import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CheckSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import { PaginationBar } from './common/PaginationBar.tsx';
import type { GLAccount, LedgerState } from '../types/accounting.ts';

interface MasterJournalProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenNewVoucher: () => void;
  onValidateJournal: () => Promise<void>;
  onApproveJournal: () => Promise<void>;
  onPostJournal: () => Promise<void>;
  onReverseVoucher: (voucherNo: string, reason: string) => Promise<void>;
  onDeleteDraft: (voucherNo: string) => Promise<void>;
  onOpenRegister: (code: string) => void;
}

export const MasterJournal: React.FC<MasterJournalProps> = ({
  state,
  busyAction,
  onOpenNewVoucher,
  onValidateJournal,
  onApproveJournal,
  onPostJournal,
  onReverseVoucher,
  onDeleteDraft,
  onOpenRegister,
}) => {
  const [filterMode, setFilterMode] = useState<'UNPOSTED' | 'ALL' | 'POSTED'>('UNPOSTED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reverseTarget, setReverseTarget] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState('');

  const postedVoucherList = useMemo(() => {
    const set = new Set<string>();
    state.postedTransactions.forEach((t) => set.add(t.voucherNo));
    return Array.from(set).sort().reverse();
  }, [state.postedTransactions]);

  const unpostedSummary = useMemo(() => {
    const unpostedLines = state.journalLines.filter((l) => l.postingStatus !== 'POSTED');
    const voucherSet = new Set(unpostedLines.map((l) => l.voucherNo));
    const approvedReady = new Set(
      unpostedLines
        .filter((l) => l.approvalStatus === 'APPROVED' && l.validationRemarks.startsWith('VALID'))
        .map((l) => l.voucherNo)
    );
    const validPending = new Set(
      unpostedLines
        .filter((l) => l.approvalStatus !== 'APPROVED' && l.validationRemarks.startsWith('VALID'))
        .map((l) => l.voucherNo)
    );
    return {
      totalUnpostedVouchers: voucherSet.size,
      validReadyToApprove: validPending.size,
      approvedReadyToPost: approvedReady.size,
    };
  }, [state.journalLines]);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...state.journalLines]
      .reverse()
      .filter((line) => {
        if (filterMode === 'UNPOSTED' && line.postingStatus === 'POSTED') return false;
        if (filterMode === 'POSTED' && line.postingStatus !== 'POSTED') return false;
        if (!q) return true;
        return (
          line.voucherNo.toLowerCase().includes(q) ||
          line.glCode.toLowerCase().includes(q) ||
          line.glName.toLowerCase().includes(q) ||
          line.description.toLowerCase().includes(q) ||
          line.reference.toLowerCase().includes(q)
        );
      });
  }, [state.journalLines, filterMode, search]);

  const handleOpenReverse = (presetVoucher?: string) => {
    setReverseTarget(presetVoucher || postedVoucherList[0] || '');
    setReverseReason('');
    setReverseError('');
    setShowReverseModal(true);
  };

  const handleSubmitReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    setReverseError('');
    if (!reverseTarget.trim()) {
      setReverseError('Please select a posted voucher to reverse.');
      return;
    }
    if (!reverseReason.trim()) {
      setReverseError('A formal audit reason / justification is required for voucher reversal.');
      return;
    }
    try {
      await onReverseVoucher(reverseTarget.trim(), reverseReason.trim());
      setShowReverseModal(false);
    } catch (err) {
      setReverseError(err instanceof Error ? err.message : 'Unable to reverse voucher.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & 4-Step Posting Engine Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Master Journal Entry & Posting Engine
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {unpostedSummary.totalUnpostedVouchers} unposted voucher(s) · {unpostedSummary.validReadyToApprove} validated awaiting approval · {unpostedSummary.approvedReadyToPost} approved ready to post
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onValidateJournal}
            disabled={busyAction !== null || unpostedSummary.totalUnpostedVouchers === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>1. Validate Entries</span>
          </button>

          <button
            onClick={onApproveJournal}
            disabled={busyAction !== null || unpostedSummary.validReadyToApprove === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
            <span>2. Approve Validated</span>
          </button>

          <button
            onClick={onPostJournal}
            disabled={busyAction !== null || unpostedSummary.approvedReadyToPost === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>3. Post Approved ({unpostedSummary.approvedReadyToPost})</span>
          </button>

          <button
            onClick={() => handleOpenReverse()}
            disabled={busyAction !== null || postedVoucherList.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
            <span>Reverse Voucher</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
          {(
            [
              { key: 'UNPOSTED', label: 'Unposted Queue' },
              { key: 'POSTED', label: 'Posted History' },
              { key: 'ALL', label: 'All Lines' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterMode(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filterMode === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search voucher no, GL code, narration..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
            />
          </div>
          <button
            onClick={onOpenNewVoucher}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#2563EB] bg-white border border-[#2563EB]/30 hover:bg-[#EFF6FF] rounded-md whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Compose</span>
          </button>
        </div>
      </div>

      {/* 13-Column Master Journal Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto ledger-scroll">
          <table className="w-full text-left border-collapse min-w-[1260px]">
            <thead>
              <tr className="bg-[#2563EB] text-white text-xs font-medium">
                <th className="py-2.5 px-3 whitespace-nowrap">Journal ID</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Voucher No</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Description</th>
                <th className="py-2.5 px-3 whitespace-nowrap">GL Code</th>
                <th className="py-2.5 px-3 whitespace-nowrap">GL Account Name</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Debit</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Credit</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Ref</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Approval</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Posting</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Validation Remarks</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLines.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center">
                    <div className="text-sm font-medium text-slate-700">
                      {filterMode === 'UNPOSTED'
                        ? 'No unposted journal vouchers in the queue.'
                        : 'No journal lines match your search.'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Create a new double-entry multi-line voucher to begin validation and posting.
                    </p>
                    <button
                      onClick={onOpenNewVoucher}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create First Voucher</span>
                    </button>
                  </td>
                </tr>
              ) : (
                filteredLines.slice((Math.min(page, Math.max(1, Math.ceil(filteredLines.length / pageSize))) - 1) * pageSize, Math.min(page, Math.max(1, Math.ceil(filteredLines.length / pageSize))) * pageSize).map((line) => {
                  const isValidRemark =
                    line.validationRemarks.startsWith('VALID') ||
                    line.validationRemarks.startsWith('POSTED');
                  const isInvalidRemark = line.validationRemarks.startsWith('INVALID');

                  return (
                    <tr key={line.journalId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                        {line.journalId}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {line.date}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-[#2563EB] whitespace-nowrap">
                        {line.voucherNo}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 max-w-[230px] truncate" title={line.description}>
                        {line.description}
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                        <button
                          onClick={() => onOpenRegister(line.glCode)}
                          className="text-[#2563EB] hover:underline font-medium cursor-pointer"
                        >
                          {line.glCode}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                        {line.glName}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {line.debit > 0 ? formatBDT(line.debit) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {line.credit > 0 ? formatBDT(line.credit) : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                        {line.reference || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                        <span
                          className={
                            line.approvalStatus === 'APPROVED'
                              ? 'text-emerald-700'
                              : line.approvalStatus === 'REJECTED'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }
                        >
                          {line.approvalStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                        <span
                          className={
                            line.postingStatus === 'POSTED' ? 'text-emerald-700' : 'text-slate-600'
                          }
                        >
                          {line.postingStatus}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-3 max-w-[240px] truncate ${
                          isInvalidRemark
                            ? 'text-red-700 font-medium'
                            : isValidRemark
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                        }`}
                        title={line.validationRemarks}
                      >
                        {line.validationRemarks}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {line.postingStatus !== 'POSTED' ? (
                          <button
                            onClick={() => onDeleteDraft(line.voucherNo)}
                            title={`Delete unposted voucher ${line.voucherNo}`}
                            className="inline-flex items-center gap-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenReverse(line.voucherNo)}
                            className="text-slate-500 hover:text-[#2563EB] hover:underline cursor-pointer"
                          >
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          page={Math.min(page, Math.max(1, Math.ceil(filteredLines.length / pageSize)))}
          pageSize={pageSize}
          totalItems={filteredLines.length}
          onPageChange={setPage}
        />
      </div>

      {/* Reverse Voucher Modal */}
      {showReverseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Reverse Posted Voucher
              </h2>
              <button
                onClick={() => setShowReverseModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmitReverse} className="p-6 space-y-4">
              {reverseError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                  {reverseError}
                </div>
              )}
              <p className="text-xs text-slate-600 leading-relaxed">
                Posted ledger records are immutable. Reversing a voucher automatically generates and posts an inverted contra-entry (<span className="font-mono">REV-VoucherNo</span>) and synchronizes all affected GL Register Books.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Posted Voucher Number
                </label>
                <select
                  value={reverseTarget}
                  onChange={(e) => setReverseTarget(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                >
                  {postedVoucherList.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Audit Justification / Reversal Reason
                </label>
                <textarea
                  rows={3}
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="e.g. Incorrect GL expense classification — rebooking to Cloud Infrastructure 5030"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReverseModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-md disabled:opacity-50 cursor-pointer"
                >
                  Generate & Post Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------- Reusable Multi-Line Journal Voucher Composer Modal ---------- */

interface VoucherComposerModalProps {
  accounts: GLAccount[];
  suggestedVoucherNo: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    voucherNo: string;
    date: string;
    description: string;
    reference: string;
    counterparty: string;
    approvalStatus: 'DRAFT' | 'PENDING_APPROVAL';
    lines: Array<{ glCode: string; debit: number; credit: number }>;
  }) => Promise<void>;
}

export const VoucherComposerModal: React.FC<VoucherComposerModalProps> = ({
  accounts,
  suggestedVoucherNo,
  busy,
  onClose,
  onSubmit,
}) => {
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'Active'),
    [accounts]
  );

  const [voucherNo, setVoucherNo] = useState(suggestedVoucherNo);
  const [date, setDate] = useState('2025-06-30');
  const [reference, setReference] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Array<{ id: number; glCode: string; debit: string; credit: string }>>([
    {
      id: 1,
      glCode: activeAccounts.find((a) => a.code === '1240')?.code || activeAccounts[0]?.code || '1240',
      debit: '',
      credit: '',
    },
    {
      id: 2,
      glCode: activeAccounts.find((a) => a.code === '4010')?.code || activeAccounts[1]?.code || '4010',
      debit: '',
      credit: '',
    },
  ]);
  const [error, setError] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const handleAiDraft = async () => {
    if (!aiPrompt.trim() || aiDrafting) return;
    setError('');
    setAiNote(null);
    setAiDrafting(true);
    try {
      const drafted = await api.draftVoucherWithAi(aiPrompt.trim(), 'MasterJournal');
      setDate(drafted.date);
      setCounterparty(drafted.counterparty);
      setReference(drafted.reference);
      setDescription(drafted.narration);
      setLines(
        drafted.lines.map((l, idx) => ({
          id: Date.now() + idx,
          glCode: l.glCode,
          debit: l.debit > 0 ? String(l.debit) : '',
          credit: l.credit > 0 ? String(l.credit) : '',
        }))
      );
      setAiNote(`${drafted.model} · ${drafted.reasoning}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to draft voucher with AI.');
    } finally {
      setAiDrafting(false);
    }
  };

  const totals = useMemo(() => {
    const dr = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const cr = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    const diff = round2(dr - cr);
    return { dr, cr, diff, balanced: dr > 0 && Math.abs(diff) < 0.005 };
  }, [lines]);

  const updateLine = (id: number, field: 'glCode' | 'debit' | 'credit', value: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        if (field === 'debit' && Number(value) > 0) return { ...l, debit: value, credit: '' };
        if (field === 'credit' && Number(value) > 0) return { ...l, credit: value, debit: '' };
        return { ...l, [field]: value };
      })
    );
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: Date.now(), glCode: activeAccounts[0]?.code || '1240', debit: '', credit: '' },
    ]);
  };

  const removeLine = (id: number) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSubmit = async (approvalStatus: 'DRAFT' | 'PENDING_APPROVAL') => {
    setError('');
    if (!voucherNo.trim() || !description.trim()) {
      setError('Voucher Number and Narration / Description are required.');
      return;
    }
    const parsedLines = lines.map((l) => ({
      glCode: l.glCode,
      debit: round2(Number(l.debit) || 0),
      credit: round2(Number(l.credit) || 0),
    }));
    if (parsedLines.some((l) => l.debit <= 0 && l.credit <= 0)) {
      setError('Every journal line must have either a Debit or Credit amount greater than zero.');
      return;
    }
    if (approvalStatus === 'PENDING_APPROVAL' && !totals.balanced) {
      setError('Voucher must be balanced (Total Debits = Total Credits) before submitting for approval.');
      return;
    }

    try {
      await onSubmit({
        voucherNo: voucherNo.trim(),
        date,
        description: description.trim(),
        reference: reference.trim(),
        counterparty: counterparty.trim() || 'General Client / Supplier',
        approvalStatus,
        lines: parsedLines,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save journal voucher.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-lg max-w-3xl w-full my-8 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-[#F8FAFC]">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Compose Double-Entry Journal Voucher
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Multi-line operational entry for Master Journal validation and atomic ledger posting
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* AI Smart Voucher Draft Bar */}
          <div className="p-3.5 rounded-md border border-slate-200 bg-[#F8FAFC] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Smart Voucher Drafting (uses Custom Instructions & Active COA)
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAiDraft();
                  }
                }}
                placeholder="Describe transaction (e.g., Pay Tk 120,000 office rent via City Bank with 5% TDS)..."
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
              />
              <button
                type="button"
                onClick={handleAiDraft}
                disabled={aiDrafting || !aiPrompt.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>{aiDrafting ? 'Drafting...' : 'Draft GL Lines'}</span>
              </button>
            </div>
            {aiNote && (
              <div className="text-[11px] text-slate-600 leading-relaxed">
                {aiNote}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Voucher Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Voucher Number
              </label>
              <input
                type="text"
                value={voucherNo}
                onChange={(e) => setVoucherNo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Transaction Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reference Number
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="INV-2515 / BEFTN-..."
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Narration / Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the accounting event..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Counterparty / Party
              </label>
              <input
                type="text"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder="Client, Vendor, Bank, or Staff Pool"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
            </div>
          </div>

          {/* Multi-Line Debit/Credit Grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">Journal Distribution Lines</span>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Line</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                    <th className="py-2 px-3">GL Account</th>
                    <th className="py-2 px-3 text-right w-36">Debit (৳)</th>
                    <th className="py-2 px-3 text-right w-36">Credit (৳)</th>
                    <th className="py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td className="p-2">
                        <select
                          value={line.glCode}
                          onChange={(e) => updateLine(line.id, 'glCode', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-[#2563EB]"
                        >
                          {activeAccounts.map((acc) => (
                            <option key={acc.code} value={acc.code}>
                              {acc.code} — {acc.name} ({acc.category})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit}
                          onChange={(e) => updateLine(line.id, 'debit', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1.5 text-xs text-right font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:border-[#2563EB]"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit}
                          onChange={(e) => updateLine(line.id, 'credit', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1.5 text-xs text-right font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:border-[#2563EB]"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length <= 2}
                          className="text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200 text-xs font-semibold">
                    <td className="py-2.5 px-3">
                      {totals.balanced ? (
                        <span className="text-emerald-700">Voucher Balanced (Dr = Cr)</span>
                      ) : (
                        <span className="text-amber-700">
                          Out of Balance by {formatBDT(Math.abs(totals.diff))}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                      {formatBDT(totals.dr)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                      {formatBDT(totals.cr)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSubmit('DRAFT')}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50 cursor-pointer"
            >
              Save as Draft
            </button>
            <button
              type="button"
              disabled={busy || !totals.balanced}
              onClick={() => handleSubmit('PENDING_APPROVAL')}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
            >
              Submit for Approval
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

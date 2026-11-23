import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Ban,
  BookCheck,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  Paperclip,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Send,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  LedgerState,
  VoucherKind,
  VoucherRecord,
  VoucherRecordStatus,
} from '../types/accounting.ts';
import { VoucherCreationModal } from './VoucherCreationModal.tsx';
import { openPaymentVoucherPrintPreview } from '../lib/paymentVoucherPrint.ts';
import { openReceiptVoucherPrintPreview } from '../lib/receiptVoucherPrint.ts';
import { openJournalVoucherPrintPreview } from '../lib/journalVoucherPrint.ts';
import { openExpenseVoucherPrintPreview } from '../lib/expenseVoucherPrint.ts';

interface VoucherManagementPageProps {
  voucherType: VoucherKind;
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onCreateVoucherRecord: (
    payload: Omit<VoucherRecord, 'id' | 'updatedAt' | 'createdBy' | 'postedToGl'> & {
      postImmediately?: boolean;
    }
  ) => Promise<void>;
  onPostVoucherToGL: (id: string) => Promise<void>;
  onVoidVoucherRecord: (id: string) => Promise<void>;
  onDeleteVoucherRecord: (id: string) => Promise<void>;
}

const PAGE_META: Record<
  VoucherKind,
  {
    title: string;
    subtitle: string;
    createLabel: string;
    refPrefix: string;
    partyColumn: string;
    primaryGl: string;
    primaryGlLabel: string;
  }
> = {
  Payment: {
    title: 'Payment Voucher',
    subtitle:
      'Vendor disbursements, statutory TDS/VDS withholding, liquidity checks, and PO/LC auto-linking.',
    createLabel: 'Create New Payment Voucher',
    refPrefix: 'ERP-PV-',
    partyColumn: 'Supplier & Mode',
    primaryGl: '1240',
    primaryGlLabel: 'Bank GL 1240',
  },
  Receipt: {
    title: 'Receipt Voucher',
    subtitle:
      'Customer collections, bank/cash deposit verification, and Sales Order / AR reconciliation.',
    createLabel: 'Create New Receipt Voucher',
    refPrefix: 'ERP-R-',
    partyColumn: 'Customer & Mode',
    primaryGl: '1120',
    primaryGlLabel: 'Receivables GL 1120',
  },
  Journal: {
    title: 'Journal Voucher',
    subtitle:
      'Multi-line accounting adjustments, accruals, depreciation, auto-reverse schedules, and double-entry checks.',
    createLabel: 'Create New Journal Voucher',
    refPrefix: 'JV-',
    partyColumn: 'Posting Type & Lines',
    primaryGl: '5340',
    primaryGlLabel: 'GL Register Books',
  },
  Expense: {
    title: 'Expense Voucher',
    subtitle:
      'Simple and split multi-item corporate expenses with department budget validation and liquidity checks.',
    createLabel: 'Create New Expense Voucher',
    refPrefix: 'ERP-EV-',
    partyColumn: 'Department & Recipient',
    primaryGl: '5190',
    primaryGlLabel: 'Expense GL 5190',
  },
};

const STATUS_FILTERS: Array<'All' | VoucherRecordStatus> = [
  'All',
  'Auto-Approved',
  'Posted to GL',
  'Voided',
];

const STATUS_TEXT_CLASS: Record<VoucherRecordStatus, string> = {
  'Auto-Approved': 'text-[#2563EB]',
  'Posted to GL': 'text-emerald-700',
  Voided: 'text-red-600',
};

export const VoucherManagementPage: React.FC<VoucherManagementPageProps> = ({
  voucherType,
  state,
  busyAction,
  onOpenRegister,
  onCreateVoucherRecord,
  onPostVoucherToGL,
  onVoidVoucherRecord,
  onDeleteVoucherRecord,
}) => {
  const meta = PAGE_META[voucherType];
  const [statusFilter, setStatusFilter] = useState<'All' | VoucherRecordStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingVoucher, setViewingVoucher] = useState<VoucherRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const vouchers = useMemo(
    () => (state.vouchers || []).filter((v) => v.voucherType === voucherType),
    [state.vouchers, voucherType]
  );

  const metrics = useMemo(() => {
    const active = vouchers.filter((v) => v.status !== 'Voided');
    const totalVolume = round2(active.reduce((s, v) => s + v.totalAmount, 0));
    const postedCount = vouchers.filter((v) => v.postedToGl).length;
    const readyToPostCount = vouchers.filter(
      (v) => v.status === 'Auto-Approved' && !v.postedToGl
    ).length;
    const totalWithheld = round2(
      active.reduce((s, v) => s + (v.tdsAmount || 0) + (v.vdsAmount || 0), 0)
    );
    const linkedDocsCount = active.reduce((s, v) => s + (v.linkedSourceDocs?.length || 0), 0);
    return {
      totalCount: vouchers.length,
      totalVolume,
      postedCount,
      readyToPostCount,
      totalWithheld,
      linkedDocsCount,
    };
  }, [vouchers]);

  const filteredVouchers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vouchers.filter((v) => {
      if (statusFilter !== 'All' && v.status !== statusFilter) return false;
      if (!q) return true;
      return (
        v.voucherRef.toLowerCase().includes(q) ||
        v.narration.toLowerCase().includes(q) ||
        (v.supplierName || '').toLowerCase().includes(q) ||
        (v.customerName || '').toLowerCase().includes(q) ||
        (v.employeeName || '').toLowerCase().includes(q) ||
        (v.department || '').toLowerCase().includes(q) ||
        (v.postingType || '').toLowerCase().includes(q) ||
        (v.bankReferenceNo || '').toLowerCase().includes(q) ||
        v.linkedSourceDocs.some((d) => d.docRef.toLowerCase().includes(q))
      );
    });
  }, [vouchers, statusFilter, searchQuery]);

  const suggestedRef = useMemo(() => {
    const defaults: Record<VoucherKind, number> = {
      Payment: 374,
      Receipt: 545,
      Journal: 503,
      Expense: 926,
    };
    const re = new RegExp(`^${meta.refPrefix.replace('-', '\\-')}(\\d+)$`);
    const maxNum = vouchers.reduce((max, v) => {
      const m = re.exec(v.voucherRef);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, defaults[voucherType]);
    return `${meta.refPrefix}${String(maxNum + 1).padStart(4, '0')}`;
  }, [vouchers, meta.refPrefix, voucherType]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_${voucherType}_Vouchers_${state.config.fiscalPeriod}.csv`,
      [
        'Voucher Ref',
        'Voucher Date',
        'Posting Date',
        'Type',
        'Party / Department',
        'Mode / Category',
        'Total Amount (BDT)',
        'TDS + VDS (BDT)',
        'Linked Docs',
        'Status',
        'Posted GL Ref',
        'Narration',
      ],
      filteredVouchers.map((v) => [
        v.voucherRef,
        v.voucherDate,
        v.postingDate,
        v.voucherType,
        v.supplierName || v.customerName || v.department || v.postingType || '—',
        v.paymentMode || v.receiptMode || v.allocationMode || v.postingType || '—',
        v.totalAmount,
        round2((v.tdsAmount || 0) + (v.vdsAmount || 0)),
        v.linkedSourceDocs.map((d) => d.docRef).join('; ') || '—',
        v.status,
        v.postedVoucherNo || 'Unposted',
        v.narration,
      ])
    );
  };

  const TypeIcon =
    voucherType === 'Payment'
      ? CreditCard
      : voucherType === 'Receipt'
        ? Wallet
        : voucherType === 'Journal'
          ? BookCheck
          : ReceiptText;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-[var(--font-display)]">
            {meta.title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{meta.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{meta.createLabel}</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total {voucherType} Volume</span>
            <TypeIcon className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {formatCompactBDT(metrics.totalVolume)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.totalCount} voucher(s) recorded
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Auto-Approved (Ready for GL)</span>
            <Send className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="mt-2 text-xl font-bold text-[#2563EB] font-mono tabular-nums">
            {metrics.readyToPostCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            1-click double-entry posting to GL Registers
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Posted to General Ledger</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-700 font-mono tabular-nums">
            {metrics.postedCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Synchronized to Posted Store &amp; Register Books
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>
              {voucherType === 'Payment' ? 'Statutory TDS + VDS' : 'Linked Source Documents'}
            </span>
            <button
              onClick={() => onOpenRegister(meta.primaryGl)}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>{meta.primaryGlLabel}</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {voucherType === 'Payment'
              ? formatBDT(metrics.totalWithheld)
              : metrics.linkedDocsCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {voucherType === 'Payment'
              ? 'Withheld under GL 2130 & GL 2160'
              : 'Auto-linked POs, LCs, Sales Orders & Jobs'}
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
            {STATUS_FILTERS.map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="relative min-w-[260px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${voucherType.toLowerCase()} ref, party, narration...`}
              className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            />
          </div>
        </div>
      </div>

      {/* Voucher Register Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Voucher Ref &amp; Dates</th>
                <th className="py-3 px-4">{meta.partyColumn}</th>
                <th className="py-3 px-4">Narration &amp; Source Links</th>
                <th className="py-3 px-4 text-right">Amount (BDT)</th>
                <th className="py-3 px-4">GL Legs</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    No {voucherType.toLowerCase()} vouchers match the current filter criteria.
                  </td>
                </tr>
              ) : (
                filteredVouchers.map((v) => {
                  const isDeleting = confirmDeleteId === v.id;
                  const glCodes = Array.from(new Set(v.doubleEntryLines.map((l) => l.glCode)));

                  return (
                    <tr
                      key={v.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        v.status === 'Voided' ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="py-3 px-4 align-top whitespace-nowrap font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{v.voucherRef}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Doc {v.voucherDate}
                        </div>
                        {v.postingDate !== v.voucherDate && (
                          <div className="text-[11px] text-slate-400">Post {v.postingDate}</div>
                        )}
                      </td>

                      <td className="py-3 px-4 align-top max-w-[240px]">
                        {voucherType === 'Payment' && (
                          <>
                            <div className="font-medium text-slate-900">{v.supplierName}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {v.paymentMode}
                              {v.bankReferenceNo ? ` · ${v.bankReferenceNo}` : ''}
                            </div>
                          </>
                        )}
                        {voucherType === 'Receipt' && (
                          <>
                            <div className="font-medium text-slate-900">{v.customerName}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {v.receiptMode} · Deposit GL {v.depositToGlCode}
                            </div>
                          </>
                        )}
                        {voucherType === 'Journal' && (
                          <>
                            <div className="font-medium text-slate-900">{v.postingType}</div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              {v.doubleEntryLines.length} lines
                              {v.autoReverseDate ? ` · Auto-Rev ${v.autoReverseDate}` : ''}
                            </div>
                          </>
                        )}
                        {voucherType === 'Expense' && (
                          <>
                            <div className="font-medium text-slate-900">
                              {v.department} · {v.costCenter}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {v.employeeName || 'Corporate Staff'} ({v.allocationMode})
                            </div>
                          </>
                        )}
                      </td>

                      <td className="py-3 px-4 align-top max-w-xs">
                        <div className="text-slate-700 line-clamp-2">{v.narration}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-mono">
                          {v.linkedSourceDocs.map((d) => (
                            <span key={d.docId} className="text-[#2563EB]">
                              {d.docType}:{d.docRef}
                            </span>
                          ))}
                          {v.attachments.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-slate-400">
                              <Paperclip className="w-3 h-3" />
                              {v.attachments.length}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">
                          {formatBDT(v.totalAmount)}
                        </div>
                        {voucherType === 'Payment' &&
                          ((v.tdsAmount || 0) > 0 || (v.vdsAmount || 0) > 0) && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Net {formatBDT(v.netPayableAmount || v.totalAmount)}
                            </div>
                          )}
                      </td>

                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className="flex flex-wrap gap-1.5 max-w-[140px]">
                          {glCodes.map((code) => (
                            <button
                              key={code}
                              onClick={() => onOpenRegister(code)}
                              className="font-mono text-[11px] text-[#2563EB] hover:underline cursor-pointer"
                            >
                              {code}
                            </button>
                          ))}
                        </div>
                      </td>

                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className={`font-semibold ${STATUS_TEXT_CLASS[v.status]}`}>
                          {v.status}
                        </div>
                        {v.status === 'Auto-Approved' && !v.postedToGl && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => onPostVoucherToGL(v.id)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer disabled:opacity-50"
                          >
                            <Send className="w-3 h-3" />
                            <span>Post to GL</span>
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        {isDeleting ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={async () => {
                                await onDeleteVoucherRecord(v.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() =>
                                v.voucherType === 'Receipt'
                                  ? openReceiptVoucherPrintPreview(v, state)
                                  : v.voucherType === 'Journal'
                                    ? openJournalVoucherPrintPreview(v, state)
                                    : v.voucherType === 'Expense'
                                      ? openExpenseVoucherPrintPreview(v, state)
                                      : openPaymentVoucherPrintPreview(v, state)
                              }
                              title={
                                v.voucherType === 'Receipt'
                                  ? 'Print / Save Receipt Voucher PDF'
                                  : v.voucherType === 'Journal'
                                    ? 'Print / Save Journal Voucher PDF'
                                    : v.voucherType === 'Expense'
                                      ? 'Print / Save Expense Voucher PDF'
                                      : 'Print / Save Payment Voucher PDF'
                              }
                              className="p-1.5 text-slate-500 hover:text-[#0b4f8a] hover:bg-blue-50 rounded cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setViewingVoucher(v)}
                              title="Inspect voucher details"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {!v.postedToGl && v.status !== 'Voided' && (
                              <button
                                disabled={busyAction !== null}
                                onClick={() => onVoidVoucherRecord(v.id)}
                                title="Void voucher"
                                className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded cursor-pointer"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!v.postedToGl && (
                              <button
                                onClick={() => setConfirmDeleteId(v.id)}
                                title="Delete voucher"
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Voucher Modal */}
      {showCreateModal && (
        <VoucherCreationModal
          voucherType={voucherType}
          state={state}
          suggestedRef={suggestedRef}
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreateVoucherRecord}
        />
      )}

      {/* Inspect Voucher Detail Modal */}
      {viewingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-bold text-slate-900 font-mono">
                  {viewingVoucher.voucherType} Voucher · {viewingVoucher.voucherRef}
                </h2>
                <div className="text-xs text-slate-500 mt-0.5">
                  Voucher Date {viewingVoucher.voucherDate} · Posting Date{' '}
                  {viewingVoucher.postingDate} · {viewingVoucher.status}
                </div>
              </div>
              <button
                onClick={() => setViewingVoucher(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-slate-100">
                <div>
                  <div className="text-slate-400">Counterparty / Allocation</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    {viewingVoucher.supplierName ||
                      viewingVoucher.customerName ||
                      viewingVoucher.department ||
                      viewingVoucher.postingType ||
                      'General Ledger'}
                  </div>
                  {viewingVoucher.employeeName && (
                    <div className="text-slate-500 mt-0.5">{viewingVoucher.employeeName}</div>
                  )}
                  {viewingVoucher.linkedProject && (
                    <div className="text-slate-500 mt-0.5">
                      Project: {viewingVoucher.linkedProject}
                    </div>
                  )}
                </div>
                <div className="sm:text-right">
                  <div className="text-slate-400">Total Voucher Value</div>
                  <div className="text-lg font-bold font-mono text-[#2563EB] tabular-nums mt-0.5">
                    {formatBDT(viewingVoucher.totalAmount)}
                  </div>
                  {viewingVoucher.bankReferenceNo && (
                    <div className="font-mono text-slate-500 mt-0.5">
                      Ref: {viewingVoucher.bankReferenceNo}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-slate-400 mb-1">Narration</div>
                <div className="text-slate-800 bg-slate-50 border border-slate-200 rounded p-3">
                  {viewingVoucher.narration}
                </div>
              </div>

              <div>
                <div className="font-semibold text-slate-800 mb-2">
                  Double-Entry Accounting Legs
                </div>
                <table className="w-full text-left border-collapse border border-slate-200 rounded overflow-hidden">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2 px-3">GL Code &amp; Account</th>
                      <th className="py-2 px-3 text-right">Debit (৳)</th>
                      <th className="py-2 px-3 text-right">Credit (৳)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {viewingVoucher.doubleEntryLines.map((line, i) => (
                      <tr key={`${line.glCode}-${i}`}>
                        <td className="py-2 px-3">
                          <button
                            onClick={() => {
                              setViewingVoucher(null);
                              onOpenRegister(line.glCode);
                            }}
                            className="text-[#2563EB] hover:underline font-semibold cursor-pointer"
                          >
                            {line.glCode}
                          </button>{' '}
                          <span className="font-sans text-slate-800">{line.glName}</span>
                          {line.memo && (
                            <span className="font-sans text-slate-400"> · {line.memo}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-900">
                          {line.debit > 0 ? formatBDT(line.debit) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-emerald-700">
                          {line.credit > 0 ? formatBDT(line.credit) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {viewingVoucher.linkedSourceDocs.length > 0 && (
                <div>
                  <div className="font-semibold text-slate-800 mb-1.5">
                    Linked Source Documents
                  </div>
                  <div className="space-y-1.5">
                    {viewingVoucher.linkedSourceDocs.map((d) => (
                      <div
                        key={d.docId}
                        className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded font-mono text-[11px]"
                      >
                        <span>
                          {d.docType} · {d.docRef} —{' '}
                          <span className="font-sans text-slate-600">{d.label}</span>
                        </span>
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {formatBDT(d.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewingVoucher.attachments.length > 0 && (
                <div>
                  <div className="font-semibold text-slate-800 mb-1.5">
                    Support Document Attachments
                  </div>
                  <div className="space-y-1">
                    {viewingVoucher.attachments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between px-3 py-1.5 border border-slate-200 rounded font-mono text-[11px] text-slate-700"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Paperclip className="w-3 h-3 text-slate-400" />
                          {a.name}
                        </span>
                        <span className="text-slate-400">{a.sizeLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                {viewingVoucher.status === 'Auto-Approved' && !viewingVoucher.postedToGl && (
                  <button
                    disabled={busyAction !== null}
                    onClick={async () => {
                      await onPostVoucherToGL(viewingVoucher.id);
                      setViewingVoucher(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Post to General Ledger</span>
                  </button>
                )}
                <button
                  onClick={() => setViewingVoucher(null)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

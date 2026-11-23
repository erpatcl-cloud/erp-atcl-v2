import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Landmark,
  Plus,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { computeGLSummary, formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { ChequeRecord, FundTransferRecord, LedgerState } from '../types/accounting.ts';

interface BankTreasuryPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onOpenRegister: (code: string) => void;
}

const CASH_BANK_ASSET_CODES = ['1210', '1220', '1230', '1240', '1250'];
const LOAN_OD_LIABILITY_CODES = ['2010', '2020', '2030'];

export const BankTreasuryPage: React.FC<BankTreasuryPageProps> = ({
  state,
  onStateChange,
  onNotify,
  onOpenRegister,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'cheques' | 'transfers' | 'reconciliation'>('overview');
  const glSummary = useMemo(() => computeGLSummary(state), [state]);

  const cashBankAssets = useMemo(
    () => glSummary.filter((r) => CASH_BANK_ASSET_CODES.includes(r.code)),
    [glSummary]
  );
  const loanLiabilities = useMemo(
    () => glSummary.filter((r) => LOAN_OD_LIABILITY_CODES.includes(r.code)),
    [glSummary]
  );

  const totalCashLiquid = useMemo(
    () => round2(cashBankAssets.reduce((s, r) => s + r.closingBalance, 0)),
    [cashBankAssets]
  );
  const totalBankLoans = useMemo(
    () => round2(loanLiabilities.reduce((s, r) => s + r.closingBalance, 0)),
    [loanLiabilities]
  );

  const cheques = state.cheques || [];
  const transfers = state.fundTransfers || [];
  const bankStatements = state.bankStatements || [];

  // Cheque form
  const [showChequeModal, setShowChequeModal] = useState(false);
  const [chequeNo, setChequeNo] = useState('');
  const [direction, setDirection] = useState<ChequeRecord['direction']>('Issued');
  const [bankGlCode, setBankGlCode] = useState('1240');
  const [partyName, setPartyName] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chequeDate, setChequeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chequeAmount, setChequeAmount] = useState('');
  const [chequeNotes, setChequeNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Transfer form
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferNo, setTransferNo] = useState(() => `TRF-2026-${String(transfers.length + 101).padStart(4, '0')}`);
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fromGlCode, setFromGlCode] = useState('1240');
  const [toGlCode, setToGlCode] = useState('1220');
  const [transferAmount, setTransferAmount] = useState('');
  const [bankChargeAmount, setBankChargeAmount] = useState('0');
  const [channel, setChannel] = useState<FundTransferRecord['channel']>('BEFTN');
  const [transferRef, setTransferRef] = useState('');

  // Bank Rec state
  const [recBankGl, setRecBankGl] = useState('1240');
  const [stmtDate, setStmtDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stmtDesc, setStmtDesc] = useState('');
  const [stmtRef, setStmtRef] = useState('');
  const [stmtDebit, setStmtDebit] = useState('0');
  const [stmtCredit, setStmtCredit] = useState('0');

  const bankTxns = useMemo(
    () => state.postedTransactions.filter((t) => t.glCode === recBankGl).slice(-40).reverse(),
    [state.postedTransactions, recBankGl]
  );

  const recEntries = useMemo(
    () => bankStatements.filter((b) => b.bankGlCode === recBankGl),
    [bankStatements, recBankGl]
  );

  const bookBalanceForRec = useMemo(
    () => glSummary.find((r) => r.code === recBankGl)?.closingBalance ?? 0,
    [glSummary, recBankGl]
  );
  const reconciledStmtNet = useMemo(
    () => round2(recEntries.filter((e) => e.reconciled).reduce((s, e) => s + e.credit - e.debit, 0)),
    [recEntries]
  );

  const handleCreateCheque = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const bankName = state.accounts.find((a) => a.code === bankGlCode)?.name || bankGlCode;
      const res = await api.createCheque({
        chequeNo: chequeNo.trim().toUpperCase(),
        direction,
        bankGlCode,
        bankName,
        partyName: partyName.trim(),
        issueDate,
        chequeDate,
        amount: round2(Number(chequeAmount) || 0),
        status: direction === 'Issued' ? 'Issued' : 'Deposited',
        notes: chequeNotes.trim(),
      });
      onStateChange(res.state);
      onNotify('success', `Logged ${direction} Cheque ${res.cheque.chequeNo}.`);
      setShowChequeModal(false);
      setChequeNo('');
      setPartyName('');
      setChequeAmount('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save cheque.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChequeStatus = async (id: string, status: ChequeRecord['status']) => {
    try {
      const res = await api.updateChequeStatus(id, { status });
      onStateChange(res.state);
      onNotify(status === 'Bounced' ? 'info' : 'success', `Cheque ${res.cheque.chequeNo} marked ${status}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update cheque.');
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createFundTransfer({
        transferNo: transferNo.trim().toUpperCase(),
        transferDate,
        fromGlCode,
        toGlCode,
        amount: round2(Number(transferAmount) || 0),
        bankChargeAmount: round2(Number(bankChargeAmount) || 0),
        channel,
        reference: transferRef.trim() || transferNo,
        notes: `${channel} transfer`,
      });
      onStateChange(res.state);
      onNotify('success', `Posted ${res.transfer.postedVoucherNo} to GL & Register Books.`);
      setShowTransferModal(false);
      setTransferAmount('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Transfer failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddStmtLine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.addBankStatementLine({
        bankGlCode: recBankGl,
        statementDate: stmtDate,
        description: stmtDesc.trim() || 'Bank Statement Entry',
        reference: stmtRef.trim() || recBankGl,
        debit: round2(Number(stmtDebit) || 0),
        credit: round2(Number(stmtCredit) || 0),
      });
      onStateChange(res.state);
      onNotify('success', 'Added bank statement line for reconciliation.');
      setStmtDesc('');
      setStmtRef('');
      setStmtDebit('0');
      setStmtCredit('0');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to add statement line.');
    }
  };

  const handleMatchLine = async (stmtId: string, txnId: string) => {
    try {
      const res = await api.matchBankStatementLine(stmtId, txnId);
      onStateChange(res.state);
      onNotify('success', 'Statement entry matched and reconciled against GL transaction.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to match entry.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Bank, Cash &amp; Treasury Management</h1>
          <p className="text-xs text-slate-500">
            Strictly segregates liquid Cash &amp; Bank Assets (GL 1210–1250) from Bank Loans &amp; Overdrafts (GL 2010–2030), Cheque Clearing, BEFTN/RTGS Transfers &amp; Bank Rec.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowChequeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <CreditCard className="w-3.5 h-3.5" /> Log Cheque
          </button>
          <button
            onClick={() => {
              setTransferNo(`TRF-2026-${String(transfers.length + 101).padStart(4, '0')}`);
              setShowTransferModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" /> Fund Transfer / LC Margin
          </button>
        </div>
      </div>

      {/* Top KPI Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Liquid Cash &amp; Bank Assets (1210–1250)</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-700">{formatBDT(totalCashLiquid)}</div>
          <div className="text-[11px] text-slate-400 mt-1">{cashBankAssets.length} active asset treasury GL(s)</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-amber-600 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Bank Loans &amp; Overdrafts (2010–2030)</span>
            <Landmark className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-700">{formatBDT(totalBankLoans)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Liability facilities segregated from cash</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Active PDC / Uncleared Cheques</span>
            <RefreshCw className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900">
            {cheques.filter((c) => c.status === 'Issued' || c.status === 'Deposited').length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Total {cheques.length} cheque instrument(s) logged</div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="inline-flex flex-wrap bg-slate-200/70 p-1 rounded-lg gap-1 text-xs">
        {[
          { id: 'overview', label: 'Bank Assets vs Loans' },
          { id: 'cheques', label: `Cheque Register (${cheques.length})` },
          { id: 'transfers', label: `Fund Transfers & LC Margin (${transfers.length})` },
          { id: 'reconciliation', label: `Bank Reconciliation (${recEntries.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
              activeTab === t.id ? 'bg-white text-[#2563EB] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-emerald-50/70 border-b border-slate-200 font-bold text-xs text-emerald-900">
              Asset Accounts — Cash, Bank &amp; POS Clearing (1210–1250)
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {cashBankAssets.map((acc) => (
                  <tr key={acc.code} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{acc.code}</td>
                    <td className="py-2.5 px-3 text-slate-800">{acc.name}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                      {formatBDT(acc.closingBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => onOpenRegister(acc.code)}
                        className="inline-flex items-center gap-0.5 text-[#2563EB] font-mono text-[11px] hover:underline cursor-pointer"
                      >
                        Register <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-50/70 border-b border-slate-200 font-bold text-xs text-amber-900">
              Liability Accounts — Bank Loans &amp; Overdrafts (2010–2030)
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {loanLiabilities.map((acc) => (
                  <tr key={acc.code} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{acc.code}</td>
                    <td className="py-2.5 px-3 text-slate-800">{acc.name}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                      {formatBDT(acc.closingBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => onOpenRegister(acc.code)}
                        className="inline-flex items-center gap-0.5 text-[#2563EB] font-mono text-[11px] hover:underline cursor-pointer"
                      >
                        Register <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'cheques' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Cheque No.</th>
                <th className="py-2.5 px-3 text-left">Direction / Party</th>
                <th className="py-2.5 px-3 text-left">Bank Account</th>
                <th className="py-2.5 px-3 text-left">Cheque Date</th>
                <th className="py-2.5 px-3 text-right">Amount (BDT)</th>
                <th className="py-2.5 px-3 text-left">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cheques.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No cheques logged yet. Click &ldquo;Log Cheque&rdquo; to track PDC / vendor / customer cheques.
                  </td>
                </tr>
              ) : (
                cheques.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{c.chequeNo}</td>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-slate-800">{c.direction}</span> · {c.partyName}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{c.bankGlCode} · {c.bankName}</td>
                    <td className="py-2.5 px-3 text-slate-600">{c.chequeDate}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatBDT(c.amount)}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          c.status === 'Cleared'
                            ? 'bg-emerald-50 text-emerald-700'
                            : c.status === 'Bounced' || c.status === 'Cancelled'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1">
                      {(c.status === 'Issued' || c.status === 'Deposited') && (
                        <>
                          <button
                            onClick={() => void handleChequeStatus(c.id, 'Cleared')}
                            className="px-2 py-0.5 text-[11px] bg-emerald-600 text-white rounded cursor-pointer"
                          >
                            Clear
                          </button>
                          <button
                            onClick={() => void handleChequeStatus(c.id, 'Bounced')}
                            className="px-2 py-0.5 text-[11px] bg-red-50 text-red-700 border border-red-200 rounded cursor-pointer"
                          >
                            Bounce
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Transfer #</th>
                <th className="py-2.5 px-3 text-left">Date / Channel</th>
                <th className="py-2.5 px-3 text-left">From GL &rarr; To GL</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
                <th className="py-2.5 px-3 text-right">Bank Charge (5420)</th>
                <th className="py-2.5 px-3 text-left">GL Voucher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No inter-bank transfers or LC margin deposits posted yet.
                  </td>
                </tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{t.transferNo}</td>
                    <td className="py-2.5 px-3">{t.transferDate} · {t.channel}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{t.fromGlCode} &rarr; {t.toGlCode}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatBDT(t.amount)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatBDT(t.bankChargeAmount)}</td>
                    <td className="py-2.5 px-3 font-mono text-emerald-700">{t.postedVoucherNo}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'reconciliation' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <label className="font-semibold text-slate-700">Select Bank GL:</label>
              <select
                value={recBankGl}
                onChange={(e) => setRecBankGl(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded bg-white font-mono"
              >
                {cashBankAssets.map((b) => (
                  <option key={b.code} value={b.code}>{b.code} — {b.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-4 font-mono">
              <span>Book Balance: <strong>{formatBDT(bookBalanceForRec)}</strong></span>
              <span>Matched Statement Net: <strong className="text-emerald-700">{formatBDT(reconciledStmtNet)}</strong></span>
            </div>
          </div>

          <form onSubmit={handleAddStmtLine} className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
            <input type="date" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded" required />
            <input value={stmtDesc} onChange={(e) => setStmtDesc(e.target.value)} placeholder="Statement description" className="md:col-span-2 px-2 py-1.5 border border-slate-300 rounded" required />
            <input value={stmtRef} onChange={(e) => setStmtRef(e.target.value)} placeholder="Bank Ref / Cheque #" className="px-2 py-1.5 border border-slate-300 rounded font-mono" />
            <div className="grid grid-cols-2 gap-1">
              <input type="number" step="0.01" min="0" value={stmtDebit} onChange={(e) => setStmtDebit(e.target.value)} placeholder="Withdrawal" className="px-2 py-1.5 border border-slate-300 rounded font-mono" />
              <input type="number" step="0.01" min="0" value={stmtCredit} onChange={(e) => setStmtCredit(e.target.value)} placeholder="Deposit" className="px-2 py-1.5 border border-slate-300 rounded font-mono" />
            </div>
            <button type="submit" className="px-3 py-1.5 bg-[#2563EB] text-white font-semibold rounded inline-flex items-center justify-center gap-1 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add Stmt Line
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3 text-left">Stmt Date</th>
                  <th className="py-2.5 px-3 text-left">Description &amp; Ref</th>
                  <th className="py-2.5 px-3 text-right">Withdrawal (Dr)</th>
                  <th className="py-2.5 px-3 text-right">Deposit (Cr)</th>
                  <th className="py-2.5 px-3 text-left">Match Posted GL Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recEntries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Add bank statement lines above to match against GL {recBankGl} transactions.
                    </td>
                  </tr>
                ) : (
                  recEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2 px-3 font-mono">{entry.statementDate}</td>
                      <td className="py-2 px-3">
                        <div className="font-medium text-slate-800">{entry.description}</div>
                        <div className="text-[11px] font-mono text-slate-400">{entry.reference}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{entry.debit > 0 ? formatBDT(entry.debit) : '—'}</td>
                      <td className="py-2 px-3 text-right font-mono">{entry.credit > 0 ? formatBDT(entry.credit) : '—'}</td>
                      <td className="py-2 px-3">
                        {entry.reconciled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-mono text-[11px] font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Matched ({entry.matchedTxnId})
                          </span>
                        ) : (
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) void handleMatchLine(entry.id, e.target.value);
                            }}
                            className="px-2 py-1 border border-slate-300 rounded bg-white text-[11px] max-w-xs"
                          >
                            <option value="">-- Match to GL Entry --</option>
                            {bankTxns.map((tx) => (
                              <option key={tx.transactionId} value={tx.transactionId}>
                                {tx.voucherNo} · {tx.date} · {tx.debit > 0 ? `+${formatBDT(tx.debit)}` : `-${formatBDT(tx.credit)}`}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showChequeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreateCheque} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Record Cheque / PDC Instrument</h2>
              <button type="button" onClick={() => setShowChequeModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Cheque No. *</label>
                <input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Direction</label>
                <select value={direction} onChange={(e) => setDirection(e.target.value as any)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="Issued">Issued (Vendor)</option>
                  <option value="Received">Received (Customer)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Bank GL</label>
                <select value={bankGlCode} onChange={(e) => setBankGlCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white font-mono">
                  {cashBankAssets.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount (BDT) *</label>
                <input type="number" step="0.01" min="0.01" value={chequeAmount} onChange={(e) => setChequeAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Payee / Drawer Party Name *</label>
              <input value={partyName} onChange={(e) => setPartyName(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Issue Date</label>
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Cheque / Clearing Date</label>
                <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Notes</label>
              <input value={chequeNotes} onChange={(e) => setChequeNotes(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowChequeModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Save Cheque</button>
            </div>
          </form>
        </div>
      )}

      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreateTransfer} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Post Inter-Bank Transfer / LC Margin</h2>
              <button type="button" onClick={() => setShowTransferModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Transfer No. *</label>
                <input value={transferNo} onChange={(e) => setTransferNo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Channel</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value as any)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option>BEFTN</option>
                  <option>RTGS</option>
                  <option>NPSB</option>
                  <option>Cash Deposit</option>
                  <option>Cash Withdrawal</option>
                  <option>LC Margin</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">From GL (Credit) *</label>
                <select value={fromGlCode} onChange={(e) => setFromGlCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white font-mono">
                  {cashBankAssets.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">To GL (Debit) *</label>
                <select value={toGlCode} onChange={(e) => setToGlCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white font-mono">
                  {cashBankAssets.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                  <option value="1130">1130 — LC Margin / Deposits</option>
                  <option value="2010">2010 — Repay Bank Loan IBBL</option>
                  <option value="2020">2020 — Repay SJIBL Loan</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount *</label>
                <input type="number" step="0.01" min="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Charge (5420)</label>
                <input type="number" step="0.01" min="0" value={bankChargeAmount} onChange={(e) => setBankChargeAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Bank / LC Reference</label>
              <input value={transferRef} onChange={(e) => setTransferRef(e.target.value)} placeholder="RTGS / LC Ref..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowTransferModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Post Transfer to GL</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

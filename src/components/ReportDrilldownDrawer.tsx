import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Info,
  Search,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  computeIncomeStatement,
  exportRowsToCSV,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type { LedgerState, PostedTransaction } from '../types/accounting.ts';

export interface ReportDrilldownTarget {
  sourceReport: 'Income Statement' | 'Balance Sheet';
  sectionLabel: string;
  /** Either a specific GL account code, or 'NET-PL' for Balance Sheet Current Year Net Profit */
  code: string;
  name: string;
  reportedAmount: number;
  priorAmount: number;
  isContra?: boolean;
}

interface ReportDrilldownDrawerProps {
  state: LedgerState;
  target: ReportDrilldownTarget | null;
  onClose: () => void;
  onOpenRegister: (code: string) => void;
  onNavigateToIncomeStatement?: () => void;
}

interface EnrichedDrilldownRow {
  tx: PostedTransaction;
  runningBalance: number;
  netEffect: number;
}

export const ReportDrilldownDrawer: React.FC<ReportDrilldownDrawerProps> = ({
  state,
  target,
  onClose,
  onOpenRegister,
  onNavigateToIncomeStatement,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'debit' | 'credit'>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedVoucherKey, setExpandedVoucherKey] = useState<string | null>(null);

  // Reset filters whenever target changes
  useEffect(() => {
    setSearchQuery('');
    setTypeFilter('all');
    setSortOrder('asc');
    setExpandedVoucherKey(null);
  }, [target?.code, target?.sourceReport]);

  // Close on Escape key
  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, onClose]);

  const accountByCode = useMemo(() => {
    const map = new Map(state.accounts.map((a) => [a.code, a]));
    return map;
  }, [state.accounts]);

  const glSummaryByCode = useMemo(() => {
    const summary = computeGLSummary(state);
    return new Map(summary.map((row) => [row.code, row]));
  }, [state]);

  const voucherLinesByNo = useMemo(() => {
    const map = new Map<string, PostedTransaction[]>();
    for (const tx of state.postedTransactions) {
      const key = tx.voucherNo || tx.journalId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tx);
    }
    return map;
  }, [state.postedTransactions]);

  const drilldownData = useMemo(() => {
    if (!target) return null;

    const isNetProfitLine = target.code === 'NET-PL';

    if (isNetProfitLine) {
      const isReport = computeIncomeStatement(state);
      const plAccountCodes = new Set(
        state.accounts
          .filter((a) => a.category === 'Income' || a.category === 'Expense')
          .map((a) => a.code)
      );

      const openingNetProfit = round2(
        state.accounts.reduce((sum, a) => {
          if (a.category === 'Income') return sum + a.openingBalance;
          if (a.category === 'Expense') return sum - a.openingBalance;
          return sum;
        }, 0)
      );

      const matching = state.postedTransactions
        .filter((tx) => plAccountCodes.has(tx.glCode))
        .slice()
        .sort((a, b) => {
          const d = a.date.localeCompare(b.date);
          if (d !== 0) return d;
          const ts = a.postTimestamp.localeCompare(b.postTimestamp);
          if (ts !== 0) return ts;
          return a.transactionId.localeCompare(b.transactionId);
        });

      let running = openingNetProfit;
      let periodDebit = 0;
      let periodCredit = 0;
      const rows: EnrichedDrilldownRow[] = matching.map((tx) => {
        periodDebit = round2(periodDebit + tx.debit);
        periodCredit = round2(periodCredit + tx.credit);
        const netEffect = round2(tx.credit - tx.debit);
        running = round2(running + netEffect);
        return { tx, runningBalance: running, netEffect };
      });

      return {
        isNetProfitLine: true,
        account: null,
        summaryRow: null,
        normalBalance: 'Credit' as const,
        openingBalance: openingNetProfit,
        periodDebit,
        periodCredit,
        closingBalance: isReport.netProfit,
        rows,
      };
    }

    const account = accountByCode.get(target.code) || null;
    const summaryRow = glSummaryByCode.get(target.code) || null;
    const normalBalance = account?.normalBalance ?? 'Debit';
    const openingBalance = account?.openingBalance ?? 0;

    const matching = state.postedTransactions
      .filter((tx) => tx.glCode === target.code)
      .slice()
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        const ts = a.postTimestamp.localeCompare(b.postTimestamp);
        if (ts !== 0) return ts;
        return a.transactionId.localeCompare(b.transactionId);
      });

    let running = openingBalance;
    let periodDebit = 0;
    let periodCredit = 0;
    const rows: EnrichedDrilldownRow[] = matching.map((tx) => {
      periodDebit = round2(periodDebit + tx.debit);
      periodCredit = round2(periodCredit + tx.credit);
      const netEffect =
        normalBalance === 'Debit'
          ? round2(tx.debit - tx.credit)
          : round2(tx.credit - tx.debit);
      running = round2(running + netEffect);
      return { tx, runningBalance: running, netEffect };
    });

    const closingBalance = summaryRow ? summaryRow.closingBalance : running;

    return {
      isNetProfitLine: false,
      account,
      summaryRow,
      normalBalance,
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance,
      rows,
    };
  }, [target, state, accountByCode, glSummaryByCode]);

  const filteredRows = useMemo(() => {
    if (!drilldownData) return [];
    const q = searchQuery.trim().toLowerCase();

    const filtered = drilldownData.rows.filter(({ tx }) => {
      if (typeFilter === 'debit' && tx.debit <= 0) return false;
      if (typeFilter === 'credit' && tx.credit <= 0) return false;
      if (!q) return true;
      return (
        tx.voucherNo.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q) ||
        tx.reference.toLowerCase().includes(q) ||
        tx.counterparty.toLowerCase().includes(q) ||
        tx.contraCode.toLowerCase().includes(q) ||
        tx.contraName.toLowerCase().includes(q) ||
        tx.glCode.toLowerCase().includes(q) ||
        tx.glName.toLowerCase().includes(q) ||
        tx.date.toLowerCase().includes(q)
      );
    });

    return sortOrder === 'asc' ? filtered : filtered.slice().reverse();
  }, [drilldownData, searchQuery, typeFilter, sortOrder]);

  const filteredTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of filteredRows) {
      debit = round2(debit + r.tx.debit);
      credit = round2(credit + r.tx.credit);
    }
    return { debit, credit };
  }, [filteredRows]);

  if (!target || !drilldownData) return null;

  const handleExportDrilldown = () => {
    const dateTag = new Date().toISOString().slice(0, 10);
    const safeCode = target.code.replace(/[^a-zA-Z0-9_-]/g, '_');
    exportRowsToCSV(
      `ATCL_Drilldown_${safeCode}_${dateTag}.csv`,
      [
        'Date',
        'Voucher No',
        'GL Code',
        'GL Account',
        'Description',
        'Counterparty',
        'Reference',
        'Contra Account',
        'Debit (BDT)',
        'Credit (BDT)',
        'Running Balance (BDT)',
      ],
      filteredRows.map(({ tx, runningBalance }) => [
        tx.date,
        tx.voucherNo,
        tx.glCode,
        tx.glName,
        tx.description,
        tx.counterparty,
        tx.reference,
        `${tx.contraCode} ${tx.contraName}`.trim(),
        tx.debit.toFixed(2),
        tx.credit.toFixed(2),
        runningBalance.toFixed(2),
      ])
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drilldown-drawer-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/45 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-Over Panel */}
      <div className="relative z-10 w-full max-w-4xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-[#2563EB]">{target.sourceReport}</span>
              <span aria-hidden="true">/</span>
              <span>{target.sectionLabel}</span>
              {!drilldownData.isNetProfitLine && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-600">
                    Normal: {drilldownData.normalBalance}
                    {target.isContra ? ' (Contra-Asset)' : ''}
                  </span>
                </>
              )}
            </div>
            <h2
              id="drilldown-drawer-title"
              className="text-lg font-bold text-slate-900 mt-1 flex items-center gap-2 flex-wrap"
            >
              <span className="font-mono text-[#2563EB]">{target.code}</span>
              <span className="truncate">{target.name}</span>
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {filteredRows.length > 0 && (
              <button
                type="button"
                onClick={handleExportDrilldown}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>
            )}
            {drilldownData.isNetProfitLine ? (
              onNavigateToIncomeStatement && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToIncomeStatement();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                >
                  <span>View Income Statement</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRegister(target.code);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
              >
                <span>Open Register Book</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close transaction drill-down"
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-md cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Reconciliation Proof Strip */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] font-medium text-slate-500">Opening Balance</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-slate-800 mt-1">
                {formatBDT(drilldownData.openingBalance)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] font-medium text-slate-500">Period Debits</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-slate-800 mt-1">
                {formatBDT(drilldownData.periodDebit)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] font-medium text-slate-500">Period Credits</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-slate-800 mt-1">
                {formatBDT(drilldownData.periodCredit)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-[#EFF6FF] border border-[#2563EB]/25">
              <div className="text-[11px] font-medium text-[#2563EB]">
                {target.isContra ? 'Reported Carrying' : 'Reported FY 24-25'}
              </div>
              <div
                className={`text-sm font-mono font-bold tabular-nums mt-1 ${
                  target.reportedAmount < 0 ? 'text-red-700' : 'text-[#2563EB]'
                }`}
              >
                {formatBDT(target.reportedAmount)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] font-medium text-slate-500">Comparative FY 23-24</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-slate-600 mt-1">
                {formatBDT(target.priorAmount)}
              </div>
            </div>
          </div>

          {target.isContra && (
            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded px-3 py-1.5">
              <Info className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
              <span>
                Contra-asset account carries a normal Credit closing balance of{' '}
                <strong className="font-mono text-slate-800">
                  {formatBDT(drilldownData.closingBalance)}
                </strong>
                , presented as a deduction of{' '}
                <strong className="font-mono text-red-700">
                  {formatBDT(target.reportedAmount)}
                </strong>{' '}
                under Assets.
              </span>
            </div>
          )}
        </div>

        {/* Search & Filter Controls */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by voucher no, narration, counterparty, ref..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-md">
              {(
                [
                  { id: 'all', label: 'All Entries' },
                  { id: 'debit', label: 'Debits Only' },
                  { id: 'credit', label: 'Credits Only' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded cursor-pointer transition-colors ${
                    typeFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              <ArrowDownUp className="w-3 h-3 text-slate-500" />
              <span>{sortOrder === 'asc' ? 'Oldest First' : 'Latest First'}</span>
            </button>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="flex-1 overflow-auto ledger-scroll">
          {drilldownData.rows.length === 0 ? (
            <div className="p-10 text-center max-w-md mx-auto">
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                No Posted Transactions in FY {state.config.fiscalPeriod}
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                This account balance is carried forward entirely from its Opening Balance of{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {formatBDT(drilldownData.openingBalance)}
                </span>{' '}
                with zero posted journal movements during the current fiscal period.
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-xs text-slate-500">
                No transactions match the current filter criteria.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setTypeFilter('all');
                }}
                className="mt-2 text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[740px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#2563EB] text-white text-[11px] font-medium">
                  <th className="py-2.5 pl-5 pr-2 w-8" aria-label="Expand voucher" />
                  <th className="py-2.5 px-2.5 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-2.5 whitespace-nowrap">Voucher No</th>
                  {drilldownData.isNetProfitLine && (
                    <th className="py-2.5 px-2.5 whitespace-nowrap">GL Account</th>
                  )}
                  <th className="py-2.5 px-2.5">Particulars & Counterparty</th>
                  <th className="py-2.5 px-2.5">Contra Account</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Debit (BDT)</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Credit (BDT)</th>
                  <th className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">Running Bal.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {/* Opening Balance Reference Row when showing unfiltered chronological ledger */}
                {sortOrder === 'asc' && typeFilter === 'all' && !searchQuery.trim() && (
                  <tr className="bg-slate-50/90 text-slate-600">
                    <td className="py-2 pl-5 pr-2" />
                    <td className="py-2 px-2.5 font-mono text-[11px] whitespace-nowrap">
                      Opening
                    </td>
                    <td className="py-2 px-2.5 font-mono text-[11px] text-slate-400">B/F</td>
                    {drilldownData.isNetProfitLine && (
                      <td className="py-2 px-2.5 text-[11px] text-slate-400">All P&L</td>
                    )}
                    <td className="py-2 px-2.5 italic" colSpan={2}>
                      Balance Brought Forward — Start of FY {state.config.fiscalPeriod}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                      —
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                      —
                    </td>
                    <td className="py-2 pl-3 pr-5 text-right font-mono font-semibold tabular-nums text-slate-800 whitespace-nowrap">
                      {formatBDT(drilldownData.openingBalance)}
                    </td>
                  </tr>
                )}

                {filteredRows.map(({ tx, runningBalance }) => {
                  const voucherKey = tx.voucherNo || tx.journalId;
                  const rowKey = `${tx.transactionId}-${tx.glCode}`;
                  const isExpanded = expandedVoucherKey === rowKey;
                  const siblingLines = voucherLinesByNo.get(voucherKey) || [];

                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        onClick={() =>
                          setExpandedVoucherKey((curr) => (curr === rowKey ? null : rowKey))
                        }
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? 'bg-[#EFF6FF]' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-2.5 pl-5 pr-2 text-slate-400 align-top">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-[#2563EB] mt-0.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 mt-0.5" />
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap align-top">
                          {tx.date}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono font-semibold text-[#2563EB] whitespace-nowrap align-top">
                          {tx.voucherNo}
                        </td>
                        {drilldownData.isNetProfitLine && (
                          <td className="py-2.5 px-2.5 align-top max-w-[160px]">
                            <div className="font-mono text-[11px] font-semibold text-slate-700">
                              {tx.glCode}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">{tx.glName}</div>
                          </td>
                        )}
                        <td className="py-2.5 px-2.5 align-top">
                          <div className="text-slate-900 font-medium leading-snug">
                            {tx.description}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                            {tx.counterparty && <span>{tx.counterparty}</span>}
                            {tx.reference && (
                              <span className="font-mono text-slate-400">Ref: {tx.reference}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 align-top max-w-[165px]">
                          <div className="font-mono text-[11px] text-slate-500">
                            {tx.contraCode}
                          </div>
                          <div className="text-[11px] text-slate-600 truncate">
                            {tx.contraName}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap align-top">
                          {tx.debit > 0 ? formatBDT(tx.debit) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap align-top">
                          {tx.credit > 0 ? formatBDT(tx.credit) : '—'}
                        </td>
                        <td
                          className={`py-2.5 pl-3 pr-5 text-right font-mono font-semibold tabular-nums whitespace-nowrap align-top ${
                            runningBalance < 0 ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {formatBDT(runningBalance)}
                        </td>
                      </tr>

                      {/* Expanded Full Double-Entry Voucher Breakdown */}
                      {isExpanded && siblingLines.length > 0 && (
                        <tr className="bg-slate-50/90">
                          <td
                            colSpan={drilldownData.isNetProfitLine ? 9 : 8}
                            className="px-6 py-3 border-t border-b border-slate-200/80"
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wider">
                                Full Double-Entry Voucher · {voucherKey} ({siblingLines.length}{' '}
                                lines)
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                Posted by {tx.enteredBy} · {tx.journalId}
                              </div>
                            </div>
                            <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
                              <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                  <tr className="bg-slate-100 text-slate-600 font-semibold">
                                    <th className="py-1.5 px-3">GL Code</th>
                                    <th className="py-1.5 px-3">Account Name</th>
                                    <th className="py-1.5 px-3">Line Narration</th>
                                    <th className="py-1.5 px-3 text-right">Debit</th>
                                    <th className="py-1.5 px-3 text-right">Credit</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {siblingLines.map((line) => {
                                    const isCurrent = line.transactionId === tx.transactionId;
                                    return (
                                      <tr
                                        key={line.transactionId}
                                        className={isCurrent ? 'bg-[#EFF6FF] font-medium' : ''}
                                      >
                                        <td className="py-1.5 px-3 font-mono text-[#2563EB] whitespace-nowrap">
                                          {line.glCode}
                                        </td>
                                        <td className="py-1.5 px-3 text-slate-800 whitespace-nowrap">
                                          {line.glName}
                                        </td>
                                        <td className="py-1.5 px-3 text-slate-600">
                                          {line.description}
                                        </td>
                                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                                          {line.debit > 0 ? formatBDT(line.debit) : '—'}
                                        </td>
                                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                                          {line.credit > 0 ? formatBDT(line.credit) : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Totals & Verification Bar */}
        <div className="px-6 py-3 border-t border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="text-slate-600">
            Showing <span className="font-mono font-semibold text-slate-900">{filteredRows.length}</span>{' '}
            of <span className="font-mono font-semibold text-slate-900">{drilldownData.rows.length}</span>{' '}
            posted transaction{drilldownData.rows.length === 1 ? '' : 's'}
            <span className="text-slate-400 ml-2 hidden sm:inline">
              · Click any row to expand full voucher legs
            </span>
          </div>
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span className="text-slate-600">
              Dr:{' '}
              <strong className="text-slate-900">{formatBDT(filteredTotals.debit)}</strong>
            </span>
            <span className="text-slate-600">
              Cr:{' '}
              <strong className="text-slate-900">{formatBDT(filteredTotals.credit)}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

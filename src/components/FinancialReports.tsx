import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  Printer,
  RotateCcw,
} from 'lucide-react';
import {
  computeBalanceSheet,
  computeCashFlowStatement,
  computeEquityChangesStatement,
  computeGLSummary,
  computeIncomeStatement,
  computeMonthlySummary,
  computeTrialBalance,
  exportRowsToCSV,
  formatBDT,
  scopeLedgerStateToPeriod,
} from '../engine/accountingEngine.ts';
import type { AccountCategory, ActiveRoute, LedgerState } from '../types/accounting.ts';
import {
  ReportDrilldownDrawer,
  type ReportDrilldownTarget,
} from './ReportDrilldownDrawer.tsx';
import { AiReportInsightsCard } from './AiReportInsightsCard.tsx';

interface FinancialReportsProps {
  state: LedgerState;
  activeRoute:
    | 'reports-summary'
    | 'reports-trial-balance'
    | 'reports-income'
    | 'reports-balance-sheet'
    | 'reports-cash-flow'
    | 'reports-equity-changes'
    | 'reports-monthly';
  onNavigate: (route: ActiveRoute) => void;
  onOpenRegister: (code: string) => void;
}

const REPORT_TABS: Array<{
  route:
    | 'reports-summary'
    | 'reports-trial-balance'
    | 'reports-income'
    | 'reports-balance-sheet'
    | 'reports-cash-flow'
    | 'reports-equity-changes'
    | 'reports-monthly';
  label: string;
}> = [
  { route: 'reports-summary', label: 'GL Summary' },
  { route: 'reports-trial-balance', label: 'Trial Balance' },
  { route: 'reports-income', label: 'Income Statement' },
  { route: 'reports-balance-sheet', label: 'Balance Sheet' },
  { route: 'reports-cash-flow', label: 'Cash Flow' },
  { route: 'reports-equity-changes', label: 'Changes in Equity' },
  { route: 'reports-monthly', label: 'Monthly Matrix' },
];

export const FinancialReports: React.FC<FinancialReportsProps> = ({
  state,
  activeRoute,
  onNavigate,
  onOpenRegister,
}) => {
  const [summaryCat, setSummaryCat] = useState<'All' | AccountCategory>('All');
  const [hideZeroRows, setHideZeroRows] = useState(false);
  const [tbMode, setTbMode] = useState<'comparative' | '8col'>('comparative');
  const [matrixMetric, setMatrixMetric] = useState<'net' | 'debit' | 'credit'>('net');
  const [drilldownTarget, setDrilldownTarget] = useState<ReportDrilldownTarget | null>(null);
  const [periodPreset, setPeriodPreset] = useState<'all' | 'this-month' | 'last-month' | 'this-quarter' | 'ytd' | 'custom'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const applyPeriodPreset = (preset: 'all' | 'this-month' | 'last-month' | 'this-quarter' | 'ytd') => {
    setPeriodPreset(preset);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    if (preset === 'this-month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFromDate(fmtDate(start));
      setToDate(fmtDate(end));
      return;
    }
    if (preset === 'last-month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(fmtDate(start));
      setToDate(fmtDate(end));
      return;
    }
    if (preset === 'this-quarter') {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qStartMonth, 1);
      const end = new Date(now.getFullYear(), qStartMonth + 3, 0);
      setFromDate(fmtDate(start));
      setToDate(fmtDate(end));
      return;
    }
    if (preset === 'ytd') {
      const start = new Date(now.getFullYear(), 0, 1);
      setFromDate(fmtDate(start));
      setToDate(fmtDate(now));
    }
  };

  const periodState = useMemo(
    () => scopeLedgerStateToPeriod(state, fromDate, toDate),
    [state, fromDate, toDate]
  );

  const glSummary = useMemo(() => computeGLSummary(periodState), [periodState]);
  const trialBalance = useMemo(() => computeTrialBalance(periodState), [periodState]);
  const incomeStatement = useMemo(() => computeIncomeStatement(periodState), [periodState]);
  const balanceSheet = useMemo(() => computeBalanceSheet(periodState), [periodState]);
  const cashFlowStatement = useMemo(() => computeCashFlowStatement(periodState), [periodState]);
  const equityChanges = useMemo(() => computeEquityChangesStatement(periodState), [periodState]);
  const monthlySummary = useMemo(() => computeMonthlySummary(periodState), [periodState]);

  const txCountByCode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of periodState.postedTransactions) {
      counts.set(tx.glCode, (counts.get(tx.glCode) || 0) + 1);
    }
    return counts;
  }, [periodState.postedTransactions]);

  const plTxCount = useMemo(() => {
    const plCodes = new Set(
      periodState.accounts
        .filter((a) => a.category === 'Income' || a.category === 'Expense')
        .map((a) => a.code)
    );
    let count = 0;
    for (const tx of periodState.postedTransactions) {
      if (plCodes.has(tx.glCode)) count++;
    }
    return count;
  }, [periodState.accounts, periodState.postedTransactions]);

  const handleRowKeyDown = (
    e: React.KeyboardEvent,
    target: ReportDrilldownTarget
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setDrilldownTarget(target);
    }
  };

  const handleExportCurrent = () => {
    const dateTag = new Date().toISOString().slice(0, 10);
    if (activeRoute === 'reports-summary') {
      exportRowsToCSV(
        `ATCL_GL_Summary_${dateTag}.csv`,
        ['GL Code', 'Account Name', 'Account Type', 'Normal', 'Opening', 'Period Dr', 'Period Cr', 'Closing'],
        glSummary.map((r) => [
          r.code,
          r.name,
          r.accountType,
          r.normalBalance,
          r.openingBalance.toFixed(2),
          r.periodDebit.toFixed(2),
          r.periodCredit.toFixed(2),
          r.closingBalance.toFixed(2),
        ])
      );
    } else if (activeRoute === 'reports-trial-balance') {
      if (tbMode === 'comparative') {
        exportRowsToCSV(
          `ATCL_Comparative_Trial_Balance_${dateTag}.csv`,
          [
            'GL Code',
            'Account Name',
            'Account Type',
            'FY 2024-25 Debit',
            'FY 2024-25 Credit',
            'FY 2023-24 Debit',
            'FY 2023-24 Credit',
          ],
          [
            ...trialBalance.rows.map((r) => [
              r.code,
              r.name,
              r.accountType,
              r.closingDr.toFixed(2),
              r.closingCr.toFixed(2),
              r.priorDr.toFixed(2),
              r.priorCr.toFixed(2),
            ]),
            [
              'TOTAL',
              'Verification Totals',
              '',
              trialBalance.totals.closingDr.toFixed(2),
              trialBalance.totals.closingCr.toFixed(2),
              trialBalance.totals.priorDr.toFixed(2),
              trialBalance.totals.priorCr.toFixed(2),
            ],
          ]
        );
      } else {
        exportRowsToCSV(
          `ATCL_Trial_Balance_${dateTag}.csv`,
          ['GL Code', 'Account Name', 'Opening Dr', 'Opening Cr', 'Period Dr', 'Period Cr', 'Closing Dr', 'Closing Cr'],
          [
            ...trialBalance.rows.map((r) => [
              r.code,
              r.name,
              r.openingDr.toFixed(2),
              r.openingCr.toFixed(2),
              r.periodDr.toFixed(2),
              r.periodCr.toFixed(2),
              r.closingDr.toFixed(2),
              r.closingCr.toFixed(2),
            ]),
            [
              'TOTAL',
              'Verification Totals',
              trialBalance.totals.openingDr.toFixed(2),
              trialBalance.totals.openingCr.toFixed(2),
              trialBalance.totals.periodDr.toFixed(2),
              trialBalance.totals.periodCr.toFixed(2),
              trialBalance.totals.closingDr.toFixed(2),
              trialBalance.totals.closingCr.toFixed(2),
            ],
          ]
        );
      }
    } else if (activeRoute === 'reports-income') {
      const rows: (string | number)[][] = [];
      incomeStatement.incomeGroups.forEach((g) =>
        g.accounts.forEach((a) =>
          rows.push(['Revenue', g.group, a.code, a.name, a.amount.toFixed(2), a.priorAmount.toFixed(2)])
        )
      );
      incomeStatement.directCostGroups.forEach((g) =>
        g.accounts.forEach((a) =>
          rows.push(['Direct Expense', g.group, a.code, a.name, a.amount.toFixed(2), a.priorAmount.toFixed(2)])
        )
      );
      incomeStatement.operatingExpenseGroups.forEach((g) =>
        g.accounts.forEach((a) =>
          rows.push(['Operating Expense', g.group, a.code, a.name, a.amount.toFixed(2), a.priorAmount.toFixed(2)])
        )
      );
      incomeStatement.financialExpenseGroups.forEach((g) =>
        g.accounts.forEach((a) =>
          rows.push(['Financial Expense', g.group, a.code, a.name, a.amount.toFixed(2), a.priorAmount.toFixed(2)])
        )
      );
      incomeStatement.taxExpenseGroups.forEach((g) =>
        g.accounts.forEach((a) =>
          rows.push(['Tax Expense', g.group, a.code, a.name, a.amount.toFixed(2), a.priorAmount.toFixed(2)])
        )
      );
      rows.push([
        'SUMMARY',
        'Net Profit',
        '',
        'Net Profit After Tax',
        incomeStatement.netProfit.toFixed(2),
        incomeStatement.priorYear.netProfit.toFixed(2),
      ]);
      exportRowsToCSV(
        `ATCL_Income_Statement_${dateTag}.csv`,
        ['Section', 'Group', 'GL Code', 'Account', 'FY 2024-25 (BDT)', 'FY 2023-24 (BDT)'],
        rows
      );
    } else if (activeRoute === 'reports-balance-sheet') {
      const rows: (string | number)[][] = [
        ...balanceSheet.nonCurrentAssets.map((a) => [
          'Non-Current Assets',
          a.code,
          a.name,
          a.amount.toFixed(2),
          a.priorAmount.toFixed(2),
        ]),
        ...balanceSheet.currentAssets.map((a) => [
          'Current Assets',
          a.code,
          a.name,
          a.amount.toFixed(2),
          a.priorAmount.toFixed(2),
        ]),
        ['TOTAL ASSETS', '', '', balanceSheet.totalAssets.toFixed(2), balanceSheet.priorYear.totalAssets.toFixed(2)],
        ...balanceSheet.equityItems.map((e) => [
          'Equity',
          e.code,
          e.name,
          e.amount.toFixed(2),
          e.priorAmount.toFixed(2),
        ]),
        [
          'Equity',
          'NET-PL',
          'Current Period Net Profit / (Loss)',
          balanceSheet.currentPeriodNetProfit.toFixed(2),
          balanceSheet.priorYear.currentPeriodNetProfit.toFixed(2),
        ],
        ...balanceSheet.nonCurrentLiabilities.map((l) => [
          'Non-Current Liabilities',
          l.code,
          l.name,
          l.amount.toFixed(2),
          l.priorAmount.toFixed(2),
        ]),
        ...balanceSheet.currentLiabilities.map((l) => [
          'Current Liabilities',
          l.code,
          l.name,
          l.amount.toFixed(2),
          l.priorAmount.toFixed(2),
        ]),
        [
          'TOTAL EQUITY & LIABILITIES',
          '',
          '',
          balanceSheet.totalEquityAndLiabilities.toFixed(2),
          balanceSheet.priorYear.totalEquityAndLiabilities.toFixed(2),
        ],
      ];
      exportRowsToCSV(
        `ATCL_Balance_Sheet_${dateTag}.csv`,
        ['Section', 'GL Code', 'Account', 'FY 2024-25 (BDT)', 'FY 2023-24 (BDT)'],
        rows
      );
    } else if (activeRoute === 'reports-cash-flow') {
      const rows: (string | number)[][] = [
        ['Operating Activities', '', 'Net Profit After Tax', cashFlowStatement.netProfit.toFixed(2), ''],
        ...cashFlowStatement.operatingItems.map((i) => [
          'Operating Activities',
          i.code || '',
          i.label,
          i.amount.toFixed(2),
          i.note || '',
        ]),
        ['Operating Activities', '', 'Net Cash from Operating Activities', cashFlowStatement.netOperatingCash.toFixed(2), ''],
        ...cashFlowStatement.investingItems.map((i) => [
          'Investing Activities',
          i.code || '',
          i.label,
          i.amount.toFixed(2),
          i.note || '',
        ]),
        ['Investing Activities', '', 'Net Cash from Investing Activities', cashFlowStatement.netInvestingCash.toFixed(2), ''],
        ...cashFlowStatement.financingItems.map((i) => [
          'Financing Activities',
          i.code || '',
          i.label,
          i.amount.toFixed(2),
          i.note || '',
        ]),
        ['Financing Activities', '', 'Net Cash from Financing Activities', cashFlowStatement.netFinancingCash.toFixed(2), ''],
        ['Cash Summary', '', 'Net Increase / (Decrease) in Cash', cashFlowStatement.netCashChange.toFixed(2), ''],
        ['Cash Summary', '', 'Opening Cash & Cash Equivalents', cashFlowStatement.openingCashBalance.toFixed(2), ''],
        ['Cash Summary', '', 'Closing Cash & Cash Equivalents', cashFlowStatement.closingCashBalance.toFixed(2), ''],
      ];
      exportRowsToCSV(
        `ATCL_Cash_Flow_Statement_${dateTag}.csv`,
        ['Section', 'GL Code', 'Line Item', 'Amount (BDT)', 'Note'],
        rows
      );
    } else if (activeRoute === 'reports-equity-changes') {
      const rows: (string | number)[][] = [
        ...equityChanges.rows.map((r) => [
          r.code,
          r.name,
          r.openingBalance.toFixed(2),
          r.additions.toFixed(2),
          r.deductions.toFixed(2),
          r.netProfitShare.toFixed(2),
          r.closingBalance.toFixed(2),
        ]),
        [
          'TOTAL',
          'Total Shareholders Equity',
          equityChanges.totalOpening.toFixed(2),
          equityChanges.totalAdditions.toFixed(2),
          equityChanges.totalDeductions.toFixed(2),
          equityChanges.totalNetProfit.toFixed(2),
          equityChanges.totalClosing.toFixed(2),
        ],
      ];
      exportRowsToCSV(
        `ATCL_Statement_of_Changes_in_Equity_${dateTag}.csv`,
        ['GL Code', 'Equity Component', 'Opening (BDT)', 'Additions (BDT)', 'Deductions (BDT)', 'Net Profit (BDT)', 'Closing (BDT)'],
        rows
      );
    } else {
      exportRowsToCSV(
        `ATCL_Monthly_Summary_${matrixMetric}_${dateTag}.csv`,
        ['GL Code', 'Account Name', 'Category', ...monthlySummary.monthLabels, 'Total'],
        monthlySummary.rows.map((r) => [
          r.code,
          r.name,
          r.category,
          ...monthlySummary.monthKeys.map((mk) => r.months[mk][matrixMetric].toFixed(2)),
          (matrixMetric === 'debit' ? r.totalDebit : matrixMetric === 'credit' ? r.totalCredit : r.totalNet).toFixed(2),
        ])
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Report Switcher */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 no-print">
        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.route}
              onClick={() => {
                setDrilldownTarget(null);
                onNavigate(tab.route);
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeRoute === tab.route
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportCurrent}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print Statement</span>
          </button>
        </div>
      </div>

      {/* Time Period Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 mr-1">
            <Calendar className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>Report Period:</span>
          </span>
          {(
            [
              { id: 'all', label: 'Full Fiscal Year' },
              { id: 'this-month', label: 'This Month' },
              { id: 'last-month', label: 'Last Month' },
              { id: 'this-quarter', label: 'This Quarter' },
              { id: 'ytd', label: 'Year to Date' },
            ] as const
          ).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPeriodPreset(preset.id)}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                periodPreset === preset.id
                  ? 'bg-[#001F60] text-white border-[#001F60]'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <label htmlFor="report-from-date" className="text-slate-500 font-medium">
              From
            </label>
            <input
              id="report-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPeriodPreset('custom');
              }}
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <label htmlFor="report-to-date" className="text-slate-500 font-medium">
              To
            </label>
            <input
              id="report-to-date"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPeriodPreset('custom');
              }}
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            />
          </div>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => applyPeriodPreset('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              title="Reset to Full Fiscal Year"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
          <span className="px-2.5 py-1 rounded-full bg-blue-50 text-[#001F60] border border-blue-200 text-[11px] font-semibold font-mono">
            {periodState.postedTransactions.length} entries
          </span>
        </div>
      </div>

      {(fromDate || toDate) && (
        <div className="text-xs font-medium text-slate-600 bg-blue-50/70 border border-blue-200/80 rounded-lg px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
          <span>
            Active Reporting Window:{' '}
            <strong className="font-mono text-[#001F60]">
              {fromDate || 'Opening'} → {toDate || 'Latest'}
            </strong>
          </span>
          <span className="text-[11px] text-slate-500">
            Pre-period activity automatically rolled into Opening Balances.
          </span>
        </div>
      )}

      <AiReportInsightsCard
        reportScope={
          activeRoute === 'reports-trial-balance'
            ? 'trial-balance'
            : activeRoute === 'reports-income'
              ? 'income'
              : activeRoute === 'reports-balance-sheet'
                ? 'balance-sheet'
                : activeRoute === 'reports-monthly'
                  ? 'monthly'
                  : 'summary'
        }
        title="AI Financial Commentary & Variance Analysis"
      />

      {/* 1. GL SUMMARY DASHBOARD */}
      {activeRoute === 'reports-summary' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Consolidated GL Summary Dashboard</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time opening, period movement, and closing balances across all {state.accounts.length} accounts
              </p>
            </div>
            <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
              {(['All', 'Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSummaryCat(cat)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                    summaryCat === cat ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#2563EB] text-white text-xs font-medium">
                    <th className="py-2.5 px-4">GL Code</th>
                    <th className="py-2.5 px-4">Account Name</th>
                    <th className="py-2.5 px-4">Account Type</th>
                    <th className="py-2.5 px-4">Normal</th>
                    <th className="py-2.5 px-4 text-right">Opening Balance</th>
                    <th className="py-2.5 px-4 text-right">Period Debits</th>
                    <th className="py-2.5 px-4 text-right">Period Credits</th>
                    <th className="py-2.5 px-4 text-right">Closing Balance</th>
                    <th className="py-2.5 px-4 text-right no-print">Register</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {glSummary
                    .filter((r) => summaryCat === 'All' || r.category === summaryCat)
                    .map((r) => (
                      <tr key={r.code} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#2563EB] tabular-nums">
                          {r.code}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{r.name}</td>
                        <td className="py-2.5 px-4 text-slate-600">{r.accountType}</td>
                        <td className="py-2.5 px-4 text-slate-500">{r.normalBalance}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {formatBDT(r.openingBalance, true)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {formatBDT(r.periodDebit, true)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {formatBDT(r.periodCredit, true)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                            r.closingBalance < 0 ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {formatBDT(r.closingBalance, true)}
                        </td>
                        <td className="py-2.5 px-4 text-right no-print">
                          <button
                            onClick={() => onOpenRegister(r.code)}
                            className="inline-flex items-center gap-0.5 text-[#2563EB] hover:underline font-medium cursor-pointer"
                          >
                            <span>Open</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. STATUTORY & COMPARATIVE TRIAL BALANCE */}
      {activeRoute === 'reports-trial-balance' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-[#2563EB]">
                  {state.config.organizationName} · FY {state.config.fiscalPeriod}
                </div>
                <h1 className="text-xl font-bold text-slate-900 mt-0.5">
                  {tbMode === 'comparative'
                    ? 'Comparative Statutory Trial Balance (FY 2024-25 vs FY 2023-24)'
                    : '8-Column Statutory Trial Balance (Opening / Movement / Closing)'}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-3 no-print">
                <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
                  <button
                    onClick={() => setTbMode('comparative')}
                    className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                      tbMode === 'comparative'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Comparative (FY 24-25 / FY 23-24)
                  </button>
                  <button
                    onClick={() => setTbMode('8col')}
                    className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                      tbMode === '8col'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    8-Column Movement
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideZeroRows}
                    onChange={(e) => setHideZeroRows(e.target.checked)}
                    className="rounded border-slate-300 text-[#2563EB]"
                  />
                  <span>Hide zero rows</span>
                </label>
              </div>
            </div>

            {/* Balance Verification Strip */}
            <div
              className={`px-6 py-3 border-b text-xs font-medium flex flex-wrap items-center justify-between gap-3 ${
                trialBalance.isClosingBalanced && trialBalance.isOpeningBalanced
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {trialBalance.isClosingBalanced ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                )}
                <span>
                  {trialBalance.isClosingBalanced
                    ? `TRIAL BALANCE VERIFIED · FY 2024-25 Debits ${formatBDT(trialBalance.totals.closingDr)} vs Credits ${formatBDT(trialBalance.totals.closingCr)} (Rounding Variance: ${formatBDT(trialBalance.closingDiff)})`
                    : `TRIAL BALANCE OUT OF BALANCE BY ${formatBDT(trialBalance.closingDiff)}`}
                </span>
              </span>
              <span className="font-mono tabular-nums">
                FY 24-25 Diff: {formatBDT(trialBalance.closingDiff)} · FY 23-24 Diff: {formatBDT(trialBalance.priorDiff)}
              </span>
            </div>

            <div className="overflow-x-auto ledger-scroll">
              {tbMode === 'comparative' ? (
                <table className="w-full text-left border-collapse min-w-[1040px]">
                  <thead>
                    <tr className="bg-[#2563EB] text-white text-xs font-medium">
                      <th className="py-2.5 px-4">GL Code</th>
                      <th className="py-2.5 px-4">Account Name</th>
                      <th className="py-2.5 px-3">Account Type</th>
                      <th className="py-2.5 px-3 text-right">FY 2024-25 Debit</th>
                      <th className="py-2.5 px-3 text-right">FY 2024-25 Credit</th>
                      <th className="py-2.5 px-3 text-right">FY 2023-24 Debit</th>
                      <th className="py-2.5 px-4 text-right">FY 2023-24 Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {trialBalance.rows
                      .filter(
                        (r) =>
                          !hideZeroRows ||
                          r.closingDr > 0 ||
                          r.closingCr > 0 ||
                          r.priorDr > 0 ||
                          r.priorCr > 0
                      )
                      .map((r) => (
                        <tr key={r.code} className="hover:bg-slate-50/70">
                          <td className="py-2 px-4 font-mono whitespace-nowrap">
                            <button
                              onClick={() => onOpenRegister(r.code)}
                              className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                            >
                              {r.code}
                            </button>
                          </td>
                          <td className="py-2 px-4 text-slate-800 font-medium">{r.name}</td>
                          <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{r.accountType}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium tabular-nums text-slate-900">
                            {formatBDT(r.closingDr, true)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-medium tabular-nums text-slate-900">
                            {formatBDT(r.closingCr, true)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                            {formatBDT(r.priorDr, true)}
                          </td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                            {formatBDT(r.priorCr, true)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#DBEAFE] border-t-2 border-[#2563EB] text-xs font-bold text-slate-900">
                      <td className="py-3 px-4 font-mono">TOTAL</td>
                      <td className="py-3 px-4" colSpan={2}>
                        Statutory Trial Balance Totals (FY 2024-25 & Comparative FY 2023-24)
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#2563EB]">
                        {formatBDT(trialBalance.totals.closingDr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#2563EB]">
                        {formatBDT(trialBalance.totals.closingCr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatBDT(trialBalance.totals.priorDr)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatBDT(trialBalance.totals.priorCr)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <table className="w-full text-left border-collapse min-w-[1020px]">
                  <thead>
                    <tr className="bg-[#2563EB] text-white text-xs font-medium">
                      <th className="py-2.5 px-4">GL Code</th>
                      <th className="py-2.5 px-4">Account Name</th>
                      <th className="py-2.5 px-3 text-right">Opening Dr</th>
                      <th className="py-2.5 px-3 text-right">Opening Cr</th>
                      <th className="py-2.5 px-3 text-right">Period Dr</th>
                      <th className="py-2.5 px-3 text-right">Period Cr</th>
                      <th className="py-2.5 px-3 text-right">Closing Dr</th>
                      <th className="py-2.5 px-4 text-right">Closing Cr</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {trialBalance.rows
                      .filter(
                        (r) =>
                          !hideZeroRows ||
                          r.openingDr > 0 ||
                          r.openingCr > 0 ||
                          r.periodDr > 0 ||
                          r.periodCr > 0 ||
                          r.closingDr > 0 ||
                          r.closingCr > 0
                      )
                      .map((r) => (
                        <tr key={r.code} className="hover:bg-slate-50/70">
                          <td className="py-2 px-4 font-mono whitespace-nowrap">
                            <button
                              onClick={() => onOpenRegister(r.code)}
                              className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                            >
                              {r.code}
                            </button>
                          </td>
                          <td className="py-2 px-4 text-slate-800">{r.name}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                            {formatBDT(r.openingDr, true)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                            {formatBDT(r.openingCr, true)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                            {formatBDT(r.periodDr, true)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                            {formatBDT(r.periodCr, true)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-medium tabular-nums text-slate-900">
                            {formatBDT(r.closingDr, true)}
                          </td>
                          <td className="py-2 px-4 text-right font-mono font-medium tabular-nums text-slate-900">
                            {formatBDT(r.closingCr, true)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#DBEAFE] border-t-2 border-[#2563EB] text-xs font-bold text-slate-900">
                      <td className="py-3 px-4 font-mono">TOTAL</td>
                      <td className="py-3 px-4">Verification: Total Debits = Total Credits</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatBDT(trialBalance.totals.openingDr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatBDT(trialBalance.totals.openingCr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatBDT(trialBalance.totals.periodDr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatBDT(trialBalance.totals.periodCr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#2563EB]">
                        {formatBDT(trialBalance.totals.closingDr)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#2563EB]">
                        {formatBDT(trialBalance.totals.closingCr)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. IFRS INCOME STATEMENT (P&L) */}
      {activeRoute === 'reports-income' && (
        <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden max-w-5xl">
          <div className="px-6 py-5 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-[#2563EB]">
                {state.config.organizationName}
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-0.5">
                Statement of Profit or Loss (IFRS Income Statement)
              </h1>
              <div className="text-xs text-slate-500 mt-1">
                For the Fiscal Period {state.config.fiscalPeriod} with Comparative FY 2023-24 · Amounts in{' '}
                {state.config.currencyCode} ({state.config.currencySymbol})
              </div>
            </div>
            <div className="text-[11px] text-slate-500 no-print">
              Click any line item to inspect underlying transactions
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="bg-[#2563EB] text-white text-xs font-medium">
                  <th className="py-2.5 px-6">Particulars</th>
                  <th className="py-2.5 px-5 text-right w-48">FY 2024-25 (BDT)</th>
                  <th className="py-2.5 px-6 text-right w-48">FY 2023-24 (BDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {/* Revenue */}
                <tr className="bg-slate-50/80">
                  <td colSpan={3} className="py-2.5 px-6 font-semibold text-[#2563EB] uppercase tracking-wider">
                    Revenue
                  </td>
                </tr>
                {incomeStatement.incomeGroups.flatMap((g) => g.accounts).map((acc) => {
                  const target: ReportDrilldownTarget = {
                    sourceReport: 'Income Statement',
                    sectionLabel: 'Revenue',
                    code: acc.code,
                    name: acc.name,
                    reportedAmount: acc.amount,
                    priorAmount: acc.priorAmount,
                  };
                  const count = txCountByCode.get(acc.code) || 0;
                  return (
                    <tr
                      key={acc.code}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDrilldownTarget(target)}
                      onKeyDown={(e) => handleRowKeyDown(e, target)}
                      className="group hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                    >
                      <td className="py-2 px-6">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-800 group-hover:text-[#2563EB] font-medium">
                            <span className="font-mono text-slate-400 mr-2">{acc.code}</span>
                            {acc.name}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 group-hover:text-[#2563EB] shrink-0 no-print">
                            <span>{count} {count === 1 ? 'txn' : 'txns'}</span>
                            <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-5 text-right font-mono tabular-nums text-slate-900">
                        {formatBDT(acc.amount)}
                      </td>
                      <td className="py-2 px-6 text-right font-mono tabular-nums text-slate-600">
                        {formatBDT(acc.priorAmount)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <td className="py-2.5 px-6">Total Revenue</td>
                  <td className="py-2.5 px-5 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.totalIncome)}
                  </td>
                  <td className="py-2.5 px-6 text-right font-mono tabular-nums text-slate-700">
                    {formatBDT(incomeStatement.priorYear.totalIncome)}
                  </td>
                </tr>

                {/* Direct Expenses */}
                <tr className="bg-slate-50/80">
                  <td colSpan={3} className="py-2.5 px-6 font-semibold text-slate-600 uppercase tracking-wider">
                    Less: Direct Expenses (Cost of Sales)
                  </td>
                </tr>
                {incomeStatement.directCostGroups
                  .flatMap((g) => g.accounts)
                  .filter((a) => a.amount !== 0 || a.priorAmount !== 0)
                  .map((acc) => {
                    const target: ReportDrilldownTarget = {
                      sourceReport: 'Income Statement',
                      sectionLabel: 'Direct Expenses (Cost of Sales)',
                      code: acc.code,
                      name: acc.name,
                      reportedAmount: acc.amount,
                      priorAmount: acc.priorAmount,
                    };
                    const count = txCountByCode.get(acc.code) || 0;
                    return (
                      <tr
                        key={acc.code}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDrilldownTarget(target)}
                        onKeyDown={(e) => handleRowKeyDown(e, target)}
                        className="group hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                      >
                        <td className="py-2 px-6">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-700 group-hover:text-[#2563EB]">
                              <span className="font-mono text-slate-400 mr-2">{acc.code}</span>
                              {acc.name}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 group-hover:text-[#2563EB] shrink-0 no-print">
                              <span>{count} {count === 1 ? 'txn' : 'txns'}</span>
                              <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-5 text-right font-mono tabular-nums text-slate-800">
                          {formatBDT(acc.amount)}
                        </td>
                        <td className="py-2 px-6 text-right font-mono tabular-nums text-slate-600">
                          {formatBDT(acc.priorAmount)}
                        </td>
                      </tr>
                    );
                  })}
                <tr className="font-semibold text-slate-700 bg-slate-50/50">
                  <td className="py-2.5 px-6">Total Direct Expenses</td>
                  <td className="py-2.5 px-5 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.totalDirectCosts)}
                  </td>
                  <td className="py-2.5 px-6 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.priorYear.totalDirectCosts)}
                  </td>
                </tr>
                <tr className="bg-[#EFF6FF] font-bold text-[#2563EB] text-sm">
                  <td className="py-3 px-6">
                    Gross Profit ({incomeStatement.grossMarginPct.toFixed(2)}% Margin)
                  </td>
                  <td className="py-3 px-5 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.grossProfit)}
                  </td>
                  <td className="py-3 px-6 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.priorYear.grossProfit)}
                  </td>
                </tr>

                {/* Operating Expenses */}
                <tr className="bg-slate-50/80">
                  <td colSpan={3} className="py-2.5 px-6 font-semibold text-slate-600 uppercase tracking-wider">
                    Less: Operating & Administrative Expenses
                  </td>
                </tr>
                {incomeStatement.operatingExpenseGroups
                  .flatMap((g) => g.accounts)
                  .filter((a) => a.amount !== 0 || a.priorAmount !== 0)
                  .map((acc) => {
                    const target: ReportDrilldownTarget = {
                      sourceReport: 'Income Statement',
                      sectionLabel: 'Operating & Administrative Expenses',
                      code: acc.code,
                      name: acc.name,
                      reportedAmount: acc.amount,
                      priorAmount: acc.priorAmount,
                    };
                    const count = txCountByCode.get(acc.code) || 0;
                    return (
                      <tr
                        key={acc.code}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDrilldownTarget(target)}
                        onKeyDown={(e) => handleRowKeyDown(e, target)}
                        className="group hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                      >
                        <td className="py-1.5 px-6">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-700 group-hover:text-[#2563EB]">
                              <span className="font-mono text-slate-400 mr-2">{acc.code}</span>
                              {acc.name}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 group-hover:text-[#2563EB] shrink-0 no-print">
                              <span>{count} {count === 1 ? 'txn' : 'txns'}</span>
                              <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-5 text-right font-mono tabular-nums text-slate-800">
                          {formatBDT(acc.amount)}
                        </td>
                        <td className="py-1.5 px-6 text-right font-mono tabular-nums text-slate-600">
                          {formatBDT(acc.priorAmount)}
                        </td>
                      </tr>
                    );
                  })}
                <tr className="font-semibold text-slate-700 bg-slate-50/50">
                  <td className="py-2.5 px-6">Total Operating Expenses</td>
                  <td className="py-2.5 px-5 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.totalOperatingExpenses)}
                  </td>
                  <td className="py-2.5 px-6 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.priorYear.totalOperatingExpenses)}
                  </td>
                </tr>
                <tr className="bg-slate-100/80 font-semibold text-slate-900">
                  <td className="py-2.5 px-6">Operating Profit (EBIT)</td>
                  <td className="py-2.5 px-5 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.operatingProfit)}
                  </td>
                  <td className="py-2.5 px-6 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.priorYear.operatingProfit)}
                  </td>
                </tr>

                {/* Financial Expenses */}
                {incomeStatement.financialExpenseGroups.length > 0 && (
                  <>
                    <tr className="bg-slate-50/80">
                      <td colSpan={3} className="py-2.5 px-6 font-semibold text-slate-600 uppercase tracking-wider">
                        Less: Financial Expenses
                      </td>
                    </tr>
                    {incomeStatement.financialExpenseGroups
                      .flatMap((g) => g.accounts)
                      .map((acc) => {
                        const target: ReportDrilldownTarget = {
                          sourceReport: 'Income Statement',
                          sectionLabel: 'Financial Expenses',
                          code: acc.code,
                          name: acc.name,
                          reportedAmount: acc.amount,
                          priorAmount: acc.priorAmount,
                        };
                        const count = txCountByCode.get(acc.code) || 0;
                        return (
                          <tr
                            key={acc.code}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(target)}
                            onKeyDown={(e) => handleRowKeyDown(e, target)}
                            className="group hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-6">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-700 group-hover:text-[#2563EB]">
                                  <span className="font-mono text-slate-400 mr-2">{acc.code}</span>
                                  {acc.name}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 group-hover:text-[#2563EB] shrink-0 no-print">
                                  <span>{count} {count === 1 ? 'txn' : 'txns'}</span>
                                  <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-5 text-right font-mono tabular-nums text-slate-800">
                              {formatBDT(acc.amount)}
                            </td>
                            <td className="py-2 px-6 text-right font-mono tabular-nums text-slate-600">
                              {formatBDT(acc.priorAmount)}
                            </td>
                          </tr>
                        );
                      })}
                    <tr className="font-semibold text-slate-700 bg-slate-50/50">
                      <td className="py-2.5 px-6">Total Financial Expenses</td>
                      <td className="py-2.5 px-5 text-right font-mono tabular-nums">
                        {formatBDT(incomeStatement.totalFinancialExpenses)}
                      </td>
                      <td className="py-2.5 px-6 text-right font-mono tabular-nums">
                        {formatBDT(incomeStatement.priorYear.totalFinancialExpenses)}
                      </td>
                    </tr>
                  </>
                )}

                <tr className="bg-[#EFF6FF] font-semibold text-[#2563EB]">
                  <td className="py-2.5 px-6">Profit Before Income Tax (PBT)</td>
                  <td className="py-2.5 px-5 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.profitBeforeTax)}
                  </td>
                  <td className="py-2.5 px-6 text-right font-mono tabular-nums">
                    {formatBDT(incomeStatement.priorYear.profitBeforeTax)}
                  </td>
                </tr>

                {/* Tax Expenses */}
                {incomeStatement.taxExpenseGroups.length > 0 && (
                  <>
                    <tr className="bg-slate-50/80">
                      <td colSpan={3} className="py-2.5 px-6 font-semibold text-slate-600 uppercase tracking-wider">
                        Less: Income Tax Expense
                      </td>
                    </tr>
                    {incomeStatement.taxExpenseGroups
                      .flatMap((g) => g.accounts)
                      .map((acc) => {
                        const target: ReportDrilldownTarget = {
                          sourceReport: 'Income Statement',
                          sectionLabel: 'Income Tax Expense',
                          code: acc.code,
                          name: acc.name,
                          reportedAmount: acc.amount,
                          priorAmount: acc.priorAmount,
                        };
                        const count = txCountByCode.get(acc.code) || 0;
                        return (
                          <tr
                            key={acc.code}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(target)}
                            onKeyDown={(e) => handleRowKeyDown(e, target)}
                            className="group hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-6">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-700 group-hover:text-[#2563EB]">
                                  <span className="font-mono text-slate-400 mr-2">{acc.code}</span>
                                  {acc.name}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 group-hover:text-[#2563EB] shrink-0 no-print">
                                  <span>{count} {count === 1 ? 'txn' : 'txns'}</span>
                                  <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-5 text-right font-mono tabular-nums text-slate-800">
                              {formatBDT(acc.amount)}
                            </td>
                            <td className="py-2 px-6 text-right font-mono tabular-nums text-slate-600">
                              {formatBDT(acc.priorAmount)}
                            </td>
                          </tr>
                        );
                      })}
                  </>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-[#2563EB] text-white font-bold text-sm">
                  <td className="py-4 px-6">
                    <div>Net Profit / (Loss) After Tax</div>
                    <div className="text-xs font-normal text-white/80 mt-0.5">
                      Net Profit Margin: {incomeStatement.netMarginPct.toFixed(2)}%
                    </div>
                  </td>
                  <td className="py-4 px-5 text-right font-mono tabular-nums text-base">
                    {formatBDT(incomeStatement.netProfit)}
                  </td>
                  <td className="py-4 px-6 text-right font-mono tabular-nums text-sm text-white/90">
                    {formatBDT(incomeStatement.priorYear.netProfit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 4. IFRS BALANCE SHEET */}
      {activeRoute === 'reports-balance-sheet' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200 bg-[#F8FAFC] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[#2563EB]">
                  {state.config.organizationName}
                </div>
                <h1 className="text-xl font-bold text-slate-900 mt-0.5">
                  Statement of Financial Position (IFRS Balance Sheet)
                </h1>
                <div className="text-xs text-slate-500 mt-1">
                  As at 30 June 2025 (FY {state.config.fiscalPeriod}) with Comparative FY 2023-24 · Currency{' '}
                  {state.config.currencyCode} ({state.config.currencySymbol})
                </div>
              </div>
              <div className="flex flex-col md:items-end gap-1">
                <div
                  className={`text-xs font-semibold flex items-center gap-1.5 ${
                    balanceSheet.isBalanced ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {balanceSheet.isBalanced ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  <span>
                    {balanceSheet.isBalanced
                      ? `Balance Sheet Balanced (Rounding Variance: ${formatBDT(Math.abs(balanceSheet.variance))})`
                      : `Imbalance Detected: ${formatBDT(balanceSheet.variance)}`}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 no-print">
                  Click any line item to inspect underlying transactions
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
              {/* Left Column: ASSETS */}
              <div className="p-6 flex flex-col justify-between space-y-6">
                <div className="space-y-6">
                  <div>
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200">
                      <div className="col-span-6 text-[#2563EB]">Non-Current Assets</div>
                      <div className="col-span-3 text-right">FY 2024-25</div>
                      <div className="col-span-3 text-right">FY 2023-24</div>
                    </div>
                    <div className="space-y-0.5 text-xs mt-2">
                      {balanceSheet.nonCurrentAssets.map((a) => {
                        const target: ReportDrilldownTarget = {
                          sourceReport: 'Balance Sheet',
                          sectionLabel: 'Non-Current Assets',
                          code: a.code,
                          name: a.name,
                          reportedAmount: a.amount,
                          priorAmount: a.priorAmount,
                          isContra: a.isContra,
                        };
                        const count = txCountByCode.get(a.code) || 0;
                        return (
                          <div
                            key={a.code}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(target)}
                            onKeyDown={(e) => handleRowKeyDown(e, target)}
                            title={`${a.name} — ${count} posted ${count === 1 ? 'transaction' : 'transactions'}`}
                            className="group grid grid-cols-12 gap-2 items-center py-1.5 px-2 -mx-2 rounded-md hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                          >
                            <div className="col-span-6 flex items-center justify-between gap-1.5 min-w-0">
                              <span className="text-slate-700 group-hover:text-[#2563EB] truncate">
                                <span className="font-mono text-slate-400 mr-1.5">{a.code}</span>
                                {a.name}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#2563EB] shrink-0 transition-colors no-print" />
                            </div>
                            <span
                              className={`col-span-3 text-right font-mono tabular-nums ${
                                a.amount < 0 ? 'text-red-700' : 'text-slate-900'
                              }`}
                            >
                              {formatBDT(a.amount)}
                            </span>
                            <span
                              className={`col-span-3 text-right font-mono tabular-nums ${
                                a.priorAmount < 0 ? 'text-red-600' : 'text-slate-500'
                              }`}
                            >
                              {formatBDT(a.priorAmount)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="pt-2 mt-1 border-t border-slate-200 grid grid-cols-12 gap-2 font-semibold text-slate-800">
                        <span className="col-span-6">Total Non-Current Assets (Net)</span>
                        <span className="col-span-3 text-right font-mono tabular-nums">
                          {formatBDT(balanceSheet.totalNonCurrentAssets)}
                        </span>
                        <span className="col-span-3 text-right font-mono tabular-nums text-slate-600">
                          {formatBDT(balanceSheet.priorYear.totalNonCurrentAssets)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200">
                      <div className="col-span-6 text-[#2563EB]">Current Assets</div>
                      <div className="col-span-3 text-right">FY 2024-25</div>
                      <div className="col-span-3 text-right">FY 2023-24</div>
                    </div>
                    <div className="space-y-0.5 text-xs mt-2">
                      {balanceSheet.currentAssets.map((a) => {
                        const target: ReportDrilldownTarget = {
                          sourceReport: 'Balance Sheet',
                          sectionLabel: 'Current Assets',
                          code: a.code,
                          name: a.name,
                          reportedAmount: a.amount,
                          priorAmount: a.priorAmount,
                          isContra: a.isContra,
                        };
                        const count = txCountByCode.get(a.code) || 0;
                        return (
                          <div
                            key={a.code}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(target)}
                            onKeyDown={(e) => handleRowKeyDown(e, target)}
                            title={`${a.name} — ${count} posted ${count === 1 ? 'transaction' : 'transactions'}`}
                            className="group grid grid-cols-12 gap-2 items-center py-1.5 px-2 -mx-2 rounded-md hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                          >
                            <div className="col-span-6 flex items-center justify-between gap-1.5 min-w-0">
                              <span className="text-slate-700 group-hover:text-[#2563EB] truncate">
                                <span className="font-mono text-slate-400 mr-1.5">{a.code}</span>
                                {a.name}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#2563EB] shrink-0 transition-colors no-print" />
                            </div>
                            <span className="col-span-3 text-right font-mono tabular-nums text-slate-900">
                              {formatBDT(a.amount)}
                            </span>
                            <span className="col-span-3 text-right font-mono tabular-nums text-slate-500">
                              {formatBDT(a.priorAmount)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="pt-2 mt-1 border-t border-slate-200 grid grid-cols-12 gap-2 font-semibold text-slate-800">
                        <span className="col-span-6">Total Current Assets</span>
                        <span className="col-span-3 text-right font-mono tabular-nums">
                          {formatBDT(balanceSheet.totalCurrentAssets)}
                        </span>
                        <span className="col-span-3 text-right font-mono tabular-nums text-slate-600">
                          {formatBDT(balanceSheet.priorYear.totalCurrentAssets)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-4 py-3.5 bg-[#2563EB] text-white rounded-md grid grid-cols-12 gap-2 items-center font-bold text-xs sm:text-sm">
                  <span className="col-span-6">TOTAL ASSETS</span>
                  <span className="col-span-3 text-right font-mono tabular-nums">
                    {formatBDT(balanceSheet.totalAssets)}
                  </span>
                  <span className="col-span-3 text-right font-mono tabular-nums text-white/85">
                    {formatBDT(balanceSheet.priorYear.totalAssets)}
                  </span>
                </div>
              </div>

              {/* Right Column: EQUITY & LIABILITIES */}
              <div className="p-6 flex flex-col justify-between space-y-6">
                <div className="space-y-6">
                  <div>
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200">
                      <div className="col-span-6 text-[#2563EB]">Shareholders Equity</div>
                      <div className="col-span-3 text-right">FY 2024-25</div>
                      <div className="col-span-3 text-right">FY 2023-24</div>
                    </div>
                    <div className="space-y-0.5 text-xs mt-2">
                      {balanceSheet.equityItems.map((e) => {
                        const target: ReportDrilldownTarget = {
                          sourceReport: 'Balance Sheet',
                          sectionLabel: 'Shareholders Equity',
                          code: e.code,
                          name: e.name,
                          reportedAmount: e.amount,
                          priorAmount: e.priorAmount,
                        };
                        const count = txCountByCode.get(e.code) || 0;
                        return (
                          <div
                            key={e.code}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(target)}
                            onKeyDown={(ev) => handleRowKeyDown(ev, target)}
                            title={`${e.name} — ${count} posted ${count === 1 ? 'transaction' : 'transactions'}`}
                            className="group grid grid-cols-12 gap-2 items-center py-1.5 px-2 -mx-2 rounded-md hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                          >
                            <div className="col-span-6 flex items-center justify-between gap-1.5 min-w-0">
                              <span className="text-slate-700 group-hover:text-[#2563EB] truncate">
                                <span className="font-mono text-slate-400 mr-1.5">{e.code}</span>
                                {e.name}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#2563EB] shrink-0 transition-colors no-print" />
                            </div>
                            <span className="col-span-3 text-right font-mono tabular-nums text-slate-900">
                              {formatBDT(e.amount)}
                            </span>
                            <span className="col-span-3 text-right font-mono tabular-nums text-slate-500">
                              {formatBDT(e.priorAmount)}
                            </span>
                          </div>
                        );
                      })}
                      {(() => {
                        const plTarget: ReportDrilldownTarget = {
                          sourceReport: 'Balance Sheet',
                          sectionLabel: 'Shareholders Equity · P&L Rollup',
                          code: 'NET-PL',
                          name: 'Current Year Net Profit',
                          reportedAmount: balanceSheet.currentPeriodNetProfit,
                          priorAmount: balanceSheet.priorYear.currentPeriodNetProfit,
                        };
                        return (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(plTarget)}
                            onKeyDown={(ev) => handleRowKeyDown(ev, plTarget)}
                            title={`Current Year Net Profit — ${plTxCount} Income & Expense transactions`}
                            className="group grid grid-cols-12 gap-2 items-center py-1.5 px-2 -mx-2 rounded-md text-emerald-800 font-medium hover:bg-emerald-50/80 focus:bg-emerald-50/80 focus:outline-none cursor-pointer transition-colors"
                          >
                            <div className="col-span-6 flex items-center justify-between gap-1.5 min-w-0">
                              <span className="truncate">
                                <span className="font-mono text-emerald-600 mr-1.5">P&L</span>
                                Current Year Net Profit
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-emerald-500/60 group-hover:text-emerald-700 shrink-0 transition-colors no-print" />
                            </div>
                            <span className="col-span-3 text-right font-mono tabular-nums">
                              {formatBDT(balanceSheet.currentPeriodNetProfit)}
                            </span>
                            <span className="col-span-3 text-right font-mono tabular-nums text-emerald-700/80">
                              {formatBDT(balanceSheet.priorYear.currentPeriodNetProfit)}
                            </span>
                          </div>
                        );
                      })()}
                      <div className="pt-2 mt-1 border-t border-slate-200 grid grid-cols-12 gap-2 font-semibold text-slate-800">
                        <span className="col-span-6">Total Equity</span>
                        <span className="col-span-3 text-right font-mono tabular-nums">
                          {formatBDT(balanceSheet.totalEquity)}
                        </span>
                        <span className="col-span-3 text-right font-mono tabular-nums text-slate-600">
                          {formatBDT(balanceSheet.priorYear.totalEquity)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {balanceSheet.nonCurrentLiabilities.length > 0 && (
                    <div>
                      <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200">
                        <div className="col-span-6 text-[#2563EB]">Non-Current Liabilities</div>
                        <div className="col-span-3 text-right">FY 2024-25</div>
                        <div className="col-span-3 text-right">FY 2023-24</div>
                      </div>
                      <div className="space-y-0.5 text-xs mt-2">
                        {balanceSheet.nonCurrentLiabilities.map((l) => {
                          const target: ReportDrilldownTarget = {
                            sourceReport: 'Balance Sheet',
                            sectionLabel: 'Non-Current Liabilities',
                            code: l.code,
                            name: l.name,
                            reportedAmount: l.amount,
                            priorAmount: l.priorAmount,
                          };
                          const count = txCountByCode.get(l.code) || 0;
                          return (
                            <div
                              key={l.code}
                              role="button"
                              tabIndex={0}
                              onClick={() => setDrilldownTarget(target)}
                              onKeyDown={(ev) => handleRowKeyDown(ev, target)}
                              title={`${l.name} — ${count} posted ${count === 1 ? 'transaction' : 'transactions'}`}
                              className="group grid grid-cols-12 gap-2 items-center py-1.5 px-2 -mx-2 rounded-md hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                            >
                              <div className="col-span-6 flex items-center justify-between gap-1.5 min-w-0">
                                <span className="text-slate-700 group-hover:text-[#2563EB] truncate">
                                  <span className="font-mono text-slate-400 mr-1.5">{l.code}</span>
                                  {l.name}
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#2563EB] shrink-0 transition-colors no-print" />
                              </div>
                              <span className="col-span-3 text-right font-mono tabular-nums text-slate-900">
                                {formatBDT(l.amount)}
                              </span>
                              <span className="col-span-3 text-right font-mono tabular-nums text-slate-500">
                                {formatBDT(l.priorAmount)}
                              </span>
                            </div>
                          );
                        })}
                        <div className="pt-2 mt-1 border-t border-slate-200 grid grid-cols-12 gap-2 font-semibold text-slate-800">
                          <span className="col-span-6">Total Non-Current Liabilities</span>
                          <span className="col-span-3 text-right font-mono tabular-nums">
                            {formatBDT(balanceSheet.totalNonCurrentLiabilities)}
                          </span>
                          <span className="col-span-3 text-right font-mono tabular-nums text-slate-600">
                            {formatBDT(balanceSheet.priorYear.totalNonCurrentLiabilities)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200">
                      <div className="col-span-6 text-[#2563EB]">Current Liabilities</div>
                      <div className="col-span-3 text-right">FY 2024-25</div>
                      <div className="col-span-3 text-right">FY 2023-24</div>
                    </div>
                    <div className="space-y-0.5 text-xs mt-2">
                      {balanceSheet.currentLiabilities.map((l) => {
                        const target: ReportDrilldownTarget = {
                          sourceReport: 'Balance Sheet',
                          sectionLabel: 'Current Liabilities',
                          code: l.code,
                          name: l.name,
                          reportedAmount: l.amount,
                          priorAmount: l.priorAmount,
                        };
                        const count = txCountByCode.get(l.code) || 0;
                        return (
                          <div
                            key={l.code}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDrilldownTarget(target)}
                            onKeyDown={(ev) => handleRowKeyDown(ev, target)}
                            title={`${l.name} — ${count} posted ${count === 1 ? 'transaction' : 'transactions'}`}
                            className="group grid grid-cols-12 gap-2 items-center py-1.5 px-2 -mx-2 rounded-md hover:bg-[#EFF6FF] focus:bg-[#EFF6FF] focus:outline-none cursor-pointer transition-colors"
                          >
                            <div className="col-span-6 flex items-center justify-between gap-1.5 min-w-0">
                              <span className="text-slate-700 group-hover:text-[#2563EB] truncate">
                                <span className="font-mono text-slate-400 mr-1.5">{l.code}</span>
                                {l.name}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#2563EB] shrink-0 transition-colors no-print" />
                            </div>
                            <span
                              className={`col-span-3 text-right font-mono tabular-nums ${
                                l.amount < 0 ? 'text-red-700' : 'text-slate-900'
                              }`}
                            >
                              {formatBDT(l.amount)}
                            </span>
                            <span className="col-span-3 text-right font-mono tabular-nums text-slate-500">
                              {formatBDT(l.priorAmount, true)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="pt-2 mt-1 border-t border-slate-200 grid grid-cols-12 gap-2 font-semibold text-slate-800">
                        <span className="col-span-6">Total Current Liabilities</span>
                        <span className="col-span-3 text-right font-mono tabular-nums">
                          {formatBDT(balanceSheet.totalCurrentLiabilities)}
                        </span>
                        <span className="col-span-3 text-right font-mono tabular-nums text-slate-600">
                          {formatBDT(balanceSheet.priorYear.totalCurrentLiabilities)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-4 py-3.5 bg-[#2563EB] text-white rounded-md grid grid-cols-12 gap-2 items-center font-bold text-xs sm:text-sm">
                  <span className="col-span-6">TOTAL EQUITY & LIABILITIES</span>
                  <span className="col-span-3 text-right font-mono tabular-nums">
                    {formatBDT(balanceSheet.totalEquityAndLiabilities)}
                  </span>
                  <span className="col-span-3 text-right font-mono tabular-nums text-white/85">
                    {formatBDT(balanceSheet.priorYear.totalEquityAndLiabilities)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. CASH FLOW STATEMENT (IAS 7) */}
      {activeRoute === 'reports-cash-flow' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Operating Cash Flow</div>
              <div className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${cashFlowStatement.netOperatingCash >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatBDT(cashFlowStatement.netOperatingCash, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Indirect method from Net Profit</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Investing Cash Flow</div>
              <div className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${cashFlowStatement.netInvestingCash >= 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                {formatBDT(cashFlowStatement.netInvestingCash, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Non-current asset movements</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Financing Cash Flow</div>
              <div className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${cashFlowStatement.netFinancingCash >= 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                {formatBDT(cashFlowStatement.netFinancingCash, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Long-term debt &amp; equity</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Closing Cash &amp; Bank</div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#001F60]">
                {formatBDT(cashFlowStatement.closingCashBalance, true)}
              </div>
              <div className="mt-1 text-[11px] flex items-center gap-1">
                {cashFlowStatement.isReconciled ? (
                  <span className="text-emerald-700 font-semibold">Reconciled to Cash GLs</span>
                ) : (
                  <span className="text-amber-700 font-semibold">
                    Variance: {formatBDT(cashFlowStatement.variance, true)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#001F60] text-white text-xs font-bold">
                    <th className="py-2.5 px-4 whitespace-nowrap">Section / Cash Flow Line Item</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">GL Code</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Classification Note</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount (BDT)</th>
                  </tr>
                </thead>
                <tbody className="bg-white text-xs text-slate-800">
                  <tr className="bg-blue-50/60 font-bold text-[#001F60]">
                    <td colSpan={4} className="py-2 px-4">
                      A. Cash Flows from Operating Activities (Indirect Method)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-semibold">Net Profit / (Loss) for the Period</td>
                    <td className="py-2 px-3 font-mono text-slate-400">P&amp;L</td>
                    <td className="py-2 px-3 text-slate-500">Starting profit before working capital adjustments</td>
                    <td className="py-2 px-4 text-right font-mono font-semibold tabular-nums">
                      {formatBDT(cashFlowStatement.netProfit, true)}
                    </td>
                  </tr>
                  {cashFlowStatement.operatingItems.map((item, idx) => (
                    <tr key={`op-${idx}`}>
                      <td className="py-2 px-4">{item.label}</td>
                      <td className="py-2 px-3 font-mono">
                        {item.code ? (
                          <button
                            type="button"
                            onClick={() => onOpenRegister(item.code!)}
                            className="text-[#2563EB] hover:underline cursor-pointer"
                          >
                            {item.code}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{item.note || '—'}</td>
                      <td className={`py-2 px-4 text-right font-mono tabular-nums ${item.amount < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                        {formatBDT(item.amount, true)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={3} className="py-2 px-4">Net Cash Provided by / (Used in) Operating Activities</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">
                      {formatBDT(cashFlowStatement.netOperatingCash, true)}
                    </td>
                  </tr>

                  <tr className="bg-blue-50/60 font-bold text-[#001F60]">
                    <td colSpan={4} className="py-2 px-4">
                      B. Cash Flows from Investing Activities
                    </td>
                  </tr>
                  {cashFlowStatement.investingItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-2 px-4 text-slate-400 italic">
                        No non-current asset acquisitions or disposals during this period
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums">0.00</td>
                    </tr>
                  ) : (
                    cashFlowStatement.investingItems.map((item, idx) => (
                      <tr key={`inv-${idx}`}>
                        <td className="py-2 px-4">{item.label}</td>
                        <td className="py-2 px-3 font-mono">
                          {item.code ? (
                            <button
                              type="button"
                              onClick={() => onOpenRegister(item.code!)}
                              className="text-[#2563EB] hover:underline cursor-pointer"
                            >
                              {item.code}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{item.note || '—'}</td>
                        <td className={`py-2 px-4 text-right font-mono tabular-nums ${item.amount < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                          {formatBDT(item.amount, true)}
                        </td>
                      </tr>
                    ))
                  )}
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={3} className="py-2 px-4">Net Cash Provided by / (Used in) Investing Activities</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">
                      {formatBDT(cashFlowStatement.netInvestingCash, true)}
                    </td>
                  </tr>

                  <tr className="bg-blue-50/60 font-bold text-[#001F60]">
                    <td colSpan={4} className="py-2 px-4">
                      C. Cash Flows from Financing Activities
                    </td>
                  </tr>
                  {cashFlowStatement.financingItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-2 px-4 text-slate-400 italic">
                        No long-term borrowing or equity capital movements during this period
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums">0.00</td>
                    </tr>
                  ) : (
                    cashFlowStatement.financingItems.map((item, idx) => (
                      <tr key={`fin-${idx}`}>
                        <td className="py-2 px-4">{item.label}</td>
                        <td className="py-2 px-3 font-mono">
                          {item.code ? (
                            <button
                              type="button"
                              onClick={() => onOpenRegister(item.code!)}
                              className="text-[#2563EB] hover:underline cursor-pointer"
                            >
                              {item.code}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{item.note || '—'}</td>
                        <td className={`py-2 px-4 text-right font-mono tabular-nums ${item.amount < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                          {formatBDT(item.amount, true)}
                        </td>
                      </tr>
                    ))
                  )}
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={3} className="py-2 px-4">Net Cash Provided by / (Used in) Financing Activities</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">
                      {formatBDT(cashFlowStatement.netFinancingCash, true)}
                    </td>
                  </tr>

                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={3} className="py-2.5 px-4">Net Increase / (Decrease) in Cash &amp; Cash Equivalents (A + B + C)</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {formatBDT(cashFlowStatement.netCashChange, true)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-2 px-4 text-slate-700">Cash &amp; Cash Equivalents at Beginning of Period</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">
                      {formatBDT(cashFlowStatement.openingCashBalance, true)}
                    </td>
                  </tr>
                  <tr className="bg-[#001F60]/5 font-bold text-[#001F60]">
                    <td colSpan={3} className="py-2.5 px-4">Cash &amp; Cash Equivalents at End of Period</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {formatBDT(cashFlowStatement.closingCashBalance, true)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {cashFlowStatement.cashAccounts.length > 0 && (
            <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden shadow-xs">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-800">
                Cash &amp; Bank Accounts Breakdown
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#001F60] text-white text-xs font-bold">
                      <th className="py-2 px-4">GL Code</th>
                      <th className="py-2 px-4">Cash / Bank Account</th>
                      <th className="py-2 px-4 text-right">Opening (BDT)</th>
                      <th className="py-2 px-4 text-right">Net Change (BDT)</th>
                      <th className="py-2 px-4 text-right">Closing (BDT)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white text-xs">
                    {cashFlowStatement.cashAccounts.map((ca) => (
                      <tr key={ca.code}>
                        <td className="py-2 px-4 font-mono">
                          <button
                            type="button"
                            onClick={() => onOpenRegister(ca.code)}
                            className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                          >
                            {ca.code}
                          </button>
                        </td>
                        <td className="py-2 px-4 font-medium">{ca.name}</td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">{formatBDT(ca.opening, true)}</td>
                        <td className={`py-2 px-4 text-right font-mono tabular-nums ${ca.netChange < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {formatBDT(ca.netChange, true)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-bold tabular-nums">{formatBDT(ca.closing, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. STATEMENT OF CHANGES IN EQUITY (IAS 1) */}
      {activeRoute === 'reports-equity-changes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Opening Equity</div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900">
                {formatBDT(equityChanges.totalOpening, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Beginning of fiscal period</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Capital Additions</div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-emerald-700">
                {formatBDT(equityChanges.totalAdditions, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Issued capital &amp; reserve credits</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Net Profit / (Loss)</div>
              <div className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${equityChanges.totalNetProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatBDT(equityChanges.totalNetProfit, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Transferred from Income Statement</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold text-slate-500">Closing Total Equity</div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#001F60]">
                {formatBDT(equityChanges.totalClosing, true)}
              </div>
              <div className="mt-1 text-[11px] text-emerald-700 font-semibold">
                {equityChanges.isReconciled ? 'Matches Balance Sheet Equity' : 'Variance Detected'}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#001F60] text-white text-xs font-bold">
                    <th className="py-2.5 px-4 whitespace-nowrap">GL Code</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Equity Component</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Opening Balance</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Additions / Credits</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Drawings / Deductions</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Net Profit / (Loss)</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Closing Balance</th>
                  </tr>
                </thead>
                <tbody className="bg-white text-xs text-slate-800">
                  {equityChanges.rows.map((row) => (
                    <tr key={row.code}>
                      <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                        {row.code !== 'P&L' ? (
                          <button
                            type="button"
                            onClick={() => onOpenRegister(row.code)}
                            className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                          >
                            {row.code}
                          </button>
                        ) : (
                          <span className="font-semibold text-emerald-700">P&amp;L</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.name}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatBDT(row.openingBalance, true)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700">
                        {formatBDT(row.additions, true)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                        {formatBDT(row.deductions, true)}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-mono tabular-nums ${row.netProfitShare < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {formatBDT(row.netProfitShare, true)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-slate-900">
                        {formatBDT(row.closingBalance, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-[#001F60]">
                    <td colSpan={2} className="py-2.5 px-4">Total Shareholders&apos; Equity</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {formatBDT(equityChanges.totalOpening, true)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700">
                      {formatBDT(equityChanges.totalAdditions, true)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                      {formatBDT(equityChanges.totalDeductions, true)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {formatBDT(equityChanges.totalNetProfit, true)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {formatBDT(equityChanges.totalClosing, true)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 7. 12-MONTH SUMMARY MATRIX */}
      {activeRoute === 'reports-monthly' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
            <div>
              <h1 className="text-xl font-bold text-slate-900">12-Month Summary Matrix</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Posted monthly ledger movements across Bangladesh Fiscal Year {state.config.fiscalPeriod}
              </p>
            </div>
            <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
              {(
                [
                  { key: 'net', label: 'Net Movement' },
                  { key: 'debit', label: 'Monthly Debits' },
                  { key: 'credit', label: 'Monthly Credits' },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMatrixMetric(m.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                    matrixMetric === m.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="overflow-x-auto ledger-scroll">
              <table className="w-full text-left border-collapse min-w-[1440px]">
                <thead>
                  <tr className="bg-[#2563EB] text-white text-xs font-medium">
                    <th className="py-2.5 px-3 sticky left-0 bg-[#2563EB] z-10 whitespace-nowrap">
                      GL Account
                    </th>
                    {monthlySummary.monthLabels.map((lbl) => (
                      <th key={lbl} className="py-2.5 px-2.5 text-right whitespace-nowrap">
                        {lbl}
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">FY Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {monthlySummary.rows
                    .filter((r) => r.totalDebit > 0 || r.totalCredit > 0)
                    .map((r) => {
                      const rowTotal =
                        matrixMetric === 'debit'
                          ? r.totalDebit
                          : matrixMetric === 'credit'
                            ? r.totalCredit
                            : r.totalNet;
                      return (
                        <tr key={r.code} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3 sticky left-0 bg-white border-r border-slate-100 whitespace-nowrap">
                            <button
                              onClick={() => onOpenRegister(r.code)}
                              className="text-left hover:text-[#2563EB] hover:underline cursor-pointer"
                            >
                              <span className="font-mono font-semibold text-[#2563EB] mr-1.5">
                                {r.code}
                              </span>
                              <span className="text-slate-800">{r.name}</span>
                            </button>
                          </td>
                          {monthlySummary.monthKeys.map((mk) => {
                            const val = r.months[mk][matrixMetric];
                            return (
                              <td
                                key={mk}
                                className={`py-2 px-2.5 text-right font-mono tabular-nums whitespace-nowrap ${
                                  val < 0 ? 'text-red-700' : val > 0 ? 'text-slate-900' : 'text-slate-300'
                                }`}
                              >
                                {formatBDT(val, true)}
                              </td>
                            );
                          })}
                          <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap bg-slate-50/70">
                            {formatBDT(rowTotal, true)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Account Transaction Drill-Down Drawer */}
      <ReportDrilldownDrawer
        state={periodState}
        target={drilldownTarget}
        onClose={() => setDrilldownTarget(null)}
        onOpenRegister={onOpenRegister}
        onNavigateToIncomeStatement={() => onNavigate('reports-income')}
      />
    </div>
  );
};

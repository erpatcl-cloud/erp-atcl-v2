import React, { useMemo } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  ShieldCheck,
  FileCheck2,
  FolderSync,
  Database,
} from 'lucide-react';
import {
  computeBalanceSheet,
  computeFinancialRatios,
  computeIncomeStatement,
  computeMonthlySummary,
  computeTrialBalance,
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
} from '../engine/accountingEngine.ts';
import type { ActiveRoute, LedgerState } from '../types/accounting.ts';
import { FinancialInsightsSection } from './FinancialInsightsSection.tsx';
import { MetricCard } from './common/MetricCard.tsx';

interface ControlDashboardProps {
  state: LedgerState;
  busyAction: string | null;
  onNavigate: (route: ActiveRoute) => void;
  onCreateMissingRegisters: () => void;
  onValidateJournal: () => void;
  onSyncRegisters: () => void;
  onRunReconciliation: () => void;
  onLoadSampleTransactions: () => void;
}

export const ControlDashboard: React.FC<ControlDashboardProps> = ({
  state,
  busyAction,
  onNavigate,
  onCreateMissingRegisters,
  onValidateJournal,
  onSyncRegisters,
  onRunReconciliation,
  onLoadSampleTransactions,
}) => {
  const balanceSheet = useMemo(() => computeBalanceSheet(state), [state]);
  const incomeStatement = useMemo(() => computeIncomeStatement(state), [state]);
  const trialBalance = useMemo(() => computeTrialBalance(state), [state]);
  const monthly = useMemo(() => computeMonthlySummary(state), [state]);
  const financialRatios = useMemo(() => computeFinancialRatios(state), [state]);

  const counts = useMemo(() => {
    const byCategory = { Asset: 0, Liability: 0, Equity: 0, Income: 0, Expense: 0 };
    let activeRegisters = 0;
    for (const acc of state.accounts) {
      byCategory[acc.category]++;
      if (acc.registerFileId && state.registers[acc.code]) activeRegisters++;
    }
    const unpostedVouchers = new Set(
      state.journalLines.filter((l) => l.postingStatus !== 'POSTED').map((l) => l.voucherNo)
    ).size;
    const pendingSync = state.postedTransactions.filter((t) => t.registerSynced === 'PENDING').length;
    return {
      totalAccounts: state.accounts.length,
      activeRegisters,
      byCategory,
      unpostedVouchers,
      pendingSync,
      postedCount: state.postedTransactions.length,
    };
  }, [state]);

  const maxMonthlyVal = useMemo(() => {
    let max = 1;
    for (const mk of monthly.monthKeys) {
      const m = monthly.monthlyTotals[mk];
      if (m.debit > max) max = m.debit;
      if (m.credit > max) max = m.credit;
    }
    return max;
  }, [monthly]);

  // Exact 8-row Quick Navigation Menu matching Control_Dashboard CSV
  const navDirectory: Array<{
    sheet: string;
    route: ActiveRoute;
    metric: string;
    description: string;
  }> = [
    {
      sheet: 'Chart of Accounts',
      route: 'coa',
      metric: `${counts.totalAccounts} GL Accounts`,
      description: `${counts.totalAccounts} GL Accounts with individual Drive Register links`,
    },
    {
      sheet: 'Master Journal Entry',
      route: 'journal',
      metric: `${counts.unpostedVouchers} Unposted`,
      description: 'Operational transaction and voucher entry sheet',
    },
    {
      sheet: 'Posted Journal Store',
      route: 'posted-store',
      metric: `${counts.postedCount} Posted Lines`,
      description: 'Immutable authoritative ledger store',
    },
    {
      sheet: 'GL Summary Dashboard',
      route: 'reports-summary',
      metric: `${counts.activeRegisters} Registers`,
      description: 'Consolidated real-time GL balances and KPIs',
    },
    {
      sheet: 'Trial Balance',
      route: 'reports-trial-balance',
      metric: trialBalance.isClosingBalanced ? 'Balanced' : 'Variance',
      description: '8-Column statutory Trial Balance with auto-reconciliation',
    },
    {
      sheet: 'Income Statement',
      route: 'reports-income',
      metric: formatCompactBDT(incomeStatement.netProfit),
      description: 'IFRS Profit or Loss Statement',
    },
    {
      sheet: 'Balance Sheet',
      route: 'reports-balance-sheet',
      metric: formatCompactBDT(balanceSheet.totalAssets),
      description: 'IFRS Statement of Financial Position',
    },
    {
      sheet: 'System Audit Log',
      route: 'audit-log',
      metric: `${state.auditLogs.length} Audit Events`,
      description: 'Full chronological system operation audit log',
    },
  ];

  const baseEquity = balanceSheet.totalEquity - balanceSheet.currentPeriodNetProfit;
  const liabRatio =
    balanceSheet.totalAssets > 0
      ? Math.min(100, (balanceSheet.totalLiabilities / balanceSheet.totalAssets) * 100)
      : 0;
  const equityRatio = Math.max(0, 100 - liabRatio);

  const handleExportControlDashboardCSV = () => {
    const eqStatus = balanceSheet.isBalanced
      ? 'BALANCED (A = L + E + Profit)'
      : `OUT OF BALANCE (${balanceSheet.variance.toFixed(2)})`;
    const tbStatus = `${
      trialBalance.isOpeningBalanced ? 'OPENING TRIAL BALANCE BALANCED' : 'OPENING TRIAL BALANCE UNBALANCED'
    } | ${
      trialBalance.isClosingBalanced ? 'CLOSING TRIAL BALANCE BALANCED' : 'CLOSING TRIAL BALANCE UNBALANCED'
    }`;

    exportRowsToCSV(
      `ATCL_Control_Dashboard_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Section', 'Metric / Sheet', 'Value 1', 'Label 2', 'Value 2', 'Label 3', 'Value 3'],
      [
        ['SYSTEM OVERVIEW', 'Total GL Accounts', counts.totalAccounts, 'Total Active Registers', counts.activeRegisters, 'Reporting Currency', state.config.currencyCode],
        ['SYSTEM OVERVIEW', 'Total Asset Accounts', counts.byCategory.Asset, 'Total Liability Accounts', counts.byCategory.Liability, 'Total Equity Accounts', counts.byCategory.Equity],
        ['SYSTEM OVERVIEW', 'Total Income Accounts', counts.byCategory.Income, 'Total Expense Accounts', counts.byCategory.Expense, 'Fiscal Period', state.config.fiscalPeriod],
        ['FINANCIAL EQUATION', 'Total Assets (BDT)', balanceSheet.totalAssets.toFixed(2), 'Total Liabilities (BDT)', balanceSheet.totalLiabilities.toFixed(2), 'Total Equity (BDT)', baseEquity.toFixed(2)],
        ['FINANCIAL EQUATION', 'Net Income / Profit', incomeStatement.netProfit.toFixed(2), 'Equation Check', eqStatus, 'Trial Balance Status', tbStatus],
        ['FINANCIAL INSIGHTS', 'Current Ratio', `${financialRatios.current.currentRatio.toFixed(2)}x`, 'Quick Ratio', `${financialRatios.current.quickRatio.toFixed(2)}x`, 'Cash Ratio', `${financialRatios.current.cashRatio.toFixed(2)}x`],
        ['FINANCIAL INSIGHTS', 'Gross Profit Margin', `${financialRatios.current.grossMarginPct.toFixed(2)}%`, 'Operating Margin (EBIT)', `${financialRatios.current.operatingMarginPct.toFixed(2)}%`, 'Net Profit Margin', `${financialRatios.current.netProfitMarginPct.toFixed(2)}%`],
        ['FINANCIAL INSIGHTS', 'Return on Equity (ROE)', `${financialRatios.current.returnOnEquityPct.toFixed(2)}%`, 'Return on Assets (ROA)', `${financialRatios.current.returnOnAssetsPct.toFixed(2)}%`, 'Debt-to-Equity', `${financialRatios.current.debtToEquity.toFixed(2)}x`],
      ]
    );
  };

  return (
    <div className="space-y-6">
      {/* Executive Header matching V1 Dashboard Welcome Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">
            {state.config.organizationName.toUpperCase()} · AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
            Master Financial Control Center & Multi-Register Synchronizer
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Fiscal Period {state.config.fiscalPeriod}</span>
            <span aria-hidden="true">·</span>
            <span>Reporting Currency {state.config.currencyCode} ({state.config.currencySymbol})</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{counts.totalAccounts} GL Accounts / {counts.activeRegisters} Active Registers</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {counts.postedCount === 0 && (
            <button
              onClick={onLoadSampleTransactions}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              <Database className="w-4 h-4" />
              <span>Load Sample FY Transactions</span>
            </button>
          )}
          <button
            onClick={handleExportControlDashboardCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export Control CSV</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: FINANCIAL EQUATION BALANCE MONITOR */}
      <section aria-label="Financial Equation Balance Monitor" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">
            Financial Equation Balance Monitor
          </h2>
          <div className="flex items-center gap-2 text-xs font-medium">
            {balanceSheet.isBalanced && trialBalance.isClosingBalanced ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                <span>BALANCED (A = L + E + Profit)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-red-700">
                <AlertTriangle className="w-4 h-4" />
                <span>OUT OF BALANCE ({formatBDT(balanceSheet.variance)})</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total Assets (BDT)"
            value={formatBDT(balanceSheet.totalAssets)}
            subValue={`${counts.byCategory.Asset} Asset Accounts · Current ${formatCompactBDT(balanceSheet.totalCurrentAssets)}`}
            tone="blue"
          />
          <MetricCard
            label="Total Liabilities (BDT)"
            value={formatBDT(balanceSheet.totalLiabilities)}
            subValue={`${counts.byCategory.Liability} Liability Accounts · ${liabRatio.toFixed(1)}% of Assets`}
            tone="amber"
          />
          <MetricCard
            label="Base Equity (Excl. Profit)"
            value={formatBDT(baseEquity)}
            subValue={`Incl. Profit ${formatCompactBDT(balanceSheet.totalEquity)} · ${equityRatio.toFixed(1)}% Capital Ratio`}
            tone="purple"
          />
          <MetricCard
            label="Net Income / Profit"
            value={formatBDT(incomeStatement.netProfit)}
            subValue={`Revenue ${formatCompactBDT(incomeStatement.totalIncome)} · Expenses ${formatCompactBDT(
              incomeStatement.totalDirectCosts +
                incomeStatement.totalOperatingExpenses +
                incomeStatement.totalFinancialExpenses +
                incomeStatement.totalTaxExpenses
            )}`}
            tone={incomeStatement.netProfit >= 0 ? 'emerald' : 'rose'}
          />
        </div>

        {/* Equation & Trial Balance Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white border border-slate-200/90 rounded-xl shadow-xs text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
            <span className="font-sans font-semibold text-slate-800">Equation Check:</span>
            <span className={balanceSheet.isBalanced ? 'text-emerald-700 font-semibold font-sans' : 'text-red-700 font-semibold font-sans'}>
              {balanceSheet.isBalanced ? 'BALANCED (A = L + E + Profit)' : `UNBALANCED (${formatBDT(balanceSheet.variance)})`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-slate-800">Trial Balance Status:</span>
            <span className={trialBalance.isOpeningBalanced ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
              {trialBalance.isOpeningBalanced ? 'OPENING TRIAL BALANCE BALANCED' : 'OPENING TB UNBALANCED'}
            </span>
            <span className="text-slate-300" aria-hidden="true">|</span>
            <span className={trialBalance.isClosingBalanced ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
              {trialBalance.isClosingBalanced ? 'CLOSING TRIAL BALANCE BALANCED' : 'CLOSING TB UNBALANCED'}
            </span>
          </div>
        </div>
      </section>

      {/* SECTION 2: FINANCIAL INSIGHTS (Recharts IFRS KPI Visualizations) */}
      <FinancialInsightsSection state={state} onNavigate={onNavigate} />

      {/* SECTION 3: SYSTEM OVERVIEW KPIs + ACTIVITY ANALYTICS */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* System Overview & KPIs (5 cols — exact 9 metrics from Control_Dashboard CSV) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              System Overview & Key Performance Indicators
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Chart of Accounts structure and active Register Book coverage
            </p>

            <div className="mt-4 grid grid-cols-3 border border-slate-200 rounded-md divide-x divide-y divide-slate-200 overflow-hidden">
              <div className="p-3 bg-slate-50/60">
                <div className="text-[11px] text-slate-500">Total GL Accounts</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-[#2563EB]">
                  {counts.totalAccounts}
                </div>
              </div>
              <div className="p-3 bg-slate-50/60">
                <div className="text-[11px] text-slate-500">Active Registers</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-[#2563EB]">
                  {counts.activeRegisters}
                </div>
              </div>
              <div className="p-3 bg-slate-50/60">
                <div className="text-[11px] text-slate-500">Currency</div>
                <div className="mt-1 text-lg font-bold font-mono text-slate-900">
                  {state.config.currencyCode}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Asset Accounts</div>
                <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
                  {counts.byCategory.Asset}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Liability Accounts</div>
                <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
                  {counts.byCategory.Liability}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Equity Accounts</div>
                <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
                  {counts.byCategory.Equity}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Income Accounts</div>
                <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
                  {counts.byCategory.Income}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Expense Accounts</div>
                <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
                  {counts.byCategory.Expense}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Fiscal Period</div>
                <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
                  {state.config.fiscalPeriod}
                </div>
              </div>
            </div>
          </div>

          {/* Operational Action Controls mirroring 02_Menu.gs */}
          <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-2 gap-2">
            <button
              onClick={onValidateJournal}
              disabled={busyAction !== null}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              <FileCheck2 className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Validate Journal</span>
            </button>
            <button
              onClick={onSyncRegisters}
              disabled={busyAction !== null}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Sync Registers</span>
            </button>
            <button
              onClick={onCreateMissingRegisters}
              disabled={busyAction !== null}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              <FolderSync className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Link Registers</span>
            </button>
            <button
              onClick={onRunReconciliation}
              disabled={busyAction !== null}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Run Audit</span>
            </button>
          </div>
        </div>

        {/* Fiscal Year Posting Activity Chart / Balance Structure (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Fiscal Year Posting Activity & Capital Structure
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {counts.postedCount > 0
                  ? `Monthly posted ledger turnover across FY ${state.config.fiscalPeriod} (${counts.postedCount} posted lines)`
                  : `Opening balance baseline active · ${counts.unpostedVouchers} draft voucher(s) queued in Master Journal`}
              </p>
            </div>
            <button
              onClick={() => onNavigate(counts.postedCount > 0 ? 'reports-monthly' : 'journal')}
              className="text-xs font-medium text-[#2563EB] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              {counts.postedCount > 0 ? 'Open Monthly Matrix' : 'Review Draft Vouchers'}
            </button>
          </div>

          {/* Capital Composition Bar */}
          <div className="mb-5">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
              <span>Equity Capital ({equityRatio.toFixed(1)}%)</span>
              <span>Liabilities ({liabRatio.toFixed(1)}%)</span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 rounded-sm overflow-hidden flex">
              <div
                className="bg-[#2563EB] h-full"
                style={{ width: `${equityRatio}%` }}
                title={`Equity: ${formatBDT(balanceSheet.totalEquity)}`}
              />
              <div
                className="bg-slate-400 h-full"
                style={{ width: `${liabRatio}%` }}
                title={`Liabilities: ${formatBDT(balanceSheet.totalLiabilities)}`}
              />
            </div>
          </div>

          {/* Crisp SVG Monthly Bar Chart */}
          <div className="w-full overflow-x-auto">
            <div className="min-w-[500px]">
              <svg viewBox="0 0 660 165" className="w-full h-40" role="img" aria-label="Monthly posted debit and credit activity">
                {[0, 0.33, 0.66, 1].map((pct) => {
                  const y = 132 - pct * 115;
                  return <line key={pct} x1="0" y1={y} x2="660" y2={y} stroke="#E2E8F0" strokeWidth="1" />;
                })}
                {monthly.monthKeys.map((mk, idx) => {
                  const m = monthly.monthlyTotals[mk];
                  const barH = counts.postedCount > 0 ? (m.debit / maxMonthlyVal) * 110 : 0;
                  const x = idx * 54 + 14;
                  const y = 132 - barH;
                  return (
                    <g key={mk}>
                      <rect
                        x={x}
                        y={barH > 0 ? Math.min(y, 128) : 130}
                        width="28"
                        height={barH > 0 ? Math.max(barH, 4) : 2}
                        rx="2"
                        fill={barH > 0 ? '#2563EB' : '#CBD5E1'}
                      >
                        <title>
                          {monthly.monthLabels[idx]}: Posted Turnover {formatBDT(m.debit)}
                        </title>
                      </rect>
                      <text
                        x={x + 14}
                        y="152"
                        textAnchor="middle"
                        className="fill-slate-500 text-[10px]"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {monthly.monthLabels[idx].split(' ')[0]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Period Debits:{' '}
              <strong className="font-mono text-slate-800 tabular-nums">
                {formatBDT(trialBalance.totals.periodDr)}
              </strong>
            </span>
            <span>
              Period Credits:{' '}
              <strong className="font-mono text-slate-800 tabular-nums">
                {formatBDT(trialBalance.totals.periodCr)}
              </strong>
            </span>
            <span>
              Unposted Vouchers:{' '}
              <strong className="font-mono text-amber-700 tabular-nums">
                {counts.unpostedVouchers}
              </strong>
            </span>
          </div>
        </div>
      </section>

      {/* SECTION 3: QUICK NAVIGATION MENU (Exact 8 sheets from Control_Dashboard CSV) */}
      <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Quick Navigation Menu
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Direct links to every operational ledger sheet, IFRS financial statement, and audit register
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-5">Sheet Name</th>
                <th className="py-2.5 px-4">Description</th>
                <th className="py-2.5 px-4 text-right">Current Status</th>
                <th className="py-2.5 px-5 text-right">Direct Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {navDirectory.map((item) => (
                <tr key={item.route} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-5 font-medium text-slate-900 whitespace-nowrap">
                    {item.sheet}
                  </td>
                  <td className="py-3 px-4 text-slate-600 text-xs">
                    {item.description}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    {item.metric}
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <button
                      onClick={() => onNavigate(item.route)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] hover:underline cursor-pointer"
                    >
                      <span>Open {item.sheet}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

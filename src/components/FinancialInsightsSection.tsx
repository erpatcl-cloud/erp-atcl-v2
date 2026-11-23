import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight } from 'lucide-react';
import {
  computeFinancialRatios,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type { ActiveRoute, LedgerState } from '../types/accounting.ts';

interface FinancialInsightsSectionProps {
  state: LedgerState;
  onNavigate: (route: ActiveRoute) => void;
}

type InsightsView = 'overview' | 'liquidity' | 'profitability';

interface RatioBarDatum {
  metric: string;
  shortLabel: string;
  current: number;
  prior: number;
  benchmark: number;
  unit: 'x' | '%';
  formula: string;
  currentDetail: string;
  priorDetail: string;
}

interface WorkingCapitalDatum {
  period: string;
  cashAndBank: number;
  receivables: number;
  advances: number;
  inventories: number;
  currentLiabilities: number;
  netWorkingCapital: number;
}

interface EarningsBridgeDatum {
  stage: string;
  fy25Cr: number;
  fy24Cr: number;
  fy25Raw: number;
  fy24Raw: number;
  fy25Pct: number;
  fy24Pct: number;
}

function formatDelta(val: number, unit: 'x' | 'pp'): string {
  const rounded = round2(val);
  const sign = rounded > 0 ? '+' : '';
  return unit === 'x' ? `${sign}${rounded.toFixed(2)}x` : `${sign}${rounded.toFixed(2)} pp`;
}

function getRatioStatus(
  value: number,
  goodMin: number,
  cautionMin: number,
  higherIsBetter = true
): { label: string; toneClass: string } {
  if (higherIsBetter) {
    if (value >= goodMin) return { label: 'Strong', toneClass: 'text-emerald-700' };
    if (value >= cautionMin) return { label: 'Adequate', toneClass: 'text-amber-700' };
    return { label: 'Watch', toneClass: 'text-red-700' };
  }
  if (value <= goodMin) return { label: 'Conservative', toneClass: 'text-emerald-700' };
  if (value <= cautionMin) return { label: 'Moderate', toneClass: 'text-amber-700' };
  return { label: 'Elevated', toneClass: 'text-red-700' };
}

export const FinancialInsightsSection: React.FC<FinancialInsightsSectionProps> = ({
  state,
  onNavigate,
}) => {
  const [activeView, setActiveView] = useState<InsightsView>('overview');

  const ratios = useMemo(() => computeFinancialRatios(state), [state]);
  const { current, prior } = ratios;

  const liquidityChartData: RatioBarDatum[] = useMemo(
    () => [
      {
        metric: 'Current Ratio',
        shortLabel: 'Current',
        current: current.currentRatio,
        prior: prior.currentRatio,
        benchmark: 1.5,
        unit: 'x',
        formula: 'Current Assets ÷ Current Liabilities',
        currentDetail: `${formatCompactBDT(current.currentAssets)} ÷ ${formatCompactBDT(current.currentLiabilities)}`,
        priorDetail: `${formatCompactBDT(prior.currentAssets)} ÷ ${formatCompactBDT(prior.currentLiabilities)}`,
      },
      {
        metric: 'Quick Ratio (Acid-Test)',
        shortLabel: 'Quick',
        current: current.quickRatio,
        prior: prior.quickRatio,
        benchmark: 1.0,
        unit: 'x',
        formula: '(Cash & Bank + Receivables) ÷ Current Liabilities',
        currentDetail: `${formatCompactBDT(current.quickAssets)} ÷ ${formatCompactBDT(current.currentLiabilities)}`,
        priorDetail: `${formatCompactBDT(prior.quickAssets)} ÷ ${formatCompactBDT(prior.currentLiabilities)}`,
      },
      {
        metric: 'Cash Ratio',
        shortLabel: 'Cash',
        current: current.cashRatio,
        prior: prior.cashRatio,
        benchmark: 0.5,
        unit: 'x',
        formula: 'Cash & Bank Balances ÷ Current Liabilities',
        currentDetail: `${formatCompactBDT(current.cashAndEquivalents)} ÷ ${formatCompactBDT(current.currentLiabilities)}`,
        priorDetail: `${formatCompactBDT(prior.cashAndEquivalents)} ÷ ${formatCompactBDT(prior.currentLiabilities)}`,
      },
      {
        metric: 'Debt-to-Equity',
        shortLabel: 'Debt / Eq',
        current: current.debtToEquity,
        prior: prior.debtToEquity,
        benchmark: 1.0,
        unit: 'x',
        formula: 'Total Liabilities ÷ Total Equity',
        currentDetail: `${formatCompactBDT(current.totalLiabilities)} ÷ ${formatCompactBDT(current.totalEquity)}`,
        priorDetail: `${formatCompactBDT(prior.totalLiabilities)} ÷ ${formatCompactBDT(prior.totalEquity)}`,
      },
    ],
    [current, prior]
  );

  const profitabilityChartData: RatioBarDatum[] = useMemo(
    () => [
      {
        metric: 'Gross Profit Margin',
        shortLabel: 'Gross',
        current: current.grossMarginPct,
        prior: prior.grossMarginPct,
        benchmark: 25,
        unit: '%',
        formula: 'Gross Profit ÷ Sales Revenue',
        currentDetail: `${formatCompactBDT(current.grossProfit)} on ${formatCompactBDT(current.revenue)}`,
        priorDetail: `${formatCompactBDT(prior.grossProfit)} on ${formatCompactBDT(prior.revenue)}`,
      },
      {
        metric: 'Operating Margin (EBIT)',
        shortLabel: 'EBIT',
        current: current.operatingMarginPct,
        prior: prior.operatingMarginPct,
        benchmark: 15,
        unit: '%',
        formula: 'Operating Profit ÷ Sales Revenue',
        currentDetail: `${formatCompactBDT(current.operatingProfit)} on ${formatCompactBDT(current.revenue)}`,
        priorDetail: `${formatCompactBDT(prior.operatingProfit)} on ${formatCompactBDT(prior.revenue)}`,
      },
      {
        metric: 'Net Profit Margin',
        shortLabel: 'Net Margin',
        current: current.netProfitMarginPct,
        prior: prior.netProfitMarginPct,
        benchmark: 8,
        unit: '%',
        formula: 'Net Profit After Tax ÷ Sales Revenue',
        currentDetail: `${formatCompactBDT(current.netProfit)} on ${formatCompactBDT(current.revenue)}`,
        priorDetail: `${formatCompactBDT(prior.netProfit)} on ${formatCompactBDT(prior.revenue)}`,
      },
      {
        metric: 'Return on Assets (ROA)',
        shortLabel: 'ROA',
        current: current.returnOnAssetsPct,
        prior: prior.returnOnAssetsPct,
        benchmark: 10,
        unit: '%',
        formula: 'Net Profit ÷ Total Assets',
        currentDetail: `${formatCompactBDT(current.netProfit)} ÷ ${formatCompactBDT(current.totalAssets)}`,
        priorDetail: `${formatCompactBDT(prior.netProfit)} ÷ ${formatCompactBDT(prior.totalAssets)}`,
      },
      {
        metric: 'Return on Equity (ROE)',
        shortLabel: 'ROE',
        current: current.returnOnEquityPct,
        prior: prior.returnOnEquityPct,
        benchmark: 18,
        unit: '%',
        formula: 'Net Profit ÷ Total Equity',
        currentDetail: `${formatCompactBDT(current.netProfit)} ÷ ${formatCompactBDT(current.totalEquity)}`,
        priorDetail: `${formatCompactBDT(prior.netProfit)} ÷ ${formatCompactBDT(prior.totalEquity)}`,
      },
    ],
    [current, prior]
  );

  const workingCapitalData: WorkingCapitalDatum[] = useMemo(
    () => [
      {
        period: 'FY 2023–24',
        cashAndBank: round2(prior.cashAndEquivalents / 1e7),
        receivables: round2(prior.tradeReceivables / 1e7),
        advances: round2(prior.prepaymentsAndAdvances / 1e7),
        inventories: round2(prior.inventories / 1e7),
        currentLiabilities: round2(prior.currentLiabilities / 1e7),
        netWorkingCapital: prior.netWorkingCapital,
      },
      {
        period: 'FY 2024–25',
        cashAndBank: round2(current.cashAndEquivalents / 1e7),
        receivables: round2(current.tradeReceivables / 1e7),
        advances: round2(current.prepaymentsAndAdvances / 1e7),
        inventories: round2(current.inventories / 1e7),
        currentLiabilities: round2(current.currentLiabilities / 1e7),
        netWorkingCapital: current.netWorkingCapital,
      },
    ],
    [current, prior]
  );

  const earningsBridgeData: EarningsBridgeDatum[] = useMemo(
    () => [
      {
        stage: 'Revenue',
        fy25Cr: round2(current.revenue / 1e7),
        fy24Cr: round2(prior.revenue / 1e7),
        fy25Raw: current.revenue,
        fy24Raw: prior.revenue,
        fy25Pct: 100,
        fy24Pct: 100,
      },
      {
        stage: 'Gross Profit',
        fy25Cr: round2(current.grossProfit / 1e7),
        fy24Cr: round2(prior.grossProfit / 1e7),
        fy25Raw: current.grossProfit,
        fy24Raw: prior.grossProfit,
        fy25Pct: current.grossMarginPct,
        fy24Pct: prior.grossMarginPct,
      },
      {
        stage: 'EBIT',
        fy25Cr: round2(current.operatingProfit / 1e7),
        fy24Cr: round2(prior.operatingProfit / 1e7),
        fy25Raw: current.operatingProfit,
        fy24Raw: prior.operatingProfit,
        fy25Pct: current.operatingMarginPct,
        fy24Pct: prior.operatingMarginPct,
      },
      {
        stage: 'PBT',
        fy25Cr: round2(current.profitBeforeTax / 1e7),
        fy24Cr: round2(prior.profitBeforeTax / 1e7),
        fy25Raw: current.profitBeforeTax,
        fy24Raw: prior.profitBeforeTax,
        fy25Pct: current.preTaxMarginPct,
        fy24Pct: prior.preTaxMarginPct,
      },
      {
        stage: 'Net Profit',
        fy25Cr: round2(current.netProfit / 1e7),
        fy24Cr: round2(prior.netProfit / 1e7),
        fy25Raw: current.netProfit,
        fy24Raw: prior.netProfit,
        fy25Pct: current.netProfitMarginPct,
        fy24Pct: prior.netProfitMarginPct,
      },
    ],
    [current, prior]
  );

  const currentRatioStatus = getRatioStatus(current.currentRatio, 1.5, 1.15);
  const quickRatioStatus = getRatioStatus(current.quickRatio, 1.0, 0.75);
  const netMarginStatus = getRatioStatus(current.netProfitMarginPct, 8.0, 5.0);
  const roeStatus = getRatioStatus(current.returnOnEquityPct, 18.0, 10.0);

  const liquidityRows = [
    {
      label: 'Current Ratio',
      formula: 'Current Assets ÷ Current Liabilities',
      fy25: `${current.currentRatio.toFixed(2)}x`,
      fy24: `${prior.currentRatio.toFixed(2)}x`,
      delta: formatDelta(current.currentRatio - prior.currentRatio, 'x'),
      benchmark: '≥ 1.50x',
      status: currentRatioStatus,
    },
    {
      label: 'Quick Ratio (Acid-Test)',
      formula: '(Cash & Bank + Receivables) ÷ Current Liab.',
      fy25: `${current.quickRatio.toFixed(2)}x`,
      fy24: `${prior.quickRatio.toFixed(2)}x`,
      delta: formatDelta(current.quickRatio - prior.quickRatio, 'x'),
      benchmark: '≥ 1.00x',
      status: quickRatioStatus,
    },
    {
      label: 'Cash Ratio',
      formula: 'Cash & Bank ÷ Current Liabilities',
      fy25: `${current.cashRatio.toFixed(2)}x`,
      fy24: `${prior.cashRatio.toFixed(2)}x`,
      delta: formatDelta(current.cashRatio - prior.cashRatio, 'x'),
      benchmark: '≥ 0.50x',
      status: getRatioStatus(current.cashRatio, 0.5, 0.2),
    },
    {
      label: 'Net Working Capital',
      formula: 'Current Assets − Current Liabilities',
      fy25: formatCompactBDT(current.netWorkingCapital),
      fy24: formatCompactBDT(prior.netWorkingCapital),
      delta: `${current.netWorkingCapital >= prior.netWorkingCapital ? '+' : ''}${formatCompactBDT(current.netWorkingCapital - prior.netWorkingCapital)}`,
      benchmark: '> ৳0',
      status: getRatioStatus(current.netWorkingCapital, 1, 0),
    },
    {
      label: 'Debt-to-Equity Ratio',
      formula: 'Total Liabilities ÷ Total Equity',
      fy25: `${current.debtToEquity.toFixed(2)}x`,
      fy24: `${prior.debtToEquity.toFixed(2)}x`,
      delta: formatDelta(current.debtToEquity - prior.debtToEquity, 'x'),
      benchmark: '≤ 1.00x',
      status: getRatioStatus(current.debtToEquity, 1.0, 1.5, false),
    },
    {
      label: 'Debt-to-Assets Ratio',
      formula: 'Total Liabilities ÷ Total Assets',
      fy25: `${current.debtToAssetsPct.toFixed(2)}%`,
      fy24: `${prior.debtToAssetsPct.toFixed(2)}%`,
      delta: formatDelta(current.debtToAssetsPct - prior.debtToAssetsPct, 'pp'),
      benchmark: '≤ 50.0%',
      status: getRatioStatus(current.debtToAssetsPct, 50, 65, false),
    },
  ];

  const profitabilityRows = [
    {
      label: 'Gross Profit Margin',
      formula: 'Gross Profit ÷ Sales Revenue',
      fy25: `${current.grossMarginPct.toFixed(2)}%`,
      fy24: `${prior.grossMarginPct.toFixed(2)}%`,
      delta: formatDelta(current.grossMarginPct - prior.grossMarginPct, 'pp'),
      status: getRatioStatus(current.grossMarginPct, 25, 18),
    },
    {
      label: 'Operating Margin (EBIT)',
      formula: 'Operating Profit ÷ Sales Revenue',
      fy25: `${current.operatingMarginPct.toFixed(2)}%`,
      fy24: `${prior.operatingMarginPct.toFixed(2)}%`,
      delta: formatDelta(current.operatingMarginPct - prior.operatingMarginPct, 'pp'),
      status: getRatioStatus(current.operatingMarginPct, 15, 10),
    },
    {
      label: 'Pre-Tax Margin (EBT)',
      formula: 'Profit Before Tax ÷ Sales Revenue',
      fy25: `${current.preTaxMarginPct.toFixed(2)}%`,
      fy24: `${prior.preTaxMarginPct.toFixed(2)}%`,
      delta: formatDelta(current.preTaxMarginPct - prior.preTaxMarginPct, 'pp'),
      status: getRatioStatus(current.preTaxMarginPct, 12, 8),
    },
    {
      label: 'Net Profit Margin',
      formula: 'Net Profit After Tax ÷ Sales Revenue',
      fy25: `${current.netProfitMarginPct.toFixed(2)}%`,
      fy24: `${prior.netProfitMarginPct.toFixed(2)}%`,
      delta: formatDelta(current.netProfitMarginPct - prior.netProfitMarginPct, 'pp'),
      status: netMarginStatus,
    },
    {
      label: 'Effective Tax Rate',
      formula: 'Income Tax Expense ÷ Profit Before Tax',
      fy25: `${current.effectiveTaxRatePct.toFixed(2)}%`,
      fy24: `${prior.effectiveTaxRatePct.toFixed(2)}%`,
      delta: formatDelta(current.effectiveTaxRatePct - prior.effectiveTaxRatePct, 'pp'),
      status: getRatioStatus(current.effectiveTaxRatePct, 35, 47, false),
    },
    {
      label: 'Return on Assets (ROA)',
      formula: 'Net Profit ÷ Total Assets',
      fy25: `${current.returnOnAssetsPct.toFixed(2)}%`,
      fy24: `${prior.returnOnAssetsPct.toFixed(2)}%`,
      delta: formatDelta(current.returnOnAssetsPct - prior.returnOnAssetsPct, 'pp'),
      status: getRatioStatus(current.returnOnAssetsPct, 10, 6),
    },
    {
      label: 'Return on Equity (ROE)',
      formula: 'Net Profit ÷ Total Equity',
      fy25: `${current.returnOnEquityPct.toFixed(2)}%`,
      fy24: `${prior.returnOnEquityPct.toFixed(2)}%`,
      delta: formatDelta(current.returnOnEquityPct - prior.returnOnEquityPct, 'pp'),
      status: roeStatus,
    },
  ];

  const renderRatioTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: ReadonlyArray<{ payload?: RatioBarDatum }>;
  }) => {
    if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
    const item = payload[0].payload;
    const delta = item.current - item.prior;
    return (
      <div className="bg-white border border-slate-200 rounded-md px-3.5 py-2.5 shadow-sm text-xs max-w-[260px]">
        <div className="font-semibold text-slate-900">{item.metric}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{item.formula}</div>
        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1 font-mono tabular-nums">
          <div className="flex items-center justify-between gap-4">
            <span className="font-sans text-slate-600">FY 2024–25</span>
            <span className="font-semibold text-[#2563EB]">
              {item.current.toFixed(2)}
              {item.unit}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="font-sans text-slate-500">FY 2023–24</span>
            <span className="text-slate-700">
              {item.prior.toFixed(2)}
              {item.unit}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="font-sans text-slate-500">YoY Shift</span>
            <span className={delta >= 0 ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
              {formatDelta(delta, item.unit === 'x' ? 'x' : 'pp')}
            </span>
          </div>
        </div>
        <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] text-slate-500 font-mono tabular-nums">
          {item.currentDetail}
        </div>
      </div>
    );
  };

  return (
    <section aria-label="Financial Insights" className="space-y-4">
      {/* Header + Functional Segmented Control */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Financial Insights</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live IFRS liquidity, profitability, and capital efficiency ratios · FY {state.config.fiscalPeriod} vs FY 2023–24
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div
            role="tablist"
            aria-label="Financial insights views"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md border border-slate-200/80"
          >
            {(
              [
                { id: 'overview', label: 'KPI Overview' },
                { id: 'liquidity', label: 'Liquidity & Working Capital' },
                { id: 'profitability', label: 'Profitability & Returns' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeView === tab.id}
                onClick={() => setActiveView(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() =>
              onNavigate(activeView === 'profitability' ? 'reports-income' : 'reports-balance-sheet')
            }
            className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{activeView === 'profitability' ? 'Income Statement' : 'Balance Sheet'}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary Ratio Headline Strip — Single Divided Surface */}
      <div className="bg-white border border-slate-200 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200 grid grid-cols-1 md:grid-cols-4">
        <div className="p-5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-500">Current Ratio</span>
            <span className={`font-semibold ${currentRatioStatus.toneClass}`}>
              {currentRatioStatus.label}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {current.currentRatio.toFixed(2)}x
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {formatDelta(current.currentRatio - prior.currentRatio, 'x')} YoY
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            FY24 <span className="font-mono tabular-nums text-slate-700">{prior.currentRatio.toFixed(2)}x</span>
            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
            Working Cap <span className="font-mono tabular-nums text-slate-700">{formatCompactBDT(current.netWorkingCapital)}</span>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-500">Quick Ratio (Acid-Test)</span>
            <span className={`font-semibold ${quickRatioStatus.toneClass}`}>
              {quickRatioStatus.label}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {current.quickRatio.toFixed(2)}x
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-700 font-medium">
              {formatDelta(current.quickRatio - prior.quickRatio, 'x')} YoY
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            FY24 <span className="font-mono tabular-nums text-slate-700">{prior.quickRatio.toFixed(2)}x</span>
            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
            Cash Ratio <span className="font-mono tabular-nums text-slate-700">{current.cashRatio.toFixed(2)}x</span>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-500">Net Profit Margin</span>
            <span className={`font-semibold ${netMarginStatus.toneClass}`}>
              {netMarginStatus.label}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold font-mono tabular-nums text-emerald-700">
              {current.netProfitMarginPct.toFixed(2)}%
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {formatDelta(current.netProfitMarginPct - prior.netProfitMarginPct, 'pp')} YoY
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Gross <span className="font-mono tabular-nums text-slate-700">{current.grossMarginPct.toFixed(1)}%</span>
            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
            EBIT <span className="font-mono tabular-nums text-slate-700">{current.operatingMarginPct.toFixed(1)}%</span>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-500">Return on Equity (ROE)</span>
            <span className={`font-semibold ${roeStatus.toneClass}`}>{roeStatus.label}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {current.returnOnEquityPct.toFixed(2)}%
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {formatDelta(current.returnOnEquityPct - prior.returnOnEquityPct, 'pp')} YoY
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            ROA <span className="font-mono tabular-nums text-slate-700">{current.returnOnAssetsPct.toFixed(1)}%</span>
            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
            Debt/Eq <span className="font-mono tabular-nums text-slate-700">{current.debtToEquity.toFixed(2)}x</span>
          </div>
        </div>
      </div>

      {/* Interactive Recharts Deck */}
      {activeView === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Chart 1: Liquidity & Solvency Multiples (FY25 vs FY24) */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Liquidity & Solvency Multiples (FY 2024–25 vs FY 2023–24)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Current, Quick (excluding inventory & prepayments), Cash, and Debt-to-Equity ratios
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB]" aria-hidden="true" />
                  FY 24–25
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-300" aria-hidden="true" />
                  FY 23–24
                </span>
              </div>
            </div>

            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={liquidityChartData}
                  margin={{ top: 10, right: 16, left: -8, bottom: 4 }}
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fill: '#475569', fontSize: 12 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v.toFixed(1)}x`}
                    domain={[0, (dataMax: number) => Math.max(2.6, Math.ceil((dataMax + 0.3) * 2) / 2)]}
                  />
                  <Tooltip content={renderRatioTooltip} cursor={{ fill: '#F8FAFC' }} />
                  <ReferenceLine
                    y={1.0}
                    stroke="#0F766E"
                    strokeDasharray="4 4"
                    strokeWidth={1.2}
                    label={{
                      value: '1.0x Liquidity Floor',
                      position: 'insideTopRight',
                      fill: '#0F766E',
                      fontSize: 10,
                    }}
                  />
                  <Bar
                    dataKey="prior"
                    name="FY 2023–24"
                    fill="#CBD5E1"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="current"
                    name="FY 2024–25"
                    fill="#2563EB"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  >
                    {liquidityChartData.map((entry) => (
                      <Cell
                        key={entry.shortLabel}
                        fill={entry.shortLabel === 'Debt / Eq' ? '#475569' : '#2563EB'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Quick Assets:{' '}
                <strong className="font-mono text-slate-800 tabular-nums">
                  {formatCompactBDT(current.quickAssets)}
                </strong>
              </span>
              <span>
                Current Liabilities:{' '}
                <strong className="font-mono text-slate-800 tabular-nums">
                  {formatCompactBDT(current.currentLiabilities)}
                </strong>
              </span>
            </div>
          </div>

          {/* Chart 2: Profitability Margins & Capital Returns (FY25 vs FY24) */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Profitability Margins & Returns (% of Revenue / Capital)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Gross, Operating (EBIT), and Net Profit Margins alongside ROA and ROE
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#0F766E]" aria-hidden="true" />
                  FY 24–25
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-300" aria-hidden="true" />
                  FY 23–24
                </span>
              </div>
            </div>

            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={profitabilityChartData}
                  margin={{ top: 10, right: 16, left: -8, bottom: 4 }}
                  barGap={5}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fill: '#475569', fontSize: 12 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                    domain={[0, (dataMax: number) => Math.max(30, Math.ceil((dataMax + 4) / 5) * 5)]}
                  />
                  <Tooltip content={renderRatioTooltip} cursor={{ fill: '#F8FAFC' }} />
                  <Bar
                    dataKey="prior"
                    name="FY 2023–24"
                    fill="#CBD5E1"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                  />
                  <Bar
                    dataKey="current"
                    name="FY 2024–25"
                    fill="#0F766E"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                  >
                    {profitabilityChartData.map((entry) => (
                      <Cell
                        key={entry.shortLabel}
                        fill={
                          entry.shortLabel === 'ROA' || entry.shortLabel === 'ROE'
                            ? '#2563EB'
                            : '#0F766E'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Sales Revenue:{' '}
                <strong className="font-mono text-slate-800 tabular-nums">
                  {formatCompactBDT(current.revenue)}
                </strong>
              </span>
              <span>
                Net Profit After Tax:{' '}
                <strong className="font-mono text-emerald-700 tabular-nums">
                  {formatCompactBDT(current.netProfit)}
                </strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {activeView === 'liquidity' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Working Capital Composition Stacked Bar vs Current Liabilities */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Current Asset Liquidity Mix vs Short-Term Obligations (BDT Cr)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Stacked current asset quality compared directly against current liabilities
              </p>
            </div>

            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={workingCapitalData}
                  margin={{ top: 10, right: 16, left: -4, bottom: 4 }}
                  barGap={12}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="period"
                    tick={{ fill: '#475569', fontSize: 12 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `৳${v}Cr`}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0].payload as WorkingCapitalDatum;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md px-3.5 py-2.5 shadow-sm text-xs space-y-1">
                          <div className="font-semibold text-slate-900 mb-1">{label} Liquidity Structure</div>
                          <div className="flex justify-between gap-4 font-mono tabular-nums">
                            <span className="font-sans text-slate-600">Cash & Bank</span>
                            <span className="text-[#2563EB] font-medium">৳{row.cashAndBank.toFixed(2)} Cr</span>
                          </div>
                          <div className="flex justify-between gap-4 font-mono tabular-nums">
                            <span className="font-sans text-slate-600">Trade Receivables</span>
                            <span className="text-sky-700 font-medium">৳{row.receivables.toFixed(2)} Cr</span>
                          </div>
                          <div className="flex justify-between gap-4 font-mono tabular-nums">
                            <span className="font-sans text-slate-600">Advances & Prepayments</span>
                            <span className="text-slate-600">৳{row.advances.toFixed(2)} Cr</span>
                          </div>
                          <div className="flex justify-between gap-4 font-mono tabular-nums">
                            <span className="font-sans text-slate-600">Inventories</span>
                            <span className="text-slate-500">৳{row.inventories.toFixed(2)} Cr</span>
                          </div>
                          <div className="pt-1.5 mt-1 border-t border-slate-100 flex justify-between gap-4 font-mono tabular-nums">
                            <span className="font-sans text-slate-700 font-medium">Current Liabilities</span>
                            <span className="text-amber-700 font-semibold">৳{row.currentLiabilities.toFixed(2)} Cr</span>
                          </div>
                          <div className="flex justify-between gap-4 font-mono tabular-nums">
                            <span className="font-sans text-emerald-700 font-medium">Net Working Capital</span>
                            <span className="text-emerald-700 font-semibold">
                              {formatCompactBDT(row.netWorkingCapital)}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="cashAndBank" stackId="assets" name="Cash & Bank" fill="#2563EB" maxBarSize={54} />
                  <Bar dataKey="receivables" stackId="assets" name="Trade Receivables" fill="#0284C7" maxBarSize={54} />
                  <Bar dataKey="advances" stackId="assets" name="Advances & Prepayments" fill="#94A3B8" maxBarSize={54} />
                  <Bar
                    dataKey="inventories"
                    stackId="assets"
                    name="Inventories"
                    fill="#CBD5E1"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={54}
                  />
                  <Bar
                    dataKey="currentLiabilities"
                    name="Current Liabilities"
                    fill="#D97706"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={54}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB]" aria-hidden="true" />
                Cash & Bank
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-600" aria-hidden="true" />
                Receivables
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-400" aria-hidden="true" />
                Advances
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-300" aria-hidden="true" />
                Inventories
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-600" aria-hidden="true" />
                Current Liabilities
              </span>
            </div>
          </div>

          {/* Liquidity & Solvency Diagnostic Table */}
          <div className="lg:col-span-6 bg-white border border-[#001F60] rounded-lg overflow-hidden flex flex-col justify-between">
            <div>
              <div className="px-5 py-4 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Liquidity & Solvency Schedule
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Audited statutory ratio formulas with year-over-year comparison
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4">Ratio / Metric</th>
                      <th className="py-2.5 px-3 text-right">FY 24–25</th>
                      <th className="py-2.5 px-3 text-right">FY 23–24</th>
                      <th className="py-2.5 px-3 text-right">YoY</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {liquidityRows.map((row) => (
                      <tr key={row.label} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">{row.label}</div>
                          <div className="text-[11px] text-slate-500">{row.formula}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {row.fy25}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {row.fy24}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {row.delta}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-medium whitespace-nowrap ${row.status.toneClass}`}>
                          {row.status.label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeView === 'profitability' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Earnings Conversion Bridge (BDT Crore) */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Earnings Conversion Funnel (BDT Crore)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Revenue to Net Profit After Tax progression across comparative fiscal years
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB]" aria-hidden="true" />
                  FY 24–25
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-300" aria-hidden="true" />
                  FY 23–24
                </span>
              </div>
            </div>

            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={earningsBridgeData}
                  margin={{ top: 10, right: 16, left: -4, bottom: 4 }}
                  barGap={5}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="stage"
                    tick={{ fill: '#475569', fontSize: 12 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `৳${v}Cr`}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const d = payload[0].payload as EarningsBridgeDatum;
                      const growthPct =
                        d.fy24Raw > 0 ? round2(((d.fy25Raw - d.fy24Raw) / d.fy24Raw) * 100) : 0;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md px-3.5 py-2.5 shadow-sm text-xs space-y-1">
                          <div className="font-semibold text-slate-900 mb-1">{d.stage}</div>
                          <div className="flex justify-between gap-5 font-mono tabular-nums">
                            <span className="font-sans text-slate-600">FY 2024–25</span>
                            <span className="text-[#2563EB] font-semibold">
                              {formatBDT(d.fy25Raw)} ({d.fy25Pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="flex justify-between gap-5 font-mono tabular-nums">
                            <span className="font-sans text-slate-500">FY 2023–24</span>
                            <span className="text-slate-700">
                              {formatBDT(d.fy24Raw)} ({d.fy24Pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="pt-1.5 mt-1 border-t border-slate-100 flex justify-between gap-5 font-mono tabular-nums">
                            <span className="font-sans text-slate-500">YoY Growth</span>
                            <span className={growthPct >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                              {growthPct >= 0 ? '+' : ''}
                              {growthPct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="fy24Cr"
                    name="FY 2023–24"
                    fill="#CBD5E1"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                  />
                  <Bar
                    dataKey="fy25Cr"
                    name="FY 2024–25"
                    fill="#2563EB"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                  >
                    {earningsBridgeData.map((entry) => (
                      <Cell
                        key={entry.stage}
                        fill={entry.stage === 'Net Profit' ? '#0F766E' : '#2563EB'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Revenue YoY Growth:{' '}
                <strong className="font-mono text-emerald-700 tabular-nums">
                  +{prior.revenue > 0 ? (((current.revenue - prior.revenue) / prior.revenue) * 100).toFixed(1) : '0.0'}%
                </strong>
              </span>
              <span>
                Net Profit YoY Growth:{' '}
                <strong className="font-mono text-emerald-700 tabular-nums">
                  +{prior.netProfit > 0 ? (((current.netProfit - prior.netProfit) / prior.netProfit) * 100).toFixed(1) : '0.0'}%
                </strong>
              </span>
            </div>
          </div>

          {/* Profitability & Capital Efficiency Table */}
          <div className="lg:col-span-6 bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Profitability & Capital Return Schedule
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                IFRS earnings margins, tax burden, and shareholder return ratios
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4">Metric</th>
                    <th className="py-2.5 px-3 text-right">FY 24–25</th>
                    <th className="py-2.5 px-3 text-right">FY 23–24</th>
                    <th className="py-2.5 px-3 text-right">YoY</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {profitabilityRows.map((row) => (
                    <tr key={row.label} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{row.label}</div>
                        <div className="text-[11px] text-slate-500">{row.formula}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {row.fy25}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {row.fy24}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {row.delta}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-medium whitespace-nowrap ${row.status.toneClass}`}>
                        {row.status.label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

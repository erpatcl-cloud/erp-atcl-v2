import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { normalizeBDPhone, validateBDPhone } from '../lib/phoneUtils.ts';
import {
  computeCustomerLiveAR,
  computeGLSummary,
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  CustomerRecord,
  CustomerSegment,
  LedgerState,
  SystemConfig,
} from '../types/accounting.ts';
import { SearchableSelect, type SearchableOption } from './common/SearchableSelect.tsx';

interface Customers360PageProps {
  state: LedgerState;
  busyAction: string | null;
  currentUserEmail?: string;
  onOpenRegister: (code: string) => void;
  onOpenNewVoucher: () => void;
  onCreateCustomer: (payload: Omit<CustomerRecord, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateCustomer: (
    id: string,
    payload: Partial<Omit<CustomerRecord, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteCustomer: (id: string) => Promise<void>;
  onUpdateConfig?: (payload: Partial<SystemConfig>) => Promise<void>;
}

const DEFAULT_SEGMENTS: string[] = [
  'Government & Utility',
  'Telecom & ISP',
  'Banking & Finance',
  'Enterprise',
  'Commercial',
];

const DEFAULT_STATUSES: string[] = ['Active', 'On Hold', 'Inactive'];

function mergeUniqueStrings(defaults: string[], saved: string[] = [], existing: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const v of [...defaults, ...saved, ...existing]) {
    const t = String(v || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return Array.from(seen.values());
}

function generateNextCustomerCode(
  customers: CustomerRecord[],
  highestFloor = 1000
): string {
  const existing = new Set(customers.map((c) => c.code.trim().toUpperCase()));
  let maxNum = Math.max(1000, highestFloor);
  for (const c of customers) {
    const m = /^CUST-(\d+)$/.exec(c.code.trim().toUpperCase());
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  let candidateNum = maxNum + 1;
  let candidate = `CUST-${candidateNum}`;
  while (existing.has(candidate)) {
    candidateNum += 1;
    candidate = `CUST-${candidateNum}`;
  }
  return candidate;
}

const SEGMENTS: Array<'All' | CustomerSegment> = [
  'All',
  ...DEFAULT_SEGMENTS,
];

export const Customers360Page: React.FC<Customers360PageProps> = ({
  state,
  busyAction,
  currentUserEmail = 'system@atcl.com',
  onOpenRegister,
  onOpenNewVoucher,
  onCreateCustomer,
  onUpdateCustomer,
  onDeleteCustomer,
  onUpdateConfig,
}) => {
  const customers = state.customers || [];
  const [segmentFilter, setSegmentFilter] = useState<'All' | CustomerSegment>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(customers[0]?.id ?? '');
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glControlBalances = useMemo(() => {
    const summary = computeGLSummary(state);
    return {
      receivables1120: summary.find((r) => r.code === '1120')?.closingBalance ?? 0,
      revenue4010: summary.find((r) => r.code === '4010')?.closingBalance ?? 0,
    };
  }, [state]);

  const metrics = useMemo(() => {
    const activeCount = customers.filter((c) => c.status === 'Active').length;
    const onHoldCount = customers.filter((c) => c.status === 'On Hold').length;
    const totalReceivable = round2(customers.reduce((s, c) => s + c.currentReceivable, 0));
    const totalYtdRevenue = round2(customers.reduce((s, c) => s + c.ytdRevenue, 0));
    const totalOverdue90 = round2(customers.reduce((s, c) => s + (c.aging?.days90Plus ?? 0), 0));
    const arVariance = round2(totalReceivable - glControlBalances.receivables1120);
    const isArReconciled = Math.abs(arVariance) < 0.01;
    const overdue90Pct = totalReceivable > 0 ? (totalOverdue90 / totalReceivable) * 100 : 0;

    return {
      total: customers.length,
      activeCount,
      onHoldCount,
      totalReceivable,
      totalYtdRevenue,
      totalOverdue90,
      arVariance,
      isArReconciled,
      overdue90Pct,
    };
  }, [customers, glControlBalances]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return customers.filter((c) => {
      if (segmentFilter !== 'All' && c.segment !== segmentFilter) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.contactPerson.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.binNumber.toLowerCase().includes(q)
      );
    });
  }, [customers, segmentFilter, searchQuery]);

  const selectedCustomer = useMemo(() => {
    return (
      filteredCustomers.find((c) => c.id === selectedId) ??
      customers.find((c) => c.id === selectedId) ??
      filteredCustomers[0] ??
      null
    );
  }, [filteredCustomers, customers, selectedId]);

  const relatedLedgerLines = useMemo(() => {
    if (!selectedCustomer) return [];
    const nameToken = selectedCustomer.name.split(' ')[0]?.toLowerCase() ?? '';
    const directMatches = state.postedTransactions.filter(
      (t) =>
        t.glCode === selectedCustomer.receivableGlCode ||
        (nameToken.length > 3 && t.counterparty.toLowerCase().includes(nameToken))
    );
    return directMatches.slice(0, 5);
  }, [selectedCustomer, state.postedTransactions]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Customers_360_${state.config.fiscalPeriod}.csv`,
      [
        'Code',
        'Customer Name',
        'Segment',
        'Contact Person',
        'Email',
        'Phone',
        'City',
        'VAT BIN',
        'Payment Terms',
        'Credit Limit (BDT)',
        'Opening AR (BDT)',
        'Current AR (BDT)',
        '0-30d Current',
        '31-60d',
        '61-90d',
        '90+ Days',
        'FY Revenue (BDT)',
        'Receivable GL',
        'Status',
      ],
      filteredCustomers.map((c) => [
        c.code,
        c.name,
        c.segment,
        c.contactPerson,
        c.email,
        c.phone,
        c.city,
        c.binNumber,
        c.paymentTerms,
        c.creditLimit,
        c.openingReceivable,
        c.currentReceivable,
        c.aging.current,
        c.aging.days30,
        c.aging.days60,
        c.aging.days90Plus,
        c.ytdRevenue,
        c.receivableGlCode,
        c.status,
      ])
    );
  };

  const creditUtilization =
    selectedCustomer && selectedCustomer.creditLimit > 0
      ? Math.min(100, (selectedCustomer.currentReceivable / selectedCustomer.creditLimit) * 100)
      : 0;

  const availableCredit = selectedCustomer
    ? round2(selectedCustomer.creditLimit - selectedCustomer.currentReceivable)
    : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
            Customers 360°
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Enterprise customer accounts, credit utilization governance, AR aging analysis, and GL 1120 sub-ledger.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => {
              setEditingCustomer(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Customer Accounts</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {metrics.total}
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {metrics.activeCount} active
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {metrics.onHoldCount > 0 ? (
              <span className="text-amber-700 font-medium">
                {metrics.onHoldCount} account on credit hold
              </span>
            ) : (
              'All accounts in good standing'
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Trade Receivables Sub-Ledger</span>
            <button
              onClick={() => onOpenRegister('1120')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1120</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalReceivable)}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {metrics.isArReconciled ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-emerald-700 font-medium">Reconciled to GL 1120 Control</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-700 font-medium font-mono tabular-nums">
                  Variance vs GL 1120: {formatBDT(metrics.arVariance)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              FY {state.config.fiscalPeriod} Billed Revenue
            </span>
            <button
              onClick={() => onOpenRegister('4010')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 4010</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalYtdRevenue)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            GL 4010 Gross Sales: {formatCompactBDT(glControlBalances.revenue4010)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Overdue 90+ Days Exposure</div>
          <div
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              metrics.totalOverdue90 > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {formatBDT(metrics.totalOverdue90)}
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            {metrics.overdue90Pct.toFixed(1)}% of total Trade Receivables portfolio
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center bg-slate-200/70 p-1 rounded-lg gap-0.5">
          {SEGMENTS.map((seg) => {
            const active = segmentFilter === seg;
            return (
              <button
                key={seg}
                onClick={() => setSegmentFilter(seg)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {seg}
              </button>
            );
          })}
        </div>

        <div className="relative w-full xl:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search code, customer, BIN, city..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Master-Detail 360° Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Customer Directory Table */}
        <div className="xl:col-span-7 bg-white border border-[#001F60] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Customer Directory ({filteredCustomers.length})
            </span>
            <span className="text-xs text-slate-400">Select an account for 360° profile</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Segment</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">FY Revenue</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Receivable</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 px-4 text-center text-slate-500">
                      <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                      <div className="text-sm font-medium text-slate-700">No customers found</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Try a different segment filter or search term.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((cust) => {
                    const isSelected = selectedCustomer?.id === cust.id;
                    const utilPct =
                      cust.creditLimit > 0 ? (cust.currentReceivable / cust.creditLimit) * 100 : 0;
                    return (
                      <tr
                        key={cust.id}
                        onClick={() => setSelectedId(cust.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#EFF6FF]' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 leading-snug">
                            {cust.name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                            <span className="font-mono text-[#2563EB] font-medium">
                              {cust.code}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span>{cust.city}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap">
                          {cust.segment}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                          {formatCompactBDT(cust.ytdRevenue)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            {formatBDT(cust.currentReceivable)}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-0.5">
                            {utilPct.toFixed(0)}% of limit
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${
                              cust.status === 'Active'
                                ? 'text-emerald-700'
                                : cust.status === 'On Hold'
                                  ? 'text-amber-700'
                                  : 'text-slate-400'
                            }`}
                          >
                            {cust.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: 360° Customer Profile Panel */}
        <div className="xl:col-span-5 xl:sticky xl:top-20">
          {selectedCustomer ? (
            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
              {/* Profile Header */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-[#2563EB] font-semibold">
                      {selectedCustomer.code} · {selectedCustomer.segment}
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mt-1 leading-snug font-[var(--font-display)]">
                      {selectedCustomer.name}
                    </h2>
                    <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`font-semibold ${
                          selectedCustomer.status === 'Active'
                            ? 'text-emerald-700'
                            : selectedCustomer.status === 'On Hold'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {selectedCustomer.status}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>Terms: {selectedCustomer.paymentTerms}</span>
                      <span className="text-slate-300">·</span>
                      <button
                        onClick={() => onOpenRegister(selectedCustomer.receivableGlCode)}
                        className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                      >
                        GL {selectedCustomer.receivableGlCode}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingCustomer(selectedCustomer);
                        setShowModal(true);
                      }}
                      title="Edit customer"
                      className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === selectedCustomer.id ? (
                      <div className="inline-flex items-center gap-1.5 text-xs pl-1">
                        <button
                          disabled={busyAction !== null}
                          onClick={async () => {
                            await onDeleteCustomer(selectedCustomer.id);
                            setConfirmDeleteId(null);
                          }}
                          className="font-semibold text-red-700 hover:underline cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(selectedCustomer.id)}
                        title="Delete customer"
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Financial & Credit Health */}
              <div className="p-5 space-y-4">
                {(() => {
                  const liveAr = computeCustomerLiveAR(state, selectedCustomer.id);
                  return (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-slate-500">Live Receivable (AR 1120)</div>
                        <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                          {formatBDT(liveAr.outstanding)}
                        </div>
                        {liveAr.advanceUnapplied > 0 && (
                          <div className="text-[11px] font-mono text-amber-700 mt-0.5">
                            Adv. Unapplied (2110): {formatBDT(liveAr.advanceUnapplied)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">FY {state.config.fiscalPeriod} Billed</div>
                        <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                          {formatBDT(liveAr.invoicedAmount > 0 ? liveAr.invoicedAmount : selectedCustomer.ytdRevenue)}
                        </div>
                        {liveAr.overdueAmount > 0 && (
                          <div className="text-[11px] font-mono text-red-600 mt-0.5">
                            Overdue: {formatBDT(liveAr.overdueAmount)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Approved Credit Limit</div>
                        <div className="text-sm font-semibold font-mono tabular-nums text-slate-700 mt-0.5">
                          {formatBDT(selectedCustomer.creditLimit)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Available Credit Headroom</div>
                        <div
                          className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                            availableCredit < 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatBDT(availableCredit)}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Credit Utilization Bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-500">Credit Limit Utilization</span>
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {creditUtilization.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        creditUtilization >= 90
                          ? 'bg-red-600'
                          : creditUtilization >= 75
                            ? 'bg-amber-500'
                            : 'bg-[#2563EB]'
                      }`}
                      style={{ width: `${creditUtilization}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* AR Aging Breakdown */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">AR Aging Profile</span>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    Opening AR: {formatCompactBDT(selectedCustomer.openingReceivable)}
                  </span>
                </div>

                {/* Stacked Bar */}
                {selectedCustomer.currentReceivable > 0 && (
                  <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-100">
                    <div
                      className="bg-[#2563EB]"
                      style={{
                        width: `${(selectedCustomer.aging.current / selectedCustomer.currentReceivable) * 100}%`,
                      }}
                      title="0-30 Days Current"
                    />
                    <div
                      className="bg-sky-500"
                      style={{
                        width: `${(selectedCustomer.aging.days30 / selectedCustomer.currentReceivable) * 100}%`,
                      }}
                      title="31-60 Days"
                    />
                    <div
                      className="bg-amber-500"
                      style={{
                        width: `${(selectedCustomer.aging.days60 / selectedCustomer.currentReceivable) * 100}%`,
                      }}
                      title="61-90 Days"
                    />
                    <div
                      className="bg-red-600"
                      style={{
                        width: `${(selectedCustomer.aging.days90Plus / selectedCustomer.currentReceivable) * 100}%`,
                      }}
                      title="90+ Days Overdue"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs pt-1">
                  {[
                    { label: '0–30 Days (Current)', value: selectedCustomer.aging.current, tone: 'text-slate-900' },
                    { label: '31–60 Days', value: selectedCustomer.aging.days30, tone: 'text-slate-700' },
                    { label: '61–90 Days', value: selectedCustomer.aging.days60, tone: 'text-amber-700' },
                    {
                      label: '90+ Days Overdue',
                      value: selectedCustomer.aging.days90Plus,
                      tone: selectedCustomer.aging.days90Plus > 0 ? 'text-red-700 font-semibold' : 'text-slate-500',
                    },
                  ].map((bucket) => (
                    <div key={bucket.label} className="flex items-center justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">{bucket.label}</span>
                      <span className={`font-mono tabular-nums ${bucket.tone}`}>
                        {formatBDT(bucket.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Contact & Statutory Metadata */}
              <div className="p-5 space-y-2.5 text-xs">
                <div className="font-semibold text-slate-800 mb-1">Contact &amp; Tax Profile</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-slate-600">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedCustomer.contactPerson || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono truncate">BIN {selectedCustomer.binNumber || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedCustomer.email || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono truncate">{selectedCustomer.phone || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedCustomer.city}, Bangladesh</span>
                  </div>
                </div>
                {selectedCustomer.notes && (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-md p-2.5 mt-2 leading-relaxed">
                    {selectedCustomer.notes}
                  </p>
                )}
              </div>

              {/* Related GL Control Activity + Quick Actions */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    GL {selectedCustomer.receivableGlCode} Control Activity
                  </span>
                  <span className="text-xs text-slate-400">
                    {relatedLedgerLines.length} recent posting(s)
                  </span>
                </div>
                {relatedLedgerLines.length > 0 ? (
                  <div className="space-y-1.5">
                    {relatedLedgerLines.map((txn) => (
                      <div
                        key={txn.transactionId}
                        className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0"
                      >
                        <div className="min-w-0">
                          <span className="font-mono font-medium text-[#2563EB]">
                            {txn.voucherNo}
                          </span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-600 truncate">{txn.date}</span>
                        </div>
                        <span className="font-mono tabular-nums font-medium text-slate-900 shrink-0">
                          {txn.debit > 0 ? `Dr ${formatBDT(txn.debit)}` : `Cr ${formatBDT(txn.credit)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">No posted control ledger lines yet.</div>
                )}

                <div className="flex items-center gap-2.5 pt-2">
                  <button
                    onClick={() => onOpenRegister(selectedCustomer.receivableGlCode)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    <span>Open GL {selectedCustomer.receivableGlCode}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onOpenNewVoucher}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors cursor-pointer"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    <span>New Voucher</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500 text-sm">
              Select a customer from the directory to view their 360° profile.
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <CustomerFormModal
          customers={customers}
          config={state.config}
          initial={editingCustomer}
          busy={busyAction !== null}
          currentUserEmail={currentUserEmail}
          onClose={() => setShowModal(false)}
          onOpenRegister={onOpenRegister}
          onSelectExistingCustomer={(existingId) => {
            setShowModal(false);
            setSelectedId(existingId);
          }}
          onUpdateConfig={onUpdateConfig}
          onSubmit={async (payload) => {
            if (editingCustomer) {
              await onUpdateCustomer(editingCustomer.id, payload);
            } else {
              await onCreateCustomer(payload);
            }
          }}
        />
      )}
    </div>
  );
};

interface CustomerFormModalProps {
  customers: CustomerRecord[];
  config: SystemConfig;
  initial: CustomerRecord | null;
  busy: boolean;
  currentUserEmail: string;
  onClose: () => void;
  onOpenRegister: (code: string) => void;
  onSelectExistingCustomer: (id: string) => void;
  onUpdateConfig?: (payload: Partial<SystemConfig>) => Promise<void>;
  onSubmit: (payload: Omit<CustomerRecord, 'id' | 'updatedAt'>) => Promise<void>;
}

const CustomerFormModal: React.FC<CustomerFormModalProps> = ({
  customers,
  config,
  initial,
  busy,
  currentUserEmail,
  onClose,
  onOpenRegister,
  onSelectExistingCustomer,
  onUpdateConfig,
  onSubmit,
}) => {
  const [code, setCode] = useState(
    () => initial?.code ?? generateNextCustomerCode(customers, config.highestCustomerCodeNum)
  );
  const [segment, setSegment] = useState<string>(initial?.segment ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [vat, setVat] = useState(initial?.vat ?? '15%');
  const [binNumber, setBinNumber] = useState(initial?.binNumber ?? '');
  const [openingReceivable, setOpeningReceivable] = useState(
    initial ? initial.openingReceivable.toFixed(2) : '0.00'
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(Boolean(initial?.phone));
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [duplicateCustomer, setDuplicateCustomer] = useState<{
    id: string;
    code: string;
    name: string;
    phone: string;
    status: string;
  } | null>(null);

  const phoneValidation = useMemo(() => validateBDPhone(phone), [phone]);

  useEffect(() => {
    if (!phoneValidation.valid) {
      setDuplicateCustomer(null);
      setCheckingPhone(false);
      return;
    }

    let cancelled = false;
    setCheckingPhone(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.checkCustomerPhone(phoneValidation.normalized, initial?.id);
        if (!cancelled) {
          setDuplicateCustomer(res.duplicate ? res.existingCustomer : null);
        }
      } catch {
        if (!cancelled) {
          const localMatch = customers.find(
            (c) =>
              c.id !== initial?.id &&
              normalizeBDPhone(c.phone) === phoneValidation.normalized
          );
          setDuplicateCustomer(
            localMatch
              ? {
                  id: localMatch.id,
                  code: localMatch.code,
                  name: localMatch.name,
                  phone: localMatch.phone,
                  status: localMatch.status,
                }
              : null
          );
        }
      } finally {
        if (!cancelled) setCheckingPhone(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phoneValidation.valid, phoneValidation.normalized, initial?.id, customers]);

  // Dynamic Segment & Status lists
  const [localSegments, setLocalSegments] = useState<string[]>(() =>
    mergeUniqueStrings(
      DEFAULT_SEGMENTS,
      config.customerSegments,
      customers.map((c) => c.segment)
    )
  );
  const [localStatuses, setLocalStatuses] = useState<string[]>(() =>
    mergeUniqueStrings(
      DEFAULT_STATUSES,
      config.customerStatuses,
      customers.map((c) => c.status)
    )
  );

  // Quick-add modal state
  const [addTarget, setAddTarget] = useState<'segment' | 'status' | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');
  const [addOptionError, setAddOptionError] = useState<string | null>(null);
  const [savingOption, setSavingOption] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const segmentOptions: SearchableOption[] = useMemo(
    () => localSegments.map((s) => ({ value: s, label: s })),
    [localSegments]
  );
  const statusOptions: SearchableOption[] = useMemo(
    () =>
      localStatuses.map((s) => ({
        value: s,
        label: s,
        sublabel: DEFAULT_STATUSES.includes(s) ? undefined : 'Restricted',
      })),
    [localStatuses]
  );

  // Calculated read-only financial displays
  const openingNum = round2(Math.max(0, Number(openingReceivable) || 0));
  const fyBilledDisplay = initial ? initial.ytdRevenue : 0;
  const receivablesDisplay = initial ? initial.currentReceivable : openingNum;

  const isDirty = useMemo(() => {
    if (initial) {
      return (
        name !== initial.name ||
        segment !== initial.segment ||
        status !== initial.status ||
        contactPerson !== initial.contactPerson ||
        email !== initial.email ||
        phone !== initial.phone ||
        city !== initial.city ||
        vat !== (initial.vat ?? '15%') ||
        binNumber !== initial.binNumber ||
        notes !== initial.notes
      );
    }
    return Boolean(
      name.trim() ||
        contactPerson.trim() ||
        email.trim() ||
        phone.trim() ||
        city.trim() ||
        binNumber.trim() ||
        notes.trim() ||
        openingNum > 0
    );
  }, [
    initial,
    name,
    segment,
    status,
    contactPerson,
    email,
    phone,
    city,
    vat,
    binNumber,
    notes,
    openingNum,
  ]);

  const handleSaveNewOption = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newOptionValue.trim();
    if (!cleaned) {
      setAddOptionError('Please enter a name.');
      return;
    }
    const list = addTarget === 'segment' ? localSegments : localStatuses;
    if (list.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      setAddOptionError(`"${cleaned}" already exists.`);
      return;
    }
    const nextList = [...list, cleaned];
    setSavingOption(true);
    setAddOptionError(null);
    try {
      if (onUpdateConfig) {
        if (addTarget === 'segment') {
          await onUpdateConfig({ customerSegments: nextList });
        } else {
          await onUpdateConfig({ customerStatuses: nextList });
        }
      }
      if (addTarget === 'segment') {
        setLocalSegments(nextList);
        setSegment(cleaned);
      } else {
        setLocalStatuses(nextList);
        setStatus(cleaned);
      }
      setAddTarget(null);
    } catch (err) {
      setAddOptionError(err instanceof Error ? err.message : 'Unable to save option.');
    } finally {
      setSavingOption(false);
    }
  };

  const resetForNextCustomer = () => {
    setCode(generateNextCustomerCode(customers, config.highestCustomerCodeNum));
    setSegment('');
    setStatus('');
    setName('');
    setContactPerson('');
    setEmail('');
    setPhone('');
    setCity('');
    setVat('15%');
    setBinNumber('');
    setOpeningReceivable('0.00');
    setNotes('');
    setPhoneTouched(false);
    setDuplicateCustomer(null);
    setError(null);
  };

  const validateAndSubmit = async (addAnother: boolean) => {
    setSuccessMsg(null);
    setPhoneTouched(true);
    const trimmedName = name.trim();
    if (!code.trim() || !trimmedName) {
      setError('Customer Code and Customer Legal Name are required.');
      return;
    }
    if (!segment.trim()) {
      setError('Please select a Customer Segment.');
      return;
    }
    if (!status.trim()) {
      setError('Please select a Customer Status.');
      return;
    }
    if (!phoneValidation.valid) {
      setError(phoneValidation.error || 'Phone number is required.');
      return;
    }
    if (duplicateCustomer) {
      setError('Duplicate Customer Detected! This phone number is already registered under an existing customer account.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (binNumber.trim() && !/^[0-9\-]{9,17}$/.test(binNumber.trim())) {
      setError('BIN must be 9–17 digits/hyphens (preserving leading zeros).');
      return;
    }
    const parsedOpening = Number(openingReceivable);
    if (Number.isNaN(parsedOpening) || parsedOpening < 0) {
      setError('Opening AR (BDT) must be a valid non-negative currency amount.');
      return;
    }

    setSaving(true);
    try {
      setError(null);
      const dupCheck = await api.checkCustomerPhone(phoneValidation.normalized, initial?.id);
      if (dupCheck.duplicate && dupCheck.existingCustomer) {
        setDuplicateCustomer(dupCheck.existingCustomer);
        setError('Duplicate Customer Detected! This phone number is already registered under an existing customer account.');
        setSaving(false);
        return;
      }
      const now = new Date().toISOString();
      await onSubmit({
        code: code.trim().toUpperCase(),
        name: trimmedName,
        segment: segment.trim() || 'Enterprise',
        contactPerson: contactPerson.trim(),
        email: email.trim(),
        phone: phoneValidation.normalized,
        city: city.trim() || 'Dhaka',
        vat: vat.trim(),
        binNumber: binNumber.trim(),
        paymentTerms: initial?.paymentTerms || 'Net 30 Days',
        creditLimit: initial?.creditLimit ?? 10000000,
        openingReceivable: initial ? initial.openingReceivable : round2(parsedOpening),
        currentReceivable: initial ? initial.currentReceivable : round2(parsedOpening),
        ytdRevenue: initial ? initial.ytdRevenue : 0,
        aging: initial
          ? initial.aging
          : {
              current: round2(parsedOpening),
              days30: 0,
              days60: 0,
              days90Plus: 0,
            },
        receivableGlCode: '1120',
        status: status.trim() || 'Active',
        notes,
        createdBy: initial?.createdBy || currentUserEmail,
        createdAt: initial?.createdAt || now,
        updatedBy: currentUserEmail,
      });
      if (addAnother && !initial) {
        resetForNextCustomer();
        setSuccessMsg('Customer account saved and linked to GL 1120. Ready for next customer.');
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save customer.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestClose = () => {
    if (isDirty && !saving) {
      setConfirmCancel(true);
    } else {
      onClose();
    }
  };

  const isDisabled = busy || saving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-xs p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#001F60] text-white shrink-0">
          <div>
            <h2 className="text-base font-bold font-[var(--font-display)]">
              {initial ? `Edit Customer Account — ${initial.code}` : 'Add Customer Account'}
            </h2>
            <p className="text-xs text-blue-100 mt-0.5">
              Linked to GL 1120 — Trade Receivables Control Register.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            aria-label="Close modal"
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void validateAndSubmit(false);
          }}
          className="p-6 space-y-5 overflow-y-auto flex-1"
        >
          {error && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Section A – Account Identification */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-[#001F60] border-b border-slate-200 pb-1.5">
              Section A — Account Identification
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Code <span className="text-red-500">*</span>{' '}
                  <span className="text-[10px] font-normal text-slate-400">(Auto-generated)</span>
                </label>
                <input
                  type="text"
                  value={code}
                  readOnly
                  className="w-full px-3 py-2 text-xs font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-300 rounded-md cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Linked GL Account
                </label>
                <div className="w-full px-3 py-2 text-xs font-mono bg-blue-50/70 text-[#001F60] border border-blue-200 rounded-md flex items-center justify-between">
                  <span>1120 — Trade Receivables Control Register</span>
                  <button
                    type="button"
                    onClick={() => onOpenRegister('1120')}
                    className="text-[11px] font-sans font-semibold text-[#2563EB] hover:underline cursor-pointer"
                  >
                    Open GL
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Segment <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  value={segment}
                  onChange={setSegment}
                  options={segmentOptions}
                  placeholder="Select One"
                  searchPlaceholder="Search segment..."
                  addNewLabel="+ Add New Segment"
                  onAddNew={() => {
                    setAddTarget('segment');
                    setNewOptionValue('');
                    setAddOptionError(null);
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Status <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  value={status}
                  onChange={setStatus}
                  options={statusOptions}
                  placeholder="Select One"
                  searchPlaceholder="Search status..."
                  addNewLabel="+ Add New Status"
                  onAddNew={() => {
                    setAddTarget('status');
                    setNewOptionValue('');
                    setAddOptionError(null);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section B – Customer Information */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-[#001F60] border-b border-slate-200 pb-1.5">
              Section B — Customer Information
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Northern Electricity Supply Company PLC"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="Primary contact name"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="accounts@company.com.bd"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneTouched(true);
                  }}
                  onBlur={() => setPhoneTouched(true)}
                  placeholder="01744883636"
                  required
                  className={`w-full px-3 py-2 text-xs font-mono border rounded-md focus:outline-none ${
                    duplicateCustomer || (phoneTouched && !phoneValidation.valid)
                      ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                      : phoneValidation.valid
                        ? 'border-emerald-400 focus:border-emerald-600'
                        : 'border-slate-300 focus:border-[#2563EB]'
                  }`}
                />
                {checkingPhone && (
                  <p className="mt-1 text-[11px] text-slate-500">Checking phone uniqueness...</p>
                )}
                {!checkingPhone && duplicateCustomer && (
                  <p className="mt-1 text-[11px] font-medium text-red-600">
                    This phone number is already registered to another customer.
                  </p>
                )}
                {!checkingPhone && !duplicateCustomer && phoneTouched && !phoneValidation.valid && (
                  <p className="mt-1 text-[11px] font-medium text-red-600">
                    {phoneValidation.error}
                  </p>
                )}
                {!checkingPhone && !duplicateCustomer && phoneValidation.valid && (
                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                    Phone number is valid and available.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g., Dhaka"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">VAT</label>
                <input
                  type="text"
                  value={vat}
                  onChange={(e) => setVat(e.target.value)}
                  placeholder="e.g., 15% Standard VAT"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  BIN <span className="text-[10px] font-normal text-slate-400">(Preserves leading zeros)</span>
                </label>
                <input
                  type="text"
                  value={binNumber}
                  onChange={(e) => setBinNumber(e.target.value)}
                  placeholder="001234567-0101"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>
          </div>

          {/* Section C – Financial Overview */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-[#001F60] border-b border-slate-200 pb-1.5">
              Section C — Financial Overview
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening AR (BDT)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={openingReceivable}
                  readOnly={Boolean(initial)}
                  onChange={(e) => setOpeningReceivable(e.target.value)}
                  className={`w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB] ${
                    initial ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : ''
                  }`}
                />
                {initial && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    Locked after posting to prevent duplicate GL entries.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  FY Billed Revenue (BDT)
                </label>
                <div className="w-full px-3 py-2 text-xs font-mono font-semibold bg-slate-50 text-slate-800 border border-slate-200 rounded-md flex items-center justify-between">
                  <span>{formatBDT(fyBilledDisplay, true)}</span>
                  <span className="text-[10px] font-sans text-slate-400">System</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Receivables (BDT)
                </label>
                <div className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 text-[#001F60] border border-slate-200 rounded-md flex items-center justify-between">
                  <span>{formatBDT(receivablesDisplay, true)}</span>
                  <span className="text-[10px] font-sans text-slate-400">GL 1120</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section D – Account Governance */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-[#001F60] border-b border-slate-200 pb-1.5">
              Section D — Account Governance
            </div>
            <label className="block text-xs font-semibold text-slate-700">
              Account Governance Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter account governance notes, payment terms, billing instructions, credit approval references, or internal remarks..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          {duplicateCustomer && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-xs space-y-2.5">
              <div className="flex items-start gap-2 text-amber-900 font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Duplicate Customer Detected! This phone number is already registered under an existing customer account.
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white/80 p-2.5 rounded border border-amber-200">
                <div>
                  <div className="text-[10px] text-slate-500">Customer Code</div>
                  <div className="font-mono font-semibold text-[#001F60]">{duplicateCustomer.code}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Customer Legal Name</div>
                  <div className="font-semibold text-slate-900 truncate">{duplicateCustomer.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Phone Number</div>
                  <div className="font-mono text-slate-800">{duplicateCustomer.phone}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Customer Status</div>
                  <div className="font-semibold text-slate-800">{duplicateCustomer.status}</div>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onSelectExistingCustomer(duplicateCustomer.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#001F60] text-white text-xs font-semibold hover:bg-[#001F60]/90 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View Existing Customer</span>
                </button>
              </div>
            </div>
          )}

          {/* Form Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={isDisabled}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            {!initial && (
              <button
                type="button"
                disabled={isDisabled || Boolean(duplicateCustomer) || checkingPhone}
                onClick={() => void validateAndSubmit(true)}
                className="px-4 py-2 text-xs font-semibold text-[#001F60] bg-blue-50 border border-[#001F60]/30 hover:bg-blue-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save & Add New'}
              </button>
            )}
            <button
              type="submit"
              disabled={isDisabled || Boolean(duplicateCustomer) || checkingPhone}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Customer'}
            </button>
          </div>
        </form>
      </div>

      {/* Add New Segment / Status Modal */}
      {addTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-[#001F60] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {addTarget === 'segment' ? 'Add New Customer Segment' : 'Add New Customer Status'}
              </h3>
              <button
                type="button"
                onClick={() => setAddTarget(null)}
                className="p-1 text-white/80 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveNewOption} className="p-5 space-y-3">
              {addOptionError && (
                <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                  {addOptionError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {addTarget === 'segment' ? 'Segment Name' : 'Status Name'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newOptionValue}
                  onChange={(e) => setNewOptionValue(e.target.value)}
                  placeholder={addTarget === 'segment' ? 'e.g., Energy & Power' : 'e.g., Credit Review'}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              {addTarget === 'status' && (
                <p className="text-[11px] text-slate-500">
                  Custom statuses are restricted by default and do not grant unrestricted transaction permissions.
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddTarget(null)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOption}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                >
                  {savingOption ? 'Saving...' : 'Save Option'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unsaved Changes Confirmation */}
      {confirmCancel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
              Discard Unsaved Changes?
            </div>
            <div className="p-5 text-xs text-slate-600">
              You have unsaved customer account changes. Are you sure you want to close?
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 bg-white rounded-md hover:bg-slate-100 cursor-pointer"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmCancel(false);
                  onClose();
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
              >
                Discard & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

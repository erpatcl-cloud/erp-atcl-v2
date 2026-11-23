import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Download,
  Edit3,
  Eye,
  Globe2,
  Landmark,
  Mail,
  PenLine,
  Phone,
  Plus,
  Search,
  Trash2,
  Truck,
  User,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { normalizeBDPhone, validateBDPhone } from '../lib/phoneUtils.ts';
import {
  computeGLSummary,
  computeSupplierLiveAP,
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  GLAccount,
  LedgerState,
  SupplierRecord,
  SupplierType,
  SystemConfig,
} from '../types/accounting.ts';
import { SearchableSelect, type SearchableOption } from './common/SearchableSelect.tsx';

interface SuppliersPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onOpenNewVoucher: () => void;
  onCreateSupplier: (payload: Omit<SupplierRecord, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateSupplier: (
    id: string,
    payload: Partial<Omit<SupplierRecord, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteSupplier: (id: string) => Promise<void>;
  onUpdateConfig?: (payload: Partial<SystemConfig>) => Promise<void>;
}

const DEFAULT_SUPPLIER_TYPES: string[] = [
  'Import / OEM',
  'Local Material',
  'C&F & Logistics',
  'Engineering Subcontractor',
  'Professional Services',
];

const SUPPLIER_TYPES: Array<'All' | SupplierType> = [
  'All',
  ...DEFAULT_SUPPLIER_TYPES,
];

const ATCL_BANKS = [
  'Shahjalal Islami Bank PLC',
  'Al-Arafah Islami Bank',
  'IBBL',
];

const SUPPLIER_COUNTRIES = [
  'Australia',
  'Austria',
  'Bangladesh',
  'Belgium',
  'Canada',
  'China',
  'Czech Republic',
  'Denmark',
  'Finland',
  'France',
  'Germany',
  'India',
  'Indonesia',
  'Italy',
  'Japan',
  'Malaysia',
  'Netherlands',
  'Poland',
  'Singapore',
  'South Korea',
  'Spain',
  'Sweden',
  'Switzerland',
  'Taiwan',
  'Thailand',
  'Turkey',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Vietnam',
];

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

function generateNextSupplierCode(
  suppliers: SupplierRecord[],
  highestFloor = 2000
): string {
  const existing = new Set(suppliers.map((s) => s.code.trim().toUpperCase()));
  let maxNum = Math.max(2000, highestFloor);
  for (const s of suppliers) {
    const m = /^VEND-(\d+)$/.exec(s.code.trim().toUpperCase());
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  let candidateNum = maxNum + 1;
  let candidate = `VEND-${candidateNum}`;
  while (existing.has(candidate)) {
    candidateNum += 1;
    candidate = `VEND-${candidateNum}`;
  }
  return candidate;
}

export const SuppliersPage: React.FC<SuppliersPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onOpenNewVoucher,
  onCreateSupplier,
  onUpdateSupplier,
  onDeleteSupplier,
  onUpdateConfig,
}) => {
  const suppliers = state.suppliers || [];
  const [typeFilter, setTypeFilter] = useState<'All' | SupplierType>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(suppliers[0]?.id ?? '');
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glBalanceMap = useMemo(() => {
    const summary = computeGLSummary(state);
    return new Map(summary.map((r) => [r.code, r]));
  }, [state]);

  const glAdvances1130 = glBalanceMap.get('1130')?.closingBalance ?? 0;
  const glAuditPayable2060 = glBalanceMap.get('2060')?.closingBalance ?? 0;

  const metrics = useMemo(() => {
    const activeCount = suppliers.filter((s) => s.status === 'Active').length;
    const importCount = suppliers.filter((s) => s.country.toLowerCase() !== 'bangladesh').length;
    const localCount = suppliers.length - importCount;
    const totalAdvances = round2(suppliers.reduce((s, v) => s + v.advanceBalance, 0));
    const totalPayables = round2(suppliers.reduce((s, v) => s + v.payableBalance, 0));
    const totalYtdSpend = round2(suppliers.reduce((s, v) => s + v.ytdSpend, 0));
    const advanceShareOf1130 = glAdvances1130 > 0 ? (totalAdvances / glAdvances1130) * 100 : 0;

    return {
      total: suppliers.length,
      activeCount,
      importCount,
      localCount,
      totalAdvances,
      totalPayables,
      totalYtdSpend,
      advanceShareOf1130,
    };
  }, [suppliers, glAdvances1130]);

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (typeFilter !== 'All' && s.supplierType !== typeFilter) return false;
      if (!q) return true;
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q) ||
        s.bankName.toLowerCase().includes(q) ||
        s.contactPerson.toLowerCase().includes(q) ||
        s.expenseGlCode.toLowerCase().includes(q)
      );
    });
  }, [suppliers, typeFilter, searchQuery]);

  const selectedSupplier = useMemo(() => {
    return (
      filteredSuppliers.find((s) => s.id === selectedId) ??
      suppliers.find((s) => s.id === selectedId) ??
      filteredSuppliers[0] ??
      null
    );
  }, [filteredSuppliers, suppliers, selectedId]);

  const selectedExpenseGl = selectedSupplier
    ? glBalanceMap.get(selectedSupplier.expenseGlCode) ?? null
    : null;

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Suppliers_${state.config.fiscalPeriod}.csv`,
      [
        'Code',
        'Supplier Name',
        'Type',
        'Country',
        'Contact Person',
        'Email',
        'Phone',
        'Tax / VAT BIN',
        'Payment / LC Terms',
        'Settlement Bank',
        'Advance Balance (BDT)',
        'Payable Balance (BDT)',
        'FY Spend (BDT)',
        'Expense GL',
        'Status',
      ],
      filteredSuppliers.map((s) => [
        s.code,
        s.name,
        s.supplierType,
        s.country,
        s.contactPerson,
        s.email,
        s.phone,
        s.binNumber,
        s.paymentTerms,
        s.bankName,
        s.advanceBalance,
        s.payableBalance,
        s.ytdSpend,
        s.expenseGlCode,
        s.status,
      ])
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
            Suppliers
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            OEM import partners, local material suppliers, C&amp;F logistics agents, LC bank channels, and GL expense mapping.
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
              setEditingSupplier(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Supplier</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Approved Suppliers</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {metrics.total}
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {metrics.activeCount} active
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {metrics.importCount} International OEM · {metrics.localCount} Local Partners
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Supplier &amp; LC Advances</span>
            <button
              onClick={() => onOpenRegister('1130')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1130</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalAdvances)}
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            {metrics.advanceShareOf1130.toFixed(1)}% of GL 1130 ({formatCompactBDT(glAdvances1130)})
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Outstanding Payables</span>
            <button
              onClick={() => onOpenRegister('2060')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 2060</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalPayables)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            GL 2060 Audit Fee Payable: {formatBDT(glAuditPayable2060)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              FY {state.config.fiscalPeriod} Procurement Spend
            </span>
            <button
              onClick={() => onOpenRegister('5010')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5010</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalYtdSpend)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Material, C&amp;F, freight, installation &amp; statutory audit
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center bg-slate-200/70 p-1 rounded-lg gap-0.5">
          {SUPPLIER_TYPES.map((t) => {
            const active = typeFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t}
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
            placeholder="Search vendor, country, bank, GL..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Master-Detail Supplier Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Supplier Directory Table */}
        <div className="xl:col-span-7 bg-white border border-[#001F60] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Vendor Directory ({filteredSuppliers.length})
            </span>
            <span className="text-xs text-slate-400">Select a supplier for LC &amp; GL profile</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Supplier</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Bank / LC Channel</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Advances</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">FY Spend</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">GL</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 px-4 text-center text-slate-500">
                      <Truck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                      <div className="text-sm font-medium text-slate-700">No suppliers found</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Adjust your category filter or register a new supplier.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSuppliers.map((sup) => {
                    const isSelected = selectedSupplier?.id === sup.id;
                    return (
                      <tr
                        key={sup.id}
                        onClick={() => setSelectedId(sup.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#EFF6FF]' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 leading-snug">{sup.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                            <span className="font-mono text-[#2563EB] font-medium">{sup.code}</span>
                            <span className="text-slate-300">·</span>
                            <span>{sup.supplierType}</span>
                            <span className="text-slate-300">·</span>
                            <span>{sup.country}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap">
                          <div>{sup.bankName}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{sup.paymentTerms}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                          {sup.advanceBalance > 0 ? formatCompactBDT(sup.advanceBalance) : '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          {formatBDT(sup.ytdSpend)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenRegister(sup.expenseGlCode);
                            }}
                            className="font-mono text-xs text-[#2563EB] hover:underline cursor-pointer"
                          >
                            {sup.expenseGlCode}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${
                              sup.status === 'Active' ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            {sup.status}
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

        {/* Right: Supplier Detail Panel */}
        <div className="xl:col-span-5 xl:sticky xl:top-20">
          {selectedSupplier ? (
            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
              {/* Header */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-[#2563EB] font-semibold">
                      {selectedSupplier.code} · {selectedSupplier.supplierType}
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mt-1 leading-snug font-[var(--font-display)]">
                      {selectedSupplier.name}
                    </h2>
                    <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`font-semibold ${
                          selectedSupplier.status === 'Active'
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {selectedSupplier.status}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>{selectedSupplier.country}</span>
                      <span className="text-slate-300">·</span>
                      <span>{selectedSupplier.paymentTerms}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingSupplier(selectedSupplier);
                        setShowModal(true);
                      }}
                      title="Edit supplier"
                      className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === selectedSupplier.id ? (
                      <div className="inline-flex items-center gap-1.5 text-xs pl-1">
                        <button
                          disabled={busyAction !== null}
                          onClick={async () => {
                            await onDeleteSupplier(selectedSupplier.id);
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
                        onClick={() => setConfirmDeleteId(selectedSupplier.id)}
                        title="Delete supplier"
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Financial Exposure Summary */}
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500">
                    FY {state.config.fiscalPeriod} Total Spend
                  </div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {formatBDT(selectedSupplier.ytdSpend)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">LC / Advance Balance</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#2563EB] mt-0.5">
                    {formatBDT(selectedSupplier.advanceBalance)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Current Payable (AP 2080)</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                    {formatBDT(
                      (() => {
                        const liveAp = computeSupplierLiveAP(state, selectedSupplier.id);
                        return liveAp.invoicedAmount > 0 ? liveAp.outstanding : selectedSupplier.payableBalance;
                      })()
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Net Advance / (Payable)</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-700 mt-0.5">
                    {formatBDT(round2(selectedSupplier.advanceBalance - selectedSupplier.payableBalance))}
                  </div>
                </div>
              </div>

              {/* Banking & Contact Profile */}
              <div className="p-5 space-y-2.5 text-xs">
                <div className="font-semibold text-slate-800 mb-1">
                  Banking, LC Channel &amp; Contact
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-slate-600">
                  <div className="flex items-center gap-2 min-w-0">
                    <Landmark className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-800">
                      {selectedSupplier.bankName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedSupplier.country}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedSupplier.contactPerson || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono truncate">BIN {selectedSupplier.binNumber || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedSupplier.email || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono truncate">{selectedSupplier.phone || '—'}</span>
                  </div>
                </div>
                {selectedSupplier.notes && (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-md p-2.5 mt-2 leading-relaxed">
                    {selectedSupplier.notes}
                  </p>
                )}
              </div>

              {/* Linked GL Control Books + Quick Actions */}
              <div className="p-5 space-y-3">
                <div className="text-xs font-semibold text-slate-800">Linked GL Control Books</div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <div className="min-w-0">
                      <button
                        onClick={() => onOpenRegister(selectedSupplier.expenseGlCode)}
                        className="font-mono font-semibold text-[#2563EB] hover:underline cursor-pointer"
                      >
                        GL {selectedSupplier.expenseGlCode}
                      </button>
                      <span className="text-slate-500 ml-2 truncate">
                        {selectedExpenseGl?.name ?? 'Expense Register'}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums font-medium text-slate-900 shrink-0">
                      {formatCompactBDT(selectedExpenseGl?.closingBalance ?? 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="min-w-0">
                      <button
                        onClick={() => onOpenRegister('1130')}
                        className="font-mono font-semibold text-[#2563EB] hover:underline cursor-pointer"
                      >
                        GL 1130
                      </button>
                      <span className="text-slate-500 ml-2">
                        Advances, Deposits &amp; Prepayments
                      </span>
                    </div>
                    <span className="font-mono tabular-nums font-medium text-slate-900 shrink-0">
                      {formatCompactBDT(glAdvances1130)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 pt-2">
                  <button
                    onClick={() => onOpenRegister(selectedSupplier.expenseGlCode)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    <span>Open GL {selectedSupplier.expenseGlCode}</span>
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
              Select a supplier from the directory to view banking and GL mapping details.
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <SupplierFormModal
          accounts={state.accounts}
          suppliers={suppliers}
          config={state.config}
          initial={editingSupplier}
          busy={busyAction !== null}
          onClose={() => setShowModal(false)}
          onSelectExistingSupplier={(existingId) => {
            setShowModal(false);
            setSelectedId(existingId);
          }}
          onUpdateConfig={onUpdateConfig}
          onSubmit={async (payload) => {
            if (editingSupplier) {
              await onUpdateSupplier(editingSupplier.id, payload);
            } else {
              await onCreateSupplier(payload);
            }
          }}
        />
      )}
    </div>
  );
};

interface SupplierFormModalProps {
  accounts: GLAccount[];
  suppliers: SupplierRecord[];
  config: SystemConfig;
  initial: SupplierRecord | null;
  busy: boolean;
  onClose: () => void;
  onSelectExistingSupplier: (id: string) => void;
  onUpdateConfig?: (payload: Partial<SystemConfig>) => Promise<void>;
  onSubmit: (payload: Omit<SupplierRecord, 'id' | 'updatedAt'>) => Promise<void>;
}

const SupplierFormModal: React.FC<SupplierFormModalProps> = ({
  accounts,
  suppliers,
  config,
  initial,
  busy,
  onClose,
  onSelectExistingSupplier,
  onUpdateConfig,
  onSubmit,
}) => {
  const [code, setCode] = useState(
    () => initial?.code ?? generateNextSupplierCode(suppliers, config.highestSupplierCodeNum)
  );
  const [supplierType, setSupplierType] = useState<string>(initial?.supplierType ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [bankName, setBankName] = useState(initial?.bankName ?? '');
  const [taxNo, setTaxNo] = useState(initial?.taxNo ?? '');
  const [binNumber, setBinNumber] = useState(initial?.binNumber ?? '');
  const [advanceBalance, setAdvanceBalance] = useState(
    initial ? initial.advanceBalance.toFixed(2) : '0.00'
  );
  const [payableBalance, setPayableBalance] = useState(
    initial ? initial.payableBalance.toFixed(2) : '0.00'
  );
  const [ytdSpend, setYtdSpend] = useState(
    initial ? initial.ytdSpend.toFixed(2) : '0.00'
  );
  const [expenseGlCode, setExpenseGlCode] = useState(initial?.expenseGlCode ?? '5010');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(Boolean(initial?.phone));
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [duplicateSupplier, setDuplicateSupplier] = useState<{
    id: string;
    code: string;
    name: string;
    phone: string;
    status: string;
  } | null>(null);

  const isBangladeshSupplier = !country || country.trim().toLowerCase() === 'bangladesh';

  const phoneValidation = useMemo(() => {
    if (isBangladeshSupplier) {
      return validateBDPhone(phone, 'Supplier phone number is required.');
    }
    const trimmed = phone.trim();
    if (!trimmed) {
      return { valid: false, normalized: '', error: 'Supplier phone number is required.' };
    }
    if (trimmed.length < 6) {
      return { valid: false, normalized: trimmed, error: 'Enter a valid international phone number (at least 6 characters).' };
    }
    return { valid: true, normalized: trimmed, error: undefined };
  }, [phone, isBangladeshSupplier]);

  useEffect(() => {
    if (!phoneValidation.valid) {
      setDuplicateSupplier(null);
      setCheckingPhone(false);
      return;
    }

    let cancelled = false;
    setCheckingPhone(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.checkSupplierPhone(phoneValidation.normalized, initial?.id);
        if (!cancelled) {
          setDuplicateSupplier(res.duplicate ? res.existingSupplier : null);
        }
      } catch {
        if (!cancelled) {
          const localMatch = suppliers.find(
            (s) =>
              s.id !== initial?.id &&
              normalizeBDPhone(s.phone) === phoneValidation.normalized
          );
          setDuplicateSupplier(
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
  }, [phoneValidation.valid, phoneValidation.normalized, initial?.id, suppliers]);

  // Dynamic Supplier Type list + Quick-add modal
  const [localTypes, setLocalTypes] = useState<string[]>(() =>
    mergeUniqueStrings(
      DEFAULT_SUPPLIER_TYPES,
      config.supplierTypes,
      suppliers.map((s) => s.supplierType)
    )
  );
  const [showAddTypeModal, setShowAddTypeModal] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [addTypeError, setAddTypeError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const typeOptions: SearchableOption[] = useMemo(
    () => localTypes.map((t) => ({ value: t, label: t })),
    [localTypes]
  );

  const statusOptions: SearchableOption[] = useMemo(
    () => [
      { value: 'Active', label: 'Active' },
      { value: 'In Active', label: 'In Active' },
    ],
    []
  );

  const countryOptions: SearchableOption[] = useMemo(() => {
    const list = mergeUniqueStrings(SUPPLIER_COUNTRIES, country ? [country] : []);
    return list.map((c) => ({ value: c, label: c }));
  }, [country]);

  const bankOptions: SearchableOption[] = useMemo(() => {
    const list = mergeUniqueStrings(ATCL_BANKS, bankName ? [bankName] : []);
    return list.map((b) => ({ value: b, label: b }));
  }, [bankName]);

  const expenseGlOptions: SearchableOption[] = useMemo(() => {
    const expenseAccounts = accounts.filter((a) => a.category === 'Expense');
    const source = expenseAccounts.length > 0 ? expenseAccounts : accounts;
    const opts = source.map((a) => ({
      value: a.code,
      label: `${a.code} — ${a.name}`,
    }));
    if (!opts.some((o) => o.value === '5010')) {
      opts.unshift({ value: '5010', label: '5010 — Material Consumed' });
    }
    return opts;
  }, [accounts]);

  const isDirty = useMemo(() => {
    if (initial) {
      return (
        name !== initial.name ||
        supplierType !== initial.supplierType ||
        status !== initial.status ||
        country !== initial.country ||
        contactPerson !== initial.contactPerson ||
        email !== initial.email ||
        phone !== initial.phone ||
        bankName !== initial.bankName ||
        taxNo !== (initial.taxNo ?? '') ||
        binNumber !== initial.binNumber ||
        notes !== initial.notes
      );
    }
    return Boolean(
      name.trim() ||
        supplierType ||
        status ||
        country ||
        contactPerson.trim() ||
        email.trim() ||
        phone.trim() ||
        bankName ||
        taxNo.trim() ||
        binNumber.trim() ||
        notes.trim()
    );
  }, [
    initial,
    name,
    supplierType,
    status,
    country,
    contactPerson,
    email,
    phone,
    bankName,
    taxNo,
    binNumber,
    notes,
  ]);

  const handleSaveNewType = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newTypeName.trim();
    if (!cleaned) {
      setAddTypeError('Please enter a Supplier Type name.');
      return;
    }
    if (localTypes.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      setAddTypeError(`"${cleaned}" already exists.`);
      return;
    }
    const nextList = [...localTypes, cleaned];
    setSavingType(true);
    setAddTypeError(null);
    try {
      if (onUpdateConfig) {
        await onUpdateConfig({ supplierTypes: nextList });
      }
      setLocalTypes(nextList);
      setSupplierType(cleaned);
      setShowAddTypeModal(false);
    } catch (err) {
      setAddTypeError(err instanceof Error ? err.message : 'Unable to save type.');
    } finally {
      setSavingType(false);
    }
  };

  const resetForNextSupplier = () => {
    setCode(generateNextSupplierCode(suppliers, config.highestSupplierCodeNum));
    setSupplierType('');
    setStatus('');
    setName('');
    setCountry('');
    setContactPerson('');
    setEmail('');
    setPhone('');
    setBankName('');
    setTaxNo('');
    setBinNumber('');
    setAdvanceBalance('0.00');
    setPayableBalance('0.00');
    setYtdSpend('0.00');
    setExpenseGlCode('5010');
    setNotes('');
    setPhoneTouched(false);
    setDuplicateSupplier(null);
    setError(null);
  };

  const submitForm = async (addAnother: boolean) => {
    setSuccessMsg(null);
    setPhoneTouched(true);
    if (!code.trim() || !name.trim()) {
      setError('Supplier Code and Supplier Legal Name are required.');
      return;
    }
    if (!supplierType.trim()) {
      setError('Please select a Supplier Type.');
      return;
    }
    if (!status.trim()) {
      setError('Please select a Status.');
      return;
    }
    if (!phoneValidation.valid) {
      setError(phoneValidation.error || 'Supplier phone number is required.');
      return;
    }
    if (duplicateSupplier) {
      setError('Duplicate Supplier Detected! This phone number is already registered under an existing supplier account.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setSaving(true);
    try {
      setError(null);
      const dupCheck = await api.checkSupplierPhone(phoneValidation.normalized, initial?.id);
      if (dupCheck.duplicate && dupCheck.existingSupplier) {
        setDuplicateSupplier(dupCheck.existingSupplier);
        setError('Duplicate Supplier Detected! This phone number is already registered under an existing supplier account.');
        setSaving(false);
        return;
      }
      await onSubmit({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        supplierType: supplierType.trim(),
        country: country.trim() || 'Bangladesh',
        contactPerson: contactPerson.trim(),
        email: email.trim(),
        phone: phoneValidation.normalized,
        taxNo: taxNo.trim(),
        binNumber: binNumber.trim(),
        paymentTerms: initial?.paymentTerms || 'Net 30 Days',
        bankName: bankName.trim() || ATCL_BANKS[0],
        advanceBalance: round2(Math.max(0, Number(advanceBalance) || 0)),
        payableBalance: round2(Math.max(0, Number(payableBalance) || 0)),
        ytdSpend: round2(Math.max(0, Number(ytdSpend) || 0)),
        expenseGlCode: expenseGlCode.trim() || '5010',
        status: status.trim(),
        notes: notes.trim(),
      });
      if (addAnother && !initial) {
        resetForNextSupplier();
        setSuccessMsg('Supplier registered. Ready to add the next supplier.');
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save supplier.');
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
        <div className="flex items-center justify-between px-6 py-4 bg-[#001F60] text-white shrink-0">
          <div>
            <h2 className="text-base font-bold font-[var(--font-display)]">
              {initial ? `Edit Supplier — ${initial.code}` : 'Register Supplier / Vendor'}
            </h2>
            <p className="text-xs text-blue-100 mt-0.5">
              Configure vendor classification, LC bank channel, advances, and GL expense mapping.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitForm(false);
          }}
          className="p-6 space-y-4 overflow-y-auto flex-1"
        >
          {error && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
              {successMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Supplier Code <span className="text-red-500">*</span>{' '}
                <span className="text-[10px] font-normal text-slate-400">(Auto-generate)</span>
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
                Supplier Type <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                value={supplierType}
                onChange={setSupplierType}
                options={typeOptions}
                placeholder="Select One"
                searchPlaceholder="Search supplier type..."
                addNewLabel="+ Add New Type"
                onAddNew={() => {
                  setNewTypeName('');
                  setAddTypeError(null);
                  setShowAddTypeModal(true);
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
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Supplier Legal Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Eaton Electrical Systems Pte Ltd"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Country</label>
              <SearchableSelect
                value={country}
                onChange={setCountry}
                options={countryOptions}
                placeholder="Select One"
                searchPlaceholder="Search country..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                placeholder="vendor@company.com"
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
                  duplicateSupplier || (phoneTouched && !phoneValidation.valid)
                    ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                    : phoneValidation.valid
                      ? 'border-emerald-400 focus:border-emerald-600'
                      : 'border-slate-300 focus:border-[#2563EB]'
                }`}
              />
              {checkingPhone && (
                <p className="mt-1 text-[11px] text-slate-500">Checking phone uniqueness...</p>
              )}
              {!checkingPhone && duplicateSupplier && (
                <p className="mt-1 text-[11px] font-medium text-red-600">
                  This phone number is already registered to another supplier.
                </p>
              )}
              {!checkingPhone && !duplicateSupplier && phoneTouched && !phoneValidation.valid && (
                <p className="mt-1 text-[11px] font-medium text-red-600">
                  {phoneValidation.error}
                </p>
              )}
              {!checkingPhone && !duplicateSupplier && phoneValidation.valid && (
                <p className="mt-1 text-[11px] font-medium text-emerald-700">
                  Phone number is valid and available.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Settlement / LC Bank
              </label>
              <SearchableSelect
                value={bankName}
                onChange={setBankName}
                options={bankOptions}
                placeholder="Select One"
                searchPlaceholder="Search bank..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tax No.</label>
              <input
                type="text"
                value={taxNo}
                onChange={(e) => setTaxNo(e.target.value)}
                placeholder="TIN / Tax Registration"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">VAT BIN No.</label>
              <input
                type="text"
                value={binNumber}
                onChange={(e) => setBinNumber(e.target.value)}
                placeholder="001234567-0101"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Advance Balance (BDT)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={advanceBalance}
                onChange={(e) => setAdvanceBalance(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payable Balance (BDT)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={payableBalance}
                onChange={(e) => setPayableBalance(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                FY Procurement Spend (BDT)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={ytdSpend}
                onChange={(e) => setYtdSpend(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Primary Expense GL Register
            </label>
            <SearchableSelect
              value={expenseGlCode}
              onChange={setExpenseGlCode}
              options={expenseGlOptions}
              placeholder="Select GL account..."
              searchPlaceholder="Search GL code or name..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Procurement &amp; Settlement Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter procurement terms, LC settlement instructions, bank routing, or vendor remarks..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          {duplicateSupplier && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-xs space-y-2.5">
              <div className="flex items-start gap-2 text-amber-900 font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Duplicate Supplier Detected! This phone number is already registered under an existing supplier account.
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white/80 p-2.5 rounded border border-amber-200">
                <div>
                  <div className="text-[10px] text-slate-500">Supplier Code</div>
                  <div className="font-mono font-semibold text-[#001F60]">{duplicateSupplier.code}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Supplier Legal Name</div>
                  <div className="font-semibold text-slate-900 truncate">{duplicateSupplier.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Phone Number</div>
                  <div className="font-mono text-slate-800">{duplicateSupplier.phone}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Supplier Status</div>
                  <div className="font-semibold text-slate-800">{duplicateSupplier.status}</div>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onSelectExistingSupplier(duplicateSupplier.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#001F60] text-white text-xs font-semibold hover:bg-[#001F60]/90 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View Existing Supplier</span>
                </button>
              </div>
            </div>
          )}

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
                disabled={isDisabled || Boolean(duplicateSupplier) || checkingPhone}
                onClick={() => void submitForm(true)}
                className="px-4 py-2 text-xs font-semibold text-[#001F60] bg-blue-50 border border-[#001F60]/30 hover:bg-blue-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save & Add New'}
              </button>
            )}
            <button
              type="submit"
              disabled={isDisabled || Boolean(duplicateSupplier) || checkingPhone}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Supplier'}
            </button>
          </div>
        </form>
      </div>

      {/* Add New Supplier Type Modal */}
      {showAddTypeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-[#001F60] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">Add New Supplier Type</h3>
              <button
                type="button"
                onClick={() => setShowAddTypeModal(false)}
                className="p-1 text-white/80 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveNewType} className="p-5 space-y-3">
              {addTypeError && (
                <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                  {addTypeError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier Type Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  placeholder="e.g., Freight Forwarder"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTypeModal(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingType}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                >
                  {savingType ? 'Saving...' : 'Save Type'}
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
              You have unsaved supplier registration changes. Are you sure you want to close?
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

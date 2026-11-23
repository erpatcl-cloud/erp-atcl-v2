import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Edit3,
  Globe2,
  Landmark,
  PenLine,
  Plus,
  Search,
  Ship,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  ImportLCFile,
  IssuingBankName,
  LCStatus,
  LCType,
  LedgerState,
} from '../types/accounting.ts';

interface ImportLCManagementPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onOpenNewVoucher: () => void;
  onCreateLC: (payload: Omit<ImportLCFile, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateLC: (
    id: string,
    payload: Partial<Omit<ImportLCFile, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteLC: (id: string) => Promise<void>;
}

const LC_STATUSES: Array<'All' | LCStatus> = [
  'All',
  'Opened',
  'In Transit',
  'Customs Clearance',
  'Released to Warehouse',
  'Retired / Settled',
];

const ISSUING_BANKS: IssuingBankName[] = [
  'Shahjalal Islami Bank PLC',
  'Al-Arafah Islami Bank',
  'IBBL',
];

const LC_TYPES: LCType[] = ['Sight LC', 'UPAS 90D', 'Deferred 120D', 'Back-to-Back'];

const NEXT_LC_STAGE: Partial<Record<LCStatus, { next: LCStatus; label: string }>> = {
  Opened: { next: 'In Transit', label: 'Mark In Transit' },
  'In Transit': { next: 'Customs Clearance', label: 'Move to Customs' },
  'Customs Clearance': { next: 'Released to Warehouse', label: 'Release to Warehouse' },
  'Released to Warehouse': { next: 'Retired / Settled', label: 'Retire / Settle LC' },
};

export const ImportLCManagementPage: React.FC<ImportLCManagementPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onOpenNewVoucher,
  onCreateLC,
  onUpdateLC,
  onDeleteLC,
}) => {
  const lcs = state.importLCs || [];
  const [statusFilter, setStatusFilter] = useState<'All' | LCStatus>('All');
  const [bankFilter, setBankFilter] = useState<'All' | IssuingBankName>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(lcs[0]?.id ?? '');
  const [editingLC, setEditingLC] = useState<ImportLCFile | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glControls = useMemo(() => {
    const summary = computeGLSummary(state);
    const byCode = new Map(summary.map((r) => [r.code, r.closingBalance]));
    return {
      ibblLoan2010: byCode.get('2010') ?? 0,
      sjiblLoan2020: byCode.get('2020') ?? 0,
      aaiblLoan2030: byCode.get('2030') ?? 0,
      cnfExpense5030: byCode.get('5030') ?? 0,
      bankCharges5420: byCode.get('5420') ?? 0,
    };
  }, [state]);

  const metrics = useMemo(() => {
    const activeLCs = lcs.filter((l) => l.status !== 'Retired / Settled');
    const activeBdtExposure = round2(activeLCs.reduce((s, l) => s + l.bdtValue, 0));
    const activeUsdExposure = round2(
      activeLCs.filter((l) => l.currency === 'USD').reduce((s, l) => s + l.foreignAmount, 0)
    );
    const totalDutyCnf = round2(lcs.reduce((s, l) => s + l.customsDutyAndCnfBdt, 0));
    const totalBankCharges = round2(lcs.reduce((s, l) => s + l.bankChargesBdt, 0));
    const totalBankFacilities = round2(
      glControls.ibblLoan2010 + glControls.sjiblLoan2020 + glControls.aaiblLoan2030
    );

    const cnfVariance = round2(totalDutyCnf - glControls.cnfExpense5030);
    const chargeVariance = round2(totalBankCharges - glControls.bankCharges5420);

    return {
      totalCount: lcs.length,
      activeCount: activeLCs.length,
      activeBdtExposure,
      activeUsdExposure,
      totalDutyCnf,
      totalBankCharges,
      totalBankFacilities,
      isCnfReconciled: Math.abs(cnfVariance) < 0.01,
      cnfVariance,
      isChargeReconciled: Math.abs(chargeVariance) < 0.01,
      chargeVariance,
    };
  }, [lcs, glControls]);

  const filteredLCs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lcs.filter((l) => {
      if (statusFilter !== 'All' && l.status !== statusFilter) return false;
      if (bankFilter !== 'All' && l.issuingBank !== bankFilter) return false;
      if (!q) return true;
      return (
        l.lcNumber.toLowerCase().includes(q) ||
        l.supplierName.toLowerCase().includes(q) ||
        l.originCountry.toLowerCase().includes(q) ||
        l.billOfEntryNo.toLowerCase().includes(q) ||
        l.goodsDescription.toLowerCase().includes(q)
      );
    });
  }, [lcs, statusFilter, bankFilter, searchQuery]);

  const selectedLC = useMemo(() => {
    return (
      filteredLCs.find((l) => l.id === selectedId) ??
      lcs.find((l) => l.id === selectedId) ??
      filteredLCs[0] ??
      null
    );
  }, [filteredLCs, lcs, selectedId]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Import_LC_Register_${state.config.fiscalPeriod}.csv`,
      [
        'LC Number',
        'Open Date',
        'Shipment Date',
        'Maturity Date',
        'Overseas Supplier',
        'Origin',
        'Issuing Bank',
        'Loan GL',
        'LC Type',
        'Currency',
        'Foreign Amount',
        'FX Rate',
        'Invoice BDT',
        'Margin %',
        'Margin Deposit BDT',
        'Customs Duty & C&F BDT',
        'Bank Charges BDT',
        'Total Landed Cost BDT',
        'Port of Discharge',
        'Bill of Entry',
        'Status',
      ],
      filteredLCs.map((l) => [
        l.lcNumber,
        l.openDate,
        l.shipmentDate,
        l.maturityDate,
        l.supplierName,
        l.originCountry,
        l.issuingBank,
        l.loanGlCode,
        l.lcType,
        l.currency,
        l.foreignAmount,
        l.exchangeRate,
        l.bdtValue,
        l.marginPct,
        l.marginDepositBdt,
        l.customsDutyAndCnfBdt,
        l.bankChargesBdt,
        l.totalLandedCostBdt,
        l.portOfDischarge,
        l.billOfEntryNo,
        l.status,
      ])
    );
  };

  const nextStage = selectedLC ? NEXT_LC_STAGE[selectedLC.status] : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
            Import &amp; LC Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Letters of Credit lifecycle, UPAS/Deferred maturities, customs clearance, landed cost build-up, and bank facility tracking.
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
              setEditingLC(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Open New LC</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Active Open LC Exposure</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.activeBdtExposure)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.activeCount} active of {metrics.totalCount} files · USD{' '}
            {metrics.activeUsdExposure.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Bank LC &amp; Trade Loan Facilities</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalBankFacilities)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs font-mono">
            <button
              onClick={() => onOpenRegister('2020')}
              className="text-[#2563EB] hover:underline cursor-pointer"
            >
              SJIBL 2020
            </button>
            <span className="text-slate-300">·</span>
            <button
              onClick={() => onOpenRegister('2030')}
              className="text-[#2563EB] hover:underline cursor-pointer"
            >
              AAIBL 2030
            </button>
            <span className="text-slate-300">·</span>
            <button
              onClick={() => onOpenRegister('2010')}
              className="text-[#2563EB] hover:underline cursor-pointer"
            >
              IBBL 2010
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Customs Duty &amp; C&amp;F</span>
            <button
              onClick={() => onOpenRegister('5030')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5030</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalDutyCnf)}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {metrics.isCnfReconciled ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-emerald-700 font-medium">Reconciled to GL 5030</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-700 font-medium font-mono tabular-nums">
                  Var: {formatBDT(metrics.cnfVariance)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">LC Bank Charges &amp; Commission</span>
            <button
              onClick={() => onOpenRegister('5420')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5420</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalBankCharges)}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {metrics.isChargeReconciled ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-emerald-700 font-medium">Reconciled to GL 5420</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-700 font-medium font-mono tabular-nums">
                  Var: {formatBDT(metrics.chargeVariance)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex flex-wrap items-center bg-slate-200/70 p-1 rounded-lg gap-0.5">
            {LC_STATUSES.map((st) => {
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-white text-[#2563EB] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              );
            })}
          </div>

          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value as 'All' | IssuingBankName)}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-[#2563EB]"
          >
            <option value="All">All Issuing Banks</option>
            {ISSUING_BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="relative w-full xl:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search LC#, supplier, B/E#..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Master-Detail LC Register & Landed Cost Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: LC Files Table */}
        <div className="xl:col-span-7 bg-white border border-[#001F60] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Import LC Files ({filteredLCs.length})
            </span>
            <span className="text-xs text-slate-400">Select an LC for landed cost breakdown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">LC Number &amp; Beneficiary</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Bank / Type</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">FX Value</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Landed BDT</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredLCs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 px-4 text-center text-slate-500">
                      <Ship className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                      <div className="text-sm font-medium text-slate-700">No LC files match</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Adjust bank or stage filter, or open a new Letter of Credit.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLCs.map((lc) => {
                    const isSelected = selectedLC?.id === lc.id;
                    return (
                      <tr
                        key={lc.id}
                        onClick={() => setSelectedId(lc.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#EFF6FF]' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs font-semibold text-[#2563EB]">
                            {lc.lcNumber}
                          </div>
                          <div className="font-medium text-slate-900 leading-snug mt-0.5">
                            {lc.supplierName}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {lc.originCountry} · Due {lc.maturityDate}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap">
                          <div className="font-medium text-slate-800">{lc.issuingBank}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {lc.lcType} · GL {lc.loanGlCode}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                          <div className="font-medium text-slate-900">
                            {lc.currency} {lc.foreignAmount.toLocaleString('en-US')}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            @ ৳{lc.exchangeRate.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          {formatCompactBDT(lc.totalLandedCostBdt)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span
                            className={`text-xs font-semibold ${
                              lc.status === 'Retired / Settled'
                                ? 'text-emerald-700'
                                : lc.status === 'Customs Clearance'
                                  ? 'text-amber-700'
                                  : 'text-[#2563EB]'
                            }`}
                          >
                            {lc.status}
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

        {/* Right: LC Dossier & Landed Cost Panel */}
        <div className="xl:col-span-5 xl:sticky xl:top-20">
          {selectedLC ? (
            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
              {/* Header */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-[#2563EB] font-semibold">
                      {selectedLC.lcNumber} · {selectedLC.lcType}
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mt-1 leading-snug font-[var(--font-display)]">
                      {selectedLC.supplierName}
                    </h2>
                    <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`font-semibold ${
                          selectedLC.status === 'Retired / Settled'
                            ? 'text-emerald-700'
                            : selectedLC.status === 'Customs Clearance'
                              ? 'text-amber-700'
                              : 'text-[#2563EB]'
                        }`}
                      >
                        {selectedLC.status}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>{selectedLC.issuingBank}</span>
                      <span className="text-slate-300">·</span>
                      <span>{selectedLC.originCountry}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingLC(selectedLC);
                        setShowModal(true);
                      }}
                      title="Edit LC file"
                      className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === selectedLC.id ? (
                      <div className="inline-flex items-center gap-1.5 text-xs pl-1">
                        <button
                          disabled={busyAction !== null}
                          onClick={async () => {
                            await onDeleteLC(selectedLC.id);
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
                        onClick={() => setConfirmDeleteId(selectedLC.id)}
                        title="Delete LC file"
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Landed Cost Build-Up */}
              <div className="p-5 space-y-2.5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-800">Landed Cost &amp; Financing Build-Up</span>
                  <span className="font-mono text-slate-500">
                    {selectedLC.currency} {selectedLC.foreignAmount.toLocaleString('en-US')} @ ৳
                    {selectedLC.exchangeRate.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-600">Commercial Invoice Value (FOB/CFR)</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {formatBDT(selectedLC.bdtValue)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-600">
                    Customs Duty &amp; C&amp;F Charges{' '}
                    <button
                      onClick={() => onOpenRegister('5030')}
                      className="font-mono text-[#2563EB] hover:underline ml-1 cursor-pointer"
                    >
                      (GL 5030)
                    </button>
                  </span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {formatBDT(selectedLC.customsDutyAndCnfBdt)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-600">
                    LC Commission &amp; Bank Charges{' '}
                    <button
                      onClick={() => onOpenRegister('5420')}
                      className="font-mono text-[#2563EB] hover:underline ml-1 cursor-pointer"
                    >
                      (GL 5420)
                    </button>
                  </span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {formatBDT(selectedLC.bankChargesBdt)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 bg-slate-50 px-2.5 rounded-md font-semibold text-slate-900">
                  <span>Total Landed Cost</span>
                  <span className="font-mono tabular-nums text-sm text-[#2563EB]">
                    {formatBDT(selectedLC.totalLandedCostBdt)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="p-2.5 border border-slate-200 rounded-md">
                    <div className="text-[11px] text-slate-500">
                      LC Margin ({selectedLC.marginPct}%) ·{' '}
                      <button
                        onClick={() => onOpenRegister('1130')}
                        className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                      >
                        GL 1130
                      </button>
                    </div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatBDT(selectedLC.marginDepositBdt)}
                    </div>
                  </div>
                  <div className="p-2.5 border border-slate-200 rounded-md">
                    <div className="text-[11px] text-slate-500">
                      Bank Financing ·{' '}
                      <button
                        onClick={() => onOpenRegister(selectedLC.loanGlCode)}
                        className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                      >
                        GL {selectedLC.loanGlCode}
                      </button>
                    </div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatBDT(round2(selectedLC.bdtValue - selectedLC.marginDepositBdt))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Shipment & Customs Details */}
              <div className="p-5 space-y-2.5 text-xs">
                <div className="font-semibold text-slate-800">Shipment, Port &amp; Customs</div>
                <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                  <div>
                    <div className="text-[11px] text-slate-400">Opened</div>
                    <div className="font-mono text-slate-800 mt-0.5">{selectedLC.openDate}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Shipped</div>
                    <div className="font-mono text-slate-800 mt-0.5">{selectedLC.shipmentDate}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Maturity</div>
                    <div className="font-mono font-semibold text-slate-900 mt-0.5">
                      {selectedLC.maturityDate}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-slate-600 pt-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Anchor className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedLC.portOfDischarge}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Landmark className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono truncate">
                      B/E: {selectedLC.billOfEntryNo || 'Pending'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:col-span-2 min-w-0">
                    <Globe2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">C&amp;F Agent: {selectedLC.cnfAgent}</span>
                  </div>
                </div>

                <div className="pt-1">
                  <div className="text-[11px] font-medium text-slate-500">Consignment Scope</div>
                  <div className="text-slate-800 mt-0.5 leading-relaxed">
                    {selectedLC.goodsDescription}
                  </div>
                </div>
                {selectedLC.notes && (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-md p-2.5 leading-relaxed">
                    {selectedLC.notes}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="p-5 space-y-2.5">
                {nextStage && (
                  <button
                    disabled={busyAction !== null}
                    onClick={() => onUpdateLC(selectedLC.id, { status: nextStage.next })}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors cursor-pointer"
                  >
                    <span>{nextStage.label}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => onOpenRegister(selectedLC.loanGlCode)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    <span>Open GL {selectedLC.loanGlCode}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onOpenNewVoucher}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    <span>New Voucher</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500 text-sm">
              Select an Import LC file to inspect landed cost and customs milestones.
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <ImportLCFormModal
          initial={editingLC}
          busy={busyAction !== null}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingLC) {
              await onUpdateLC(editingLC.id, payload);
            } else {
              await onCreateLC(payload);
            }
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
};

interface ImportLCFormModalProps {
  initial: ImportLCFile | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Omit<ImportLCFile, 'id' | 'updatedAt'>) => Promise<void>;
}

const ImportLCFormModal: React.FC<ImportLCFormModalProps> = ({
  initial,
  busy,
  onClose,
  onSubmit,
}) => {
  const [lcNumber, setLcNumber] = useState(initial?.lcNumber ?? '');
  const [openDate, setOpenDate] = useState(initial?.openDate ?? '2025-06-30');
  const [shipmentDate, setShipmentDate] = useState(initial?.shipmentDate ?? '2025-07-25');
  const [maturityDate, setMaturityDate] = useState(initial?.maturityDate ?? '2025-10-25');
  const [supplierName, setSupplierName] = useState(
    initial?.supplierName ?? 'Siemens Industrial Automation Pte Ltd'
  );
  const [originCountry, setOriginCountry] = useState(initial?.originCountry ?? 'Singapore');
  const [issuingBank, setIssuingBank] = useState<IssuingBankName>(
    initial?.issuingBank ?? 'Shahjalal Islami Bank PLC'
  );
  const [lcType, setLcType] = useState<LCType>(initial?.lcType ?? 'UPAS 90D');
  const [currency, setCurrency] = useState<'USD' | 'EUR' | 'SGD'>(initial?.currency ?? 'USD');
  const [foreignAmount, setForeignAmount] = useState(String(initial?.foreignAmount ?? '250000'));
  const [exchangeRate, setExchangeRate] = useState(String(initial?.exchangeRate ?? '121.50'));
  const [marginPct, setMarginPct] = useState(String(initial?.marginPct ?? '20'));
  const [customsDutyAndCnfBdt, setCustomsDutyAndCnfBdt] = useState(
    String(initial?.customsDutyAndCnfBdt ?? '0')
  );
  const [bankChargesBdt, setBankChargesBdt] = useState(String(initial?.bankChargesBdt ?? '0'));
  const [portOfDischarge, setPortOfDischarge] = useState<ImportLCFile['portOfDischarge']>(
    initial?.portOfDischarge ?? 'Chattogram Sea Port'
  );
  const [cnfAgent, setCnfAgent] = useState(
    initial?.cnfAgent ?? 'Chattogram Port Express C&F Ltd.'
  );
  const [billOfEntryNo, setBillOfEntryNo] = useState(initial?.billOfEntryNo ?? '');
  const [goodsDescription, setGoodsDescription] = useState(initial?.goodsDescription ?? '');
  const [status, setStatus] = useState<LCStatus>(initial?.status ?? 'Opened');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const numFx = round2(Math.max(0, Number(foreignAmount) || 0));
  const numRate = Math.max(1, Number(exchangeRate) || 121);
  const bdtVal = round2(numFx * numRate);
  const numMarginPct = Math.min(100, Math.max(0, Number(marginPct) || 0));
  const marginDep = round2((bdtVal * numMarginPct) / 100);
  const dutyVal = round2(Math.max(0, Number(customsDutyAndCnfBdt) || 0));
  const bankChg = round2(Math.max(0, Number(bankChargesBdt) || 0));
  const landed = round2(bdtVal + dutyVal + bankChg);

  const loanGlCode =
    issuingBank === 'IBBL' ? '2010' : issuingBank === 'Al-Arafah Islami Bank' ? '2030' : '2020';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lcNumber.trim() || !supplierName.trim()) {
      setError('LC Number and Overseas Supplier are required.');
      return;
    }
    try {
      setError(null);
      await onSubmit({
        lcNumber: lcNumber.trim().toUpperCase(),
        openDate,
        shipmentDate,
        maturityDate,
        supplierName: supplierName.trim(),
        originCountry: originCountry.trim() || 'Singapore',
        issuingBank,
        loanGlCode,
        lcType,
        currency,
        foreignAmount: numFx,
        exchangeRate: numRate,
        bdtValue: bdtVal,
        marginPct: numMarginPct,
        marginDepositBdt: marginDep,
        customsDutyAndCnfBdt: dutyVal,
        bankChargesBdt: bankChg,
        totalLandedCostBdt: landed,
        portOfDischarge,
        cnfAgent: cnfAgent.trim() || 'Chattogram Port Express C&F Ltd.',
        billOfEntryNo: billOfEntryNo.trim(),
        goodsDescription: goodsDescription.trim() || 'Imported Automation Equipment',
        status,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save LC file.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-[var(--font-display)]">
              {initial ? `Edit Import LC — ${initial.lcNumber}` : 'Open New Import LC File'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks FX conversion, bank margin deposit (GL 1130), duties (GL 5030), and landed cost.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="px-3.5 py-2.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">LC Number *</label>
              <input
                type="text"
                value={lcNumber}
                onChange={(e) => setLcNumber(e.target.value)}
                placeholder="SJIBL-0124-25-0912"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Issuing Bank</label>
              <select
                value={issuingBank}
                onChange={(e) => setIssuingBank(e.target.value as IssuingBankName)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {ISSUING_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">LC Type</label>
              <select
                value={lcType}
                onChange={(e) => setLcType(e.target.value as LCType)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {LC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Overseas Beneficiary / OEM *
              </label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Origin Country
              </label>
              <input
                type="text"
                value={originCountry}
                onChange={(e) => setOriginCountry(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Open Date</label>
              <input
                type="date"
                value={openDate}
                onChange={(e) => setOpenDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Shipment Date</label>
              <input
                type="date"
                value={shipmentDate}
                onChange={(e) => setShipmentDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Maturity Date</label>
              <input
                type="date"
                value={maturityDate}
                onChange={(e) => setMaturityDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as 'USD' | 'EUR' | 'SGD')}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="SGD">SGD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">FX Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={foreignAmount}
                onChange={(e) => setForeignAmount(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Rate (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="1"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Margin (%)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={marginPct}
                onChange={(e) => setMarginPct(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Customs Duty &amp; C&amp;F (BDT · GL 5030)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={customsDutyAndCnfBdt}
                onChange={(e) => setCustomsDutyAndCnfBdt(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                LC Commission &amp; Bank Charges (BDT · GL 5420)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={bankChargesBdt}
                onChange={(e) => setBankChargesBdt(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-slate-500">Invoice BDT:</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatCompactBDT(bdtVal)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Margin:</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatCompactBDT(marginDep)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-500">Landed Cost:</span>{' '}
              <span className="font-mono font-bold text-[#2563EB] tabular-nums">
                {formatBDT(landed)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Port of Discharge
              </label>
              <select
                value={portOfDischarge}
                onChange={(e) =>
                  setPortOfDischarge(e.target.value as ImportLCFile['portOfDischarge'])
                }
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                <option value="Chattogram Sea Port">Chattogram Sea Port</option>
                <option value="HSIA Dhaka Air Cargo">HSIA Dhaka Air Cargo</option>
                <option value="Benapole Land Port">Benapole Land Port</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bill of Entry #
              </label>
              <input
                type="text"
                value={billOfEntryNo}
                onChange={(e) => setBillOfEntryNo(e.target.value)}
                placeholder="C-842190/2025"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Stage / Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LCStatus)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {LC_STATUSES.filter((s) => s !== 'All').map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">C&amp;F Agent</label>
              <input
                type="text"
                value={cnfAgent}
                onChange={(e) => setCnfAgent(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Consignment Goods Description
              </label>
              <input
                type="text"
                value={goodsDescription}
                onChange={(e) => setGoodsDescription(e.target.value)}
                placeholder="e.g., 11kV Switchgear Panels & Relays"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
            >
              {initial ? 'Save LC Changes' : 'Open Import LC'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

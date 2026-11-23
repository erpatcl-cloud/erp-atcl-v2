import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Edit3,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  exportRowsToCSV,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  InventorySerialUnit,
  LedgerState,
  WarrantyClaimRecord,
  WarrantyClaimStatus,
  WarrantyCoverageType,
} from '../types/accounting.ts';

interface WarrantyManagementPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onCreateWarrantyClaim: (
    payload: Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateWarrantyClaim: (
    id: string,
    payload: Partial<Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteWarrantyClaim: (id: string) => Promise<void>;
}

const STATUS_FILTERS: Array<'All' | WarrantyClaimStatus> = [
  'All',
  'Logged',
  'Under Inspection',
  'OEM Approved',
  'Replaced / Resolved',
  'Rejected',
];

const COVERAGE_TYPES: WarrantyCoverageType[] = [
  'OEM Replacement',
  'ATCL Standard 24M',
  'Extended SLA',
  'Out-of-Warranty',
];

const NEXT_STAGE: Partial<
  Record<WarrantyClaimStatus, { next: WarrantyClaimStatus; label: string }>
> = {
  Logged: { next: 'Under Inspection', label: 'Start Inspection' },
  'Under Inspection': { next: 'OEM Approved', label: 'Approve OEM RMA' },
  'OEM Approved': { next: 'Replaced / Resolved', label: 'Mark Resolved' },
};

const STATUS_TEXT_CLASS: Record<WarrantyClaimStatus, string> = {
  Logged: 'text-slate-600',
  'Under Inspection': 'text-amber-700',
  'OEM Approved': 'text-[#2563EB]',
  'Replaced / Resolved': 'text-emerald-700',
  Rejected: 'text-red-600',
};

export const WarrantyManagementPage: React.FC<WarrantyManagementPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onCreateWarrantyClaim,
  onUpdateWarrantyClaim,
  onDeleteWarrantyClaim,
}) => {
  const claims = state.warrantyClaims || [];
  const [statusFilter, setStatusFilter] = useState<'All' | WarrantyClaimStatus>('All');
  const [coverageFilter, setCoverageFilter] = useState<'All' | WarrantyCoverageType>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClaim, setEditingClaim] = useState<WarrantyClaimRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glWarrantyBalance = useMemo(() => {
    const summary = computeGLSummary(state);
    return summary.find((r) => r.code === '5310')?.closingBalance ?? 0;
  }, [state]);

  const metrics = useMemo(() => {
    const activeCount = claims.filter(
      (c) => c.status !== 'Replaced / Resolved' && c.status !== 'Rejected'
    ).length;
    const resolvedCount = claims.filter((c) => c.status === 'Replaced / Resolved').length;
    const totalClaimCost = round2(claims.reduce((s, c) => s + c.claimCostBdt, 0));
    const totalOemRecovery = round2(claims.reduce((s, c) => s + c.oemRecoveryBdt, 0));
    const netExposure = round2(totalClaimCost - totalOemRecovery);
    const glVariance = round2(totalClaimCost - glWarrantyBalance);
    const resolvedPct = claims.length > 0 ? (resolvedCount / claims.length) * 100 : 0;

    return {
      totalCount: claims.length,
      activeCount,
      resolvedCount,
      resolvedPct,
      totalClaimCost,
      totalOemRecovery,
      netExposure,
      glVariance,
    };
  }, [claims, glWarrantyBalance]);

  const filteredClaims = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return claims.filter((c) => {
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;
      if (coverageFilter !== 'All' && c.coverageType !== coverageFilter) return false;
      if (!q) return true;
      return (
        c.claimNo.toLowerCase().includes(q) ||
        c.serialNumber.toLowerCase().includes(q) ||
        c.sku.toLowerCase().includes(q) ||
        c.productName.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        c.issueSummary.toLowerCase().includes(q)
      );
    });
  }, [claims, statusFilter, coverageFilter, searchQuery]);

  const suggestedClaimNo = useMemo(() => {
    const maxNum = claims.reduce((max, c) => {
      const m = /^WRN-25-(\d+)$/.exec(c.claimNo);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    return `WRN-25-${String(maxNum + 1).padStart(3, '0')}`;
  }, [claims]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Warranty_Claims_${state.config.fiscalPeriod}.csv`,
      [
        'Claim No',
        'Claim Date',
        'Serial Number',
        'SKU',
        'Product',
        'Customer',
        'Warranty Expiry',
        'Coverage Type',
        'Issue Summary',
        'Claim Cost (BDT)',
        'OEM Recovery (BDT)',
        'Net Exposure (BDT)',
        'Expense GL',
        'Status',
        'Resolution Notes',
      ],
      filteredClaims.map((c) => [
        c.claimNo,
        c.claimDate,
        c.serialNumber,
        c.sku,
        c.productName,
        c.customerName,
        c.warrantyExpiry || '—',
        c.coverageType,
        c.issueSummary,
        c.claimCostBdt,
        c.oemRecoveryBdt,
        round2(c.claimCostBdt - c.oemRecoveryBdt),
        c.expenseGlCode,
        c.status,
        c.resolutionNotes || '—',
      ])
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-[var(--font-display)]">
            Warranty Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Serialized RMA warranty claims, OEM credit recoveries, and GL 5310 warranty expense reconciliation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => {
              setEditingClaim(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Warranty Claim</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Warranty Claims</span>
            <ShieldAlert className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-[#2563EB] font-mono tabular-nums">
            {metrics.activeCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.totalCount} total claims logged
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Claim Cost</span>
            <button
              onClick={() => onOpenRegister('5310')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5310</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalClaimCost)}
          </div>
          <div
            className={`mt-1 text-xs font-medium flex items-center gap-1 ${
              Math.abs(metrics.glVariance) < 0.01 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono tabular-nums">
              {Math.abs(metrics.glVariance) < 0.01
                ? 'Reconciled to GL 5310'
                : `GL Var ${formatBDT(metrics.glVariance)}`}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">OEM Recoveries &amp; Net Cost</div>
          <div className="mt-2 text-xl font-bold text-emerald-700 font-mono tabular-nums">
            {formatBDT(metrics.totalOemRecovery)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Net ATCL Exposure: {formatBDT(metrics.netExposure)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Resolution Rate</div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.resolvedPct.toFixed(0)}%
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.resolvedCount} of {metrics.totalCount} replaced / resolved
          </div>
        </div>
      </div>

      {/* Filters */}
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

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <select
              value={coverageFilter}
              onChange={(e) => setCoverageFilter(e.target.value as 'All' | WarrantyCoverageType)}
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            >
              <option value="All">All Coverage Types</option>
              {COVERAGE_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>

            <div className="relative min-w-[230px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search claim, serial #, customer..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Claims Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Claim &amp; Date</th>
                <th className="py-3 px-4">Serial # &amp; Equipment</th>
                <th className="py-3 px-4">Customer &amp; Issue</th>
                <th className="py-3 px-4">Coverage &amp; Expiry</th>
                <th className="py-3 px-4 text-right">Claim Cost</th>
                <th className="py-3 px-4 text-right">OEM Recovery</th>
                <th className="py-3 px-4">GL</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredClaims.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No warranty claims match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredClaims.map((claim) => {
                  const nextAction = NEXT_STAGE[claim.status];
                  const isDeleting = confirmDeleteId === claim.id;

                  return (
                    <tr key={claim.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top whitespace-nowrap font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{claim.claimNo}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{claim.claimDate}</div>
                      </td>
                      <td className="py-3 px-4 align-top max-w-[220px]">
                        <div className="font-mono font-semibold text-[#2563EB]">
                          {claim.serialNumber}
                        </div>
                        <div className="text-slate-800 font-medium mt-0.5 line-clamp-1">
                          {claim.productName}
                        </div>
                        {claim.sku && (
                          <div className="text-[11px] font-mono text-slate-400">{claim.sku}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top max-w-xs">
                        <div className="font-medium text-slate-900">{claim.customerName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                          {claim.issueSummary}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className="font-medium text-slate-700">{claim.coverageType}</div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Exp {claim.warrantyExpiry || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono font-semibold text-slate-900 tabular-nums">
                        {formatBDT(claim.claimCostBdt)}
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono text-emerald-700 tabular-nums">
                        {formatBDT(claim.oemRecoveryBdt)}
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <button
                          onClick={() => onOpenRegister(claim.expenseGlCode || '5310')}
                          className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                        >
                          {claim.expenseGlCode || '5310'}
                        </button>
                        {claim.status === 'Replaced / Resolved' && claim.claimCostBdt > 0 && (
                          <div className="text-[10px] text-emerald-700 font-medium mt-0.5">
                            GL 5310 Synced
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className={`font-semibold ${STATUS_TEXT_CLASS[claim.status]}`}>
                          {claim.status}
                        </div>
                        {nextAction && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() =>
                              onUpdateWarrantyClaim(claim.id, { status: nextAction.next })
                            }
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer disabled:opacity-50"
                          >
                            <span>{nextAction.label}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        {isDeleting ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={async () => {
                                await onDeleteWarrantyClaim(claim.id);
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
                              onClick={() => {
                                setEditingClaim(claim);
                                setShowModal(true);
                              }}
                              title="Edit warranty claim"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(claim.id)}
                              title="Delete warranty claim"
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

      {showModal && (
        <WarrantyClaimModal
          initial={editingClaim}
          suggestedClaimNo={suggestedClaimNo}
          serials={state.inventorySerials}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingClaim) {
              await onUpdateWarrantyClaim(editingClaim.id, payload);
            } else {
              await onCreateWarrantyClaim(payload);
            }
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
};

interface WarrantyClaimModalProps {
  initial: WarrantyClaimRecord | null;
  suggestedClaimNo: string;
  serials: InventorySerialUnit[];
  onClose: () => void;
  onSubmit: (payload: Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>) => Promise<void>;
}

const WarrantyClaimModal: React.FC<WarrantyClaimModalProps> = ({
  initial,
  suggestedClaimNo,
  serials,
  onClose,
  onSubmit,
}) => {
  const [claimNo, setClaimNo] = useState(initial?.claimNo || suggestedClaimNo);
  const [claimDate, setClaimDate] = useState(
    initial?.claimDate || new Date().toISOString().slice(0, 10)
  );
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber || '');
  const [sku, setSku] = useState(initial?.sku || '');
  const [productName, setProductName] = useState(initial?.productName || '');
  const [customerName, setCustomerName] = useState(initial?.customerName || '');
  const [warrantyExpiry, setWarrantyExpiry] = useState(initial?.warrantyExpiry || '');
  const [coverageType, setCoverageType] = useState<WarrantyCoverageType>(
    initial?.coverageType || 'ATCL Standard 24M'
  );
  const [issueSummary, setIssueSummary] = useState(initial?.issueSummary || '');
  const [claimCostBdt, setClaimCostBdt] = useState(String(initial?.claimCostBdt ?? 0));
  const [oemRecoveryBdt, setOemRecoveryBdt] = useState(String(initial?.oemRecoveryBdt ?? 0));
  const [status, setStatus] = useState<WarrantyClaimStatus>(initial?.status || 'Logged');
  const [resolutionNotes, setResolutionNotes] = useState(initial?.resolutionNotes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSerialPick = (sn: string) => {
    setSerialNumber(sn);
    const found = serials.find((u) => u.serialNumber === sn);
    if (found) {
      setSku(found.sku);
      setProductName(found.productName);
      if (found.assignedCustomer) setCustomerName(found.assignedCustomer);
      if (found.warrantyExpiry) setWarrantyExpiry(found.warrantyExpiry);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimNo.trim() || !serialNumber.trim() || !customerName.trim()) {
      setError('Claim Number, Serial Number, and Customer Name are required.');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        claimNo: claimNo.trim().toUpperCase(),
        claimDate,
        serialNumber: serialNumber.trim().toUpperCase(),
        sku: sku.trim().toUpperCase(),
        productName: productName.trim() || 'Serialized Equipment',
        customerName: customerName.trim(),
        warrantyExpiry,
        coverageType,
        issueSummary: issueSummary.trim() || 'Warranty fault reported',
        claimCostBdt: round2(Math.max(0, Number(claimCostBdt) || 0)),
        oemRecoveryBdt: round2(Math.max(0, Number(oemRecoveryBdt) || 0)),
        expenseGlCode: '5310',
        status,
        resolutionNotes: resolutionNotes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save warranty claim.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            {initial ? `Edit Warranty Claim ${initial.claimNo}` : 'Log New Warranty Claim'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Claim Number *</label>
              <input
                type="text"
                value={claimNo}
                onChange={(e) => setClaimNo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                required
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Claim Date</label>
              <input
                type="date"
                value={claimDate}
                onChange={(e) => setClaimDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Warranty Expiry</label>
              <input
                type="date"
                value={warrantyExpiry}
                onChange={(e) => setWarrantyExpiry(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Pick from Serial Register (Auto-Fill)
              </label>
              <select
                value={serials.some((u) => u.serialNumber === serialNumber) ? serialNumber : ''}
                onChange={(e) => {
                  if (e.target.value) handleSerialPick(e.target.value);
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white font-mono"
              >
                <option value="">-- Select Serialized Unit --</option>
                {serials.map((u) => (
                  <option key={u.id} value={u.serialNumber}>
                    {u.serialNumber} ({u.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Serial Number *</label>
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">SKU</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Equipment / Product</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Customer Name *</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Coverage Type</label>
              <select
                value={coverageType}
                onChange={(e) => setCoverageType(e.target.value as WarrantyCoverageType)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                {COVERAGE_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Reported Fault / Issue Summary</label>
            <input
              type="text"
              value={issueSummary}
              onChange={(e) => setIssueSummary(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Claim Cost (BDT · GL 5310)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={claimCostBdt}
                onChange={(e) => setClaimCostBdt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">OEM Recovery (BDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={oemRecoveryBdt}
                onChange={(e) => setOemRecoveryBdt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Claim Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WarrantyClaimStatus)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                {STATUS_FILTERS.filter((s) => s !== 'All').map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">RMA &amp; Resolution Notes</label>
            <textarea
              rows={2}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Saving...' : initial ? 'Save Claim' : 'Log Warranty Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

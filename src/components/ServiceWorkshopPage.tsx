import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Edit3,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  exportRowsToCSV,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type {
  CustomerRecord,
  InventorySerialUnit,
  LedgerState,
  ServiceJobCard,
  ServiceJobStatus,
  ServiceJobType,
} from '../types/accounting.ts';

interface ServiceWorkshopPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onCreateServiceJob: (payload: Omit<ServiceJobCard, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateServiceJob: (
    id: string,
    payload: Partial<Omit<ServiceJobCard, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteServiceJob: (id: string) => Promise<void>;
  onStateChange?: (nextState: LedgerState) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const STATUS_FILTERS: Array<'All' | ServiceJobStatus> = [
  'All',
  'Intake',
  'Diagnostics',
  'Awaiting Parts',
  'In Repair',
  'QA Bench',
  'Completed & Handed Over',
];

const JOB_TYPES: ServiceJobType[] = [
  'Bench Repair',
  'Field Commissioning',
  'Preventive Calibration',
  'Emergency Breakdown',
];

const PRIORITIES: Array<'Normal' | 'High' | 'Critical'> = ['Normal', 'High', 'Critical'];

const NEXT_STAGE: Partial<
  Record<ServiceJobStatus, { next: ServiceJobStatus; label: string }>
> = {
  Intake: { next: 'Diagnostics', label: 'Start Diagnostics' },
  Diagnostics: { next: 'In Repair', label: 'Begin Repair' },
  'Awaiting Parts': { next: 'In Repair', label: 'Parts Issued' },
  'In Repair': { next: 'QA Bench', label: 'Move to QA' },
  'QA Bench': { next: 'Completed & Handed Over', label: 'Hand Over' },
};

const STATUS_TEXT_CLASS: Record<ServiceJobStatus, string> = {
  Intake: 'text-slate-600',
  Diagnostics: 'text-indigo-700',
  'Awaiting Parts': 'text-amber-700',
  'In Repair': 'text-[#2563EB]',
  'QA Bench': 'text-cyan-700',
  'Completed & Handed Over': 'text-emerald-700',
};

const PRIORITY_TEXT_CLASS: Record<'Normal' | 'High' | 'Critical', string> = {
  Normal: 'text-slate-500',
  High: 'text-amber-700',
  Critical: 'text-red-700',
};

export const ServiceWorkshopPage: React.FC<ServiceWorkshopPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onCreateServiceJob,
  onUpdateServiceJob,
  onDeleteServiceJob,
  onStateChange,
  onNotify,
}) => {
  const jobs = state.serviceJobs || [];
  const [billingId, setBillingId] = useState<string | null>(null);

  const handleBillJob = async (job: ServiceJobCard) => {
    setBillingId(job.id);
    try {
      const res = await api.billServiceJob(job.id);
      onStateChange?.(res.state);
      onNotify?.('success', `Billed ${job.jobNo} to AR 1120 / Revenue 4010 (${res.invoice.invoiceNumber}).`);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to bill service job.');
    } finally {
      setBillingId(null);
    }
  };
  const [statusFilter, setStatusFilter] = useState<'All' | ServiceJobStatus>('All');
  const [priorityFilter, setPriorityFilter] = useState<'All' | 'Normal' | 'High' | 'Critical'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<ServiceJobCard | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glRepairBalance = useMemo(() => {
    const summary = computeGLSummary(state);
    return summary.find((r) => r.code === '5320')?.closingBalance ?? 0;
  }, [state]);

  const metrics = useMemo(() => {
    const activeCount = jobs.filter((j) => j.status !== 'Completed & Handed Over').length;
    const totalParts = round2(jobs.reduce((s, j) => s + j.partsCostBdt, 0));
    const totalLabor = round2(jobs.reduce((s, j) => s + j.laborCostBdt, 0));
    const totalCost = round2(jobs.reduce((s, j) => s + j.totalCostBdt, 0));
    const totalBillable = round2(jobs.reduce((s, j) => s + j.billableAmountBdt, 0));
    const workshopMargin = round2(totalBillable - totalCost);
    const marginPct = totalBillable > 0 ? (workshopMargin / totalBillable) * 100 : 0;
    const urgentCount = jobs.filter(
      (j) =>
        j.status !== 'Completed & Handed Over' &&
        (j.priority === 'Critical' || j.priority === 'High')
    ).length;
    const glVariance = round2(totalCost - glRepairBalance);

    return {
      count: jobs.length,
      activeCount,
      totalParts,
      totalLabor,
      totalCost,
      totalBillable,
      workshopMargin,
      marginPct,
      urgentCount,
      glVariance,
    };
  }, [jobs, glRepairBalance]);

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== 'All' && j.status !== statusFilter) return false;
      if (priorityFilter !== 'All' && j.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        j.jobNo.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.equipmentName.toLowerCase().includes(q) ||
        j.serialNumber.toLowerCase().includes(q) ||
        j.technician.toLowerCase().includes(q) ||
        j.serviceType.toLowerCase().includes(q)
      );
    });
  }, [jobs, statusFilter, priorityFilter, searchQuery]);

  const suggestedJobNo = useMemo(() => {
    const maxNum = jobs.reduce((max, j) => {
      const m = /^JOB-25-(\d+)$/.exec(j.jobNo);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    return `JOB-25-${String(maxNum + 1).padStart(3, '0')}`;
  }, [jobs]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Service_Workshop_${state.config.fiscalPeriod}.csv`,
      [
        'Job No',
        'Intake Date',
        'Promised Date',
        'Priority',
        'Customer',
        'Equipment',
        'Serial Number',
        'Service Type',
        'Technician',
        'Parts Cost (BDT)',
        'Labor Cost (BDT)',
        'Total Cost (BDT)',
        'Billable Value (BDT)',
        'Expense GL',
        'Status',
        'Notes',
      ],
      filteredJobs.map((j) => [
        j.jobNo,
        j.intakeDate,
        j.promisedDate,
        j.priority,
        j.customerName,
        j.equipmentName,
        j.serialNumber || '—',
        j.serviceType,
        j.technician,
        j.partsCostBdt,
        j.laborCostBdt,
        j.totalCostBdt,
        j.billableAmountBdt,
        j.expenseGlCode,
        j.status,
        j.notes || '—',
      ])
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-[var(--font-display)]">
            Service &amp; Repair Workshop
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Engineering job cards, bench calibration, field breakdown dispatch, and GL 5320 repair cost control.
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
              setEditingJob(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Job Card</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Bench &amp; Field Jobs</span>
            <Wrench className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-[#2563EB] font-mono tabular-nums">
            {metrics.activeCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.count} total job cards registered
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Workshop Cost</span>
            <button
              onClick={() => onOpenRegister('5320')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5320</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalCost)}
          </div>
          <div
            className={`mt-1 text-xs font-medium flex items-center gap-1 ${
              Math.abs(metrics.glVariance) < 0.01 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono tabular-nums">
              {Math.abs(metrics.glVariance) < 0.01
                ? 'Reconciled to GL 5320'
                : `GL Var ${formatBDT(metrics.glVariance)}`}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Billable Value &amp; Margin</div>
          <div className="mt-2 text-xl font-bold text-emerald-700 font-mono tabular-nums">
            {formatBDT(metrics.totalBillable)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Margin {formatBDT(metrics.workshopMargin)} ({metrics.marginPct.toFixed(1)}%)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Critical / High Priority Open</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-xl font-bold text-amber-700 font-mono tabular-nums">
            {metrics.urgentCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Parts {formatBDT(metrics.totalParts)} · Labor {formatBDT(metrics.totalLabor)}
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
              value={priorityFilter}
              onChange={(e) =>
                setPriorityFilter(e.target.value as 'All' | 'Normal' | 'High' | 'Critical')
              }
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            >
              <option value="All">All Priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p} Priority
                </option>
              ))}
            </select>

            <div className="relative min-w-[230px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search job #, equipment, engineer..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Job # &amp; Priority</th>
                <th className="py-3 px-4">Customer &amp; Equipment</th>
                <th className="py-3 px-4">Type &amp; Technician</th>
                <th className="py-3 px-4 text-right">Parts + Labor</th>
                <th className="py-3 px-4 text-right">Total Cost</th>
                <th className="py-3 px-4 text-right">Billable</th>
                <th className="py-3 px-4">GL</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No workshop job cards match the current filters.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => {
                  const nextAction = NEXT_STAGE[job.status];
                  const isDeleting = confirmDeleteId === job.id;

                  return (
                    <tr key={job.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {job.jobNo}
                        </div>
                        <div className={`text-[11px] font-semibold mt-0.5 ${PRIORITY_TEXT_CLASS[job.priority]}`}>
                          {job.priority} Priority
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-0.5">
                          Due {job.promisedDate}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top max-w-xs">
                        <div className="font-medium text-slate-900">{job.customerName}</div>
                        <div className="text-slate-700 mt-0.5">{job.equipmentName}</div>
                        {job.serialNumber && (
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            S/N {job.serialNumber}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className="font-medium text-slate-700">{job.serviceType}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{job.technician}</div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono tabular-nums text-slate-600">
                        <div>P: {formatBDT(job.partsCostBdt)}</div>
                        <div className="text-[11px] text-slate-400">
                          L: {formatBDT(job.laborCostBdt)}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono font-semibold text-slate-900 tabular-nums">
                        {formatBDT(job.totalCostBdt)}
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono font-medium text-emerald-700 tabular-nums">
                        {formatBDT(job.billableAmountBdt)}
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <button
                          onClick={() => onOpenRegister(job.expenseGlCode || '5320')}
                          className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                        >
                          {job.expenseGlCode || '5320'}
                        </button>
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className={`font-semibold ${STATUS_TEXT_CLASS[job.status]}`}>
                          {job.status}
                        </div>
                        {nextAction && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => onUpdateServiceJob(job.id, { status: nextAction.next })}
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
                                await onDeleteServiceJob(job.id);
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
                            {job.billedToGl ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] font-semibold">
                                {job.billedInvoiceNo}
                              </span>
                            ) : (
                              onStateChange && (
                                <button
                                  disabled={billingId === job.id || job.billableAmountBdt <= 0}
                                  onClick={() => void handleBillJob(job)}
                                  title="Bill Job to AR 1120 & Revenue 4010"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded cursor-pointer disabled:opacity-40"
                                >
                                  <ReceiptText className="w-3 h-3" /> Bill GL
                                </button>
                              )
                            )}
                            <button
                              onClick={() => {
                                setEditingJob(job);
                                setShowModal(true);
                              }}
                              title="Edit job card"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(job.id)}
                              title="Delete job card"
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
        <ServiceJobModal
          initial={editingJob}
          suggestedJobNo={suggestedJobNo}
          customers={state.customers}
          serials={state.inventorySerials}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingJob) {
              await onUpdateServiceJob(editingJob.id, payload);
            } else {
              await onCreateServiceJob(payload);
            }
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
};

interface ServiceJobModalProps {
  initial: ServiceJobCard | null;
  suggestedJobNo: string;
  customers: CustomerRecord[];
  serials: InventorySerialUnit[];
  onClose: () => void;
  onSubmit: (payload: Omit<ServiceJobCard, 'id' | 'updatedAt'>) => Promise<void>;
}

const ServiceJobModal: React.FC<ServiceJobModalProps> = ({
  initial,
  suggestedJobNo,
  customers,
  serials,
  onClose,
  onSubmit,
}) => {
  const [jobNo, setJobNo] = useState(initial?.jobNo || suggestedJobNo);
  const [intakeDate, setIntakeDate] = useState(
    initial?.intakeDate || new Date().toISOString().slice(0, 10)
  );
  const [promisedDate, setPromisedDate] = useState(
    initial?.promisedDate || new Date().toISOString().slice(0, 10)
  );
  const [customerName, setCustomerName] = useState(
    initial?.customerName || customers[0]?.name || ''
  );
  const [equipmentName, setEquipmentName] = useState(initial?.equipmentName || '');
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber || '');
  const [serviceType, setServiceType] = useState<ServiceJobType>(
    initial?.serviceType || 'Bench Repair'
  );
  const [technician, setTechnician] = useState(initial?.technician || 'Engr. Ashfaqur Rahman');
  const [priority, setPriority] = useState<'Normal' | 'High' | 'Critical'>(
    initial?.priority || 'Normal'
  );
  const [partsCostBdt, setPartsCostBdt] = useState(String(initial?.partsCostBdt ?? 0));
  const [laborCostBdt, setLaborCostBdt] = useState(String(initial?.laborCostBdt ?? 0));
  const [billableAmountBdt, setBillableAmountBdt] = useState(
    String(initial?.billableAmountBdt ?? 0)
  );
  const [status, setStatus] = useState<ServiceJobStatus>(initial?.status || 'Intake');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numParts = round2(Math.max(0, Number(partsCostBdt) || 0));
  const numLabor = round2(Math.max(0, Number(laborCostBdt) || 0));
  const calcTotalCost = round2(numParts + numLabor);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobNo.trim() || !customerName.trim() || !equipmentName.trim()) {
      setError('Job Card #, Customer Name, and Equipment Name are required.');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        jobNo: jobNo.trim().toUpperCase(),
        intakeDate,
        promisedDate,
        customerName: customerName.trim(),
        equipmentName: equipmentName.trim(),
        serialNumber: serialNumber.trim().toUpperCase(),
        serviceType,
        technician: technician.trim() || 'Engr. Ashfaqur Rahman',
        priority,
        partsCostBdt: numParts,
        laborCostBdt: numLabor,
        totalCostBdt: calcTotalCost,
        billableAmountBdt: round2(Math.max(0, Number(billableAmountBdt) || 0)),
        expenseGlCode: '5320',
        status,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save job card.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            {initial ? `Edit Job Card ${initial.jobNo}` : 'Open Service & Repair Job Card'}
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
              <label className="block font-medium text-slate-700 mb-1">Job Card # *</label>
              <input
                type="text"
                value={jobNo}
                onChange={(e) => setJobNo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                required
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Intake Date</label>
              <input
                type="date"
                value={intakeDate}
                onChange={(e) => setIntakeDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Promised Date</label>
              <input
                type="date"
                value={promisedDate}
                onChange={(e) => setPromisedDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Customer *</label>
              <input
                type="text"
                list="workshop-customers-list"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
                required
              />
              <datalist id="workshop-customers-list">
                {customers.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Serial Number</label>
              <input
                type="text"
                list="workshop-serials-list"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
              <datalist id="workshop-serials-list">
                {serials.map((s) => (
                  <option key={s.id} value={s.serialNumber} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Equipment / Assembly Name *</label>
            <input
              type="text"
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="e.g. Modular UPS 60kVA Inverter Chassis"
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Service Type</label>
              <select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value as ServiceJobType)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                {JOB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Assigned Engineer</label>
              <input
                type="text"
                value={technician}
                onChange={(e) => setTechnician(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'Normal' | 'High' | 'Critical')}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Parts Cost (BDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={partsCostBdt}
                onChange={(e) => setPartsCostBdt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Labor Cost (BDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={laborCostBdt}
                onChange={(e) => setLaborCostBdt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Billable Amount (BDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={billableAmountBdt}
                onChange={(e) => setBillableAmountBdt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 flex items-center justify-between font-mono tabular-nums">
            <span>Total Workshop Cost (GL 5320):</span>
            <span className="font-bold text-[#2563EB]">{formatBDT(calcTotalCost)}</span>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Workshop Stage</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ServiceJobStatus)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
            >
              {STATUS_FILTERS.filter((s) => s !== 'All').map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Technical Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              {submitting ? 'Saving...' : initial ? 'Save Job Card' : 'Create Job Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

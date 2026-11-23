import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  GitBranch,
  PenLine,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import {
  DocumentTraceabilityDrawer,
  type TraceDocTarget,
} from './common/DocumentTraceabilityDrawer.tsx';
import type {
  GLAccount,
  LedgerState,
  LocalPOCategory,
  LocalPOLineItem,
  LocalPOStatus,
  LocalPurchaseOrder,
  SupplierRecord,
} from '../types/accounting.ts';

interface LocalProcurementPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onOpenNewVoucher: () => void;
  onCreatePO: (payload: Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdatePO: (
    id: string,
    payload: Partial<Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeletePO: (id: string) => Promise<void>;
}

const STATUS_FILTERS: Array<'All' | LocalPOStatus> = [
  'All',
  'Draft',
  'Approved',
  'Partially Received',
  'Received',
  'Settled',
];

const CATEGORIES: LocalPOCategory[] = [
  'Local Material',
  'C&F & Freight',
  'Engineering Subcontract',
  'Office & IT',
  'Maintenance & Spares',
];

const PAYMENT_BANKS = [
  'Shahjalal Islami Bank PLC',
  'Al-Arafah Islami Bank',
  'IBBL',
  'Cash in Hand',
];

const NEXT_STATUS_ACTION: Partial<
  Record<LocalPOStatus, { next: LocalPOStatus; label: string }>
> = {
  Draft: { next: 'Approved', label: 'Approve' },
  Approved: { next: 'Received', label: 'Receive GRN' },
  'Partially Received': { next: 'Received', label: 'Complete GRN' },
  Received: { next: 'Settled', label: 'Mark Settled' },
};

export const LocalProcurementPage: React.FC<LocalProcurementPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onOpenNewVoucher,
  onCreatePO,
  onUpdatePO,
  onDeletePO,
}) => {
  const orders = state.localPurchaseOrders || [];
  const [statusFilter, setStatusFilter] = useState<'All' | LocalPOStatus>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | LocalPOCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingOrder, setEditingOrder] = useState<LocalPurchaseOrder | null>(null);
  const [traceDoc, setTraceDoc] = useState<TraceDocTarget | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const totalNet = round2(orders.reduce((s, o) => s + o.netAmount, 0));
    const totalVat = round2(orders.reduce((s, o) => s + o.vatAmount, 0));
    const totalAit = round2(orders.reduce((s, o) => s + o.aitAmount, 0));
    const totalGross = round2(orders.reduce((s, o) => s + o.grossAmount, 0));
    const totalPaid = round2(orders.reduce((s, o) => s + o.paidAmount, 0));
    const outstanding = round2(totalGross - totalPaid);
    const openCount = orders.filter((o) => o.status !== 'Settled').length;
    const paidPct = totalGross > 0 ? (totalPaid / totalGross) * 100 : 0;

    return {
      count: orders.length,
      totalNet,
      totalVat,
      totalAit,
      totalGross,
      totalPaid,
      outstanding,
      openCount,
      paidPct,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'All' && o.status !== statusFilter) return false;
      if (categoryFilter !== 'All' && o.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        o.poNumber.toLowerCase().includes(q) ||
        o.supplierName.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        o.grnNumber.toLowerCase().includes(q) ||
        o.expenseGlCode.toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, categoryFilter, searchQuery]);

  const suggestedPoNumber = useMemo(() => {
    const maxNum = orders.reduce((max, o) => {
      const m = /^PO-25-(\d+)$/.exec(o.poNumber);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    return `PO-25-${String(maxNum + 1).padStart(3, '0')}`;
  }, [orders]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Local_Procurement_${state.config.fiscalPeriod}.csv`,
      [
        'PO Number',
        'PO Date',
        'Expected Delivery',
        'Supplier',
        'Category',
        'Description',
        'Net Amount (BDT)',
        'VAT %',
        'VAT Amount (BDT)',
        'AIT %',
        'AIT Withheld (BDT)',
        'Gross Payable (BDT)',
        'Paid (BDT)',
        'Balance (BDT)',
        'Bank',
        'Expense GL',
        'GRN / Ref',
        'Status',
      ],
      filteredOrders.map((o) => [
        o.poNumber,
        o.poDate,
        o.expectedDate,
        o.supplierName,
        o.category,
        o.description,
        o.netAmount,
        o.vatRate,
        o.vatAmount,
        o.aitRate,
        o.aitAmount,
        o.grossAmount,
        o.paidAmount,
        round2(o.grossAmount - o.paidAmount),
        o.paymentBank,
        o.expenseGlCode,
        o.grnNumber || '—',
        o.status,
      ])
    );
  };

  const handleAdvanceStatus = async (order: LocalPurchaseOrder) => {
    const step = NEXT_STATUS_ACTION[order.status];
    if (!step) return;
    const grnPatch =
      step.next === 'Received' && !order.grnNumber
        ? { grnNumber: `GRN-25-${String(orders.length + 50).padStart(3, '0')}` }
        : {};
    await onUpdatePO(order.id, {
      status: step.next,
      ...grnPatch,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
            Local Procurement
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Domestic purchase orders, goods receipt tracking, Mushak VAT &amp; AIT withholding, and GL expense posting.
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
              setEditingOrder(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Local PO</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Total Local PO Commitment</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalGross)}
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            {metrics.count} orders · Base net {formatCompactBDT(metrics.totalNet)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Settled / Disbursed</span>
            <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
              {metrics.paidPct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalPaid)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            Unpaid balance: {formatBDT(metrics.outstanding)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Input VAT &amp; AIT Withheld</span>
            <button
              onClick={() => onOpenRegister('2070')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 2070</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalVat)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            AIT / TDS withheld: {formatBDT(metrics.totalAit)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Open Orders Pipeline</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {metrics.openCount}
            </div>
            <button
              onClick={onOpenNewVoucher}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
            >
              <PenLine className="w-3 h-3" />
              <span>Post Voucher</span>
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Draft, approved, or awaiting final GRN settlement
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex flex-wrap items-center bg-slate-200/70 p-1 rounded-lg gap-0.5">
            {STATUS_FILTERS.map((st) => {
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
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'All' | LocalPOCategory)}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-[#2563EB]"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
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
            placeholder="Search PO#, vendor, GRN, GL..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Purchase Order Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">PO Number &amp; Date</th>
                <th className="py-3 px-4">Supplier &amp; Scope</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Net Base</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">VAT / AIT</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Gross Payable</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Paid / Bal</th>
                <th className="py-3 px-3 whitespace-nowrap">GL &amp; GRN</th>
                <th className="py-3 px-3 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 px-4 text-center text-slate-500">
                    <ClipboardList className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <div className="text-sm font-medium text-slate-700">No purchase orders found</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Adjust filters or issue a new local purchase order.
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const balance = round2(order.grossAmount - order.paidAmount);
                  const nextAction = NEXT_STATUS_ACTION[order.status];
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-semibold text-[#2563EB]">
                          {order.poNumber}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {order.poDate}
                        </div>
                      </td>
                      <td className="py-3 px-4 min-w-[240px]">
                        <div className="font-medium text-slate-900 leading-snug">
                          {order.supplierName}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                          {order.description}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {order.category} · {order.paymentBank}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                        {formatBDT(order.netAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        <div className="text-slate-700">
                          VAT {formatCompactBDT(order.vatAmount)}{' '}
                          <span className="text-slate-400">({order.vatRate}%)</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          AIT {formatCompactBDT(order.aitAmount)} ({order.aitRate}%)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatBDT(order.grossAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        <div className="text-emerald-700 font-medium">
                          {formatCompactBDT(order.paidAmount)}
                        </div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            balance > 0 ? 'text-amber-700 font-medium' : 'text-slate-400'
                          }`}
                        >
                          Bal {formatCompactBDT(balance)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs font-mono whitespace-nowrap">
                        <button
                          onClick={() => onOpenRegister(order.expenseGlCode)}
                          className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                        >
                          GL {order.expenseGlCode}
                        </button>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {order.grnNumber || 'No GRN yet'}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div
                          className={`text-xs font-semibold ${
                            order.status === 'Settled'
                              ? 'text-emerald-700'
                              : order.status === 'Received'
                                ? 'text-[#2563EB]'
                                : order.status === 'Approved' ||
                                    order.status === 'Partially Received'
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                          }`}
                        >
                          {order.status}
                        </div>
                        {nextAction && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => handleAdvanceStatus(order)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer"
                          >
                            <span>{nextAction.label}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {confirmDeleteId === order.id ? (
                          <div className="inline-flex items-center gap-2 text-xs">
                            <button
                              disabled={busyAction !== null}
                              onClick={async () => {
                                await onDeletePO(order.id);
                                setConfirmDeleteId(null);
                              }}
                              className="font-semibold text-red-700 hover:underline cursor-pointer"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-slate-500 hover:text-slate-800 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() =>
                                setTraceDoc({
                                  docType: 'PO',
                                  docRef: order.poNumber,
                                  title: order.supplierName,
                                })
                              }
                              title="Trace PO → GRN → Invoice → GL"
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                            >
                              <GitBranch className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingOrder(order);
                                setShowModal(true);
                              }}
                              title="Edit PO"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(order.id)}
                              title="Delete PO"
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
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
            {filteredOrders.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 text-xs font-semibold text-slate-900">
                  <td colSpan={2} className="py-3 px-4">
                    Filtered Totals ({filteredOrders.length} Purchase Orders)
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {formatBDT(round2(filteredOrders.reduce((s, o) => s + o.netAmount, 0)))}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-600">
                    VAT {formatCompactBDT(round2(filteredOrders.reduce((s, o) => s + o.vatAmount, 0)))}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {formatBDT(round2(filteredOrders.reduce((s, o) => s + o.grossAmount, 0)))}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap text-emerald-700">
                    {formatCompactBDT(round2(filteredOrders.reduce((s, o) => s + o.paidAmount, 0)))}
                  </td>
                  <td colSpan={3} className="py-3 px-4 text-right font-normal text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      VAT &amp; AIT calculated per NBR rules
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {showModal && (
        <LocalPOFormModal
          accounts={state.accounts}
          suppliers={state.suppliers}
          suggestedPoNumber={suggestedPoNumber}
          initial={editingOrder}
          busy={busyAction !== null}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingOrder) {
              await onUpdatePO(editingOrder.id, payload);
            } else {
              await onCreatePO(payload);
            }
            setShowModal(false);
          }}
        />
      )}

      <DocumentTraceabilityDrawer
        state={state}
        target={traceDoc}
        onClose={() => setTraceDoc(null)}
        onOpenRegister={onOpenRegister}
      />
    </div>
  );
};

interface LocalPOFormModalProps {
  accounts: GLAccount[];
  suppliers: SupplierRecord[];
  suggestedPoNumber: string;
  initial: LocalPurchaseOrder | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>) => Promise<void>;
}

const LocalPOFormModal: React.FC<LocalPOFormModalProps> = ({
  accounts,
  suppliers,
  suggestedPoNumber,
  initial,
  busy,
  onClose,
  onSubmit,
}) => {
  const localSuppliers = suppliers.filter((s) => s.country.toLowerCase() === 'bangladesh');
  const selectableSuppliers = localSuppliers.length > 0 ? localSuppliers : suppliers;

  const [poNumber, setPoNumber] = useState(initial?.poNumber ?? suggestedPoNumber);
  const [poDate, setPoDate] = useState(initial?.poDate ?? '2025-06-30');
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? '2025-07-15');
  const [supplierId, setSupplierId] = useState(
    initial?.supplierId ?? selectableSuppliers[0]?.id ?? ''
  );
  const [supplierName, setSupplierName] = useState(
    initial?.supplierName ?? selectableSuppliers[0]?.name ?? ''
  );
  const [category, setCategory] = useState<LocalPOCategory>(initial?.category ?? 'Local Material');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [lines, setLines] = useState<LocalPOLineItem[]>(initial?.lines ?? []);
  const [netAmount, setNetAmount] = useState(String(initial?.netAmount ?? ''));
  const [vatRate, setVatRate] = useState(String(initial?.vatRate ?? '15'));
  const [aitRate, setAitRate] = useState(String(initial?.aitRate ?? '3'));
  const [paidAmount, setPaidAmount] = useState(String(initial?.paidAmount ?? '0'));
  const [paymentBank, setPaymentBank] = useState(
    initial?.paymentBank ?? PAYMENT_BANKS[0]
  );
  const [expenseGlCode, setExpenseGlCode] = useState(initial?.expenseGlCode ?? '5010');
  const [status, setStatus] = useState<LocalPOStatus>(initial?.status ?? 'Draft');
  const [grnNumber, setGrnNumber] = useState(initial?.grnNumber ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const expenseAccounts = accounts.filter((a) => a.category === 'Expense');

  const linesTotal = useMemo(
    () => round2(lines.reduce((s, l) => s + round2(l.qty * l.unitPrice), 0)),
    [lines]
  );

  const addPoLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `POL-${prev.length + 1}-${Date.now()}`,
        description: '',
        qty: 1,
        unit: 'Pcs',
        unitPrice: 0,
        vatRate: Number(vatRate) || 0,
        lineTotal: 0,
      },
    ]);
  };

  const updatePoLine = (idx: number, patch: Partial<LocalPOLineItem>) => {
    setLines((prev) => {
      const next = prev.map((item, i) => {
        if (i !== idx) return item;
        const merged = { ...item, ...patch };
        merged.lineTotal = round2((Number(merged.qty) || 0) * (Number(merged.unitPrice) || 0));
        return merged;
      });
      const sum = round2(next.reduce((s, l) => s + l.lineTotal, 0));
      setNetAmount(String(sum));
      return next;
    });
  };

  const removePoLine = (idx: number) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const sum = round2(next.reduce((s, l) => s + l.lineTotal, 0));
      if (next.length > 0) setNetAmount(String(sum));
      return next;
    });
  };

  const numNet = lines.length > 0 ? linesTotal : round2(Math.max(0, Number(netAmount) || 0));
  const numVatRate = Math.max(0, Number(vatRate) || 0);
  const numAitRate = Math.max(0, Number(aitRate) || 0);
  const calcVat = round2((numNet * numVatRate) / 100);
  const calcAit = round2((numNet * numAitRate) / 100);
  const calcGross = round2(numNet + calcVat);

  const handleSelectSupplier = (id: string) => {
    setSupplierId(id);
    const found = suppliers.find((s) => s.id === id);
    if (found) {
      setSupplierName(found.name);
      if (found.expenseGlCode) setExpenseGlCode(found.expenseGlCode);
      if (found.bankName && PAYMENT_BANKS.includes(found.bankName)) {
        setPaymentBank(found.bankName);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poNumber.trim() || !supplierName.trim()) {
      setError('PO Number and Supplier Name are required.');
      return;
    }
    try {
      setError(null);
      await onSubmit({
        poNumber: poNumber.trim().toUpperCase(),
        poDate,
        expectedDate,
        supplierId,
        supplierName: supplierName.trim(),
        category,
        description: description.trim() || 'Local Procurement Order',
        lines: lines.length > 0 ? lines : undefined,
        netAmount: numNet,
        vatRate: numVatRate,
        vatAmount: calcVat,
        aitRate: numAitRate,
        aitAmount: calcAit,
        grossAmount: calcGross,
        paidAmount: round2(Math.min(calcGross, Math.max(0, Number(paidAmount) || 0))),
        paymentBank,
        expenseGlCode,
        status,
        grnNumber: grnNumber.trim(),
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save purchase order.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-[var(--font-display)]">
              {initial ? `Edit Local PO — ${initial.poNumber}` : 'Create Local Purchase Order'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Calculates Bangladesh VAT, AIT withholding, and maps directly to ATCL GL expense registers.
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
              <label className="block text-xs font-medium text-slate-700 mb-1">PO Number *</label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">PO Date</label>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Expected Delivery
              </label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Approved Supplier *
              </label>
              <select
                value={supplierId}
                onChange={(e) => handleSelectSupplier(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as LocalPOCategory)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Goods / Scope Description *
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Armored 48-Core Fiber Drums & Cable Trays for DESCO Site"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Line-Level Items (Optional — auto-calculates Net Amount)
              </label>
              <button
                type="button"
                onClick={addPoLine}
                className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                + Add Line Item
              </button>
            </div>
            {lines.length > 0 && (
              <div className="border border-slate-200 rounded-md overflow-hidden mb-2">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="py-1.5 px-2 text-left">Item Description</th>
                      <th className="py-1.5 px-2 text-right w-16">Qty</th>
                      <th className="py-1.5 px-2 text-left w-16">Unit</th>
                      <th className="py-1.5 px-2 text-right w-24">Unit Price</th>
                      <th className="py-1.5 px-2 text-right w-24">Total</th>
                      <th className="py-1.5 px-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((ln, idx) => (
                      <tr key={ln.id}>
                        <td className="p-1">
                          <input
                            type="text"
                            value={ln.description}
                            onChange={(e) => updatePoLine(idx, { description: e.target.value })}
                            placeholder="Item / SKU"
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number"
                            min="1"
                            value={ln.qty}
                            onChange={(e) => updatePoLine(idx, { qty: Number(e.target.value) })}
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono text-[11px]"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={ln.unit}
                            onChange={(e) => updatePoLine(idx, { unit: e.target.value })}
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={ln.unitPrice}
                            onChange={(e) => updatePoLine(idx, { unitPrice: Number(e.target.value) })}
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono text-[11px]"
                          />
                        </td>
                        <td className="p-1 text-right font-mono text-slate-800">
                          {formatBDT(ln.lineTotal)}
                        </td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => removePoLine(idx)}
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Net Amount (BDT)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">VAT Rate (%)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">AIT Rate (%)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={aitRate}
                onChange={(e) => setAitRate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Paid (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          {/* Live Tax Summary Bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-slate-500">VAT ({numVatRate}%):</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatBDT(calcVat)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">AIT ({numAitRate}%):</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatBDT(calcAit)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-500">Gross PO:</span>{' '}
              <span className="font-mono font-bold text-[#2563EB] tabular-nums">
                {formatBDT(calcGross)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Settlement Bank
              </label>
              <select
                value={paymentBank}
                onChange={(e) => setPaymentBank(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {PAYMENT_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LocalPOStatus)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {STATUS_FILTERS.filter((s) => s !== 'All').map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GRN / Receipt #</label>
              <input
                type="text"
                value={grnNumber}
                onChange={(e) => setGrnNumber(e.target.value)}
                placeholder="GRN-25-055"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Target Expense GL Register
            </label>
            <select
              value={expenseGlCode}
              onChange={(e) => setExpenseGlCode(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            >
              {expenseAccounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
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
              {initial ? 'Save Changes' : 'Issue Purchase Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

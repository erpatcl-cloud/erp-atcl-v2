import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Edit3,
  GitBranch,
  PenLine,
  Plus,
  Search,
  ShoppingBag,
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
import {
  DocumentTraceabilityDrawer,
  type TraceDocTarget,
} from './common/DocumentTraceabilityDrawer.tsx';
import type {
  CustomerRecord,
  GLAccount,
  LedgerState,
  SalesChannel,
  SalesOrderRecord,
  SalesOrderStatus,
} from '../types/accounting.ts';

interface SalesDistributionPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onOpenNewVoucher: () => void;
  onCreateSalesOrder: (payload: Omit<SalesOrderRecord, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateSalesOrder: (
    id: string,
    payload: Partial<Omit<SalesOrderRecord, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteSalesOrder: (id: string) => Promise<void>;
}

const STATUS_FILTERS: Array<'All' | SalesOrderStatus> = [
  'All',
  'Quotation',
  'Confirmed',
  'Dispatched',
  'Invoiced',
  'Collected',
];

const CHANNELS: SalesChannel[] = [
  'Direct Project',
  'Utility Tender',
  'Distributor / Channel',
  'Enterprise AMC',
];

const NEXT_STAGE: Partial<
  Record<SalesOrderStatus, { next: SalesOrderStatus; label: string }>
> = {
  Quotation: { next: 'Confirmed', label: 'Confirm' },
  Confirmed: { next: 'Dispatched', label: 'Dispatch' },
  Dispatched: { next: 'Invoiced', label: 'Invoice' },
};

const STATUS_TEXT_CLASS: Record<SalesOrderStatus, string> = {
  Quotation: 'text-slate-500',
  Confirmed: 'text-[#2563EB]',
  Dispatched: 'text-amber-700',
  Invoiced: 'text-indigo-700',
  Collected: 'text-emerald-700',
};

export const SalesDistributionPage: React.FC<SalesDistributionPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onOpenNewVoucher,
  onCreateSalesOrder,
  onUpdateSalesOrder,
  onDeleteSalesOrder,
}) => {
  const orders = state.salesOrders || [];
  const [statusFilter, setStatusFilter] = useState<'All' | SalesOrderStatus>('All');
  const [channelFilter, setChannelFilter] = useState<'All' | SalesChannel>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SalesOrderRecord | null>(null);
  const [traceDoc, setTraceDoc] = useState<TraceDocTarget | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glSummaryMap = useMemo(() => {
    const summary = computeGLSummary(state);
    return new Map(summary.map((r) => [r.code, r.closingBalance]));
  }, [state]);

  const glCommission = glSummaryMap.get('5120') ?? 0;
  const glReceivable = glSummaryMap.get('1120') ?? 0;

  const metrics = useMemo(() => {
    const totalNet = round2(orders.reduce((s, o) => s + o.netAmount, 0));
    const totalVat = round2(orders.reduce((s, o) => s + o.vatAmount, 0));
    const totalGross = round2(orders.reduce((s, o) => s + o.grossAmount, 0));
    const totalCollected = round2(orders.reduce((s, o) => s + o.collectedAmount, 0));
    const totalReceivable = round2(totalGross - totalCollected);
    const totalCommission = round2(orders.reduce((s, o) => s + o.commissionAmount, 0));
    const activePipelineCount = orders.filter(
      (o) => o.status === 'Quotation' || o.status === 'Confirmed' || o.status === 'Dispatched'
    ).length;
    const collectionPct = totalGross > 0 ? (totalCollected / totalGross) * 100 : 0;
    const commissionVariance = round2(totalCommission - glCommission);

    return {
      count: orders.length,
      totalNet,
      totalVat,
      totalGross,
      totalCollected,
      totalReceivable,
      totalCommission,
      activePipelineCount,
      collectionPct,
      commissionVariance,
    };
  }, [orders, glCommission]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'All' && o.status !== statusFilter) return false;
      if (channelFilter !== 'All' && o.channel !== channelFilter) return false;
      if (!q) return true;
      return (
        o.orderNo.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        o.salesRep.toLowerCase().includes(q) ||
        o.challanNo.toLowerCase().includes(q) ||
        o.revenueGlCode.toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, channelFilter, searchQuery]);

  const suggestedOrderNo = useMemo(() => {
    const maxNum = orders.reduce((max, o) => {
      const m = /^SO-25-(\d+)$/.exec(o.orderNo);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    return `SO-25-${String(maxNum + 1).padStart(3, '0')}`;
  }, [orders]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Sales_Distribution_${state.config.fiscalPeriod}.csv`,
      [
        'Order No',
        'Order Date',
        'Delivery Date',
        'Customer',
        'Channel',
        'Sales Rep',
        'Description',
        'Net Value (BDT)',
        'VAT %',
        'VAT (BDT)',
        'Gross Order (BDT)',
        'Collected (BDT)',
        'Receivable (BDT)',
        'Commission (BDT)',
        'Revenue GL',
        'Challan No',
        'Status',
      ],
      filteredOrders.map((o) => [
        o.orderNo,
        o.orderDate,
        o.deliveryDate,
        o.customerName,
        o.channel,
        o.salesRep,
        o.description,
        o.netAmount,
        o.vatRate,
        o.vatAmount,
        o.grossAmount,
        o.collectedAmount,
        round2(o.grossAmount - o.collectedAmount),
        o.commissionAmount,
        o.revenueGlCode,
        o.challanNo || '—',
        o.status,
      ])
    );
  };

  const handleAdvanceStage = async (order: SalesOrderRecord) => {
    const action = NEXT_STAGE[order.status];
    if (!action) return;
    await onUpdateSalesOrder(order.id, {
      status: action.next,
      collectedAmount: action.next === 'Collected' ? order.grossAmount : order.collectedAmount,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-[var(--font-display)]">
            Sales &amp; Distribution
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Enterprise tender contracts, delivery challans, milestone billing, and sales commission sub-ledger.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenNewVoucher}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <PenLine className="w-3.5 h-3.5" />
            <span>Post Revenue JV</span>
          </button>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => {
              setEditingOrder(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Sales Order</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Gross Order Book</span>
            <button
              onClick={() => onOpenRegister('4010')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 4010</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {formatCompactBDT(metrics.totalGross)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.count} orders · Net {formatCompactBDT(metrics.totalNet)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Collected vs Receivable</span>
            <button
              onClick={() => onOpenRegister('1120')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1120</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-700 font-mono tabular-nums">
            {formatCompactBDT(metrics.totalCollected)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.collectionPct.toFixed(1)}% collected · AR {formatCompactBDT(metrics.totalReceivable)} (GL {formatCompactBDT(glReceivable)})
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Sales Commission</span>
            <button
              onClick={() => onOpenRegister('5120')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5120</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalCommission)}
          </div>
          <div
            className={`mt-1 text-xs font-medium flex items-center gap-1 ${
              Math.abs(metrics.commissionVariance) < 0.01 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono tabular-nums">
              {Math.abs(metrics.commissionVariance) < 0.01
                ? 'Reconciled to GL 5120'
                : `GL Var ${formatBDT(metrics.commissionVariance)}`}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Fulfillment Pipeline</span>
            <ShoppingBag className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-[#2563EB] font-mono tabular-nums">
            {metrics.activePipelineCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Orders in Quotation, Confirmed, or Dispatched
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
            {STATUS_FILTERS.map((st) => {
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as 'All' | SalesChannel)}
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            >
              <option value="All">All Sales Channels</option>
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>

            <div className="relative min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search order, customer, challan, rep..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Order &amp; Dates</th>
                <th className="py-3 px-4">Customer &amp; Scope</th>
                <th className="py-3 px-4">Channel &amp; Rep</th>
                <th className="py-3 px-4 text-right">Gross Value</th>
                <th className="py-3 px-4 text-right">Collected / AR</th>
                <th className="py-3 px-4 text-right">Commission</th>
                <th className="py-3 px-4">GL</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No sales orders match the current filter criteria.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const receivable = round2(order.grossAmount - order.collectedAmount);
                  const nextAction = NEXT_STAGE[order.status];
                  const isDeleting = confirmDeleteId === order.id;

                  return (
                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {order.orderNo}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                          {order.orderDate}
                        </div>
                        {order.challanNo && (
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                            Challan {order.challanNo}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top max-w-xs">
                        <div className="font-medium text-slate-900">{order.customerName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                          {order.description}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className="font-medium text-slate-700">{order.channel}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{order.salesRep}</div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatBDT(order.grossAmount)}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                          VAT {order.vatRate}% ({formatCompactBDT(order.vatAmount)})
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        <div className="font-mono text-emerald-700 font-medium tabular-nums">
                          {formatBDT(order.collectedAmount)}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                          AR {formatBDT(receivable)}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono tabular-nums text-slate-700">
                        {formatBDT(order.commissionAmount)}
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <button
                          onClick={() => onOpenRegister(order.revenueGlCode || '4010')}
                          className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                        >
                          {order.revenueGlCode || '4010'}
                        </button>
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <div className={`font-semibold ${STATUS_TEXT_CLASS[order.status]}`}>
                          {order.status}
                        </div>
                        {nextAction && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => handleAdvanceStage(order)}
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
                                await onDeleteSalesOrder(order.id);
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
                              onClick={() =>
                                setTraceDoc({
                                  docType: 'SO',
                                  docRef: order.orderNo,
                                  title: order.customerName,
                                })
                              }
                              title="Trace SO → Challan → Invoice → GL"
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                            >
                              <GitBranch className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingOrder(order);
                                setShowModal(true);
                              }}
                              title="Edit sales order"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(order.id)}
                              title="Delete sales order"
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
        <SalesOrderModal
          initial={editingOrder}
          suggestedOrderNo={suggestedOrderNo}
          customers={state.customers}
          accounts={state.accounts}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingOrder) {
              await onUpdateSalesOrder(editingOrder.id, payload);
            } else {
              await onCreateSalesOrder(payload);
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

interface SalesOrderModalProps {
  initial: SalesOrderRecord | null;
  suggestedOrderNo: string;
  customers: CustomerRecord[];
  accounts: GLAccount[];
  onClose: () => void;
  onSubmit: (payload: Omit<SalesOrderRecord, 'id' | 'updatedAt'>) => Promise<void>;
}

const SalesOrderModal: React.FC<SalesOrderModalProps> = ({
  initial,
  suggestedOrderNo,
  customers,
  accounts,
  onClose,
  onSubmit,
}) => {
  const [orderNo, setOrderNo] = useState(initial?.orderNo || suggestedOrderNo);
  const [orderDate, setOrderDate] = useState(
    initial?.orderDate || new Date().toISOString().slice(0, 10)
  );
  const [deliveryDate, setDeliveryDate] = useState(
    initial?.deliveryDate || new Date().toISOString().slice(0, 10)
  );
  const [customerId, setCustomerId] = useState(initial?.customerId || '');
  const [customerName, setCustomerName] = useState(
    initial?.customerName || customers[0]?.name || ''
  );
  const [channel, setChannel] = useState<SalesChannel>(initial?.channel || 'Direct Project');
  const [salesRep, setSalesRep] = useState(initial?.salesRep || 'Engr. Rafiqul Islam');
  const [description, setDescription] = useState(initial?.description || '');
  const [netAmount, setNetAmount] = useState(String(initial?.netAmount ?? 0));
  const [vatRate, setVatRate] = useState(String(initial?.vatRate ?? 7.5));
  const [collectedAmount, setCollectedAmount] = useState(String(initial?.collectedAmount ?? 0));
  const [commissionAmount, setCommissionAmount] = useState(String(initial?.commissionAmount ?? 0));
  const [revenueGlCode, setRevenueGlCode] = useState(initial?.revenueGlCode || '4010');
  const [challanNo, setChallanNo] = useState(initial?.challanNo || '');
  const [customerPoNo, setCustomerPoNo] = useState(initial?.customerPoNo || '');
  const [tenderRef, setTenderRef] = useState(initial?.tenderRef || '');
  const [creditOverrideReason, setCreditOverrideReason] = useState(initial?.creditOverrideReason || '');
  const [status, setStatus] = useState<SalesOrderStatus>(initial?.status || 'Quotation');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revenueAccounts = useMemo(
    () => accounts.filter((a) => a.category === 'Income'),
    [accounts]
  );

  const numNet = round2(Math.max(0, Number(netAmount) || 0));
  const numVatRate = Math.max(0, Number(vatRate) || 0);
  const calcVat = round2((numNet * numVatRate) / 100);
  const calcGross = round2(numNet + calcVat);

  const handleCustomerPick = (id: string) => {
    setCustomerId(id);
    const found = customers.find((c) => c.id === id);
    if (found) setCustomerName(found.name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderNo.trim() || !customerName.trim()) {
      setError('Order Number and Customer Name are required.');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        orderNo: orderNo.trim().toUpperCase(),
        orderDate,
        deliveryDate,
        customerId,
        customerName: customerName.trim(),
        channel,
        salesRep: salesRep.trim() || 'Engr. Rafiqul Islam',
        description: description.trim() || 'Enterprise Equipment Supply',
        netAmount: numNet,
        vatRate: numVatRate,
        vatAmount: calcVat,
        grossAmount: calcGross,
        collectedAmount: round2(Math.min(calcGross, Math.max(0, Number(collectedAmount) || 0))),
        commissionAmount: round2(Math.max(0, Number(commissionAmount) || 0)),
        revenueGlCode,
        challanNo: challanNo.trim(),
        customerPoNo: customerPoNo.trim() || undefined,
        tenderRef: tenderRef.trim() || undefined,
        creditOverrideReason: creditOverrideReason.trim() || undefined,
        status,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save sales order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            {initial ? `Edit Sales Order ${initial.orderNo}` : 'New Sales & Distribution Order'}
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
              <label className="block font-medium text-slate-700 mb-1">Order Number *</label>
              <input
                type="text"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                required
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Order Date</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Delivery Date</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Select Registered Customer</label>
              <select
                value={customerId}
                onChange={(e) => handleCustomerPick(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                <option value="">-- Custom / Manual Customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Customer Legal Name *</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Sales Channel</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as SalesChannel)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Account Manager / Rep</label>
              <input
                type="text"
                value={salesRep}
                onChange={(e) => setSalesRep(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Delivery Challan #</label>
              <input
                type="text"
                value={challanNo}
                onChange={(e) => setChallanNo(e.target.value)}
                placeholder="DC-25-XXX"
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Scope / Equipment Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 11kV Switchgear Panels & SCADA Commissioning"
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Customer PO / WO No.</label>
              <input
                type="text"
                value={customerPoNo}
                onChange={(e) => setCustomerPoNo(e.target.value)}
                placeholder="CPO-..."
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Tender / Contract Ref</label>
              <input
                type="text"
                value={tenderRef}
                onChange={(e) => setTenderRef(e.target.value)}
                placeholder="TND-..."
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Credit Override Reason</label>
              <input
                type="text"
                value={creditOverrideReason}
                onChange={(e) => setCreditOverrideReason(e.target.value)}
                placeholder="Required if On Hold / Over Limit"
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Net Amount (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">VAT Rate (%)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Collected (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={collectedAmount}
                onChange={(e) => setCollectedAmount(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Commission (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={commissionAmount}
                onChange={(e) => setCommissionAmount(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 flex flex-wrap items-center justify-between gap-3 font-mono tabular-nums">
            <span>Net: {formatBDT(numNet)}</span>
            <span>VAT ({numVatRate}%): {formatBDT(calcVat)}</span>
            <span className="font-bold text-[#2563EB]">Gross Order: {formatBDT(calcGross)}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Revenue GL Account</label>
              <select
                value={revenueGlCode}
                onChange={(e) => setRevenueGlCode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white font-mono"
              >
                {revenueAccounts.map((acc) => (
                  <option key={acc.code} value={acc.code}>
                    {acc.code} — {acc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Order Stage</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SalesOrderStatus)}
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
            <label className="block font-medium text-slate-700 mb-1">Notes</label>
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
              {submitting ? 'Saving...' : initial ? 'Save Changes' : 'Create Sales Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

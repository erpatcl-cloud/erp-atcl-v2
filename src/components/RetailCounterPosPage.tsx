import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Download,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import {
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  LedgerState,
  PosLineItem,
  PosPaymentMethod,
  PosTransaction,
} from '../types/accounting.ts';

interface RetailCounterPosPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onCreatePosSale: (
    payload: Omit<PosTransaction, 'id' | 'receiptNo' | 'updatedAt'>
  ) => Promise<void>;
  onVoidPosSale: (id: string) => Promise<void>;
  onDeletePosSale: (id: string) => Promise<void>;
}

interface CatalogPickItem {
  sku: string;
  name: string;
  source: 'Catalog Products' | 'Spare Parts';
  category: string;
  unitPrice: number;
  stockQty: number;
  unit: string;
}

const PAYMENT_METHODS: Array<{ method: PosPaymentMethod; glCode: string; glLabel: string }> = [
  { method: 'Cash', glCode: '1210', glLabel: 'GL 1210 Cash in Hand' },
  { method: 'Card / POS', glCode: '1240', glLabel: 'GL 1240 SJIBL Settlement' },
  { method: 'bKash / MFS', glCode: '1230', glLabel: 'GL 1230 Al-Arafah Settlement' },
  { method: 'Bank Transfer', glCode: '1240', glLabel: 'GL 1240 SJIBL Transfer' },
];

export const RetailCounterPosPage: React.FC<RetailCounterPosPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onCreatePosSale,
  onVoidPosSale,
  onDeletePosSale,
}) => {
  const transactions = state.posTransactions || [];
  const [catalogFilter, setCatalogFilter] = useState<'All' | 'Catalog Products' | 'Spare Parts'>('All');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [cart, setCart] = useState<PosLineItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [vatRate, setVatRate] = useState<number>(7.5);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('Cash');
  const [cashier, setCashier] = useState('K. Mahmud (Counter 01)');
  const [submitting, setSubmitting] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<PosTransaction | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const catalogItems = useMemo<CatalogPickItem[]>(() => {
    const prods: CatalogPickItem[] = (state.products || [])
      .filter((p) => p.status === 'Active')
      .map((p) => ({
        sku: p.sku,
        name: p.name,
        source: 'Catalog Products',
        category: p.category,
        unitPrice: p.sellingPrice,
        stockQty: p.stockQty,
        unit: p.unit,
      }));
    const spares: CatalogPickItem[] = (state.spareParts || [])
      .filter((sp) => sp.status === 'Active')
      .map((sp) => ({
        sku: sp.partCode,
        name: sp.name,
        source: 'Spare Parts',
        category: sp.category,
        unitPrice: sp.sellingPrice,
        stockQty: sp.stockQty,
        unit: sp.unit,
      }));
    return [...prods, ...spares];
  }, [state.products, state.spareParts]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return catalogItems.filter((item) => {
      if (catalogFilter !== 'All' && item.source !== catalogFilter) return false;
      if (!q) return true;
      return (
        item.sku.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [catalogItems, catalogFilter, catalogSearch]);

  const metrics = useMemo(() => {
    const completed = transactions.filter((t) => t.status === 'Completed');
    const grossSales = round2(completed.reduce((s, t) => s + t.grandTotal, 0));
    const cashSales = round2(
      completed
        .filter((t) => t.paymentMethod === 'Cash')
        .reduce((s, t) => s + t.grandTotal, 0)
    );
    const digitalSales = round2(
      completed
        .filter((t) => t.paymentMethod !== 'Cash')
        .reduce((s, t) => s + t.grandTotal, 0)
    );
    const avgTicket = completed.length > 0 ? round2(grossSales / completed.length) : 0;
    return {
      grossSales,
      cashSales,
      digitalSales,
      receiptCount: completed.length,
      voidedCount: transactions.length - completed.length,
      avgTicket,
    };
  }, [transactions]);

  const cartTotals = useMemo(() => {
    const subtotal = round2(cart.reduce((s, it) => s + it.lineTotal, 0));
    const discount = round2(Math.min(subtotal, Math.max(0, Number(discountAmount) || 0)));
    const taxable = round2(Math.max(0, subtotal - discount));
    const vat = round2((taxable * vatRate) / 100);
    const grandTotal = round2(taxable + vat);
    return { subtotal, discount, taxable, vat, grandTotal };
  }, [cart, discountAmount, vatRate]);

  const activePaymentMeta =
    PAYMENT_METHODS.find((m) => m.method === paymentMethod) || PAYMENT_METHODS[0];

  const handleAddToCart = (item: CatalogPickItem) => {
    setCartError(null);
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.sku === item.sku);
      if (idx >= 0) {
        const next = [...prev];
        const qty = next[idx].qty + 1;
        next[idx] = { ...next[idx], qty, lineTotal: round2(qty * next[idx].unitPrice) };
        return next;
      }
      return [
        ...prev,
        {
          sku: item.sku,
          name: item.name,
          qty: 1,
          unitPrice: item.unitPrice,
          lineTotal: item.unitPrice,
        },
      ];
    });
  };

  const handleAdjustQty = (sku: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) => {
          if (it.sku !== sku) return it;
          const qty = it.qty + delta;
          if (qty <= 0) return null;
          return { ...it, qty, lineTotal: round2(qty * it.unitPrice) };
        })
        .filter((it): it is PosLineItem => it !== null)
    );
  };

  const handleCompleteSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) {
      setCartError('Add at least one item from the catalog to complete a counter sale.');
      return;
    }
    try {
      setSubmitting(true);
      setCartError(null);
      await onCreatePosSale({
        saleDate: new Date().toISOString().slice(0, 10),
        customerName: customerName.trim() || 'Walk-in Counter Customer',
        customerPhone: customerPhone.trim(),
        paymentMethod,
        settlementGlCode: activePaymentMeta.glCode,
        items: cart,
        subtotal: cartTotals.subtotal,
        discountAmount: cartTotals.discount,
        vatRate,
        vatAmount: cartTotals.vat,
        grandTotal: cartTotals.grandTotal,
        cashier: cashier.trim() || 'Counter 01 (Dhaka)',
        status: 'Completed',
      });
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setDiscountAmount('0');
    } catch (err) {
      setCartError(err instanceof Error ? err.message : 'Unable to record POS receipt.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Retail_Counter_POS_${state.config.fiscalPeriod}.csv`,
      [
        'Receipt No',
        'Date',
        'Customer',
        'Phone',
        'Payment Method',
        'Settlement GL',
        'Items Count',
        'Subtotal (BDT)',
        'Discount (BDT)',
        'VAT %',
        'VAT (BDT)',
        'Grand Total (BDT)',
        'Cashier',
        'Status',
      ],
      transactions.map((t) => [
        t.receiptNo,
        t.saleDate,
        t.customerName,
        t.customerPhone || '—',
        t.paymentMethod,
        t.settlementGlCode,
        t.items.reduce((s, i) => s + i.qty, 0),
        t.subtotal,
        t.discountAmount,
        t.vatRate,
        t.vatAmount,
        t.grandTotal,
        t.cashier,
        t.status,
      ])
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-[var(--font-display)]">
            Retail Counter POS
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Walk-in hardware &amp; spare parts billing counter with instant stock deduction and GL settlement mapping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenRegister('4010')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <span>Revenue GL 4010</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#2563EB]" />
          </button>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Receipts</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Counter Gross Sales</span>
            <Store className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.grossSales)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Completed counter receipts
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Cash Drawer Total</span>
            <button
              onClick={() => onOpenRegister('1210')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1210</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-700 font-mono tabular-nums">
            {formatBDT(metrics.cashSales)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Physical cash drawer collection</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Card / MFS / Bank</span>
            <button
              onClick={() => onOpenRegister('1240')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1230/1240</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-[#2563EB] font-mono tabular-nums">
            {formatBDT(metrics.digitalSales)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Digital &amp; bank clearing settlements</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Receipts Issued</span>
            <Receipt className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.receiptCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Avg Ticket {formatCompactBDT(metrics.avgTicket)}
            {metrics.voidedCount > 0 ? ` · ${metrics.voidedCount} voided` : ''}
          </div>
        </div>
      </div>

      {/* Split Live POS Counter Terminal */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Catalog Picker */}
        <div className="xl:col-span-7 bg-white border border-[#001F60] rounded-lg overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
              {(['All', 'Catalog Products', 'Spare Parts'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCatalogFilter(tab)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    catalogFilter === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="relative sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Scan SKU or search item..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto ledger-scroll">
            {filteredCatalog.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No matching items found in active catalog or spare parts bins.
              </div>
            ) : (
              filteredCatalog.map((item) => (
                <div
                  key={`${item.source}-${item.sku}`}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#2563EB]">
                        {item.sku}
                      </span>
                      <span className="text-[11px] text-slate-400">·</span>
                      <span className="text-[11px] text-slate-500">{item.category}</span>
                    </div>
                    <div className="text-xs font-medium text-slate-900 truncate mt-0.5">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      Stock: {item.stockQty} {item.unit} ({item.source === 'Spare Parts' ? 'Workshop Bin' : 'Main Stock'})
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-xs font-semibold text-slate-900">
                        {formatBDT(item.unitPrice)}
                      </div>
                      <div className="text-[10px] text-slate-400">per {item.unit}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddToCart(item)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Live Counter Cart & Checkout */}
        <form
          onSubmit={handleCompleteSale}
          className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-4 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <ShoppingCart className="w-4 h-4 text-[#2563EB]" />
              <span>Active Counter Cart</span>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
              >
                Clear Cart
              </button>
            )}
          </div>

          {cartError && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-md">
              {cartError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Walk-in / Counter Customer
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in Counter Customer"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Phone Number
              </label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+880 17XX-XXXXXX"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          {/* Cart Items */}
          <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-48 overflow-y-auto ledger-scroll">
            {cart.length === 0 ? (
              <div className="p-6 text-center text-slate-400">
                Select items on the left to build a counter receipt.
              </div>
            ) : (
              cart.map((line) => (
                <div key={line.sku} className="p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{line.name}</div>
                    <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                      {line.sku} · {formatBDT(line.unitPrice)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="inline-flex items-center border border-slate-200 rounded">
                      <button
                        type="button"
                        onClick={() => handleAdjustQty(line.sku, -1)}
                        className="p-1 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2 font-mono font-semibold tabular-nums">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => handleAdjustQty(line.sku, 1)}
                        className="p-1 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="w-24 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatBDT(line.lineTotal)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Discount, VAT, Cashier */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Discount (BDT)
              </label>
              <input
                type="number"
                min="0"
                step="10"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">VAT Rate</label>
              <select
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md bg-white font-mono"
              >
                <option value={0}>0%</option>
                <option value={7.5}>7.5%</option>
                <option value={15}>15%</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Cashier</label>
              <input
                type="text"
                value={cashier}
                onChange={(e) => setCashier(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-slate-600">Settlement Method</span>
              <span className="text-[11px] font-mono text-[#2563EB]">
                {activePaymentMeta.glLabel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {PAYMENT_METHODS.map((pm) => {
                const active = paymentMethod === pm.method;
                return (
                  <button
                    key={pm.method}
                    type="button"
                    onClick={() => setPaymentMethod(pm.method)}
                    className={`px-2.5 py-2 text-xs font-medium rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[#2563EB] bg-[#2563EB]/5 text-[#2563EB]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {pm.method}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Totals Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1.5 font-mono tabular-nums">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatBDT(cartTotals.subtotal)}</span>
            </div>
            {cartTotals.discount > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>Discount</span>
                <span>-{formatBDT(cartTotals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>VAT ({vatRate}%)</span>
              <span>{formatBDT(cartTotals.vat)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
              <span>Grand Total</span>
              <span className="text-[#2563EB]">{formatBDT(cartTotals.grandTotal)}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || cart.length === 0 || busyAction !== null}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {submitting
                ? 'Issuing Counter Receipt...'
                : `Complete Counter Sale (${formatBDT(cartTotals.grandTotal)})`}
            </span>
          </button>
        </form>
      </div>

      {/* Recent Counter Receipts */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Recent Counter Receipts</h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {transactions.length} receipt(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Receipt #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Items</th>
                <th className="py-3 px-4">Payment &amp; GL</th>
                <th className="py-3 px-4 text-right">Grand Total</th>
                <th className="py-3 px-4">Cashier</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {transactions.map((tx) => {
                const totalUnits = tx.items.reduce((s, it) => s + it.qty, 0);
                const isDeleting = confirmDeleteId === tx.id;
                return (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      tx.status === 'Voided' ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums">
                      <div className="font-semibold text-slate-900">{tx.receiptNo}</div>
                      <div className="text-[11px] text-slate-500">{tx.saleDate}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{tx.customerName}</div>
                      {tx.customerPhone && (
                        <div className="text-[11px] font-mono text-slate-500">
                          {tx.customerPhone}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-mono tabular-nums">
                      {tx.items.length} SKU ({totalUnits} units)
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-medium text-slate-700">{tx.paymentMethod}</div>
                      <button
                        onClick={() => onOpenRegister(tx.settlementGlCode)}
                        className="text-[11px] font-mono text-[#2563EB] hover:underline cursor-pointer"
                      >
                        GL {tx.settlementGlCode}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-semibold text-slate-900 tabular-nums">
                      {formatBDT(tx.grandTotal)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{tx.cashier}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          tx.status === 'Completed' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {isDeleting ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={async () => {
                              await onDeletePosSale(tx.id);
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
                            onClick={() => setViewingReceipt(tx)}
                            className="px-2 py-1 text-[11px] font-medium text-[#2563EB] hover:bg-slate-100 rounded cursor-pointer"
                          >
                            Receipt
                          </button>
                          {tx.status === 'Completed' && (
                            <button
                              disabled={busyAction !== null}
                              onClick={() => onVoidPosSale(tx.id)}
                              title="Void receipt"
                              className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded cursor-pointer"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmDeleteId(tx.id)}
                            title="Delete receipt"
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receipt Preview Modal */}
      {viewingReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  Counter Receipt {viewingReceipt.receiptNo}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {state.config.organizationName} · {viewingReceipt.saleDate}
                </div>
              </div>
              <button
                onClick={() => setViewingReceipt(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-100">
                <div>
                  <div className="text-slate-400">Customer</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {viewingReceipt.customerName}
                  </div>
                  {viewingReceipt.customerPhone && (
                    <div className="font-mono text-slate-500">{viewingReceipt.customerPhone}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-slate-400">Payment &amp; Settlement</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {viewingReceipt.paymentMethod} (GL {viewingReceipt.settlementGlCode})
                  </div>
                  <div className="text-slate-500">{viewingReceipt.cashier}</div>
                </div>
              </div>

              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-1.5">Item</th>
                    <th className="py-1.5 text-right">Qty</th>
                    <th className="py-1.5 text-right">Rate</th>
                    <th className="py-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {viewingReceipt.items.map((item, idx) => (
                    <tr key={`${item.sku}-${idx}`}>
                      <td className="py-2 pr-2 font-sans">
                        <div className="font-medium text-slate-900">{item.name}</div>
                        <div className="text-[11px] font-mono text-slate-400">{item.sku}</div>
                      </td>
                      <td className="py-2 text-right">{item.qty}</td>
                      <td className="py-2 text-right">{formatBDT(item.unitPrice)}</td>
                      <td className="py-2 text-right font-semibold text-slate-900">
                        {formatBDT(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1 font-mono tabular-nums">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{formatBDT(viewingReceipt.subtotal)}</span>
                </div>
                {viewingReceipt.discountAmount > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Discount</span>
                    <span>-{formatBDT(viewingReceipt.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>VAT ({viewingReceipt.vatRate}%)</span>
                  <span>{formatBDT(viewingReceipt.vatAmount)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
                  <span>Total Paid</span>
                  <span className="text-[#2563EB]">{formatBDT(viewingReceipt.grandTotal)}</span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setViewingReceipt(null)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                >
                  Close Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

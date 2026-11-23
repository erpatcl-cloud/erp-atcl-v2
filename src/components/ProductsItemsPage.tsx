import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Eye,
  Package,
  Pencil,
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
  AccountStatus,
  GLAccount,
  LedgerState,
  ProductItem,
  ProductItemType,
  SystemConfig,
} from '../types/accounting.ts';
import { SearchableSelect, type SearchableOption } from './common/SearchableSelect.tsx';

interface ProductsItemsPageProps {
  state: LedgerState;
  busyAction: string | null;
  isAdmin?: boolean;
  onOpenRegister: (code: string) => void;
  onCreateProduct: (payload: Omit<ProductItem, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateProduct: (
    id: string,
    payload: Partial<Omit<ProductItem, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onUpdateConfig?: (payload: Partial<SystemConfig>) => Promise<void>;
}

const DEFAULT_INVENTORY_TYPES = [
  'Inventory',
  'Service',
  'Non-Inventory',
  'Accessories',
  'Spare Parts',
];

const DEFAULT_CATEGORIES = [
  'Accessories',
  'CNC Machinery',
  'Construction Tools',
  'Electrical',
  'Engineering Education',
  'Laboratory',
  'Lifting Equipment',
  'Measuring Tools',
  'Surveying',
];

const DEFAULT_UOMS = ['Unit', 'Unit/Set', 'Pcs/Set', 'Pcs/Meter'];

const ORIGIN_COUNTRIES = [
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

function mergeUniqueOptions(defaults: string[], saved: string[] = [], existing: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const val of [...defaults, ...saved, ...existing]) {
    const trimmed = String(val || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return Array.from(seen.values());
}

function generateNextSku(products: ProductItem[]): string {
  const existingSkus = new Set(products.map((p) => p.sku.trim().toUpperCase()));
  let maxNum = 1000;
  for (const p of products) {
    const match = /(\d+)$/.exec(p.sku.trim());
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > maxNum && n < 900000) {
        maxNum = n;
      }
    }
  }
  let candidateNum = Math.max(maxNum + 1, products.length + 1001);
  let candidate = `ATCL-PRD-${candidateNum}`;
  while (existingSkus.has(candidate)) {
    candidateNum += 1;
    candidate = `ATCL-PRD-${candidateNum}`;
  }
  return candidate;
}

const ITEM_TYPES: Array<'All' | ProductItemType> = ['All', 'Inventory', 'Service', 'Non-Inventory'];
const PAGE_SIZE = 10;

export const ProductsItemsPage: React.FC<ProductsItemsPageProps> = ({
  state,
  busyAction,
  isAdmin = false,
  onOpenRegister,
  onCreateProduct,
  onUpdateProduct,
  onDeleteProduct,
  onUpdateConfig,
}) => {
  const [typeFilter, setTypeFilter] = useState<'All' | ProductItemType>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewingProduct, setViewingProduct] = useState<ProductItem | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductItem | null>(null);
  const [accessDeniedMsg, setAccessDeniedMsg] = useState<string | null>(null);

  const products = state.products || [];

  const glInventoryBalance = useMemo(() => {
    const summary = computeGLSummary(state);
    return summary.find((r) => r.code === '1110')?.closingBalance ?? 0;
  }, [state]);

  const metrics = useMemo(() => {
    const activeCount = products.filter((p) => p.status === 'Active').length;
    const inventoryItems = products.filter((p) => p.itemType === 'Inventory');
    const serviceCount = products.filter((p) => p.itemType === 'Service').length;
    const nonInvCount = products.filter((p) => p.itemType === 'Non-Inventory').length;

    const totalStockValue = round2(
      inventoryItems.reduce((sum, p) => sum + round2(p.stockQty * p.unitCost), 0)
    );
    const totalUnits = inventoryItems.reduce((sum, p) => sum + p.stockQty, 0);
    const lowStockCount = inventoryItems.filter(
      (p) => p.status === 'Active' && p.stockQty <= p.reorderLevel
    ).length;

    const validPriced = products.filter((p) => p.sellingPrice > 0);
    const avgMarginPct =
      validPriced.length > 0
        ? validPriced.reduce(
            (sum, p) => sum + ((p.sellingPrice - p.unitCost) / p.sellingPrice) * 100,
            0
          ) / validPriced.length
        : 0;

    const glVariance = round2(totalStockValue - glInventoryBalance);
    const isReconciled = Math.abs(glVariance) < 0.01;

    return {
      total: products.length,
      activeCount,
      inventoryCount: inventoryItems.length,
      serviceCount,
      nonInvCount,
      totalStockValue,
      totalUnits,
      lowStockCount,
      avgMarginPct,
      glVariance,
      isReconciled,
    };
  }, [products, glInventoryBalance]);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort()],
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'All' && p.itemType !== typeFilter) return false;
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      if (lowStockOnly && !(p.itemType === 'Inventory' && p.stockQty <= p.reorderLevel)) {
        return false;
      }
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.modelReference || '').toLowerCase().includes(q) ||
        (p.manufacturer || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.originCountry || '').toLowerCase().includes(q) ||
        (p.shortDetails || '').toLowerCase().includes(q) ||
        p.hsnCode.toLowerCase().includes(q)
      );
    });
  }, [products, typeFilter, categoryFilter, lowStockOnly, searchQuery]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Products_${state.config.fiscalPeriod}.csv`,
      [
        'Product ID',
        'SKU',
        'Product Name',
        'Inventory',
        'Category',
        'Model / Reference',
        'Manufacturer',
        'Brand',
        'Origin Country',
        'Unit/Kg',
        'Short Product Details',
        'Status',
        'Updated At',
      ],
      filteredProducts.map((p) => [
        p.id,
        p.sku,
        p.name,
        p.itemType,
        p.category,
        p.modelReference || '',
        p.manufacturer || '',
        p.brand || '',
        p.originCountry || '',
        p.unit,
        p.shortDetails || '',
        p.status,
        p.updatedAt,
      ])
    );
  };

  const openCreateModal = () => {
    if (!isAdmin) {
      setAccessDeniedMsg('Access Denied: Only administrators can add new products.');
      return;
    }
    setAccessDeniedMsg(null);
    setEditingProduct(null);
    setShowModal(true);
  };

  const openEditModal = (item: ProductItem) => {
    if (!isAdmin) {
      setAccessDeniedMsg('Access Denied: Only administrators can edit product records.');
      return;
    }
    setAccessDeniedMsg(null);
    setEditingProduct(item);
    setShowModal(true);
  };

  const openDeleteModal = (item: ProductItem) => {
    if (!isAdmin) {
      setAccessDeniedMsg('Access Denied: Only administrators can delete product records.');
      return;
    }
    setAccessDeniedMsg(null);
    setDeleteTarget(item);
  };

  const handleToggleStatus = async (item: ProductItem) => {
    if (!isAdmin) {
      setAccessDeniedMsg('Access Denied: Only administrators can change product status.');
      return;
    }
    try {
      await onUpdateProduct(item.id, {
        status: item.status === 'Active' ? 'Inactive' : 'Active',
      });
    } catch (err) {
      setAccessDeniedMsg(err instanceof Error ? err.message : 'Access Denied.');
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, categoryFilter, lowStockOnly, searchQuery]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const actionParam = params.get('action')?.toLowerCase();
    if (!isAdmin && (actionParam === 'edit' || actionParam === 'delete' || actionParam === 'create')) {
      setAccessDeniedMsg('Access Denied: Administrator privileges are required for this action.');
    }
  }, [isAdmin]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedProducts = useMemo(
    () => filteredProducts.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredProducts, startIndex]
  );

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxButtons = Math.min(totalPages, 4);
    let start = Math.max(1, safePage - 1);
    if (start + maxButtons - 1 > totalPages) {
      start = Math.max(1, totalPages - maxButtons + 1);
    }
    for (let i = start; i < start + maxButtons; i++) {
      pages.push(i);
    }
    return pages;
  }, [safePage, totalPages]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
            Products &amp; Items
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Master catalog for automation hardware, spares, engineering services, and GL register mapping.
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
          {isAdmin && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Product / Item</span>
            </button>
          )}
        </div>
      </div>

      {accessDeniedMsg && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span>{accessDeniedMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setAccessDeniedMsg(null)}
            className="text-red-700 hover:text-red-900 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="text-xs font-medium text-slate-500">Total Catalog SKUs</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {metrics.total}
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold tabular-nums">
              {metrics.activeCount} active
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {metrics.inventoryCount} Inventory · {metrics.serviceCount} Service · {metrics.nonInvCount} License
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Inventory Sub-Ledger Value</span>
            <button
              onClick={() => onOpenRegister('1110')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1110</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.totalStockValue)}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {metrics.isReconciled ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-emerald-700 font-medium">
                  Reconciled to GL 1110 ({formatBDT(glInventoryBalance)})
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-700 font-medium font-mono tabular-nums">
                  Variance vs GL 1110: {formatBDT(metrics.glVariance)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-indigo-600 rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="text-xs font-medium text-slate-500">Average Gross Margin</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.avgMarginPct.toFixed(1)}%
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            {metrics.totalUnits} stocked units across {metrics.inventoryCount} hardware SKUs
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-amber-500 rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Reorder Threshold Alerts</span>
            {metrics.lowStockCount > 0 && (
              <button
                onClick={() => setLowStockOnly((v) => !v)}
                className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
              >
                {lowStockOnly ? 'Show All' : 'Filter Alerts'}
              </button>
            )}
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              metrics.lowStockCount > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {metrics.lowStockCount}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {metrics.lowStockCount > 0
              ? 'Inventory items at or below minimum stock level'
              : 'All tracked hardware lines above reorder point'}
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200/80">
            {ITEM_TYPES.map((t) => {
              const active = typeFilter === t;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-[#2563EB]"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'All' ? 'All Categories' : cat}
              </option>
            ))}
          </select>

          <button
            onClick={() => setLowStockOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              lowStockOnly
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Low Stock Only ({metrics.lowStockCount})</span>
          </button>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search SKU, product name, category, model, manufacturer, brand, origin..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Catalog Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#001F60] text-white text-xs font-bold">
                <th className="py-2.5 px-3 border border-[#001F60] text-center whitespace-nowrap">Sl No.</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Product ID / SKU</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Product Name</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Inventory</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Category</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Model / Reference</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Manufacturer / Brand</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Origin Country</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">Unit/Kg</th>
                <th className="py-2.5 px-3 border border-[#001F60] min-w-[210px] whitespace-nowrap">Short Product Details</th>
                <th className="py-2.5 px-3 border border-[#001F60] whitespace-nowrap">GL Mapping</th>
                <th className="py-2.5 px-3 border border-[#001F60] text-center whitespace-nowrap">Status</th>
                <th className="py-2.5 px-3 border border-[#001F60] text-center whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white text-xs text-slate-800">
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 px-4 text-center text-slate-500 border border-[#001F60]/35">
                    <Package className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <div className="text-sm font-medium text-slate-700">No products found</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {products.length === 0
                        ? 'No products exist in the catalog yet.'
                        : 'Try adjusting your search or filter criteria.'}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((item, idx) => {
                  const rowNum = startIndex + idx + 1;
                  const isInv = item.itemType === 'Inventory';

                  return (
                    <tr
                      key={item.id}
                      className="bg-white hover:bg-blue-50/40 transition-colors"
                    >
                      <td className="py-2 px-3 border border-[#001F60]/35 text-center font-mono font-semibold text-slate-700 whitespace-nowrap">
                        {rowNum}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 font-mono font-semibold text-[#001F60] whitespace-nowrap">
                        <div>{item.id}</div>
                        <div className="text-[11px] font-normal text-slate-500">{item.sku}</div>
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 min-w-[180px]">
                        <div className="font-semibold text-slate-900 leading-snug">{item.name}</div>
                        {item.sellingPrice > 0 && (
                          <div className="text-[11px] text-slate-500 font-mono">
                            Cost: {formatBDT(item.unitCost)} · Sell: {formatBDT(item.sellingPrice)}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 whitespace-nowrap text-slate-700">
                        {item.itemType}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium">
                          {item.category}
                        </span>
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 font-mono text-slate-700 whitespace-nowrap">
                        {item.modelReference || '—'}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 min-w-[140px]">
                        <div className="font-medium text-slate-900">{item.manufacturer || '—'}</div>
                        {item.brand && item.brand !== item.manufacturer && (
                          <div className="text-[11px] text-slate-500">{item.brand}</div>
                        )}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 whitespace-nowrap text-slate-600">
                        {item.originCountry || '—'}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 whitespace-nowrap text-slate-700">
                        <div>{item.unit}</div>
                        {isInv && item.stockQty > 0 && (
                          <div className="text-[11px] font-mono text-slate-500">Qty: {item.stockQty}</div>
                        )}
                      </td>
                      <td
                        className="py-2 px-3 border border-[#001F60]/35 max-w-[230px]"
                        title={item.shortDetails || ''}
                      >
                        <div className="truncate text-slate-600">{item.shortDetails || '—'}</div>
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {item.inventoryGlCode && (
                            <button
                              type="button"
                              onClick={() => onOpenRegister(item.inventoryGlCode)}
                              title="Open Inventory GL Register"
                              className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] border border-blue-200/80 font-semibold hover:bg-blue-100 cursor-pointer"
                            >
                              {item.inventoryGlCode}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenRegister(item.revenueGlCode)}
                            title="Open Revenue GL Register"
                            className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 cursor-pointer"
                          >
                            {item.revenueGlCode}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenRegister(item.cogsGlCode)}
                            title="Open Cost / Expense GL Register"
                            className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 cursor-pointer"
                          >
                            {item.cogsGlCode}
                          </button>
                        </div>
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 text-center whitespace-nowrap">
                        {isAdmin ? (
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => handleToggleStatus(item)}
                            title="Click to toggle status"
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                              item.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            {item.status}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                              item.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {item.status}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 border border-[#001F60]/35 text-center whitespace-nowrap">
                        <div className="inline-flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingProduct(item)}
                            title="View Product Details"
                            aria-label={`View ${item.name}`}
                            className="p-1.5 rounded text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(item)}
                                title="Edit Product"
                                aria-label={`Edit ${item.name}`}
                                className="p-1.5 rounded text-orange-500 hover:bg-orange-50 hover:text-orange-600 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteModal(item)}
                                title="Delete Product"
                                aria-label={`Delete ${item.name}`}
                                className="p-1.5 rounded text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-4 py-3 bg-slate-50 border-t border-[#001F60]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            {filteredProducts.length > 0 ? (
              <>
                Showing <span className="font-semibold text-slate-900">{startIndex + 1}</span> to{' '}
                <span className="font-semibold text-slate-900">
                  {Math.min(startIndex + PAGE_SIZE, filteredProducts.length)}
                </span>{' '}
                of <span className="font-semibold text-slate-900">{filteredProducts.length}</span> products
              </>
            ) : (
              'Showing 0 products'
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500 mr-1 font-medium">Page</span>
            {pageNumbers.map((pageNum) => (
              <button
                key={pageNum}
                type="button"
                onClick={() => setCurrentPage(pageNum)}
                className={`px-2.5 py-1 rounded border text-xs font-semibold transition-colors cursor-pointer ${
                  safePage === pageNum
                    ? 'bg-[#001F60] text-white border-[#001F60]'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {pageNum}
              </button>
            ))}
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Read-Only Product View Modal */}
      {viewingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 bg-[#001F60] text-white flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-blue-200 font-semibold">
                  Product Details (Read-Only)
                </div>
                <h3 className="text-base font-bold mt-0.5">{viewingProduct.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingProduct(null)}
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-400 font-medium">Product ID / SKU</div>
                <div className="font-mono font-semibold text-slate-900 mt-0.5">
                  {viewingProduct.id} / {viewingProduct.sku}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Inventory Type</div>
                <div className="font-semibold text-slate-900 mt-0.5">{viewingProduct.itemType}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Category</div>
                <div className="font-semibold text-slate-900 mt-0.5">{viewingProduct.category}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Model / Reference</div>
                <div className="font-mono text-slate-900 mt-0.5">{viewingProduct.modelReference || '—'}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Manufacturer / Brand</div>
                <div className="text-slate-900 mt-0.5">
                  {viewingProduct.manufacturer || '—'}
                  {viewingProduct.brand ? ` (${viewingProduct.brand})` : ''}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Origin Country</div>
                <div className="text-slate-900 mt-0.5">{viewingProduct.originCountry || '—'}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Unit/Kg & Stock</div>
                <div className="text-slate-900 mt-0.5">
                  {viewingProduct.unit} · Stock: {viewingProduct.stockQty}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Unit Cost / Selling Price</div>
                <div className="font-mono text-slate-900 mt-0.5">
                  {formatBDT(viewingProduct.unitCost)} / {formatBDT(viewingProduct.sellingPrice)}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">GL Mapping (Inv / Rev / COGS)</div>
                <div className="font-mono text-slate-900 mt-0.5">
                  {[viewingProduct.inventoryGlCode || '—', viewingProduct.revenueGlCode, viewingProduct.cogsGlCode].join(' · ')}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Status</div>
                <div className="mt-0.5">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                      viewingProduct.status === 'Active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {viewingProduct.status}
                  </span>
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-slate-400 font-medium">Short Product Details</div>
                <div className="text-slate-700 mt-1 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {viewingProduct.shortDetails || 'No description provided.'}
                </div>
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingProduct(null)}
                className="px-4 py-2 rounded-lg bg-[#001F60] text-white text-xs font-semibold hover:bg-[#001F60]/90 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Confirm Product Deletion</h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-2">
              <p>
                Are you sure you want to permanently delete{' '}
                <span className="font-bold text-slate-900">{deleteTarget.name}</span>{' '}
                (<span className="font-mono">{deleteTarget.sku}</span>)?
              </p>
              <p className="text-slate-500">This action cannot be undone.</p>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  try {
                    await onDeleteProduct(deleteTarget.id);
                    setDeleteTarget(null);
                  } catch (err) {
                    setAccessDeniedMsg(err instanceof Error ? err.message : 'Access Denied.');
                    setDeleteTarget(null);
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && isAdmin && (
        <ProductFormModal
          accounts={state.accounts}
          products={products}
          config={state.config}
          initial={editingProduct}
          busy={busyAction !== null}
          onClose={() => setShowModal(false)}
          onUpdateConfig={onUpdateConfig}
          onSubmit={async (payload) => {
            if (editingProduct) {
              await onUpdateProduct(editingProduct.id, payload);
            } else {
              await onCreateProduct(payload);
            }
          }}
        />
      )}
    </div>
  );
};

interface ProductFormModalProps {
  accounts: GLAccount[];
  products: ProductItem[];
  config: SystemConfig;
  initial: ProductItem | null;
  busy: boolean;
  onClose: () => void;
  onUpdateConfig?: (payload: Partial<SystemConfig>) => Promise<void>;
  onSubmit: (payload: Omit<ProductItem, 'id' | 'updatedAt'>) => Promise<void>;
}

type AddOptionTarget = 'type' | 'category' | 'unit' | null;

const ProductFormModal: React.FC<ProductFormModalProps> = ({
  accounts,
  products,
  config,
  initial,
  busy,
  onClose,
  onUpdateConfig,
  onSubmit,
}) => {
  const [sku, setSku] = useState(() => initial?.sku ?? generateNextSku(products));
  const [name, setName] = useState(initial?.name ?? '');
  const [itemType, setItemType] = useState<ProductItemType>(initial?.itemType ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [hsnCode, setHsnCode] = useState(initial?.hsnCode ?? '');
  const [unitCost, setUnitCost] = useState(String(initial?.unitCost ?? ''));
  const [sellingPrice, setSellingPrice] = useState(String(initial?.sellingPrice ?? ''));
  const [stockQty, setStockQty] = useState(String(initial?.stockQty ?? '0'));
  const [reorderLevel, setReorderLevel] = useState(String(initial?.reorderLevel ?? '2'));
  const [inventoryGlCode, setInventoryGlCode] = useState(initial?.inventoryGlCode ?? '1110');
  const [revenueGlCode, setRevenueGlCode] = useState(initial?.revenueGlCode ?? '4010');
  const [cogsGlCode, setCogsGlCode] = useState(initial?.cogsGlCode ?? '5010');
  const [modelReference, setModelReference] = useState(initial?.modelReference ?? '');
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [originCountry, setOriginCountry] = useState(initial?.originCountry ?? '');
  const [shortDetails, setShortDetails] = useState(initial?.shortDetails ?? '');
  const [status, setStatus] = useState<AccountStatus>(initial?.status ?? 'Active');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Dynamic dropdown lists
  const [localTypes, setLocalTypes] = useState<string[]>(() =>
    mergeUniqueOptions(
      DEFAULT_INVENTORY_TYPES,
      config.productTypes,
      products.map((p) => p.itemType)
    )
  );
  const [localCategories, setLocalCategories] = useState<string[]>(() =>
    mergeUniqueOptions(
      DEFAULT_CATEGORIES,
      config.productCategories,
      products.map((p) => p.category)
    )
  );
  const [localUnits, setLocalUnits] = useState<string[]>(() =>
    mergeUniqueOptions(
      DEFAULT_UOMS,
      config.productUnits,
      products.map((p) => p.unit)
    )
  );

  // Reusable "Add New" option modal state
  const [addTarget, setAddTarget] = useState<AddOptionTarget>(null);
  const [newOptionValue, setNewOptionValue] = useState('');
  const [addOptionError, setAddOptionError] = useState<string | null>(null);
  const [savingOption, setSavingOption] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const isDirty = useMemo(() => {
    if (initial) {
      return (
        name !== initial.name ||
        itemType !== initial.itemType ||
        category !== initial.category ||
        unit !== initial.unit ||
        modelReference !== (initial.modelReference ?? '') ||
        manufacturer !== (initial.manufacturer ?? '') ||
        originCountry !== (initial.originCountry ?? '') ||
        shortDetails !== (initial.shortDetails ?? '') ||
        inventoryGlCode !== (initial.inventoryGlCode ?? '1110') ||
        revenueGlCode !== (initial.revenueGlCode ?? '4010') ||
        cogsGlCode !== (initial.cogsGlCode ?? '5010') ||
        status !== initial.status
      );
    }
    return Boolean(
      name.trim() ||
        modelReference.trim() ||
        manufacturer.trim() ||
        originCountry.trim() ||
        shortDetails.trim() ||
        unitCost.trim() ||
        sellingPrice.trim()
    );
  }, [
    initial,
    name,
    itemType,
    category,
    unit,
    modelReference,
    manufacturer,
    originCountry,
    shortDetails,
    inventoryGlCode,
    revenueGlCode,
    cogsGlCode,
    status,
    unitCost,
    sellingPrice,
  ]);

  const typeOptions: SearchableOption[] = useMemo(
    () => localTypes.map((t) => ({ value: t, label: t })),
    [localTypes]
  );
  const categoryOptions: SearchableOption[] = useMemo(
    () => localCategories.map((c) => ({ value: c, label: c })),
    [localCategories]
  );
  const unitOptions: SearchableOption[] = useMemo(
    () => localUnits.map((u) => ({ value: u, label: u })),
    [localUnits]
  );
  const countryOptions: SearchableOption[] = useMemo(() => {
    const merged = mergeUniqueOptions(ORIGIN_COUNTRIES, originCountry ? [originCountry] : []);
    return merged.map((c) => ({ value: c, label: c }));
  }, [originCountry]);

  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.category === 'Asset'),
    [accounts]
  );
  const incomeAccounts = useMemo(
    () => accounts.filter((a) => a.category === 'Income'),
    [accounts]
  );
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.category === 'Expense'),
    [accounts]
  );

  const allGlOptions: SearchableOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.code,
        label: `${a.code} — ${a.name}`,
        sublabel: a.category,
      })),
    [accounts]
  );
  const assetGlOptions: SearchableOption[] = useMemo(
    () =>
      (assetAccounts.length > 0 ? assetAccounts : accounts).map((a) => ({
        value: a.code,
        label: `${a.code} — ${a.name}`,
      })),
    [assetAccounts, accounts]
  );
  const incomeGlOptions: SearchableOption[] = useMemo(
    () =>
      (incomeAccounts.length > 0 ? incomeAccounts : accounts).map((a) => ({
        value: a.code,
        label: `${a.code} — ${a.name}`,
      })),
    [incomeAccounts, accounts]
  );
  const expenseGlOptions: SearchableOption[] = useMemo(
    () =>
      (expenseAccounts.length > 0 ? expenseAccounts : accounts).map((a) => ({
        value: a.code,
        label: `${a.code} — ${a.name}`,
      })),
    [expenseAccounts, accounts]
  );

  const numCost = Number(unitCost) || 0;
  const numSell = Number(sellingPrice) || 0;
  const previewMargin = numSell > 0 ? ((numSell - numCost) / numSell) * 100 : 0;

  const handleOpenAddOption = (target: AddOptionTarget) => {
    setAddTarget(target);
    setNewOptionValue('');
    setAddOptionError(null);
  };

  const handleSaveNewOption = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newOptionValue.trim();
    if (!cleaned) {
      setAddOptionError('Please enter a name.');
      return;
    }

    const currentList =
      addTarget === 'type'
        ? localTypes
        : addTarget === 'category'
          ? localCategories
          : localUnits;

    if (currentList.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      setAddOptionError(`"${cleaned}" already exists.`);
      return;
    }

    const nextList = [...currentList, cleaned];
    setSavingOption(true);
    setAddOptionError(null);
    try {
      if (onUpdateConfig) {
        if (addTarget === 'type') {
          await onUpdateConfig({ productTypes: nextList });
        } else if (addTarget === 'category') {
          await onUpdateConfig({ productCategories: nextList });
        } else if (addTarget === 'unit') {
          await onUpdateConfig({ productUnits: nextList });
        }
      }

      if (addTarget === 'type') {
        setLocalTypes(nextList);
        setItemType(cleaned);
      } else if (addTarget === 'category') {
        setLocalCategories(nextList);
        setCategory(cleaned);
      } else if (addTarget === 'unit') {
        setLocalUnits(nextList);
        setUnit(cleaned);
      }
      setAddTarget(null);
    } catch (err) {
      setAddOptionError(err instanceof Error ? err.message : 'Unable to save option.');
    } finally {
      setSavingOption(false);
    }
  };

  const resetForNextProduct = () => {
    setSku(generateNextSku(products));
    setName('');
    setItemType('');
    setCategory('');
    setUnit('');
    setModelReference('');
    setManufacturer('');
    setBrand('');
    setOriginCountry('');
    setShortDetails('');
    setHsnCode('');
    setUnitCost('');
    setSellingPrice('');
    setStockQty('0');
    setReorderLevel('2');
    setStatus('Active');
    setError(null);
  };

  const submitForm = async (addAnother: boolean) => {
    setSuccessMsg(null);
    if (!sku.trim()) {
      setError('Product ID / SKU is required.');
      return;
    }
    if (!name.trim()) {
      setError('Product Name is required.');
      return;
    }
    if (!itemType.trim()) {
      setError('Inventory Type is required.');
      return;
    }
    if (!category.trim()) {
      setError('Category is required.');
      return;
    }
    if (!unit.trim()) {
      setError('Unit / Kg (UOM) is required.');
      return;
    }
    if (!revenueGlCode && !inventoryGlCode) {
      setError('Please select a General Ledger (GL) Mapping.');
      return;
    }

    setSaving(true);
    try {
      setError(null);
      await onSubmit({
        sku: sku.trim().toUpperCase(),
        name: name.trim(),
        itemType: itemType.trim(),
        category: category.trim(),
        unit: unit.trim(),
        hsnCode: hsnCode.trim(),
        unitCost: round2(Math.max(0, numCost)),
        sellingPrice: round2(Math.max(0, numSell)),
        stockQty: itemType === 'Inventory' ? Math.max(0, Number(stockQty) || 0) : 0,
        reorderLevel: itemType === 'Inventory' ? Math.max(0, Number(reorderLevel) || 0) : 0,
        inventoryGlCode: inventoryGlCode.trim(),
        revenueGlCode: revenueGlCode.trim() || '4010',
        cogsGlCode: cogsGlCode.trim() || '5010',
        modelReference: modelReference.trim(),
        manufacturer: manufacturer.trim(),
        brand: brand.trim() || manufacturer.trim(),
        originCountry: originCountry.trim(),
        shortDetails: shortDetails.trim(),
        status,
      });
      if (addAnother && !initial) {
        resetForNextProduct();
        setSuccessMsg('Product saved. Ready to add the next product.');
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save product.');
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
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#001F60] text-white shrink-0">
          <div>
            <h2 className="text-base font-bold font-[var(--font-display)]">
              {initial ? `Edit Product — ${initial.sku}` : 'Add New Product'}
            </h2>
            <p className="text-xs text-blue-100 mt-0.5">
              Enter product specifications, dynamic classification, UOM, and General Ledger mapping.
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
            void submitForm(false);
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

          {/* Core 2-Column Product Information Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Product ID / SKU */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Product ID / SKU <span className="text-[10px] font-normal text-slate-400">(Auto-generated)</span>
              </label>
              <input
                type="text"
                value={sku}
                readOnly
                className="w-full px-3 py-2 text-xs font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-300 rounded-md cursor-not-allowed"
              />
            </div>

            {/* 2. Product Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full product name"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                required
              />
            </div>

            {/* 3. Inventory Type */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Inventory Type <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                value={itemType}
                onChange={(val) => setItemType(val)}
                options={typeOptions}
                placeholder="Select One"
                searchPlaceholder="Search inventory type..."
                addNewLabel="+ Add New Type"
                onAddNew={() => handleOpenAddOption('type')}
              />
            </div>

            {/* 4. Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                value={category}
                onChange={(val) => setCategory(val)}
                options={categoryOptions}
                placeholder="Select One"
                searchPlaceholder="Search category..."
                addNewLabel="+ Add New Category"
                onAddNew={() => handleOpenAddOption('category')}
              />
            </div>

            {/* 5. Model / Reference */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Model / Reference
              </label>
              <input
                type="text"
                value={modelReference}
                onChange={(e) => setModelReference(e.target.value)}
                placeholder="e.g., BKM-P18III / GS05"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            {/* 6. Manufacturer / Brand */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Manufacturer / Brand
              </label>
              <input
                type="text"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="Enter manufacturer or brand name"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            {/* 7. Origin Country */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Origin Country
              </label>
              <SearchableSelect
                value={originCountry}
                onChange={(val) => setOriginCountry(val)}
                options={countryOptions}
                placeholder="Select origin country..."
                searchPlaceholder="Search country..."
              />
            </div>

            {/* 8. Unit / Kg (UOM) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Unit / Kg (UOM) <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                value={unit}
                onChange={(val) => setUnit(val)}
                options={unitOptions}
                placeholder="Select One"
                searchPlaceholder="Search unit..."
                addNewLabel="+ Add New Unit Type"
                onAddNew={() => handleOpenAddOption('unit')}
              />
            </div>

            {/* 9. Short Product Details (Full Width) */}
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Short Product Details
              </label>
              <textarea
                rows={3}
                value={shortDetails}
                onChange={(e) => setShortDetails(e.target.value)}
                placeholder="Enter brief product description, technical specifications, or notes..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          {/* 10. General Ledger (GL) Mapping */}
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-800">
              General Ledger (GL) Mapping <span className="text-red-500">*</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Primary / Inventory Asset GL
                </label>
                <SearchableSelect
                  value={inventoryGlCode}
                  onChange={(val) => setInventoryGlCode(val)}
                  options={assetGlOptions.length > 0 ? assetGlOptions : allGlOptions}
                  placeholder="Select GL account..."
                  searchPlaceholder="Search GL code or name..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Revenue GL Account
                </label>
                <SearchableSelect
                  value={revenueGlCode}
                  onChange={(val) => setRevenueGlCode(val)}
                  options={incomeGlOptions.length > 0 ? incomeGlOptions : allGlOptions}
                  placeholder="Select revenue GL..."
                  searchPlaceholder="Search GL code or name..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  COGS / Direct Cost GL
                </label>
                <SearchableSelect
                  value={cogsGlCode}
                  onChange={(val) => setCogsGlCode(val)}
                  options={expenseGlOptions.length > 0 ? expenseGlOptions : allGlOptions}
                  placeholder="Select cost GL..."
                  searchPlaceholder="Search GL code or name..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as AccountStatus)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {/* Pricing & Stock Controls */}
          <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit Cost (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Selling Price (BDT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            {itemType === 'Inventory' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {initial ? 'On-Hand Stock (Ledger Derived)' : 'Opening Stock'}
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={stockQty}
                    disabled={Boolean(initial)}
                    onChange={(e) => setStockQty(e.target.value)}
                    title={
                      initial
                        ? 'Stock quantity is controlled by GRN, Dispatch, POS, and Returns'
                        : 'Initial opening stock'
                    }
                    className={`w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB] ${
                      initial ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Level</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2 flex items-end">
                <div className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs flex items-center justify-between">
                  <span className="text-slate-500">Gross Margin</span>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {previewMargin.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>

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
                disabled={isDisabled}
                onClick={() => void submitForm(true)}
                className="px-4 py-2 text-xs font-semibold text-[#001F60] bg-blue-50 border border-[#001F60]/30 hover:bg-blue-100 rounded-md disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save & Add New'}
              </button>
            )}
            <button
              type="submit"
              disabled={isDisabled}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </form>
      </div>

      {/* Reusable "Add New Type / Category / Unit" Modal */}
      {addTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-[#001F60] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {addTarget === 'type'
                  ? 'Add New Inventory Type'
                  : addTarget === 'category'
                    ? 'Add New Category'
                    : 'Add New Unit Type'}
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
                  {addTarget === 'type'
                    ? 'Inventory Type Name'
                    : addTarget === 'category'
                      ? 'Category Name'
                      : 'Unit Name (e.g., Kg, Meter, Liter, Set, Box)'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newOptionValue}
                  onChange={(e) => setNewOptionValue(e.target.value)}
                  placeholder={
                    addTarget === 'type'
                      ? 'e.g., Consumables'
                      : addTarget === 'category'
                        ? 'e.g., Robotics'
                        : 'e.g., Kg'
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
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

      {/* Unsaved Changes Cancel Confirmation */}
      {confirmCancel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
              Discard Unsaved Changes?
            </div>
            <div className="p-5 text-xs text-slate-600">
              You have unsaved product information. Are you sure you want to close this form?
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

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Barcode,
  Download,
  Edit3,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  computeStockAvailability,
  exportRowsToCSV,
  formatBDT,
  formatCompactBDT,
  round2,
} from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type {
  CustomerRecord,
  ImportLCFile,
  InventorySerialUnit,
  LedgerState,
  LocalPurchaseOrder,
  ProductItem,
  SerialUnitStatus,
  WarehouseLocation,
} from '../types/accounting.ts';

interface InventorySerialRegisterPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onCreateSerial: (payload: Omit<InventorySerialUnit, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateSerial: (
    id: string,
    payload: Partial<Omit<InventorySerialUnit, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteSerial: (id: string) => Promise<void>;
  onStateChange?: (nextState: LedgerState) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const SERIAL_STATUSES: Array<'All' | SerialUnitStatus> = [
  'All',
  'In Transit',
  'Bonded',
  'QC Hold',
  'In Stock',
  'Reserved',
  'Issued to Project',
  'Under Calibration',
  'RMA / Warranty',
];

const WAREHOUSES: WarehouseLocation[] = [
  'Dhaka Central Warehouse',
  'Gazipur Staging Yard',
  'Chattogram Port Bonded',
  'Client Site Deployed',
];

export const InventorySerialRegisterPage: React.FC<InventorySerialRegisterPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onCreateSerial,
  onUpdateSerial,
  onDeleteSerial,
  onStateChange,
  onNotify,
}) => {
  const serials = state.inventorySerials || [];
  const [viewMode, setViewMode] = useState<'serials' | 'availability'>('serials');
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjSku, setAdjSku] = useState(state.products[0]?.sku ?? '');
  const [adjQtyDelta, setAdjQtyDelta] = useState('0');
  const [adjWarehouse, setAdjWarehouse] = useState('Dhaka Central Warehouse');
  const [adjReason, setAdjReason] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  const stockAvailability = useMemo(() => computeStockAvailability(state), [state]);
  const recentMovements = useMemo(() => (state.inventoryMovements || []).slice(0, 50), [state.inventoryMovements]);

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdjBusy(true);
    try {
      const res = await api.createStockAdjustment({
        sku: adjSku,
        qtyDelta: Number(adjQtyDelta) || 0,
        warehouse: adjWarehouse,
        reason: adjReason.trim(),
      });
      onStateChange?.(res.state);
      onNotify?.('success', `Recorded stock adjustment for ${adjSku} & posted GL valuation entry.`);
      setShowAdjModal(false);
      setAdjReason('');
      setAdjQtyDelta('0');
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Stock adjustment failed.');
    } finally {
      setAdjBusy(false);
    }
  };
  const [statusFilter, setStatusFilter] = useState<'All' | SerialUnitStatus>('All');
  const [warehouseFilter, setWarehouseFilter] = useState<'All' | WarehouseLocation>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUnit, setEditingUnit] = useState<InventorySerialUnit | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const glInventory1110 = useMemo(() => {
    const summary = computeGLSummary(state);
    return summary.find((r) => r.code === '1110')?.closingBalance ?? 0;
  }, [state]);

  const metrics = useMemo(() => {
    const inStockUnits = serials.filter((u) => u.status === 'In Stock');
    const reservedUnits = serials.filter((u) => u.status === 'Reserved');
    const issuedUnits = serials.filter((u) => u.status === 'Issued to Project');
    const watchlistUnits = serials.filter(
      (u) => u.status === 'Under Calibration' || u.status === 'RMA / Warranty'
    );

    const onHandValue = round2(
      serials
        .filter((u) => u.status !== 'Issued to Project')
        .reduce((s, u) => s + u.unitCost, 0)
    );
    const issuedValue = round2(issuedUnits.reduce((s, u) => s + u.unitCost, 0));

    return {
      total: serials.length,
      inStockCount: inStockUnits.length,
      reservedCount: reservedUnits.length,
      issuedCount: issuedUnits.length,
      watchlistCount: watchlistUnits.length,
      onHandValue,
      issuedValue,
    };
  }, [serials]);

  const filteredSerials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return serials.filter((u) => {
      if (statusFilter !== 'All' && u.status !== statusFilter) return false;
      if (warehouseFilter !== 'All' && u.warehouseLocation !== warehouseFilter) return false;
      if (!q) return true;
      return (
        u.serialNumber.toLowerCase().includes(q) ||
        u.sku.toLowerCase().includes(q) ||
        u.productName.toLowerCase().includes(q) ||
        u.batchOrLcRef.toLowerCase().includes(q) ||
        u.assignedCustomer.toLowerCase().includes(q) ||
        u.projectRef.toLowerCase().includes(q)
      );
    });
  }, [serials, statusFilter, warehouseFilter, searchQuery]);

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Inventory_Serial_Register_${state.config.fiscalPeriod}.csv`,
      [
        'Serial Number',
        'SKU',
        'Product Name',
        'Category',
        'LC / PO Batch Ref',
        'Warehouse / Custody',
        'Stock / Unit',
        'Unit Cost (BDT)',
        'Selling Price (BDT)',
        'Margin %',
        'Stock Value (BDT)',
        'GL Mapping',
        'Received Date',
        'Warranty Expiry',
        'Assigned Customer',
        'Project Ref',
        'Status',
        'Notes',
      ],
      filteredSerials.map((u) => {
        const prod = state.products.find((p) => p.sku === u.sku || p.name === u.productName);
        const unitCost = u.unitCost || prod?.unitCost || 0;
        const sellingPrice = prod?.sellingPrice || 0;
        const margin = sellingPrice > 0 ? (((sellingPrice - unitCost) / sellingPrice) * 100).toFixed(1) : '0.0';
        const stockVal = u.status === 'In Stock' || u.status === 'Reserved' ? unitCost : 0;
        const glMap = `${prod?.inventoryGlCode || u.glCode} / ${prod?.revenueGlCode || '4010'} / ${prod?.cogsGlCode || '5010'}`;
        return [
          u.serialNumber,
          u.sku,
          u.productName,
          u.category,
          u.batchOrLcRef,
          u.warehouseLocation,
          prod ? `${prod.stockQty} ${prod.unit}` : '1 Unit',
          unitCost,
          sellingPrice,
          `${margin}%`,
          stockVal,
          glMap,
          u.receivedDate,
          u.warrantyExpiry,
          u.assignedCustomer || 'Unassigned',
          u.projectRef || '—',
          u.status,
          u.notes,
        ];
      })
    );
  };

  const handleQuickTransition = async (unit: InventorySerialUnit) => {
    if (unit.status === 'In Stock' || unit.status === 'Reserved') {
      await onUpdateSerial(unit.id, {
        status: 'Issued to Project',
        warehouseLocation: 'Client Site Deployed',
        glCode: '5010',
      });
    } else if (unit.status === 'Under Calibration' || unit.status === 'RMA / Warranty') {
      await onUpdateSerial(unit.id, {
        status: 'In Stock',
        warehouseLocation: 'Dhaka Central Warehouse',
        glCode: '1110',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
            Inventory &amp; Serial Register
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Unit-level serial tracking, LC/PO batch provenance, warehouse custody, project issuance, and OEM warranty control.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex bg-slate-200/70 p-0.5 rounded-md text-xs">
            <button
              onClick={() => setViewMode('serials')}
              className={`px-3 py-1.5 rounded font-medium cursor-pointer ${viewMode === 'serials' ? 'bg-white text-[#2563EB] shadow-xs' : 'text-slate-600'}`}
            >
              Serial Units
            </button>
            <button
              onClick={() => setViewMode('availability')}
              className={`px-3 py-1.5 rounded font-medium cursor-pointer ${viewMode === 'availability' ? 'bg-white text-[#2563EB] shadow-xs' : 'text-slate-600'}`}
            >
              SKU Availability &amp; Ledger
            </button>
          </div>
          {onStateChange && (
            <button
              onClick={() => setShowAdjModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>Stock Adjustment</span>
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => {
              setEditingUnit(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register Serial Unit</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="text-xs font-medium text-slate-500">Serialized Units Tracked</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {metrics.total}
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold tabular-nums">
              {metrics.inStockCount} free stock
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {metrics.reservedCount} Reserved · {metrics.issuedCount} Deployed
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Serialized Stock On Hand</span>
            <button
              onClick={() => onOpenRegister('1110')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1110</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.onHandValue)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            GL 1110 Total Inventories: {formatBDT(glInventory1110)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-indigo-600 rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Issued to Client Projects</span>
            <button
              onClick={() => onOpenRegister('5010')}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 5010</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatBDT(metrics.issuedValue)}
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            {metrics.issuedCount} commissioned units active at client sites
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-amber-500 rounded-xl p-5 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Calibration &amp; RMA Watchlist</span>
            {metrics.watchlistCount > 0 && (
              <button
                onClick={() => onOpenRegister('5310')}
                className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:underline cursor-pointer"
              >
                <span>GL 5310</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              metrics.watchlistCount > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {metrics.watchlistCount}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Units in QA calibration bench or OEM warranty claim
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex flex-wrap items-center bg-slate-200/70 p-1 rounded-lg gap-0.5">
            {SERIAL_STATUSES.map((st) => {
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
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value as 'All' | WarehouseLocation)}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-[#2563EB]"
          >
            <option value="All">All Locations</option>
            {WAREHOUSES.map((w) => (
              <option key={w} value={w}>
                {w}
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
            placeholder="Search serial#, SKU, LC/PO, client..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Serial Register Table OR SKU Availability & Movement Ledger */}
      {viewMode === 'availability' ? (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                SKU Stock Availability Matrix (On-Hand / Reserved / Free Available / Valuation)
              </h2>
              <span className="text-xs font-mono text-slate-600">
                Total Valuation: {formatBDT(round2(stockAvailability.reduce((s, r) => s + r.valuationBdt, 0)))}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3 text-right">On Hand</th>
                    <th className="py-2.5 px-3 text-right">Reserved / QC</th>
                    <th className="py-2.5 px-3 text-right">Available</th>
                    <th className="py-2.5 px-3 text-right">In Transit / Bonded</th>
                    <th className="py-2.5 px-3 text-right">Unit Cost</th>
                    <th className="py-2.5 px-3 text-right">Valuation (BDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockAvailability.map((row) => (
                    <tr key={row.sku} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 font-mono font-semibold text-slate-900">{row.sku}</td>
                      <td className="py-2 px-3">
                        <div className="font-medium text-slate-800">{row.productName}</div>
                        <div className="text-[11px] text-slate-400">{row.category}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{row.onHandQty}</td>
                      <td className="py-2 px-3 text-right font-mono text-amber-700">{row.reservedQty + row.qcHoldQty}</td>
                      <td className={`py-2 px-3 text-right font-mono font-bold ${row.needsReorder ? 'text-red-700' : 'text-emerald-700'}`}>
                        {row.availableQty}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">{row.inTransitQty + row.bondedQty}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatBDT(row.unitCost)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">{formatBDT(row.valuationBdt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Unified Stock Movement Ledger ({recentMovements.length} Recent Entries)
              </h2>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">SKU &amp; Product</th>
                    <th className="py-2 px-3">Movement Type</th>
                    <th className="py-2 px-3">Warehouse</th>
                    <th className="py-2 px-3">Source Ref</th>
                    <th className="py-2 px-3 text-right">Qty Delta</th>
                    <th className="py-2 px-3 text-right">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentMovements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No stock movements recorded yet. Movements log automatically on GRN, Dispatch, POS, Returns, and Adjustments.
                      </td>
                    </tr>
                  ) : (
                    recentMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 font-mono text-slate-600">{m.movementDate}</td>
                        <td className="py-2 px-3">
                          <span className="font-mono font-semibold text-slate-900">{m.sku}</span> · {m.productName}
                        </td>
                        <td className="py-2 px-3">{m.movementType}</td>
                        <td className="py-2 px-3 text-slate-600">{m.warehouse}</td>
                        <td className="py-2 px-3 font-mono text-slate-700">{m.sourceRef}</td>
                        <td className={`py-2 px-3 text-right font-mono font-bold ${m.qtyDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {m.qtyDelta >= 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{formatBDT(m.unitCost)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-h-[68vh]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-[0_1px_0_0_rgba(226,232,240,1)]">
              <tr className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Serial Number &amp; Batch</th>
                <th className="py-3 px-4">Product &amp; SKU</th>
                <th className="py-3 px-3 whitespace-nowrap">Custody / Location</th>
                <th className="py-3 px-3">Customer / Project</th>
                <th className="py-3 px-3 whitespace-nowrap">Received / Warranty</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Stock / Unit</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Unit Cost</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Selling Price</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Margin</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Stock Value</th>
                <th className="py-3 px-3 whitespace-nowrap">GL Mapping</th>
                <th className="py-3 px-3 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredSerials.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 px-4 text-center text-slate-500">
                    <Barcode className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <div className="text-sm font-medium text-slate-700">
                      No serialized units match your filter
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Try clearing the filter or register a new hardware serial number.
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSerials.map((unit) => {
                  const canQuickIssue = unit.status === 'In Stock' || unit.status === 'Reserved';
                  const canReturnStock =
                    unit.status === 'Under Calibration' || unit.status === 'RMA / Warranty';
                  const prod = state.products.find(
                    (p) => p.sku === unit.sku || p.name === unit.productName
                  );
                  const unitCost = unit.unitCost || prod?.unitCost || 0;
                  const sellingPrice = prod?.sellingPrice || 0;
                  const marginPct =
                    sellingPrice > 0 ? ((sellingPrice - unitCost) / sellingPrice) * 100 : 0;
                  const stockVal =
                    unit.status === 'In Stock' || unit.status === 'Reserved' ? unitCost : 0;
                  const invGl = prod?.inventoryGlCode || unit.glCode || '1110';
                  const revGl = prod?.revenueGlCode || '4010';
                  const cogsGl = prod?.cogsGlCode || '5010';
                  return (
                    <tr key={unit.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-semibold text-[#2563EB]">
                          {unit.serialNumber}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          Ref: {unit.batchOrLcRef || 'Manual'}
                        </div>
                      </td>
                      <td className="py-3 px-4 min-w-[210px]">
                        <div className="font-medium text-slate-900 leading-snug">
                          {unit.productName}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <span className="font-mono text-slate-600">{unit.sku}</span>
                          <span className="text-slate-300">·</span>
                          <span>{unit.category}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{unit.warehouseLocation}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs min-w-[170px]">
                        {unit.assignedCustomer ? (
                          <div>
                            <div className="font-medium text-slate-800 truncate max-w-[210px]">
                              {unit.assignedCustomer}
                            </div>
                            {unit.projectRef && (
                              <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                                {unit.projectRef}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">Unallocated stock</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                        <div>In: {unit.receivedDate}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          War: {unit.warrantyExpiry || 'N/A'}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {prod ? prod.stockQty : 1}{' '}
                          <span className="text-slate-400 font-normal">{prod?.unit || 'Unit'}</span>
                        </div>
                        {prod && prod.stockQty <= prod.reorderLevel && (
                          <div className="text-[11px] font-sans font-medium text-amber-700 mt-0.5">
                            Reorder ≤ {prod.reorderLevel}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatBDT(unitCost)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums font-medium text-slate-900 whitespace-nowrap">
                        {formatBDT(sellingPrice)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        <span
                          className={
                            marginPct >= 25 ? 'text-emerald-700 font-medium' : 'text-slate-700'
                          }
                        >
                          {marginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatBDT(stockVal)}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onOpenRegister(invGl)}
                            title="Open Inventory GL Register"
                            className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] border border-blue-200/80 font-semibold hover:bg-blue-100 cursor-pointer"
                          >
                            {invGl}
                          </button>
                          <button
                            onClick={() => onOpenRegister(revGl)}
                            title="Open Revenue GL Register"
                            className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 cursor-pointer"
                          >
                            {revGl}
                          </button>
                          <button
                            onClick={() => onOpenRegister(cogsGl)}
                            title="Open COGS GL Register"
                            className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 cursor-pointer"
                          >
                            {cogsGl}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div
                          className={`text-xs font-semibold ${
                            unit.status === 'In Stock'
                              ? 'text-emerald-700'
                              : unit.status === 'Reserved'
                                ? 'text-[#2563EB]'
                                : unit.status === 'Issued to Project'
                                  ? 'text-slate-700'
                                  : 'text-amber-700'
                          }`}
                        >
                          {unit.status}
                        </div>
                        {canQuickIssue && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => handleQuickTransition(unit)}
                            className="mt-0.5 text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer"
                          >
                            Issue to Site
                          </button>
                        )}
                        {canReturnStock && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => handleQuickTransition(unit)}
                            className="mt-0.5 text-[11px] font-medium text-emerald-700 hover:underline cursor-pointer"
                          >
                            Clear to Stock
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {confirmDeleteId === unit.id ? (
                          <div className="inline-flex items-center gap-2 text-xs">
                            <button
                              disabled={busyAction !== null}
                              onClick={async () => {
                                await onDeleteSerial(unit.id);
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
                              onClick={() => {
                                setEditingUnit(unit);
                                setShowModal(true);
                              }}
                              title="Edit serial unit"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(unit.id)}
                              title="Delete serial unit"
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
            {filteredSerials.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 text-xs font-semibold text-slate-900">
                  <td colSpan={5} className="py-3 px-4">
                    Filtered Serialized Value ({filteredSerials.length} units shown)
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {formatBDT(round2(filteredSerials.reduce((s, u) => s + u.unitCost, 0)))}
                  </td>
                  <td colSpan={3} className="py-3 px-4 text-right font-normal text-slate-500">
                    {metrics.watchlistCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {metrics.watchlistCount} calibration / RMA alert(s)
                      </span>
                    )}
                    {metrics.watchlistCount === 0 && (
                      <span>On-hand serialized: {formatCompactBDT(metrics.onHandValue)}</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      )}

      {showAdjModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleStockAdjustment} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Record Inventory Stock Adjustment</h2>
              <button type="button" onClick={() => setShowAdjModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Product SKU *</label>
              <select value={adjSku} onChange={(e) => setAdjSku(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {state.products.map((p) => (
                  <option key={p.id} value={p.sku}>{p.sku} — {p.name} (On Hand: {p.stockQty})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Qty Delta (+ Gain / - Loss) *</label>
                <input type="number" value={adjQtyDelta} onChange={(e) => setAdjQtyDelta(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Warehouse</label>
                <select value={adjWarehouse} onChange={(e) => setAdjWarehouse(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  {WAREHOUSES.map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Audit Reason (Physical Count / Shrinkage) *</label>
              <input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Annual physical count variance..." className="w-full px-2.5 py-2 border border-slate-300 rounded" required />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowAdjModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={adjBusy} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {adjBusy ? 'Posting...' : 'Adjust & Post GL'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showModal && (
        <SerialFormModal
          products={state.products}
          customers={state.customers}
          importLCs={state.importLCs}
          localPOs={state.localPurchaseOrders}
          initial={editingUnit}
          busy={busyAction !== null}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingUnit) {
              await onUpdateSerial(editingUnit.id, payload);
            } else {
              await onCreateSerial(payload);
            }
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
};

interface SerialFormModalProps {
  products: ProductItem[];
  customers: CustomerRecord[];
  importLCs: ImportLCFile[];
  localPOs: LocalPurchaseOrder[];
  initial: InventorySerialUnit | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Omit<InventorySerialUnit, 'id' | 'updatedAt'>) => Promise<void>;
}

const SerialFormModal: React.FC<SerialFormModalProps> = ({
  products,
  customers,
  importLCs,
  localPOs,
  initial,
  busy,
  onClose,
  onSubmit,
}) => {
  const inventoryProducts = products.filter((p) => p.itemType === 'Inventory');
  const selectableProducts = inventoryProducts.length > 0 ? inventoryProducts : products;
  const defaultProd = selectableProducts[0];

  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [batchOrLcRef, setBatchOrLcRef] = useState(
    initial?.batchOrLcRef ?? importLCs[0]?.lcNumber ?? ''
  );
  const [sku, setSku] = useState(initial?.sku ?? defaultProd?.sku ?? '');
  const [productName, setProductName] = useState(
    initial?.productName ?? defaultProd?.name ?? ''
  );
  const [category, setCategory] = useState(
    initial?.category ?? defaultProd?.category ?? 'Automation Hardware'
  );
  const [warehouseLocation, setWarehouseLocation] = useState<WarehouseLocation>(
    initial?.warehouseLocation ?? 'Dhaka Central Warehouse'
  );
  const [unitCost, setUnitCost] = useState(
    String(initial?.unitCost ?? defaultProd?.unitCost ?? '0')
  );
  const [receivedDate, setReceivedDate] = useState(initial?.receivedDate ?? '2025-06-30');
  const [warrantyExpiry, setWarrantyExpiry] = useState(initial?.warrantyExpiry ?? '2027-06-30');
  const [assignedCustomer, setAssignedCustomer] = useState(initial?.assignedCustomer ?? '');
  const [projectRef, setProjectRef] = useState(initial?.projectRef ?? '');
  const [status, setStatus] = useState<SerialUnitStatus>(initial?.status ?? 'In Stock');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const batchSuggestions = [
    ...importLCs.map((l) => l.lcNumber),
    ...localPOs.map((o) => o.poNumber),
  ];

  const handleSelectSku = (nextSku: string) => {
    setSku(nextSku);
    const matched = products.find((p) => p.sku === nextSku);
    if (matched) {
      setProductName(matched.name);
      setCategory(matched.category);
      setUnitCost(String(matched.unitCost));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serialNumber.trim() || !sku.trim()) {
      setError('Serial Number and Product SKU are required.');
      return;
    }
    try {
      setError(null);
      await onSubmit({
        serialNumber: serialNumber.trim().toUpperCase(),
        batchOrLcRef: batchOrLcRef.trim(),
        sku: sku.trim().toUpperCase(),
        productName: productName.trim() || sku.trim(),
        category: category.trim() || 'Hardware',
        warehouseLocation: status === 'Issued to Project' ? 'Client Site Deployed' : warehouseLocation,
        unitCost: round2(Math.max(0, Number(unitCost) || 0)),
        receivedDate,
        warrantyExpiry,
        assignedCustomer: assignedCustomer.trim(),
        projectRef: projectRef.trim(),
        glCode: status === 'Issued to Project' ? '5010' : '1110',
        status,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save serial unit.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-[var(--font-display)]">
              {initial
                ? `Edit Serial Unit — ${initial.serialNumber}`
                : 'Register Serialized Inventory Unit'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Bind hardware serial numbers to LC/PO intake batches, warehouse location, and warranty dates.
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                OEM Serial Number *
              </label>
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="SIE-S715-25-8803"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                LC / Local PO Batch Ref
              </label>
              <input
                type="text"
                list="atcl-batch-refs"
                value={batchOrLcRef}
                onChange={(e) => setBatchOrLcRef(e.target.value)}
                placeholder="SJIBL-0124-25-0891 or PO-25-001"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
              <datalist id="atcl-batch-refs">
                {batchSuggestions.map((ref) => (
                  <option key={ref} value={ref} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Catalog SKU / Product *
              </label>
              <select
                value={sku}
                onChange={(e) => handleSelectSku(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {selectableProducts.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unit Cost (BDT)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Warehouse / Custody Location
              </label>
              <select
                value={warehouseLocation}
                onChange={(e) => setWarehouseLocation(e.target.value as WarehouseLocation)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {WAREHOUSES.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Unit Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SerialUnitStatus)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                {SERIAL_STATUSES.filter((s) => s !== 'All').map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Received Date</label>
              <input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                OEM Warranty Expiry
              </label>
              <input
                type="date"
                value={warrantyExpiry}
                onChange={(e) => setWarrantyExpiry(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Customer (Optional)
              </label>
              <select
                value={assignedCustomer}
                onChange={(e) => setAssignedCustomer(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                <option value="">Unassigned (Warehouse Stock)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Project / Work Order Ref
              </label>
              <input
                type="text"
                value={projectRef}
                onChange={(e) => setProjectRef(e.target.value)}
                placeholder="DESCO-SUB-25-08"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              QA / Commissioning Notes
            </label>
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
              {initial ? 'Save Serial Record' : 'Register Serial Unit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Cog,
  Download,
  Edit3,
  Minus,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  exportRowsToCSV,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import type {
  AccountStatus,
  LedgerState,
  SparePartCategory,
  SparePartItem,
} from '../types/accounting.ts';

interface SparePartsInventoryPageProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (code: string) => void;
  onCreateSparePart: (payload: Omit<SparePartItem, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateSparePart: (
    id: string,
    payload: Partial<Omit<SparePartItem, 'id' | 'updatedAt'>>
  ) => Promise<void>;
  onDeleteSparePart: (id: string) => Promise<void>;
}

const CATEGORIES: Array<'All' | SparePartCategory> = [
  'All',
  'Switchgear & Relays',
  'PLC & Modules',
  'UPS & Power',
  'Fiber & Connectors',
  'Calibration Tools',
];

export const SparePartsInventoryPage: React.FC<SparePartsInventoryPageProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onCreateSparePart,
  onUpdateSparePart,
  onDeleteSparePart,
}) => {
  const parts = state.spareParts || [];
  const [categoryFilter, setCategoryFilter] = useState<'All' | SparePartCategory>('All');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingPart, setEditingPart] = useState<SparePartItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const totalValuation = round2(parts.reduce((s, p) => s + p.stockQty * p.unitCost, 0));
    const totalUnits = parts.reduce((s, p) => s + p.stockQty, 0);
    const lowStockCount = parts.filter((p) => p.stockQty <= p.minStockLevel).length;
    const activeCount = parts.filter((p) => p.status === 'Active').length;
    return {
      skuCount: parts.length,
      activeCount,
      totalValuation,
      totalUnits,
      lowStockCount,
    };
  }, [parts]);

  const filteredParts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return parts.filter((p) => {
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      if (lowStockOnly && p.stockQty > p.minStockLevel) return false;
      if (!q) return true;
      return (
        p.partCode.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.compatibleSystem.toLowerCase().includes(q) ||
        p.binLocation.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [parts, categoryFilter, lowStockOnly, searchQuery]);

  const handleQuickAdjustStock = async (part: SparePartItem, delta: number) => {
    const nextQty = Math.max(0, part.stockQty + delta);
    if (nextQty === part.stockQty) return;
    await onUpdateSparePart(part.id, { stockQty: nextQty });
  };

  const handleExportCSV = () => {
    exportRowsToCSV(
      `ATCL_Spare_Parts_Inventory_${state.config.fiscalPeriod}.csv`,
      [
        'Part Code',
        'Name',
        'Category',
        'Compatible System',
        'Bin Location',
        'Unit',
        'Stock Qty',
        'Min Stock',
        'Unit Cost (BDT)',
        'Selling Price (BDT)',
        'Valuation (BDT)',
        'GL Code',
        'Status',
      ],
      filteredParts.map((p) => [
        p.partCode,
        p.name,
        p.category,
        p.compatibleSystem,
        p.binLocation,
        p.unit,
        p.stockQty,
        p.minStockLevel,
        p.unitCost,
        p.sellingPrice,
        round2(p.stockQty * p.unitCost),
        p.glCode,
        p.status,
      ])
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-[var(--font-display)]">
            Spare Parts Inventory
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Workshop bin-level spare parts control, quick issue/restock counters, and GL 1110 inventory valuation.
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
              setEditingPart(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Spare Part</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Spare Part SKUs</span>
            <Cog className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.skuCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.activeCount} active workshop parts
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Spare Parts Valuation</span>
            <button
              onClick={() => onOpenRegister('1110')}
              className="inline-flex items-center gap-0.5 font-mono text-[#2563EB] hover:underline cursor-pointer"
            >
              <span>GL 1110</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 text-xl font-bold text-[#2563EB] font-mono tabular-nums">
            {formatBDT(metrics.totalValuation)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Sub-ledger of Inventories GL 1110</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Low-Stock Reorder Alerts</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div
            className={`mt-2 text-xl font-bold font-mono tabular-nums ${
              metrics.lowStockCount > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {metrics.lowStockCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Parts at or below minimum bin threshold
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Total Units in Workshop Bins</div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.totalUnits}
          </div>
          <div className="mt-1 text-xs text-slate-500">Tejgaon Workshop &amp; Dhaka Bins</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 text-xs border border-slate-200 rounded-md text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(e) => setLowStockOnly(e.target.checked)}
                className="rounded border-slate-300 text-[#2563EB]"
              />
              <span>Low Stock Only</span>
            </label>

            <div className="relative min-w-[230px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search part code, bin, system..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Parts Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Part Code &amp; Bin</th>
                <th className="py-3 px-4">Spare Part &amp; Compatibility</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-center">Bin Stock (Issue / Restock)</th>
                <th className="py-3 px-4 text-right">Unit Cost</th>
                <th className="py-3 px-4 text-right">Counter Price</th>
                <th className="py-3 px-4 text-right">Valuation</th>
                <th className="py-3 px-4">GL</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredParts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No spare parts match the selected filter criteria.
                  </td>
                </tr>
              ) : (
                filteredParts.map((part) => {
                  const isLow = part.stockQty <= part.minStockLevel;
                  const valuation = round2(part.stockQty * part.unitCost);
                  const isDeleting = confirmDeleteId === part.id;

                  return (
                    <tr key={part.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top whitespace-nowrap font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{part.partCode}</div>
                        <div className="text-[11px] text-[#2563EB] mt-0.5">{part.binLocation}</div>
                      </td>
                      <td className="py-3 px-4 align-top max-w-xs">
                        <div className="font-medium text-slate-900">{part.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {part.compatibleSystem}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap text-slate-700">
                        <div>{part.category}</div>
                        <button
                          disabled={busyAction !== null}
                          onClick={() =>
                            onUpdateSparePart(part.id, {
                              status: part.status === 'Active' ? 'Inactive' : 'Active',
                            })
                          }
                          className={`text-[11px] font-medium mt-0.5 hover:underline cursor-pointer ${
                            part.status === 'Active' ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {part.status}
                        </button>
                      </td>
                      <td className="py-3 px-4 align-top text-center whitespace-nowrap">
                        <div className="inline-flex items-center border border-slate-200 rounded bg-white">
                          <button
                            disabled={busyAction !== null || part.stockQty <= 0}
                            onClick={() => handleQuickAdjustStock(part, -1)}
                            title="Issue 1 unit from bin"
                            className="p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span
                            className={`px-3 font-mono font-bold tabular-nums ${
                              isLow ? 'text-amber-700' : 'text-slate-900'
                            }`}
                          >
                            {part.stockQty}
                          </span>
                          <button
                            disabled={busyAction !== null}
                            onClick={() => handleQuickAdjustStock(part, 1)}
                            title="Restock 1 unit to bin"
                            className="p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div
                          className={`text-[11px] font-mono tabular-nums mt-1 ${
                            isLow ? 'text-amber-700 font-semibold' : 'text-slate-400'
                          }`}
                        >
                          {isLow ? `Reorder (Min ${part.minStockLevel})` : `Min ${part.minStockLevel} ${part.unit}`}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono tabular-nums text-slate-700">
                        {formatBDT(part.unitCost)}
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono tabular-nums text-slate-700">
                        {formatBDT(part.sellingPrice)}
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap font-mono font-semibold text-slate-900 tabular-nums">
                        {formatBDT(valuation)}
                      </td>
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <button
                          onClick={() => onOpenRegister(part.glCode || '1110')}
                          className="font-mono text-[#2563EB] hover:underline cursor-pointer"
                        >
                          {part.glCode || '1110'}
                        </button>
                      </td>
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        {isDeleting ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={async () => {
                                await onDeleteSparePart(part.id);
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
                                setEditingPart(part);
                                setShowModal(true);
                              }}
                              title="Edit spare part"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(part.id)}
                              title="Delete spare part"
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
        <SparePartModal
          initial={editingPart}
          onClose={() => setShowModal(false)}
          onSubmit={async (payload) => {
            if (editingPart) {
              await onUpdateSparePart(editingPart.id, payload);
            } else {
              await onCreateSparePart(payload);
            }
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
};

interface SparePartModalProps {
  initial: SparePartItem | null;
  onClose: () => void;
  onSubmit: (payload: Omit<SparePartItem, 'id' | 'updatedAt'>) => Promise<void>;
}

const SparePartModal: React.FC<SparePartModalProps> = ({ initial, onClose, onSubmit }) => {
  const [partCode, setPartCode] = useState(initial?.partCode || '');
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState<SparePartCategory>(
    initial?.category || 'Switchgear & Relays'
  );
  const [compatibleSystem, setCompatibleSystem] = useState(initial?.compatibleSystem || '');
  const [binLocation, setBinLocation] = useState(initial?.binLocation || 'Bin A-01');
  const [unit, setUnit] = useState(initial?.unit || 'Unit');
  const [stockQty, setStockQty] = useState(String(initial?.stockQty ?? 0));
  const [minStockLevel, setMinStockLevel] = useState(String(initial?.minStockLevel ?? 2));
  const [unitCost, setUnitCost] = useState(String(initial?.unitCost ?? 0));
  const [sellingPrice, setSellingPrice] = useState(String(initial?.sellingPrice ?? 0));
  const [status, setStatus] = useState<AccountStatus>(initial?.status || 'Active');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partCode.trim() || !name.trim()) {
      setError('Part Code and Spare Part Name are required.');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        partCode: partCode.trim().toUpperCase(),
        name: name.trim(),
        category,
        compatibleSystem: compatibleSystem.trim() || 'General Workshop Equipment',
        binLocation: binLocation.trim() || 'Bin A-01',
        unit: unit.trim() || 'Unit',
        stockQty: Math.max(0, Math.floor(Number(stockQty) || 0)),
        minStockLevel: Math.max(0, Math.floor(Number(minStockLevel) || 0)),
        unitCost: round2(Math.max(0, Number(unitCost) || 0)),
        sellingPrice: round2(Math.max(0, Number(sellingPrice) || 0)),
        glCode: '1110',
        status,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save spare part.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            {initial ? `Edit Spare Part ${initial.partCode}` : 'Add Workshop Spare Part'}
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
              <label className="block font-medium text-slate-700 mb-1">Part Code *</label>
              <input
                type="text"
                value={partCode}
                onChange={(e) => setPartCode(e.target.value)}
                placeholder="SP-RLY-103"
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Spare Part Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SparePartCategory)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
              >
                {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Bin Location</label>
              <input
                type="text"
                value={binLocation}
                onChange={(e) => setBinLocation(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Unit</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Compatible Equipment / System</label>
            <input
              type="text"
              value={compatibleSystem}
              onChange={(e) => setCompatibleSystem(e.target.value)}
              placeholder="e.g. 11kV Switchgear Panel (ATCL-SWG-11KV)"
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Stock Qty</label>
              <input
                type="number"
                min="0"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Min Stock</label>
              <input
                type="number"
                min="0"
                value={minStockLevel}
                onChange={(e) => setMinStockLevel(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Unit Cost (BDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Selling Price (BDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AccountStatus)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white"
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
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
              {submitting ? 'Saving...' : initial ? 'Save Part' : 'Add Spare Part'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

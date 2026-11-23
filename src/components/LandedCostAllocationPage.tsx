import React, { useMemo, useState } from 'react';
import { Landmark, Plus, Save, Ship, Trash2 } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type {
  LCShipmentRecord,
  LandedCostAllocationLine,
  LedgerState,
} from '../types/accounting.ts';

interface LandedCostAllocationPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const LandedCostAllocationPage: React.FC<LandedCostAllocationPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const lcs = state.importLCs || [];
  const [selectedLcId, setSelectedLcId] = useState(lcs[0]?.id ?? '');
  const selectedLc = lcs.find((l) => l.id === selectedLcId) || lcs[0];

  const [shipments, setShipments] = useState<LCShipmentRecord[]>(selectedLc?.shipments ?? []);
  const [allocations, setAllocations] = useState<LandedCostAllocationLine[]>(
    selectedLc?.landedAllocations ?? []
  );
  const [settlementRate, setSettlementRate] = useState(
    String(selectedLc?.settlementExchangeRate ?? selectedLc?.exchangeRate ?? 120)
  );
  const [saving, setSaving] = useState(false);

  const handleSelectLc = (id: string) => {
    setSelectedLcId(id);
    const next = lcs.find((l) => l.id === id);
    setShipments(next?.shipments ?? []);
    setAllocations(next?.landedAllocations ?? []);
    setSettlementRate(String(next?.settlementExchangeRate ?? next?.exchangeRate ?? 120));
  };

  const fxDiffBdt = useMemo(() => {
    if (!selectedLc) return 0;
    const settleRate = Number(settlementRate) || selectedLc.exchangeRate;
    return round2(selectedLc.foreignAmount * (settleRate - selectedLc.exchangeRate));
  }, [selectedLc, settlementRate]);

  // IAS 2: Inventory landed cost includes FOB/CIF + Customs Duty & C&F (5030), excluding Bank Financing Charges (5420)
  const capitalizablePool = useMemo(() => {
    if (!selectedLc) return 0;
    return round2(selectedLc.bdtValue + selectedLc.customsDutyAndCnfBdt);
  }, [selectedLc]);

  const recalcAllocations = (rows: LandedCostAllocationLine[]) => {
    if (!selectedLc) return rows;
    const totalFob = rows.reduce((s, r) => s + (Number(r.fobBdt) || 0), 0);
    const dutyPool = selectedLc.customsDutyAndCnfBdt;
    return rows.map((r) => {
      const share = totalFob > 0 ? (Number(r.fobBdt) || 0) / totalFob : 0;
      const allocDuty = round2(dutyPool * share);
      const totalLanded = round2((Number(r.fobBdt) || 0) + allocDuty);
      const qty = Math.max(1, Number(r.qty) || 1);
      return {
        ...r,
        allocatedDutyCnfBdt: allocDuty,
        totalLandedBdt: totalLanded,
        unitLandedCostBdt: round2(totalLanded / qty),
      };
    });
  };

  const addShipment = () => {
    setShipments((prev) => [
      ...prev,
      {
        id: `SHP-${prev.length + 1}-${Date.now()}`,
        shipmentRef: `SHP-${selectedLc?.lcNumber || 'LC'}-${prev.length + 1}`,
        vesselOrFlight: '',
        billOfLadingNo: '',
        etaDate: new Date().toISOString().slice(0, 10),
        foreignAmount: 0,
        dutyAndCnfBdt: 0,
        status: 'In Transit',
      },
    ]);
  };

  const addSkuLine = () => {
    const prod = state.products[0];
    const next = recalcAllocations([
      ...allocations,
      {
        id: `LCA-${allocations.length + 1}-${Date.now()}`,
        sku: prod?.sku || 'SKU-001',
        productName: prod?.name || 'Imported Equipment',
        qty: 1,
        fobBdt: selectedLc && allocations.length === 0 ? selectedLc.bdtValue : 0,
        allocatedDutyCnfBdt: 0,
        totalLandedBdt: 0,
        unitLandedCostBdt: 0,
      },
    ]);
    setAllocations(next);
  };

  const handleSave = async () => {
    if (!selectedLc) return;
    setSaving(true);
    try {
      const res = await api.saveLandedCostAllocation({
        lcId: selectedLc.id,
        settlementExchangeRate: Number(settlementRate) || selectedLc.exchangeRate,
        fxDifferenceBdt: fxDiffBdt,
        shipments,
        landedAllocations: recalcAllocations(allocations),
      });
      onStateChange(res.state);
      onNotify('success', `Saved shipments & SKU landed costs for ${selectedLc.lcNumber}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save landed cost allocation.');
    } finally {
      setSaving(false);
    }
  };

  if (!selectedLc) {
    return <div className="p-6 text-xs text-slate-500">No Import LC files available yet.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Import Landed Cost &amp; Multi-Shipment Allocation</h1>
          <p className="text-xs text-slate-500">
            IAS 2 compliant: allocate FOB/CIF + Customs Duty (5030) to SKU unit costs while keeping Finance Charges (5420) &amp; FX differences separate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedLc.id}
            onChange={(e) => handleSelectLc(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white font-mono"
          >
            {lcs.map((lc) => (
              <option key={lc.id} value={lc.id}>
                {lc.lcNumber} — {lc.supplierName}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save Costing'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">LC Value ({selectedLc.currency})</div>
          <div className="mt-1 text-sm font-bold font-mono">{selectedLc.foreignAmount.toLocaleString()} @ {selectedLc.exchangeRate}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Capitalizable Pool (IAS 2)</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">{formatBDT(capitalizablePool)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Finance Charges (5420 Exp)</div>
          <div className="mt-1 text-sm font-bold font-mono text-amber-700">{formatBDT(selectedLc.bankChargesBdt)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Settlement FX Rate</div>
          <input
            type="number"
            step="0.01"
            value={settlementRate}
            onChange={(e) => setSettlementRate(e.target.value)}
            className="mt-1 w-full px-2 py-1 border border-slate-300 rounded font-mono text-xs"
          />
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Realized FX Diff (BDT)</div>
          <div className={`mt-1 text-sm font-bold font-mono ${fxDiffBdt > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            {formatBDT(fxDiffBdt)}
          </div>
        </div>
      </div>

      {/* Multi-Shipment Tranches */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Ship className="w-3.5 h-3.5 text-[#2563EB]" /> Shipment Tranches Under {selectedLc.lcNumber}
          </h2>
          <button onClick={addShipment} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add Shipment
          </button>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="py-2 px-2 text-left">Shipment Ref</th>
              <th className="py-2 px-2 text-left">BL / AWB No.</th>
              <th className="py-2 px-2 text-left">ETA Date</th>
              <th className="py-2 px-2 text-right">Foreign Amt</th>
              <th className="py-2 px-2 text-right">Duty &amp; C&amp;F (BDT)</th>
              <th className="py-2 px-2 text-left">Stage</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shipments.length === 0 ? (
              <tr><td colSpan={7} className="py-4 text-center text-slate-400">No shipment tranches added yet.</td></tr>
            ) : (
              shipments.map((sh, i) => (
                <tr key={sh.id}>
                  <td className="p-1.5"><input value={sh.shipmentRef} onChange={(e) => setShipments((p) => p.map((x, idx) => idx === i ? { ...x, shipmentRef: e.target.value } : x))} className="w-full px-2 py-1 border border-slate-200 rounded font-mono" /></td>
                  <td className="p-1.5"><input value={sh.billOfLadingNo} onChange={(e) => setShipments((p) => p.map((x, idx) => idx === i ? { ...x, billOfLadingNo: e.target.value } : x))} placeholder="BL-..." className="w-full px-2 py-1 border border-slate-200 rounded font-mono" /></td>
                  <td className="p-1.5"><input type="date" value={sh.etaDate} onChange={(e) => setShipments((p) => p.map((x, idx) => idx === i ? { ...x, etaDate: e.target.value } : x))} className="w-full px-2 py-1 border border-slate-200 rounded" /></td>
                  <td className="p-1.5"><input type="number" value={sh.foreignAmount} onChange={(e) => setShipments((p) => p.map((x, idx) => idx === i ? { ...x, foreignAmount: Number(e.target.value) } : x))} className="w-full px-2 py-1 border border-slate-200 rounded text-right font-mono" /></td>
                  <td className="p-1.5"><input type="number" value={sh.dutyAndCnfBdt} onChange={(e) => setShipments((p) => p.map((x, idx) => idx === i ? { ...x, dutyAndCnfBdt: Number(e.target.value) } : x))} className="w-full px-2 py-1 border border-slate-200 rounded text-right font-mono" /></td>
                  <td className="p-1.5">
                    <select value={sh.status} onChange={(e) => setShipments((p) => p.map((x, idx) => idx === i ? { ...x, status: e.target.value as any } : x))} className="w-full px-2 py-1 border border-slate-200 rounded bg-white">
                      <option>In Transit</option>
                      <option>Bonded</option>
                      <option>Customs Cleared</option>
                      <option>Released</option>
                    </select>
                  </td>
                  <td className="p-1.5 text-center"><button onClick={() => setShipments((p) => p.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* SKU-Level Landed Cost Allocation */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5 text-emerald-600" /> SKU-Level Landed Cost Allocation
          </h2>
          <button onClick={addSkuLine} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add SKU Allocation
          </button>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="py-2 px-2 text-left">SKU</th>
              <th className="py-2 px-2 text-left">Product</th>
              <th className="py-2 px-2 text-right">Qty</th>
              <th className="py-2 px-2 text-right">FOB (BDT)</th>
              <th className="py-2 px-2 text-right">Allocated Duty/C&amp;F</th>
              <th className="py-2 px-2 text-right">Total Landed</th>
              <th className="py-2 px-2 text-right">Unit Landed Cost</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allocations.length === 0 ? (
              <tr><td colSpan={8} className="py-4 text-center text-slate-400">No SKU allocations yet. Click &ldquo;Add SKU Allocation&rdquo; to distribute LC duty &amp; freight.</td></tr>
            ) : (
              allocations.map((al, i) => (
                <tr key={al.id}>
                  <td className="p-1.5"><input value={al.sku} onChange={(e) => setAllocations((p) => recalcAllocations(p.map((x, idx) => idx === i ? { ...x, sku: e.target.value } : x)))} className="w-24 px-2 py-1 border border-slate-200 rounded font-mono" /></td>
                  <td className="p-1.5"><input value={al.productName} onChange={(e) => setAllocations((p) => recalcAllocations(p.map((x, idx) => idx === i ? { ...x, productName: e.target.value } : x)))} className="w-full px-2 py-1 border border-slate-200 rounded" /></td>
                  <td className="p-1.5"><input type="number" min="1" value={al.qty} onChange={(e) => setAllocations((p) => recalcAllocations(p.map((x, idx) => idx === i ? { ...x, qty: Number(e.target.value) } : x)))} className="w-16 px-2 py-1 border border-slate-200 rounded text-right font-mono" /></td>
                  <td className="p-1.5"><input type="number" step="0.01" value={al.fobBdt} onChange={(e) => setAllocations((p) => recalcAllocations(p.map((x, idx) => idx === i ? { ...x, fobBdt: Number(e.target.value) } : x)))} className="w-28 px-2 py-1 border border-slate-200 rounded text-right font-mono" /></td>
                  <td className="p-1.5 text-right font-mono text-slate-600">{formatBDT(al.allocatedDutyCnfBdt)}</td>
                  <td className="p-1.5 text-right font-mono font-semibold text-slate-900">{formatBDT(al.totalLandedBdt)}</td>
                  <td className="p-1.5 text-right font-mono font-bold text-emerald-700">{formatBDT(al.unitLandedCostBdt)}</td>
                  <td className="p-1.5 text-center"><button onClick={() => setAllocations((p) => recalcAllocations(p.filter((_, idx) => idx !== i)))} className="text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

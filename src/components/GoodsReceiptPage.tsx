import React, { useState } from 'react';
import { GitBranch, Package, Plus, X } from 'lucide-react';
import { formatBDT } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import {
  DocumentTraceabilityDrawer,
  type TraceDocTarget,
} from './common/DocumentTraceabilityDrawer.tsx';
import type { GoodsReceiptStatus, LedgerState } from '../types/accounting.ts';

interface GoodsReceiptPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const GoodsReceiptPage: React.FC<GoodsReceiptPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const grns = state.goodsReceipts || [];
  const [showModal, setShowModal] = useState(false);
  const [grnNumber, setGrnNumber] = useState(() => `GRN-2026-${String(grns.length + 101).padStart(4, '0')}`);
  const [grnDate, setGrnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceId, setSourceId] = useState(state.localPurchaseOrders[0]?.id ?? '');
  const [warehouse, setWarehouse] = useState('Dhaka Central Warehouse');
  const [totalAmount, setTotalAmount] = useState('');
  const [status, setStatus] = useState<GoodsReceiptStatus>('Accepted');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [traceDoc, setTraceDoc] = useState<TraceDocTarget | null>(null);

  const selectedPo = state.localPurchaseOrders.find((p) => p.id === sourceId);

  const handleSelectPo = (id: string) => {
    setSourceId(id);
    const po = state.localPurchaseOrders.find((p) => p.id === id);
    if (po) {
      setTotalAmount(String(po.netAmount));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPo) {
      onNotify('error', 'Select a Purchase Order to receive against.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createGoodsReceipt({
        grnNumber: grnNumber.trim().toUpperCase(),
        grnDate,
        sourceType: 'PO',
        sourceId: selectedPo.id,
        sourceRef: selectedPo.poNumber,
        supplierId: selectedPo.supplierId,
        supplierName: selectedPo.supplierName,
        warehouse,
        inventoryGlCode: '1110',
        grniGlCode: '2090',
        totalAmount: Number(totalAmount) || selectedPo.netAmount,
        status,
        notes,
        postToGl: status === 'Accepted',
      });
      onStateChange(res.state);
      onNotify(
        'success',
        `Recorded GRN ${res.grn.grnNumber}${res.grn.postedToGl ? ' & posted Dr 1110 / Cr 2090 GRNI' : ''}.`
      );
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to create GRN.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Goods Receipt Notes (GRN)</h1>
          <p className="text-xs text-slate-500">
            Receive PO / LC deliveries, perform QC inspection, and post Dr Inventory (1110) / Cr GRNI (2090).
          </p>
        </div>
        <button
          onClick={() => {
            setGrnNumber(`GRN-2026-${String(grns.length + 101).padStart(4, '0')}`);
            if (selectedPo && !totalAmount) setTotalAmount(String(selectedPo.netAmount));
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Record Goods Receipt
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">GRN No.</th>
              <th className="py-2.5 px-3 text-left">Date</th>
              <th className="py-2.5 px-3 text-left">Source PO / LC</th>
              <th className="py-2.5 px-3 text-left">Supplier &amp; Warehouse</th>
              <th className="py-2.5 px-3 text-right">Receipt Value</th>
              <th className="py-2.5 px-3 text-left">QC &amp; GL Status</th>
              <th className="py-2.5 px-3 text-right">Trace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grns.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <Package className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No Goods Receipt Notes recorded yet.
                </td>
              </tr>
            ) : (
              grns.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{g.grnNumber}</td>
                  <td className="py-2.5 px-3 text-slate-600">{g.grnDate}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-700">{g.sourceType} · {g.sourceRef}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-800">{g.supplierName}</div>
                    <div className="text-[11px] text-slate-400">{g.warehouse}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                    {formatBDT(g.totalAmount)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">
                      {g.status} {g.postedToGl ? `· Posted (${g.postedVoucherNo})` : '· Unposted'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() =>
                        setTraceDoc({
                          docType: 'GRN',
                          docRef: g.grnNumber,
                          title: `${g.sourceType} ${g.sourceRef} · ${g.supplierName}`,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded cursor-pointer hover:bg-indigo-100"
                    >
                      <GitBranch className="w-3 h-3" /> Trace
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Record Goods Receipt (GRN)</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">GRN Number *</label>
                <input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Receipt Date</label>
                <input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Purchase Order *</label>
              <select value={sourceId} onChange={(e) => handleSelectPo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {state.localPurchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNumber} — {po.supplierName} ({formatBDT(po.netAmount)})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Warehouse</label>
                <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option>Dhaka Central Warehouse</option>
                  <option>Gazipur Staging Yard</option>
                  <option>Chattogram Port Bonded</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">QC Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as GoodsReceiptStatus)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="Accepted">Accepted (Post Dr 1110 / Cr 2090)</option>
                  <option value="QC Hold">QC Hold (Pending Inspection)</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Received Value (BDT)</label>
              <input type="number" step="0.01" min="0" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Inspection Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Saving...' : 'Post GRN'}
              </button>
            </div>
          </form>
        </div>
      )}

      <DocumentTraceabilityDrawer
        state={state}
        target={traceDoc}
        onClose={() => setTraceDoc(null)}
      />
    </div>
  );
};

import React, { useState } from 'react';
import { Plus, ShieldAlert, X } from 'lucide-react';
import { formatBDT } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface PurchaseReturnsPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const PurchaseReturnsPage: React.FC<PurchaseReturnsPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const returns = state.purchaseReturns || [];
  const [showModal, setShowModal] = useState(false);
  const [returnNumber, setReturnNumber] = useState(() => `RTV-2026-${String(returns.length + 101).padStart(4, '0')}`);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id ?? '');
  const [grnNumber, setGrnNumber] = useState('');
  const [offsetGlCode, setOffsetGlCode] = useState('2080');
  const [returnAmount, setReturnAmount] = useState('');
  const [reason, setReason] = useState('Damaged / Failed QC Inspection');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const sup = state.suppliers.find((s) => s.id === supplierId);
    if (!sup) return;
    setSubmitting(true);
    try {
      const res = await api.createPurchaseReturn({
        returnNumber: returnNumber.trim().toUpperCase(),
        returnDate,
        supplierId: sup.id,
        supplierName: sup.name,
        grnNumber: grnNumber.trim() || undefined,
        reason,
        returnAmount: Number(returnAmount) || 0,
        inventoryGlCode: '1110',
        offsetGlCode,
      });
      onStateChange(res.state);
      onNotify('success', `Posted Purchase Return ${res.purchaseReturn.returnNumber} to GL.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to post return.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Purchase Returns (RTV / Debit Notes)</h1>
          <p className="text-xs text-slate-500">
            Return rejected or defective goods to suppliers and reverse Inventory (1110) against AP (2080) or GRNI (2090).
          </p>
        </div>
        <button
          onClick={() => {
            setReturnNumber(`RTV-2026-${String(returns.length + 101).padStart(4, '0')}`);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Record Purchase Return
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">RTV No.</th>
              <th className="py-2.5 px-3 text-left">Date</th>
              <th className="py-2.5 px-3 text-left">Supplier</th>
              <th className="py-2.5 px-3 text-left">Reason / GRN</th>
              <th className="py-2.5 px-3 text-right">Return Value</th>
              <th className="py-2.5 px-3 text-left">GL Reversal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returns.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  <ShieldAlert className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No purchase returns recorded yet.
                </td>
              </tr>
            ) : (
              returns.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{r.returnNumber}</td>
                  <td className="py-2.5 px-3 text-slate-600">{r.returnDate}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{r.supplierName}</td>
                  <td className="py-2.5 px-3 text-slate-600">{r.reason} {r.grnNumber ? `(${r.grnNumber})` : ''}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">{formatBDT(r.returnAmount)}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-emerald-700">
                    Dr {r.offsetGlCode} / Cr {r.inventoryGlCode} ({r.postedVoucherNo})
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
              <h2 className="text-base font-bold text-slate-900">Record Purchase Return (RTV)</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Return Number *</label>
                <input value={returnNumber} onChange={(e) => setReturnNumber(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Return Date</label>
                <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Supplier *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">GRN Ref (Optional)</label>
                <input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} placeholder="GRN-2026-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Reverse Against GL</label>
                <select value={offsetGlCode} onChange={(e) => setOffsetGlCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="2080">2080 — Accounts Payable</option>
                  <option value="2090">2090 — GRNI (Unbilled Receipt)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Return Amount (BDT) *</label>
              <input type="number" step="0.01" min="0" value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Posting...' : 'Post Return'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

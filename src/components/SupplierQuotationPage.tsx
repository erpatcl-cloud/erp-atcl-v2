import React, { useState } from 'react';
import { Award, Plus, Scale, X } from 'lucide-react';
import { formatBDT } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface SupplierQuotationPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const SupplierQuotationPage: React.FC<SupplierQuotationPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const quotes = state.supplierQuotations || [];
  const [showModal, setShowModal] = useState(false);
  const [rfqNumber, setRfqNumber] = useState(() => `RFQ-2026-${String(quotes.length + 101).padStart(4, '0')}`);
  const [prNumber, setPrNumber] = useState('');
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id ?? '');
  const [itemSummary, setItemSummary] = useState('');
  const [quotedNetAmount, setQuotedNetAmount] = useState('');
  const [vatRate, setVatRate] = useState('15');
  const [leadTimeDays, setLeadTimeDays] = useState('7');
  const [paymentTerms, setPaymentTerms] = useState('Net 30 Days');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const sup = state.suppliers.find((s) => s.id === supplierId);
    if (!sup || !itemSummary.trim()) {
      onNotify('error', 'Supplier and Item Summary are required.');
      return;
    }
    setSubmitting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await api.createSupplierQuotation({
        rfqNumber: rfqNumber.trim().toUpperCase(),
        prNumber: prNumber.trim() || undefined,
        quoteDate: today,
        validUntil: today,
        supplierId: sup.id,
        supplierName: sup.name,
        itemSummary: itemSummary.trim(),
        quotedNetAmount: Number(quotedNetAmount) || 0,
        vatRate: Number(vatRate) || 0,
        leadTimeDays: Number(leadTimeDays) || 7,
        paymentTerms,
        status: 'Received',
        notes: '',
      });
      onStateChange(res.state);
      onNotify('success', `Recorded quotation ${res.quotation.rfqNumber} from ${sup.name}.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save quotation.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAward = async (id: string) => {
    try {
      const res = await api.awardSupplierQuotation(id);
      onStateChange(res.state);
      onNotify('success', `Awarded ${res.quotation.rfqNumber} → Issued PO ${res.order.poNumber}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to award quotation.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">RFQ &amp; Supplier Quotations</h1>
          <p className="text-xs text-slate-500">
            Compare vendor quotations side-by-side and award directly to an Approved Local Purchase Order.
          </p>
        </div>
        <button
          onClick={() => {
            setRfqNumber(`RFQ-2026-${String(quotes.length + 101).padStart(4, '0')}`);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Record Supplier Quote
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">RFQ No.</th>
              <th className="py-2.5 px-3 text-left">Supplier</th>
              <th className="py-2.5 px-3 text-left">Scope / Items</th>
              <th className="py-2.5 px-3 text-right">Quoted Net</th>
              <th className="py-2.5 px-3 text-center">Lead Time</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {quotes.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <Scale className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No supplier quotations recorded yet.
                </td>
              </tr>
            ) : (
              quotes.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                    <div>{q.rfqNumber}</div>
                    {q.prNumber && <div className="text-[11px] text-slate-400">{q.prNumber}</div>}
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{q.supplierName}</td>
                  <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">{q.itemSummary}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                    {formatBDT(q.quotedNetAmount)}
                  </td>
                  <td className="py-2.5 px-3 text-center text-slate-600">{q.leadTimeDays} days</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        q.status === 'Awarded'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {q.status} {q.linkedPoNumber ? `(${q.linkedPoNumber})` : ''}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {q.status === 'Received' && (
                      <button
                        onClick={() => handleAward(q.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 cursor-pointer"
                      >
                        <Award className="w-3 h-3" /> Award &amp; Issue PO
                      </button>
                    )}
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
              <h2 className="text-base font-bold text-slate-900">Record Supplier Quotation</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">RFQ Number *</label>
                <input value={rfqNumber} onChange={(e) => setRfqNumber(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Linked PR (Optional)</label>
                <input value={prNumber} onChange={(e) => setPrNumber(e.target.value)} placeholder="PR-2026-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
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
            <div>
              <label className="block font-medium text-slate-700 mb-1">Quoted Items / Scope *</label>
              <input value={itemSummary} onChange={(e) => setItemSummary(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" required />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Net Amount (BDT)</label>
                <input type="number" step="0.01" min="0" value={quotedNetAmount} onChange={(e) => setQuotedNetAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">VAT %</label>
                <input type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Lead Time (Days)</label>
                <input type="number" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Saving...' : 'Save Quotation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { ArrowRightCircle, FileText, Plus, X } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState, SalesChannel, SalesOrderLineItem } from '../types/accounting.ts';

interface SalesQuotationPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onNavigateSO: () => void;
}

export const SalesQuotationPage: React.FC<SalesQuotationPageProps> = ({
  state,
  onStateChange,
  onNotify,
  onNavigateSO,
}) => {
  const quotations = state.salesQuotations || [];
  const [showModal, setShowModal] = useState(false);

  const [quoteNo, setQuoteNo] = useState(() => `QTN-2026-${String(quotations.length + 101).padStart(4, '0')}`);
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? '');
  const [channel, setChannel] = useState<SalesChannel>('Direct Project');
  const [deliveryTerms, setDeliveryTerms] = useState('14 Days from Confirmed PO');
  const [warrantyTerms, setWarrantyTerms] = useState('24 Months ATCL Standard Warranty');
  const [lines, setLines] = useState<SalesOrderLineItem[]>([
    { id: 'QL-1', description: '', qty: 1, unit: 'Pcs', unitPrice: 0, discount: 0, vatRate: 15, lineNet: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const totals = useMemo(() => {
    const net = round2(lines.reduce((s, l) => s + l.lineNet, 0));
    const vat = round2(lines.reduce((s, l) => s + round2((l.lineNet * l.vatRate) / 100), 0));
    return { net, vat, gross: round2(net + vat) };
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<SalesOrderLineItem>) => {
    setLines((prev) =>
      prev.map((ln, i) => {
        if (i !== idx) return ln;
        const m = { ...ln, ...patch };
        m.lineNet = round2(Math.max(0, (Number(m.qty) || 0) * (Number(m.unitPrice) || 0) - (Number(m.discount) || 0)));
        return m;
      })
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = state.customers.find((c) => c.id === customerId);
    if (!cust || totals.gross <= 0) {
      onNotify('error', 'Customer and at least one positive quotation line are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createSalesQuotation({
        quoteNo: quoteNo.trim().toUpperCase(),
        quoteDate,
        validUntil,
        customerId: cust.id,
        customerName: cust.name,
        channel,
        lines,
        netAmount: totals.net,
        vatAmount: totals.vat,
        grossAmount: totals.gross,
        deliveryTerms,
        warrantyTerms,
        status: 'Accepted',
        notes: '',
      });
      onStateChange(res.state);
      onNotify('success', `Created Sales Quotation ${res.quotation.quoteNo}.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save quotation.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvert = async (id: string) => {
    try {
      const res = await api.convertSalesQuotation(id);
      onStateChange(res.state);
      onNotify('success', `Converted ${res.quotation.quoteNo} → Confirmed Sales Order ${res.order.orderNo}.`);
      onNavigateSO();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to convert quotation.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Sales Quotations</h1>
          <p className="text-xs text-slate-500">
            Prepare B2B, tender &amp; project quotations with line-level VAT/discounts and convert accepted quotes to Sales Orders without retyping.
          </p>
        </div>
        <button
          onClick={() => {
            setQuoteNo(`QTN-2026-${String(quotations.length + 101).padStart(4, '0')}`);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> New Sales Quotation
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Quote No.</th>
              <th className="py-2.5 px-3 text-left">Customer &amp; Channel</th>
              <th className="py-2.5 px-3 text-left">Valid Until</th>
              <th className="py-2.5 px-3 text-right">Gross (BDT)</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {quotations.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  <FileText className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No sales quotations created yet.
                </td>
              </tr>
            ) : (
              quotations.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{q.quoteNo}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-800">{q.customerName}</div>
                    <div className="text-[11px] text-slate-400">{q.channel}</div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">{q.validUntil}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatBDT(q.grossAmount)}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
                      {q.status} {q.linkedOrderNo ? `(${q.linkedOrderNo})` : ''}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {q.status !== 'Converted' && (
                      <button
                        onClick={() => handleConvert(q.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 cursor-pointer"
                      >
                        <ArrowRightCircle className="w-3 h-3" /> Convert to SO
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
          <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">New Sales Quotation</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Quote No. *</label>
                <input value={quoteNo} onChange={(e) => setQuoteNo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Quote Date</label>
                <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Valid Until</label>
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Customer *</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  {state.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Sales Channel</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value as SalesChannel)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option>Direct Project</option>
                  <option>Utility Tender</option>
                  <option>Distributor / Channel</option>
                  <option>Enterprise AMC</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">Quotation Lines *</span>
                <button
                  type="button"
                  onClick={() =>
                    setLines((p) => [
                      ...p,
                      { id: `QL-${p.length + 1}`, description: '', qty: 1, unit: 'Pcs', unitPrice: 0, discount: 0, vatRate: 15, lineNet: 0 },
                    ])
                  }
                  className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                >
                  + Add Line
                </button>
              </div>
              {lines.map((ln, i) => (
                <div key={ln.id} className="grid grid-cols-12 gap-1.5 items-center">
                  <input placeholder="Product / Service Spec" value={ln.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="col-span-5 px-2 py-1.5 border border-slate-300 rounded" />
                  <input type="number" min="1" value={ln.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-right font-mono" />
                  <input type="number" step="0.01" placeholder="Price" value={ln.unitPrice} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })} className="col-span-3 px-2 py-1.5 border border-slate-300 rounded text-right font-mono" />
                  <input type="number" step="0.5" placeholder="VAT%" value={ln.vatRate} onChange={(e) => updateLine(i, { vatRate: Number(e.target.value) })} className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-right font-mono" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Delivery Terms</label>
                <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Warranty Terms</label>
                <input value={warrantyTerms} onChange={(e) => setWarrantyTerms(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <div className="font-mono font-bold text-slate-900">
                Net {formatBDT(totals.net)} + VAT {formatBDT(totals.vat)} = Gross {formatBDT(totals.gross)}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                  {submitting ? 'Saving...' : 'Save Quotation'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

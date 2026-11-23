import React, { useState } from 'react';
import { GitBranch, Plus, ReceiptText, X } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import {
  DocumentTraceabilityDrawer,
  type TraceDocTarget,
} from './common/DocumentTraceabilityDrawer.tsx';
import type { LedgerState } from '../types/accounting.ts';

interface PurchaseInvoicePageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const PurchaseInvoicePage: React.FC<PurchaseInvoicePageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const invoices = state.purchaseInvoices || [];
  const grns = state.goodsReceipts || [];
  const [showModal, setShowModal] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState(() => `PINV-2026-${String(invoices.length + 101).padStart(4, '0')}`);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id ?? '');
  const [grnId, setGrnId] = useState('');
  const [netAmount, setNetAmount] = useState('');
  const [vatAmount, setVatAmount] = useState('0');
  const [mushak63Ref, setMushak63Ref] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [traceDoc, setTraceDoc] = useState<TraceDocTarget | null>(null);

  const selectedGrn = grns.find((g) => g.id === grnId);

  const handleSelectGrn = (id: string) => {
    setGrnId(id);
    const g = grns.find((x) => x.id === id);
    if (g) {
      setSupplierId(g.supplierId);
      setNetAmount(String(g.totalAmount));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const sup = state.suppliers.find((s) => s.id === supplierId);
    if (!sup || !supplierInvoiceNo.trim()) {
      onNotify('error', 'Supplier and Supplier Bill Number are required.');
      return;
    }
    const net = round2(Number(netAmount) || 0);
    const vat = round2(Number(vatAmount) || 0);
    const gross = round2(net + vat);
    if (selectedGrn && net > selectedGrn.totalAmount + 0.01) {
      onNotify('error', `3-Way Match Block: Invoice net (${formatBDT(net)}) exceeds GRN value (${formatBDT(selectedGrn.totalAmount)}).`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createPurchaseInvoice({
        invoiceNumber: invoiceNumber.trim().toUpperCase(),
        supplierInvoiceNo: supplierInvoiceNo.trim().toUpperCase(),
        invoiceDate,
        dueDate,
        supplierId: sup.id,
        supplierName: sup.name,
        sourceType: selectedGrn ? selectedGrn.sourceType : 'Direct',
        sourceId: selectedGrn?.sourceId,
        sourceRef: selectedGrn?.sourceRef,
        grnId: selectedGrn?.id,
        grnNumber: selectedGrn?.grnNumber,
        debitGlCode: selectedGrn ? '2090' : sup.expenseGlCode || '5010',
        apGlCode: '2080',
        netAmount: net,
        vatAmount: vat,
        grossAmount: gross,
        mushak63Ref: mushak63Ref.trim() || undefined,
        status: 'Posted',
        notes: selectedGrn ? `3-way matched to ${selectedGrn.grnNumber}` : 'Direct service/expense bill',
        postToGl: true,
      });
      onStateChange(res.state);
      onNotify('success', `Posted Purchase Invoice ${res.invoice.invoiceNumber} to AP 2080.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to post invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Purchase Invoices (3-Way Match)</h1>
          <p className="text-xs text-slate-500">
            Match supplier bills against PO &amp; GRN, prevent duplicate vendor invoices, and post Dr GRNI (2090) / Cr AP (2080).
          </p>
        </div>
        <button
          onClick={() => {
            setInvoiceNumber(`PINV-2026-${String(invoices.length + 101).padStart(4, '0')}`);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Post Supplier Invoice
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Invoice No.</th>
              <th className="py-2.5 px-3 text-left">Supplier &amp; Bill Ref</th>
              <th className="py-2.5 px-3 text-left">GRN / Source</th>
              <th className="py-2.5 px-3 text-right">Gross (BDT)</th>
              <th className="py-2.5 px-3 text-right">Paid</th>
              <th className="py-2.5 px-3 text-right">Outstanding</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Trace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-400">
                  <ReceiptText className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No supplier purchase invoices posted yet.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{inv.invoiceNumber}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-800">{inv.supplierName}</div>
                    <div className="text-[11px] font-mono text-slate-400">Bill: {inv.supplierInvoiceNo}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600">
                    {inv.grnNumber ? `${inv.grnNumber} (${inv.sourceRef || ''})` : 'Direct Bill'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono">{formatBDT(inv.grossAmount)}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-emerald-700">{formatBDT(inv.paidAmount)}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatBDT(inv.outstandingAmount)}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-[#2563EB]">
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() =>
                        setTraceDoc({
                          docType: 'PINV',
                          docRef: inv.invoiceNumber,
                          title: `${inv.supplierName} · Bill ${inv.supplierInvoiceNo}`,
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
              <h2 className="text-base font-bold text-slate-900">Post Supplier Purchase Invoice</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Internal Invoice No. *</label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Supplier Bill / Mushak Ref *</label>
                <input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="BILL-9910" className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Match Against GRN (Recommended)</label>
              <select value={grnId} onChange={(e) => handleSelectGrn(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                <option value="">— Direct Service / Expense Bill (No GRN) —</option>
                {grns.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.grnNumber} — {g.supplierName} ({formatBDT(g.totalAmount)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Supplier *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Invoice Date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Mushak 6.3 No.</label>
                <input value={mushak63Ref} onChange={(e) => setMushak63Ref(e.target.value)} placeholder="M6.3-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Net Amount (BDT) *</label>
                <input type="number" step="0.01" min="0" value={netAmount} onChange={(e) => setNetAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">VAT Amount (BDT)</label>
                <input type="number" step="0.01" min="0" value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Posting...' : 'Post to AP (2080)'}
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

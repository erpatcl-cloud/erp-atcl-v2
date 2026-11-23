import React, { useState } from 'react';
import { Plus, ShieldAlert, X } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface SalesReturnsPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const SalesReturnsPage: React.FC<SalesReturnsPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const creditNotes = state.salesCreditNotes || [];
  const invoices = (state.salesInvoices || []).filter((i) => i.status !== 'Voided');
  const [showModal, setShowModal] = useState(false);

  const [creditNoteNo, setCreditNoteNo] = useState(() => `SCN-2026-${String(creditNotes.length + 101).padStart(4, '0')}`);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesInvoiceId, setSalesInvoiceId] = useState(invoices[0]?.id ?? '');
  const [returnedSerial, setReturnedSerial] = useState('');
  const [disposition, setDisposition] = useState<'Restock' | 'Damaged'>('Restock');
  const [netAmount, setNetAmount] = useState('');
  const [vatAmount, setVatAmount] = useState('0');
  const [cogsReversalAmount, setCogsReversalAmount] = useState('0');
  const [reason, setReason] = useState('Customer RMA Return / Specification Mismatch');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const inv = invoices.find((i) => i.id === salesInvoiceId);
    if (!inv) {
      onNotify('error', 'Select a posted Sales Invoice to issue a Credit Note against.');
      return;
    }
    const net = round2(Number(netAmount) || 0);
    const vat = round2(Number(vatAmount) || 0);
    setSubmitting(true);
    try {
      const res = await api.createSalesCreditNote({
        creditNoteNo: creditNoteNo.trim().toUpperCase(),
        returnDate,
        salesInvoiceId: inv.id,
        salesInvoiceNo: inv.invoiceNumber,
        customerId: inv.customerId,
        customerName: inv.customerName,
        returnedSerial: returnedSerial.trim() || undefined,
        disposition,
        netAmount: net,
        vatAmount: vat,
        grossAmount: round2(net + vat),
        cogsReversalAmount: round2(Number(cogsReversalAmount) || 0),
        reason,
      });
      onStateChange(res.state);
      onNotify('success', `Posted Credit Note ${res.creditNote.creditNoteNo} to GL.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to post Credit Note.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Sales Returns &amp; Credit Notes</h1>
          <p className="text-xs text-slate-500">
            Process customer returns, QC restock vs. damaged disposition, and reverse Revenue (4010), VAT (2070), AR (1120) &amp; Inventory (1110).
          </p>
        </div>
        <button
          onClick={() => {
            setCreditNoteNo(`SCN-2026-${String(creditNotes.length + 101).padStart(4, '0')}`);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Issue Credit Note
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Credit Note</th>
              <th className="py-2.5 px-3 text-left">Sales Invoice &amp; Customer</th>
              <th className="py-2.5 px-3 text-left">Disposition / Serial</th>
              <th className="py-2.5 px-3 text-right">Credit Gross</th>
              <th className="py-2.5 px-3 text-left">GL Journal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {creditNotes.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-400">
                  <ShieldAlert className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No sales returns or credit notes issued yet.
                </td>
              </tr>
            ) : (
              creditNotes.map((cn) => (
                <tr key={cn.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                    <div>{cn.creditNoteNo}</div>
                    <div className="text-[11px] text-slate-400">{cn.returnDate}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-mono text-slate-800">{cn.salesInvoiceNo}</div>
                    <div className="text-[11px] text-slate-500">{cn.customerName}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">{cn.disposition}</span>
                    {cn.returnedSerial && <span className="ml-2 font-mono text-[11px]">{cn.returnedSerial}</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-red-700">{formatBDT(cn.grossAmount)}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-emerald-700">{cn.postedVoucherNo}</td>
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
              <h2 className="text-base font-bold text-slate-900">Issue Sales Credit Note</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Credit Note No. *</label>
                <input value={creditNoteNo} onChange={(e) => setCreditNoteNo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Return Date</label>
                <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Original Sales Invoice *</label>
              <select value={salesInvoiceId} onChange={(e) => setSalesInvoiceId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {inv.customerName} ({formatBDT(inv.grossAmount)})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Disposition</label>
                <select value={disposition} onChange={(e) => setDisposition(e.target.value as 'Restock' | 'Damaged')} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="Restock">Restock (Reverse COGS / Inventory)</option>
                  <option value="Damaged">Damaged / Write-off</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Returned Serial (Optional)</label>
                <input value={returnedSerial} onChange={(e) => setReturnedSerial(e.target.value)} placeholder="SN-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Net Return *</label>
                <input type="number" step="0.01" min="0" value={netAmount} onChange={(e) => setNetAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">VAT Reversal</label>
                <input type="number" step="0.01" min="0" value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">COGS Reversal</label>
                <input type="number" step="0.01" min="0" value={cogsReversalAmount} onChange={(e) => setCogsReversalAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Posting...' : 'Post Credit Note'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { GitBranch, Plus, ReceiptText, Wallet, X } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import {
  DocumentTraceabilityDrawer,
  type TraceDocTarget,
} from './common/DocumentTraceabilityDrawer.tsx';
import type { LedgerState, SalesInvoiceLineItem } from '../types/accounting.ts';

interface SalesInvoicePageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onOpenNewVoucher: () => void;
}

export const SalesInvoicePage: React.FC<SalesInvoicePageProps> = ({
  state,
  onStateChange,
  onNotify,
  onOpenNewVoucher,
}) => {
  const invoices = state.salesInvoices || [];
  const advances = (state.customerAdvances || []).filter((a) => a.unappliedAmount > 0.01);
  const [showModal, setShowModal] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState(
    () => `SINV-2026-${String(invoices.length + 101).padStart(4, '0')}`
  );
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? '');
  const [salesOrderId, setSalesOrderId] = useState('');
  const [cogsAmount, setCogsAmount] = useState('0');
  const [mushak63Ref, setMushak63Ref] = useState('');
  const [traceDoc, setTraceDoc] = useState<TraceDocTarget | null>(null);
  const [lines, setLines] = useState<SalesInvoiceLineItem[]>([
    {
      id: 'SIL-1',
      description: '',
      qty: 1,
      unit: 'Pcs',
      unitPrice: 0,
      discount: 0,
      vatRate: 15,
      lineNet: 0,
      lineVat: 0,
      lineGross: 0,
    },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const totals = useMemo(() => {
    const net = round2(lines.reduce((s, l) => s + l.lineNet, 0));
    const vat = round2(lines.reduce((s, l) => s + l.lineVat, 0));
    return { net, vat, gross: round2(net + vat) };
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<SalesInvoiceLineItem>) => {
    setLines((prev) =>
      prev.map((ln, i) => {
        if (i !== idx) return ln;
        const m = { ...ln, ...patch };
        const net = round2(Math.max(0, (Number(m.qty) || 0) * (Number(m.unitPrice) || 0) - (Number(m.discount) || 0)));
        const vat = round2((net * (Number(m.vatRate) || 0)) / 100);
        return { ...m, lineNet: net, lineVat: vat, lineGross: round2(net + vat) };
      })
    );
  };

  const handleSelectSO = (soId: string) => {
    setSalesOrderId(soId);
    const so = state.salesOrders.find((o) => o.id === soId);
    if (so) {
      setCustomerId(so.customerId);
      const vatRate = so.vatRate || 0;
      const lineVat = round2((so.netAmount * vatRate) / 100);
      setLines([
        {
          id: 'SIL-SO-1',
          description: so.description,
          qty: 1,
          unit: 'Lot',
          unitPrice: so.netAmount,
          discount: 0,
          vatRate,
          lineNet: so.netAmount,
          lineVat,
          lineGross: round2(so.netAmount + lineVat),
        },
      ]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = state.customers.find((c) => c.id === customerId);
    if (!cust || totals.gross <= 0) {
      onNotify('error', 'Select a customer and enter at least one positive invoice line.');
      return;
    }
    const so = state.salesOrders.find((o) => o.id === salesOrderId);
    setSubmitting(true);
    try {
      const res = await api.createSalesInvoice({
        invoiceNumber: invoiceNumber.trim().toUpperCase(),
        invoiceDate,
        dueDate,
        customerId: cust.id,
        customerName: cust.name,
        salesOrderId: so?.id,
        salesOrderNo: so?.orderNo,
        lines,
        netAmount: totals.net,
        vatAmount: totals.vat,
        grossAmount: totals.gross,
        cogsAmount: round2(Math.max(0, Number(cogsAmount) || 0)),
        revenueGlCode: so?.revenueGlCode || '4010',
        arGlCode: cust.receivableGlCode || '1120',
        vatGlCode: '2070',
        mushak63Ref: mushak63Ref.trim() || undefined,
        status: 'Posted',
        notes: so ? `Billed against ${so.orderNo}` : 'Direct Sales Invoice',
        postToGl: true,
      });
      onStateChange(res.state);
      onNotify('success', `Posted Sales Invoice ${res.invoice.invoiceNumber} to GL 1120 / 4010 / 2070.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to post Sales Invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyAdvance = async (advId: string, invId: string, maxAmt: number) => {
    try {
      const res = await api.applyCustomerAdvanceToInvoice({
        advanceId: advId,
        invoiceId: invId,
        amount: maxAmt,
      });
      onStateChange(res.state);
      onNotify('success', `Applied advance ${res.advance.advanceNo} to ${res.invoice.invoiceNumber} (Dr 2110 / Cr 1120).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to apply advance.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Sales Invoices (AR 1120 Control)</h1>
          <p className="text-xs text-slate-500">
            Authoritative AR documents posting Dr 1120 / Cr 4010 / Cr 2070 (+ COGS 5010 / Inventory 1110) with Mushak 6.3 &amp; advance adjustment.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onOpenNewVoucher}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5" /> Record Receipt
          </button>
          <button
            onClick={() => {
              setInvoiceNumber(`SINV-2026-${String(invoices.length + 101).padStart(4, '0')}`);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Issue Sales Invoice
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Invoice No.</th>
              <th className="py-2.5 px-3 text-left">Customer &amp; SO Ref</th>
              <th className="py-2.5 px-3 text-left">Due Date</th>
              <th className="py-2.5 px-3 text-right">Gross (BDT)</th>
              <th className="py-2.5 px-3 text-right">Collected</th>
              <th className="py-2.5 px-3 text-right">Outstanding</th>
              <th className="py-2.5 px-3 text-left">Status / Advances</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <ReceiptText className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No dedicated Sales Invoices issued yet. Click &ldquo;Issue Sales Invoice&rdquo; to recognize AR on GL 1120.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const matchingAdv = advances.find((a) => a.customerId === inv.customerId);
                return (
                  <tr key={inv.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                      <div>{inv.invoiceNumber}</div>
                      {inv.mushak63Ref && <div className="text-[11px] text-slate-400">{inv.mushak63Ref}</div>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-800">{inv.customerName}</div>
                      <div className="text-[11px] text-slate-400">{inv.salesOrderNo || 'Direct Invoice'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{inv.dueDate}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatBDT(inv.grossAmount)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-700">{formatBDT(inv.paidAmount)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatBDT(inv.outstandingAmount)}</td>
                    <td className="py-2.5 px-3 space-x-2">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-[#2563EB]">
                        {inv.status}
                      </span>
                      <button
                        onClick={() =>
                          setTraceDoc({
                            docType: 'SINV',
                            docRef: inv.invoiceNumber,
                            title: `${inv.customerName}${inv.salesOrderNo ? ` · ${inv.salesOrderNo}` : ''}`,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded cursor-pointer hover:bg-indigo-100"
                      >
                        <GitBranch className="w-3 h-3" /> Trace
                      </button>
                      {matchingAdv && inv.outstandingAmount > 0.01 && (
                        <button
                          onClick={() =>
                            handleApplyAdvance(
                              matchingAdv.id,
                              inv.id,
                              Math.min(matchingAdv.unappliedAmount, inv.outstandingAmount)
                            )
                          }
                          className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                        >
                          Apply Advance ({formatBDT(matchingAdv.unappliedAmount)})
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Issue &amp; Post Sales Invoice</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Invoice No. *</label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Invoice Date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Link Sales Order (Optional)</label>
                <select value={salesOrderId} onChange={(e) => handleSelectSO(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="">— Direct Sales Invoice —</option>
                  {state.salesOrders.map((o) => (
                    <option key={o.id} value={o.id}>{o.orderNo} — {o.customerName} ({formatBDT(o.netAmount)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Customer *</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  {state.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">Invoice Lines *</span>
                <button
                  type="button"
                  onClick={() =>
                    setLines((p) => [
                      ...p,
                      { id: `SIL-${p.length + 1}`, description: '', qty: 1, unit: 'Pcs', unitPrice: 0, discount: 0, vatRate: 15, lineNet: 0, lineVat: 0, lineGross: 0 },
                    ])
                  }
                  className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                >
                  + Add Line
                </button>
              </div>
              {lines.map((ln, i) => (
                <div key={ln.id} className="grid grid-cols-12 gap-1.5 items-center">
                  <input placeholder="Description" value={ln.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="col-span-5 px-2 py-1.5 border border-slate-300 rounded" />
                  <input type="number" min="1" value={ln.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-right font-mono" />
                  <input type="number" step="0.01" placeholder="Price" value={ln.unitPrice} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })} className="col-span-3 px-2 py-1.5 border border-slate-300 rounded text-right font-mono" />
                  <input type="number" step="0.5" placeholder="VAT%" value={ln.vatRate} onChange={(e) => updateLine(i, { vatRate: Number(e.target.value) })} className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-right font-mono" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">COGS Recognition (BDT · Dr 5010 / Cr 1110)</label>
                <input type="number" step="0.01" min="0" value={cogsAmount} onChange={(e) => setCogsAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Mushak 6.3 Ref (Optional)</label>
                <input value={mushak63Ref} onChange={(e) => setMushak63Ref(e.target.value)} placeholder="M6.3-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <div className="font-mono font-bold text-slate-900">
                Net {formatBDT(totals.net)} + VAT {formatBDT(totals.vat)} = Gross {formatBDT(totals.gross)}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                  {submitting ? 'Posting...' : 'Post Sales Invoice'}
                </button>
              </div>
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

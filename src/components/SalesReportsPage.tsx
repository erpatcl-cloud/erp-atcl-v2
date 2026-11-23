import React, { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Download, Plus, X } from 'lucide-react';
import { computeGLSummary, exportRowsToCSV, formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface SalesReportsPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type O2CTab = 'ar-aging' | 'collections' | 'pos-summary' | 'amc';

export const SalesReportsPage: React.FC<SalesReportsPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const [tab, setTab] = useState<O2CTab>('ar-aging');
  const [showAmcModal, setShowAmcModal] = useState(false);

  const [contractNo, setContractNo] = useState(() => `AMC-2026-${String((state.amcContracts || []).length + 101).padStart(4, '0')}`);
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? '');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [annualValue, setAnnualValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const glByCode = useMemo(() => {
    const summary = computeGLSummary(state);
    return new Map(summary.map((r) => [r.code, r.closingBalance]));
  }, [state]);

  const invoices = useMemo(
    () => (state.salesInvoices || []).filter((i) => i.status !== 'Voided'),
    [state.salesInvoices]
  );

  const receiptVouchers = useMemo(
    () => (state.vouchers || []).filter((v) => v.voucherType === 'Receipt' && v.status !== 'Voided'),
    [state.vouchers]
  );

  const amcContracts = state.amcContracts || [];

  const aging = useMemo(() => {
    const now = Date.now();
    let current = 0, d30 = 0, d60 = 0, d90 = 0, d90Plus = 0;
    for (const inv of invoices) {
      if (inv.outstandingAmount <= 0) continue;
      const due = new Date(inv.dueDate).getTime();
      const days = Number.isNaN(due) ? 0 : Math.floor((now - due) / 86_400_000);
      if (days <= 0) current = round2(current + inv.outstandingAmount);
      else if (days <= 30) d30 = round2(d30 + inv.outstandingAmount);
      else if (days <= 60) d60 = round2(d60 + inv.outstandingAmount);
      else if (days <= 90) d90 = round2(d90 + inv.outstandingAmount);
      else d90Plus = round2(d90Plus + inv.outstandingAmount);
    }
    return { current, d30, d60, d90, d90Plus, total: round2(current + d30 + d60 + d90 + d90Plus) };
  }, [invoices]);

  const handleCreateAmc = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = state.customers.find((c) => c.id === customerId);
    if (!cust) return;
    setSubmitting(true);
    try {
      const res = await api.createAmcContract({
        contractNo: contractNo.trim().toUpperCase(),
        customerId: cust.id,
        customerName: cust.name,
        startDate,
        endDate,
        annualValue: Number(annualValue) || 0,
        deferredGlCode: '2120',
        revenueGlCode: '4010',
        status: 'Active',
      });
      onStateChange(res.state);
      onNotify('success', `Registered AMC ${res.contract.contractNo} (Dr 1120 / Cr 2120 Deferred).`);
      setShowAmcModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to create AMC contract.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecognizeAmc = async (id: string, amt: number) => {
    try {
      const res = await api.recognizeAmcRevenue(id, amt);
      onStateChange(res.state);
      onNotify('success', `Recognized ${formatBDT(amt)} AMC revenue (Dr 2120 / Cr 4010).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to recognize AMC revenue.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#2563EB]" />
            Sales, AR Aging &amp; AMC Reconciliation Reports
          </h1>
          <p className="text-xs text-slate-500">
            Authoritative O2C reporting: GL 1120 Trade Receivables, Customer Advances (2110), Customer TDS/VDS (1140), POS Clearing (1250) &amp; Deferred AMC (2120).
          </p>
        </div>
        <button
          onClick={() =>
            exportRowsToCSV(
              'ATCL_AR_Invoice_Aging.csv',
              ['Invoice No', 'Customer', 'Due Date', 'Gross', 'Paid', 'Credit Note', 'Outstanding', 'Status'],
              invoices.map((i) => [
                i.invoiceNumber,
                i.customerName,
                i.dueDate,
                i.grossAmount,
                i.paidAmount,
                i.creditNoteAmount,
                i.outstandingAmount,
                i.status,
              ])
            )
          }
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" /> Export AR CSV
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">GL 1120 Trade Receivables</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">{formatBDT(glByCode.get('1120') ?? 0)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Invoice AR Subledger</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">{formatBDT(aging.total)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Customer Advances (2110)</div>
          <div className="mt-1 text-sm font-bold font-mono text-amber-700">{formatBDT(glByCode.get('2110') ?? 0)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Cust. TDS/VDS Rec (1140)</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">{formatBDT(glByCode.get('1140') ?? 0)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">POS Clearing (1250)</div>
          <div className="mt-1 text-sm font-bold font-mono text-emerald-700">{formatBDT(glByCode.get('1250') ?? 0)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[
          { id: 'ar-aging', label: 'AR Invoice Aging' },
          { id: 'collections', label: 'Collections & Withholding' },
          { id: 'pos-summary', label: 'POS Daily Summary' },
          { id: 'amc', label: 'AMC & Deferred Revenue (2120)' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as O2CTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
              tab === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ar-aging' && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2 text-xs">
            {[
              { label: 'Current', val: aging.current },
              { label: '1–30 Days', val: aging.d30 },
              { label: '31–60 Days', val: aging.d60 },
              { label: '61–90 Days', val: aging.d90 },
              { label: 'Over 90 Days', val: aging.d90Plus },
            ].map((b) => (
              <div key={b.label} className="bg-slate-50 border border-slate-200 rounded p-2.5">
                <div className="text-[11px] text-slate-500">{b.label}</div>
                <div className="font-mono font-bold text-slate-900">{formatBDT(b.val)}</div>
              </div>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2 px-3 text-left">Invoice</th>
                  <th className="py-2 px-3 text-left">Customer</th>
                  <th className="py-2 px-3 text-left">Due Date</th>
                  <th className="py-2 px-3 text-right">Gross</th>
                  <th className="py-2 px-3 text-right">Outstanding</th>
                  <th className="py-2 px-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-400">No posted Sales Invoices yet.</td></tr>
                ) : (
                  invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 px-3 font-mono font-semibold">{i.invoiceNumber}</td>
                      <td className="py-2 px-3">{i.customerName}</td>
                      <td className="py-2 px-3">{i.dueDate}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatBDT(i.grossAmount)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold">{formatBDT(i.outstandingAmount)}</td>
                      <td className="py-2 px-3">{i.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'collections' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2 px-3 text-left">Receipt Ref</th>
                <th className="py-2 px-3 text-left">Customer</th>
                <th className="py-2 px-3 text-left">Deposit GL</th>
                <th className="py-2 px-3 text-right">Collection</th>
                <th className="py-2 px-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receiptVouchers.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 px-3 font-mono font-semibold">{v.voucherRef}</td>
                  <td className="py-2 px-3">{v.customerName || '—'}</td>
                  <td className="py-2 px-3 font-mono">{v.depositToGlCode || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(v.collectionAmount || v.totalAmount)}</td>
                  <td className="py-2 px-3">{v.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pos-summary' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2 px-3 text-left">Receipt No.</th>
                <th className="py-2 px-3 text-left">Customer</th>
                <th className="py-2 px-3 text-left">Payment Method / GL</th>
                <th className="py-2 px-3 text-right">Grand Total</th>
                <th className="py-2 px-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.posTransactions.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 px-3 font-mono font-semibold">{p.receiptNo}</td>
                  <td className="py-2 px-3">{p.customerName}</td>
                  <td className="py-2 px-3">{p.paymentMethod} (GL {p.settlementGlCode})</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(p.grandTotal)}</td>
                  <td className="py-2 px-3">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'amc' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => setShowAmcModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New AMC Contract
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2 px-3 text-left">Contract No.</th>
                  <th className="py-2 px-3 text-left">Customer</th>
                  <th className="py-2 px-3 text-left">Period</th>
                  <th className="py-2 px-3 text-right">Annual Value</th>
                  <th className="py-2 px-3 text-right">Recognized</th>
                  <th className="py-2 px-3 text-right">Deferred (2120)</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {amcContracts.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400">No AMC contracts registered yet.</td></tr>
                ) : (
                  amcContracts.map((c) => {
                    const monthlySlice = round2(Math.min(c.deferredAmount, c.annualValue / 12));
                    return (
                      <tr key={c.id}>
                        <td className="py-2 px-3 font-mono font-semibold">{c.contractNo}</td>
                        <td className="py-2 px-3">{c.customerName}</td>
                        <td className="py-2 px-3">{c.startDate} → {c.endDate}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatBDT(c.annualValue)}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-700">{formatBDT(c.recognizedAmount)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{formatBDT(c.deferredAmount)}</td>
                        <td className="py-2 px-3 text-right">
                          {c.deferredAmount > 0.01 && (
                            <button
                              onClick={() => handleRecognizeAmc(c.id, monthlySlice)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Recognize 1M ({formatBDT(monthlySlice)})
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
        </div>
      )}

      {showAmcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreateAmc} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">New AMC Contract (Deferred 2120)</h2>
              <button type="button" onClick={() => setShowAmcModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Contract No. *</label>
              <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Customer *</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {state.customers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block font-medium text-slate-700 mb-1">Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" /></div>
              <div><label className="block font-medium text-slate-700 mb-1">End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" /></div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Annual Contract Value (BDT) *</label>
              <input type="number" step="0.01" min="0" value={annualValue} onChange={(e) => setAnnualValue(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowAmcModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">{submitting ? 'Saving...' : 'Create AMC'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { BarChart3, Download, Plus, X } from 'lucide-react';
import { computeGLSummary, exportRowsToCSV, formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface ProcurementReportsPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type ReportTab = 'open-po' | 'purchase-reg' | 'tax-challan' | 'lc-recon';

export const ProcurementReportsPage: React.FC<ProcurementReportsPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const [tab, setTab] = useState<ReportTab>('open-po');
  const [showRemitModal, setShowRemitModal] = useState(false);

  const [challanNo, setChallanNo] = useState('');
  const [remittanceDate, setRemittanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [taxType, setTaxType] = useState<'TDS' | 'VDS'>('TDS');
  const [paidFromGlCode, setPaidFromGlCode] = useState('1240');
  const [amount, setAmount] = useState('');
  const [mushak66Ref, setMushak66Ref] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const glByCode = useMemo(() => {
    const summary = computeGLSummary(state);
    return new Map(summary.map((r) => [r.code, r.closingBalance]));
  }, [state]);

  const openPos = useMemo(
    () => (state.localPurchaseOrders || []).filter((po) => po.status !== 'Settled'),
    [state.localPurchaseOrders]
  );

  const invoices = useMemo(
    () => (state.purchaseInvoices || []).filter((i) => i.status !== 'Voided'),
    [state.purchaseInvoices]
  );

  const paymentVouchers = useMemo(
    () =>
      (state.vouchers || []).filter(
        (v) => v.voucherType === 'Payment' && v.status !== 'Voided' && ((v.tdsAmount || 0) > 0 || (v.vdsAmount || 0) > 0)
      ),
    [state.vouchers]
  );

  const remittances = state.taxRemittances || [];
  const bankAccounts = state.accounts.filter(
    (a) => a.category === 'Asset' && (a.code.startsWith('12') || a.name.toLowerCase().includes('bank') || a.name.toLowerCase().includes('cash'))
  );

  const metrics = useMemo(() => {
    const openPoValue = round2(openPos.reduce((s, o) => s + o.grossAmount, 0));
    const apSubledgerTotal = round2(invoices.reduce((s, i) => s + i.outstandingAmount, 0));
    const apGl2080 = round2(glByCode.get('2080') ?? 0);
    const grniGl2090 = round2(glByCode.get('2090') ?? 0);
    const tdsGl2200 = round2(glByCode.get('2200') ?? 0);
    const vdsGl2210 = round2(glByCode.get('2210') ?? 0);
    return { openPoValue, apSubledgerTotal, apGl2080, grniGl2090, tdsGl2200, vdsGl2210 };
  }, [openPos, invoices, glByCode]);

  const handleRemit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createTaxRemittance({
        challanNo: challanNo.trim().toUpperCase(),
        remittanceDate,
        taxType,
        glCode: taxType === 'VDS' ? '2210' : '2200',
        paidFromGlCode,
        amount: Number(amount) || 0,
        mushak66Ref: mushak66Ref.trim() || undefined,
        notes: `NBR Treasury Challan (${taxType})`,
      });
      onStateChange(res.state);
      onNotify('success', `Posted Treasury Challan ${res.remittance.challanNo} to GL.`);
      setShowRemitModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to post tax remittance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#2563EB]" />
            Procurement, Tax &amp; GL Reconciliation Reports
          </h1>
          <p className="text-xs text-slate-500">
            Monitor Open POs, GRNI (2090) &amp; AP (2080) reconciliation, TDS/VDS treasury challans (2200/2210), and Mushak 6.3/6.6 compliance.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRemitModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Record Tax Challan
          </button>
          <button
            onClick={() =>
              exportRowsToCSV(
                'ATCL_Purchase_Register.csv',
                ['Invoice No', 'Supplier Bill', 'Supplier', 'Mushak 6.3', 'Gross', 'Paid', 'Outstanding', 'Status'],
                invoices.map((i) => [
                  i.invoiceNumber,
                  i.supplierInvoiceNo,
                  i.supplierName,
                  i.mushak63Ref || '',
                  i.grossAmount,
                  i.paidAmount,
                  i.outstandingAmount,
                  i.status,
                ])
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Open PO Exposure ({openPos.length})</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">{formatBDT(metrics.openPoValue)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">GRNI Control (GL 2090)</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">{formatBDT(metrics.grniGl2090)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">AP Subledger / GL 2080</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">
            {formatBDT(metrics.apSubledgerTotal)} / {formatBDT(metrics.apGl2080)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">TDS Payable (GL 2200)</div>
          <div className="mt-1 text-sm font-bold font-mono text-amber-700">{formatBDT(metrics.tdsGl2200)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">VDS Payable (GL 2210)</div>
          <div className="mt-1 text-sm font-bold font-mono text-amber-700">{formatBDT(metrics.vdsGl2210)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[
          { id: 'open-po', label: 'Open POs & Pending GRN' },
          { id: 'purchase-reg', label: 'Purchase Register (Mushak 6.3)' },
          { id: 'tax-challan', label: 'TDS / VDS & Treasury Challans' },
          { id: 'lc-recon', label: 'Import LC Exposure' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as ReportTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
              tab === t.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'open-po' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">PO No.</th>
                <th className="py-2.5 px-3 text-left">Supplier</th>
                <th className="py-2.5 px-3 text-left">Expected Date</th>
                <th className="py-2.5 px-3 text-right">Gross (BDT)</th>
                <th className="py-2.5 px-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {openPos.map((po) => (
                <tr key={po.id}>
                  <td className="py-2 px-3 font-mono font-semibold">{po.poNumber}</td>
                  <td className="py-2 px-3">{po.supplierName}</td>
                  <td className="py-2 px-3">{po.expectedDate}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(po.grossAmount)}</td>
                  <td className="py-2 px-3">{po.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'purchase-reg' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Invoice No.</th>
                <th className="py-2.5 px-3 text-left">Vendor Bill / Mushak 6.3</th>
                <th className="py-2.5 px-3 text-left">Supplier</th>
                <th className="py-2.5 px-3 text-right">Net</th>
                <th className="py-2.5 px-3 text-right">VAT</th>
                <th className="py-2.5 px-3 text-right">Gross</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400">No posted purchase invoices yet.</td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2 px-3 font-mono font-semibold">{inv.invoiceNumber}</td>
                    <td className="py-2 px-3 font-mono">{inv.supplierInvoiceNo} {inv.mushak63Ref ? `· ${inv.mushak63Ref}` : ''}</td>
                    <td className="py-2 px-3">{inv.supplierName}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatBDT(inv.netAmount)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatBDT(inv.vatAmount)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{formatBDT(inv.grossAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'tax-challan' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
              Withheld at Source (Payment Vouchers)
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50/50 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-left">Voucher</th>
                  <th className="py-2 px-3 text-left">Supplier</th>
                  <th className="py-2 px-3 text-right">TDS (2200)</th>
                  <th className="py-2 px-3 text-right">VDS (2210)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentVouchers.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No TDS/VDS deductions recorded.</td></tr>
                ) : (
                  paymentVouchers.map((v) => (
                    <tr key={v.id}>
                      <td className="py-2 px-3 font-mono">{v.voucherRef}</td>
                      <td className="py-2 px-3">{v.supplierName}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatBDT(v.tdsAmount || 0)}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatBDT(v.vdsAmount || 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
              Treasury Challan Deposits &amp; Mushak 6.6
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50/50 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-left">Challan No.</th>
                  <th className="py-2 px-3 text-left">Type / Mushak 6.6</th>
                  <th className="py-2 px-3 text-left">Date</th>
                  <th className="py-2 px-3 text-right">Deposited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {remittances.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No treasury remittances posted yet.</td></tr>
                ) : (
                  remittances.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 px-3 font-mono font-semibold">{r.challanNo}</td>
                      <td className="py-2 px-3">{r.taxType} ({r.glCode}) {r.mushak66Ref ? `· ${r.mushak66Ref}` : ''}</td>
                      <td className="py-2 px-3">{r.remittanceDate}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700">{formatBDT(r.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'lc-recon' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">LC Number</th>
                <th className="py-2.5 px-3 text-left">Bank / Loan GL</th>
                <th className="py-2.5 px-3 text-left">Maturity</th>
                <th className="py-2.5 px-3 text-right">Landed Cost</th>
                <th className="py-2.5 px-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.importLCs.map((lc) => (
                <tr key={lc.id}>
                  <td className="py-2 px-3 font-mono font-semibold">{lc.lcNumber}</td>
                  <td className="py-2 px-3">{lc.issuingBank} (GL {lc.loanGlCode})</td>
                  <td className="py-2 px-3">{lc.maturityDate}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(lc.totalLandedCostBdt)}</td>
                  <td className="py-2 px-3">{lc.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRemitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleRemit} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Record Treasury Tax Challan</h2>
              <button type="button" onClick={() => setShowRemitModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Challan No. *</label>
                <input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} placeholder="TR-2026-0041" className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={remittanceDate} onChange={(e) => setRemittanceDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tax Type</label>
                <select value={taxType} onChange={(e) => setTaxType(e.target.value as 'TDS' | 'VDS')} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="TDS">TDS / AIT (GL 2200)</option>
                  <option value="VDS">VAT / VDS (GL 2210)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Paid From Bank GL</label>
                <select value={paidFromGlCode} onChange={(e) => setPaidFromGlCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  {bankAccounts.map((b) => (
                    <option key={b.code} value={b.code}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount (BDT) *</label>
                <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Mushak 6.6 Ref</label>
                <input value={mushak66Ref} onChange={(e) => setMushak66Ref(e.target.value)} placeholder="M6.6-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowRemitModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-emerald-600 text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Posting...' : 'Post Challan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

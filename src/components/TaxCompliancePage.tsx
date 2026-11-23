import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  Landmark,
  Plus,
  Printer,
  Scale,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  ensureDefaultTaxRules,
  exportRowsToCSV,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState, TaxWithholdingRule } from '../types/accounting.ts';

interface TaxCompliancePageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onOpenRegister: (code: string) => void;
}

export const TaxCompliancePage: React.FC<TaxCompliancePageProps> = ({
  state,
  onStateChange,
  onNotify,
  onOpenRegister,
}) => {
  const [activeTab, setActiveTab] = useState<'mushak91' | 'mushak63' | 'challans' | 'rules'>('mushak91');
  const [showChallanModal, setShowChallanModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [previewMushakDoc, setPreviewMushakDoc] = useState<{
    kind: 'Sales' | 'Purchase';
    docNo: string;
    mushakRef: string;
    date: string;
    partyName: string;
    net: number;
    vat: number;
    gross: number;
  } | null>(null);

  // Treasury Challan form
  const [challanNo, setChallanNo] = useState('');
  const [remittanceDate, setRemittanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [taxType, setTaxType] = useState<'TDS' | 'VDS'>('TDS');
  const [paidFromGlCode, setPaidFromGlCode] = useState('1240');
  const [remAmount, setRemAmount] = useState('');
  const [mushak66Ref, setMushak66Ref] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Rule form
  const [ruleCategory, setRuleCategory] = useState('');
  const [ruleVat, setRuleVat] = useState('15');
  const [ruleTds, setRuleTds] = useState('5');
  const [ruleVds, setRuleVds] = useState('7.5');
  const [ruleSection, setRuleSection] = useState('ITA 2023 Sec 89 / VAT Act 2012');
  const [ruleDesc, setRuleDesc] = useState('');

  const glSummary = useMemo(() => computeGLSummary(state), [state]);
  const gl2070 = glSummary.find((a) => a.code === '2070')?.closingBalance ?? 0;
  const gl2200 = glSummary.find((a) => a.code === '2200')?.closingBalance ?? 0;
  const gl2210 = glSummary.find((a) => a.code === '2210')?.closingBalance ?? 0;
  const gl1140 = glSummary.find((a) => a.code === '1140')?.closingBalance ?? 0;

  const rules: TaxWithholdingRule[] = useMemo(() => {
    if (state.taxRules && state.taxRules.length > 0) return state.taxRules;
    const clone = { ...state, taxRules: [] as TaxWithholdingRule[] };
    return ensureDefaultTaxRules(clone);
  }, [state]);

  const vatSummary = useMemo(() => {
    const salesInvoices = (state.salesInvoices || []).filter((i) => i.status !== 'Voided');
    const posSales = (state.posTransactions || []).filter((p) => p.status !== 'Voided');
    const purchaseInvoices = (state.purchaseInvoices || []).filter((i) => i.status !== 'Voided');

    const outputVatInvoices = round2(salesInvoices.reduce((s, i) => s + (i.vatAmount || 0), 0));
    const outputVatPos = round2(posSales.reduce((s, p) => s + (p.vatAmount || 0), 0));
    const totalOutputVat = round2(outputVatInvoices + outputVatPos);
    const inputVatRebate = round2(purchaseInvoices.reduce((s, p) => s + (p.vatAmount || 0), 0));
    const vdsWithheld = round2(
      state.vouchers
        .filter((v) => v.status !== 'Voided' && v.voucherType === 'Payment')
        .reduce((s, v) => s + (v.vdsAmount || 0), 0)
    );
    const netReturnPayable = round2(Math.max(0, totalOutputVat - inputVatRebate + vdsWithheld));
    return {
      salesNet: round2(salesInvoices.reduce((s, i) => s + i.netAmount, 0) + posSales.reduce((s, p) => p.subtotal + s, 0)),
      outputVatInvoices,
      outputVatPos,
      totalOutputVat,
      purchaseNet: round2(purchaseInvoices.reduce((s, i) => s + i.netAmount, 0)),
      inputVatRebate,
      vdsWithheld,
      netReturnPayable,
    };
  }, [state]);

  const mushak63Rows = useMemo(() => {
    const sales = (state.salesInvoices || []).map((i) => ({
      kind: 'Sales' as const,
      docNo: i.invoiceNumber,
      mushakRef: i.mushak63Ref || `M6.3-${i.invoiceNumber}`,
      date: i.invoiceDate,
      partyName: i.customerName,
      net: i.netAmount,
      vat: i.vatAmount,
      gross: i.grossAmount,
    }));
    const purchases = (state.purchaseInvoices || []).map((i) => ({
      kind: 'Purchase' as const,
      docNo: i.invoiceNumber,
      mushakRef: i.mushak63Ref || `M6.3-${i.supplierInvoiceNo}`,
      date: i.invoiceDate,
      partyName: i.supplierName,
      net: i.netAmount,
      vat: i.vatAmount,
      gross: i.grossAmount,
    }));
    return [...sales, ...purchases].sort((a, b) => b.date.localeCompare(a.date));
  }, [state.salesInvoices, state.purchaseInvoices]);

  const remittances = state.taxRemittances || [];

  const handleExportMushak91 = () => {
    exportRowsToCSV(
      'ATCL_Mushak_9_1_VAT_Working.csv',
      ['NBR Return Line', 'Taxable Value (BDT)', 'VAT / Tax Amount (BDT)', 'GL Reference'],
      [
        ['1. Output VAT — B2B Sales Invoices', vatSummary.salesNet.toFixed(2), vatSummary.outputVatInvoices.toFixed(2), '2070'],
        ['2. Output VAT — Retail Counter POS', '—', vatSummary.outputVatPos.toFixed(2), '2070'],
        ['3. Input VAT Credit (Mushak 6.3 Purchases)', vatSummary.purchaseNet.toFixed(2), (-vatSummary.inputVatRebate).toFixed(2), '2070'],
        ['4. Increasing Adj — Vendor VDS Withheld', '—', vatSummary.vdsWithheld.toFixed(2), '2210'],
        ['5. Net VAT Payable / Closing GL 2070 Balance', '—', gl2070.toFixed(2), '2070'],
      ]
    );
  };

  const handleCreateChallan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createTaxRemittance({
        challanNo: challanNo.trim().toUpperCase(),
        remittanceDate,
        taxType,
        glCode: taxType === 'VDS' ? '2210' : '2200',
        paidFromGlCode,
        amount: round2(Number(remAmount) || 0),
        mushak66Ref: mushak66Ref.trim() || undefined,
        notes: 'Deposited via Sonali Bank / A-Challan NBR portal',
      });
      onStateChange(res.state);
      onNotify('success', `Posted NBR Treasury Challan ${res.remittance.challanNo} (${taxType}) to GL.`);
      setShowChallanModal(false);
      setChallanNo('');
      setRemAmount('');
      setMushak66Ref('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to post treasury challan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createTaxRule({
        category: ruleCategory.trim(),
        vatRate: Number(ruleVat) || 0,
        tdsRate: Number(ruleTds) || 0,
        vdsRate: Number(ruleVds) || 0,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        nbrSectionRef: ruleSection.trim(),
        description: ruleDesc.trim(),
        active: true,
      });
      onStateChange(res.state);
      onNotify('success', `Added NBR Tax Rule '${res.rule.category}'.`);
      setShowRuleModal(false);
      setRuleCategory('');
      setRuleDesc('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save tax rule.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await api.deleteTaxRule(id);
      onStateChange(res.state);
      onNotify('info', 'Removed tax rule.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to remove rule.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Bangladesh Tax &amp; NBR Compliance (VAT / AIT / Mushak)</h1>
          <p className="text-xs text-slate-500">
            ATCL BIN: <span className="font-mono font-semibold text-slate-700">{state.config.binVatNumber || '001482936-0101'}</span> · TIN:{' '}
            <span className="font-mono font-semibold text-slate-700">{state.config.tinNumber || '5498-2104-7731'}</span> · Mushak 6.3, 6.6 &amp; 9.1 Return Prep
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportMushak91}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export Mushak 9.1 CSV
          </button>
          <button
            onClick={() => setShowChallanModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
          >
            <Landmark className="w-3.5 h-3.5" /> Post Treasury Challan
          </button>
        </div>
      </div>

      {/* Statutory GL Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div onClick={() => onOpenRegister('2070')} className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="text-xs text-slate-500">Net VAT Payable (GL 2070)</div>
          <div className="mt-1.5 text-xl font-bold font-mono text-slate-900">{formatBDT(gl2070)}</div>
          <div className="text-[11px] text-[#2563EB] mt-1">Click to inspect GL 2070 Register &rarr;</div>
        </div>
        <div onClick={() => onOpenRegister('2200')} className="bg-white border border-slate-200 border-t-2 border-t-amber-600 rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="text-xs text-slate-500">Vendor AIT / TDS Payable (GL 2200)</div>
          <div className="mt-1.5 text-xl font-bold font-mono text-amber-700">{formatBDT(gl2200)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Due for NBR A-Challan deposit</div>
        </div>
        <div onClick={() => onOpenRegister('2210')} className="bg-white border border-slate-200 border-t-2 border-t-indigo-600 rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="text-xs text-slate-500">Vendor VDS Payable (GL 2210)</div>
          <div className="mt-1.5 text-xl font-bold font-mono text-indigo-700">{formatBDT(gl2210)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Issue Mushak 6.6 after deposit</div>
        </div>
        <div onClick={() => onOpenRegister('1140')} className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="text-xs text-slate-500">Customer TDS/VDS Cert Receivable (1140)</div>
          <div className="mt-1.5 text-xl font-bold font-mono text-emerald-700">{formatBDT(gl1140)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Withholding certificates from clients</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex flex-wrap bg-slate-200/70 p-1 rounded-lg gap-1 text-xs">
        {[
          { id: 'mushak91', label: 'Mushak 9.1 Return Working' },
          { id: 'mushak63', label: `Mushak 6.3 Register (${mushak63Rows.length})` },
          { id: 'challans', label: `TDS/VDS Treasury Challans (${remittances.length})` },
          { id: 'rules', label: `NBR Withholding Rules (${rules.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
              activeTab === t.id ? 'bg-white text-[#2563EB] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'mushak91' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-[#2563EB]" /> Monthly VAT Return Working — NBR Mushak 9.1 Summary ({state.config.fiscalPeriod})
            </span>
            <span className="text-[11px] font-mono text-slate-500">BIN: {state.config.binVatNumber || '001482936-0101'}</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-4 text-left">Mushak 9.1 Part / Line Item</th>
                <th className="py-2.5 px-4 text-right">Taxable Base (BDT)</th>
                <th className="py-2.5 px-4 text-right">VAT / VDS Amount (BDT)</th>
                <th className="py-2.5 px-4 text-left">GL Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Part 3 — Output VAT on B2B Tax Invoices (Mushak 6.3)</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatBDT(vatSummary.salesNet)}</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">{formatBDT(vatSummary.outputVatInvoices)}</td>
                <td className="py-2.5 px-4 font-mono text-[#2563EB]">2070 / Sales Invoices</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Part 3 — Output VAT on Retail Counter POS Sales</td>
                <td className="py-2.5 px-4 text-right font-mono">—</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">{formatBDT(vatSummary.outputVatPos)}</td>
                <td className="py-2.5 px-4 font-mono text-[#2563EB]">2070 / POS Counter</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Part 4 — Input VAT Rebate on Local Purchases &amp; LC Imports</td>
                <td className="py-2.5 px-4 text-right font-mono">{formatBDT(vatSummary.purchaseNet)}</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700">({formatBDT(vatSummary.inputVatRebate)})</td>
                <td className="py-2.5 px-4 font-mono text-[#2563EB]">2070 / Purchase Inv</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Part 5 — Increasing Adjustment for Vendor VDS Withheld (Mushak 6.6)</td>
                <td className="py-2.5 px-4 text-right font-mono">—</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold text-indigo-700">{formatBDT(vatSummary.vdsWithheld)}</td>
                <td className="py-2.5 px-4 font-mono text-[#2563EB]">2210 / Payment Vch</td>
              </tr>
              <tr className="bg-slate-50 font-bold">
                <td className="py-3 px-4 text-slate-900">Net VAT &amp; VDS Obligation Computed for Return</td>
                <td className="py-3 px-4 text-right font-mono">—</td>
                <td className="py-3 px-4 text-right font-mono text-slate-900">{formatBDT(vatSummary.netReturnPayable)}</td>
                <td className="py-3 px-4 font-mono text-emerald-700">GL 2070: {formatBDT(gl2070)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'mushak63' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Type</th>
                <th className="py-2.5 px-3 text-left">Mushak 6.3 Ref</th>
                <th className="py-2.5 px-3 text-left">ERP Invoice #</th>
                <th className="py-2.5 px-3 text-left">Date / Party</th>
                <th className="py-2.5 px-3 text-right">Net Value</th>
                <th className="py-2.5 px-3 text-right">VAT</th>
                <th className="py-2.5 px-3 text-right">Gross</th>
                <th className="py-2.5 px-3 text-right">Form</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mushak63Rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    <FileText className="w-7 h-7 mx-auto mb-2 opacity-40" />
                    No Purchase or Sales Invoices posted yet.
                  </td>
                </tr>
              ) : (
                mushak63Rows.map((row) => (
                  <tr key={`${row.kind}-${row.docNo}`} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${row.kind === 'Sales' ? 'bg-blue-50 text-[#2563EB]' : 'bg-emerald-50 text-emerald-700'}`}>
                        {row.kind}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{row.mushakRef}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{row.docNo}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-800">{row.partyName}</div>
                      <div className="text-[11px] text-slate-400">{row.date}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatBDT(row.net)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-indigo-700">{formatBDT(row.vat)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatBDT(row.gross)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => setPreviewMushakDoc(row)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                      >
                        <Printer className="w-3 h-3" /> 6.3 Form
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'challans' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Challan No.</th>
                <th className="py-2.5 px-3 text-left">Date / Tax Type</th>
                <th className="py-2.5 px-3 text-left">Mushak 6.6 Ref</th>
                <th className="py-2.5 px-3 text-left">GL Pair</th>
                <th className="py-2.5 px-3 text-right">Deposited (BDT)</th>
                <th className="py-2.5 px-3 text-left">Posted Voucher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {remittances.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No NBR Treasury Challans posted yet. Click &ldquo;Post Treasury Challan&rdquo; to deposit TDS/VDS.
                  </td>
                </tr>
              ) : (
                remittances.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{r.challanNo}</td>
                    <td className="py-2.5 px-3">{r.remittanceDate} · {r.taxType}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{r.mushak66Ref || '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">Dr {r.glCode} / Cr {r.paidFromGlCode}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">{formatBDT(r.amount)}</td>
                    <td className="py-2.5 px-3 font-mono text-[#2563EB]">{r.postedVoucherNo}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => setShowRuleModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add NBR Withholding Rule
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3 text-left">Supply / Service Category</th>
                  <th className="py-2.5 px-3 text-right">VAT %</th>
                  <th className="py-2.5 px-3 text-right">TDS (AIT) %</th>
                  <th className="py-2.5 px-3 text-right">VDS %</th>
                  <th className="py-2.5 px-3 text-left">NBR Statutory Reference</th>
                  <th className="py-2.5 px-3 text-left">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{r.category}</div>
                      {r.description && <div className="text-[11px] text-slate-400">{r.description}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{(r.vatRate ?? 15).toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-700">{r.tdsRate.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right font-mono text-indigo-700">{r.vdsRate.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{r.nbrSectionRef}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px]">
                        <CheckCircle2 className="w-3 h-3" /> {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => void handleDeleteRule(r.id)}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        title="Delete rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showChallanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreateChallan} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Post NBR Treasury Challan (TDS / VDS)</h2>
              <button type="button" onClick={() => setShowChallanModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">A-Challan No. *</label>
                <input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} placeholder="2526-0001894" className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Deposit Date</label>
                <input type="date" value={remittanceDate} onChange={(e) => setRemittanceDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Statutory Head</label>
                <select value={taxType} onChange={(e) => setTaxType(e.target.value as 'TDS' | 'VDS')} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option value="TDS">TDS / AIT Payable (GL 2200)</option>
                  <option value="VDS">VAT / VDS Payable (GL 2210)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Paid From Bank GL</label>
                <select value={paidFromGlCode} onChange={(e) => setPaidFromGlCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white font-mono">
                  <option value="1240">1240 — Bank SJIBL</option>
                  <option value="1230">1230 — Bank Al-Arafah</option>
                  <option value="1220">1220 — Bank IBBL</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount (BDT) *</label>
                <input type="number" step="0.01" min="0.01" value={remAmount} onChange={(e) => setRemAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Mushak 6.6 Cert Ref</label>
                <input value={mushak66Ref} onChange={(e) => setMushak66Ref(e.target.value)} placeholder="M6.6-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowChallanModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Post Challan to GL</button>
            </div>
          </form>
        </div>
      )}

      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreateRule} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Add NBR Tax Withholding Rule</h2>
              <button type="button" onClick={() => setShowRuleModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Category *</label>
              <input value={ruleCategory} onChange={(e) => setRuleCategory(e.target.value)} placeholder="e.g., Turnkey Substation Engineering" className="w-full px-2.5 py-2 border border-slate-300 rounded" required />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">VAT %</label>
                <input type="number" step="0.1" value={ruleVat} onChange={(e) => setRuleVat(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">TDS %</label>
                <input type="number" step="0.1" value={ruleTds} onChange={(e) => setRuleTds(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">VDS %</label>
                <input type="number" step="0.1" value={ruleVds} onChange={(e) => setRuleVds(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">NBR Section Reference *</label>
              <input value={ruleSection} onChange={(e) => setRuleSection(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Notes</label>
              <input value={ruleDesc} onChange={(e) => setRuleDesc(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowRuleModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Save Rule</button>
            </div>
          </form>
        </div>
      )}

      {previewMushakDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="font-bold text-sm text-slate-900">MUSHAK-6.3 Tax Invoice Abstract</div>
              <button onClick={() => setPreviewMushakDoc(null)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-1 font-mono text-[11px]">
              <div><span className="text-slate-500">Registered Entity:</span> {state.config.organizationName}</div>
              <div><span className="text-slate-500">BIN (VAT Reg):</span> {state.config.binVatNumber || '001482936-0101'}</div>
              <div><span className="text-slate-500">Address:</span> {state.config.registeredAddress || 'Banani, Dhaka 1213'}</div>
              <hr className="my-2 border-slate-200" />
              <div><span className="text-slate-500">Mushak 6.3 Chalan #:</span> {previewMushakDoc.mushakRef}</div>
              <div><span className="text-slate-500">ERP Ref / Date:</span> {previewMushakDoc.docNo} ({previewMushakDoc.date})</div>
              <div><span className="text-slate-500">Counterparty:</span> {previewMushakDoc.partyName}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-center bg-white border border-slate-200 rounded p-3">
              <div>
                <div className="text-[11px] text-slate-400">Net Value</div>
                <div className="font-bold">{formatBDT(previewMushakDoc.net)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">VAT (15%)</div>
                <div className="font-bold text-indigo-700">{formatBDT(previewMushakDoc.vat)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Total Incl. VAT</div>
                <div className="font-bold text-emerald-700">{formatBDT(previewMushakDoc.gross)}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                <Printer className="w-3.5 h-3.5" /> Print Form
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

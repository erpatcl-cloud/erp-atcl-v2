import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookCheck,
  CheckCircle2,
  CreditCard,
  FileUp,
  Link2,
  Plus,
  ReceiptText,
  Scale,
  ShieldCheck,
  Trash2,
  Wallet,
  Wand2,
  X,
} from 'lucide-react';
import {
  computeGLSummary,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type {
  ExpenseSplitItem,
  InvoiceAllocation,
  LedgerState,
  SalesInvoiceAllocation,
  VoucherAttachment,
  VoucherDoubleEntryLine,
  VoucherKind,
  VoucherRecord,
  VoucherSourceDocLink,
} from '../types/accounting.ts';

interface VoucherCreationModalProps {
  voucherType: VoucherKind;
  state: LedgerState;
  suggestedRef: string;
  onClose: () => void;
  onSubmit: (
    payload: Omit<VoucherRecord, 'id' | 'updatedAt' | 'createdBy' | 'postedToGl'> & {
      postImmediately?: boolean;
    }
  ) => Promise<void>;
}

const TDS_OPTIONS = [
  { label: 'No Deduction (0%)', rate: 0 },
  { label: '2% — Local Material Supply', rate: 2 },
  { label: '3% — Contractors & Execution', rate: 3 },
  { label: '5% — Technical & C&F Services', rate: 5 },
  { label: '7% — Engineering Subcontract', rate: 7 },
  { label: '10% — Professional & Audit Fees', rate: 10 },
];

const VDS_OPTIONS = [
  { label: 'No Deduction (0%)', rate: 0 },
  { label: '5% — Procurement VDS', rate: 5 },
  { label: '7.5% — Standard Supply VDS', rate: 7.5 },
  { label: '10% — Service & Maintenance VDS', rate: 10 },
  { label: '15% — Full Statutory VDS', rate: 15 },
];

const PAYMENT_MODES = ['Bank Transfer', 'BEFTN / RTGS', 'Cheque', 'Pay Order', 'Cash'];
const RECEIPT_MODES = ['Bank Transfer', 'BEFTN / RTGS', 'Cheque', 'Cash', 'bKash / MFS', 'LC Realization'];
const JOURNAL_POSTING_TYPES = [
  'General Correction Ledger',
  'Accrual & Prepayment',
  'Depreciation & Amortization',
  'Tax & Provision',
  'Inter-Bank Transfer',
  'Reclassification',
];

const EMPLOYEES = [
  'Engr. Rafiqul Islam (Head of Projects)',
  'Engr. Ashfaqur Rahman (Lead Field Engineer)',
  'Engr. Mehedi Hasan (Workshop Manager)',
  'Engr. Farhan Kabir (Automation Specialist)',
  'Tanvir Ahmed (Enterprise Sales Lead)',
  'Nusrat Jahan (Admin & Operations)',
  'K. Mahmud (Counter Operations)',
];

const DEPARTMENTS: Array<{ name: string; annualBudget: number }> = [
  { name: 'IT Department', annualBudget: 2500000 },
  { name: 'Engineering & Projects', annualBudget: 8500000 },
  { name: 'Service Workshop', annualBudget: 3200000 },
  { name: 'Admin & HR', annualBudget: 4800000 },
  { name: 'Finance & Accounts', annualBudget: 1800000 },
  { name: 'Sales & Distribution', annualBudget: 3600000 },
  { name: 'Supply Chain & Logistics', annualBudget: 5200000 },
];

const COST_CENTERS = [
  'IT Hardware/Services',
  'Substation & Utility Ops',
  'Field Commissioning',
  'Workshop Maintenance',
  'Corporate Admin',
  'Warehouse & Fleet',
];

const PROJECTS = [
  'General Overhead',
  'DESCO 11kV Lot-4',
  'PGCB Grid SCADA',
  'Grameenphone UPS Rollout',
  'DBBL Tier-III DC',
  'Beximco PLC Phase-II',
];

interface JournalDraftRow {
  id: string;
  glCode: string;
  side: 'Debit' | 'Credit';
  amount: string;
}

interface ExpenseSplitDraft {
  id: string;
  glCode: string;
  memo: string;
  amount: string;
}

export const VoucherCreationModal: React.FC<VoucherCreationModalProps> = ({
  voucherType,
  state,
  suggestedRef,
  onClose,
  onSubmit,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live GL closing balances
  const glSummaryMap = useMemo(() => {
    const rows = computeGLSummary(state);
    return new Map(rows.map((r) => [r.code, r]));
  }, [state]);

  const activeAccounts = useMemo(
    () => state.accounts.filter((a) => a.status === 'Active'),
    [state.accounts]
  );

  const cashBankAccounts = useMemo(
    () =>
      activeAccounts.filter(
        (a) =>
          a.code === '1210' ||
          a.code === '1220' ||
          a.code === '1230' ||
          a.code === '1240' ||
          a.group.toLowerCase().includes('cash') ||
          a.group.toLowerCase().includes('bank')
      ),
    [activeAccounts]
  );

  const expenseAccounts = useMemo(
    () => activeAccounts.filter((a) => a.category === 'Expense'),
    [activeAccounts]
  );

  const defaultBankCode = cashBankAccounts.find((a) => a.code === '1240')?.code || cashBankAccounts[0]?.code || '1210';

  // Common Header Fields
  const [voucherDate, setVoucherDate] = useState(today);
  const [postingDate, setPostingDate] = useState(today);
  const [voucherRef, setVoucherRef] = useState(suggestedRef);
  const [narration, setNarration] = useState('');
  const [postImmediately, setPostImmediately] = useState(false);
  const [linkedSourceDocs, setLinkedSourceDocs] = useState<VoucherSourceDocLink[]>([]);
  const [attachments, setAttachments] = useState<VoucherAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiReason, setAiReason] = useState<string | null>(null);

  // Payment Voucher state
  const [supplierId, setSupplierId] = useState('');
  const [invoiceAllocations, setInvoiceAllocations] = useState<InvoiceAllocation[]>([]);
  const [tdsRate, setTdsRate] = useState<number>(0);
  const [vdsRate, setVdsRate] = useState<number>(0);
  const [baseAmount, setBaseAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Bank Transfer');
  const [paidFromGlCode, setPaidFromGlCode] = useState(defaultBankCode);
  const [bankReferenceNo, setBankReferenceNo] = useState('');

  // Receipt Voucher state
  const [customerId, setCustomerId] = useState('');
  const [salesInvoiceAllocations, setSalesInvoiceAllocations] = useState<SalesInvoiceAllocation[]>([]);
  const [isCustomerAdvance, setIsCustomerAdvance] = useState(false);
  const [custTdsRate, setCustTdsRate] = useState<number>(0);
  const [custVdsRate, setCustVdsRate] = useState<number>(0);
  const [custCertRef, setCustCertRef] = useState('');
  const [collectionAmount, setCollectionAmount] = useState('');
  const [receiptMode, setReceiptMode] = useState('Bank Transfer');
  const [depositToGlCode, setDepositToGlCode] = useState(defaultBankCode);

  // Journal Voucher state
  const [postingType, setPostingType] = useState(JOURNAL_POSTING_TYPES[0]);
  const [autoReverseDate, setAutoReverseDate] = useState('');
  const [journalPartyFilter, setJournalPartyFilter] = useState('');
  const [journalRows, setJournalRows] = useState<JournalDraftRow[]>([
    { id: 'r1', glCode: cashBankAccounts[0]?.code || activeAccounts[0]?.code || '1210', side: 'Debit', amount: '' },
    { id: 'r2', glCode: activeAccounts.find((a) => a.code === '4010')?.code || activeAccounts[1]?.code || '4010', side: 'Credit', amount: '' },
  ]);

  // Expense Voucher state
  const [allocationMode, setAllocationMode] = useState<'Simple Cost' | 'Split Multi-Item'>('Simple Cost');
  const [employeeName, setEmployeeName] = useState('');
  const [simpleExpenseGlCode, setSimpleExpenseGlCode] = useState('');
  const [simpleExpenseAmount, setSimpleExpenseAmount] = useState('');
  const [expenseSplits, setExpenseSplits] = useState<ExpenseSplitDraft[]>([
    { id: 's1', glCode: expenseAccounts[0]?.code || '5190', memo: '', amount: '' },
    { id: 's2', glCode: expenseAccounts[1]?.code || '5160', memo: '', amount: '' },
  ]);
  const [department, setDepartment] = useState(DEPARTMENTS[0].name);
  const [costCenter, setCostCenter] = useState(COST_CENTERS[0]);
  const [linkedProject, setLinkedProject] = useState(PROJECTS[0]);

  const selectedSupplier = useMemo(
    () => state.suppliers.find((s) => s.id === supplierId) || null,
    [state.suppliers, supplierId]
  );

  const supplierOpenInvoices = useMemo(
    () =>
      (state.purchaseInvoices || []).filter(
        (inv) =>
          inv.supplierId === supplierId &&
          inv.status !== 'Voided' &&
          inv.status !== 'Paid' &&
          inv.outstandingAmount > 0.01
      ),
    [state.purchaseInvoices, supplierId]
  );

  const toggleInvoiceAllocation = (invId: string, invNo: string, outstanding: number) => {
    setInvoiceAllocations((prev) => {
      const exists = prev.some((a) => a.invoiceId === invId);
      const next = exists
        ? prev.filter((a) => a.invoiceId !== invId)
        : [...prev, { invoiceId: invId, invoiceNo: invNo, allocatedAmount: round2(outstanding) }];
      const summed = round2(next.reduce((s, a) => s + a.allocatedAmount, 0));
      setBaseAmount(summed > 0 ? String(summed) : '');
      return next;
    });
  };

  const updateInvoiceAllocationAmount = (invId: string, val: number) => {
    setInvoiceAllocations((prev) => {
      const next = prev.map((a) =>
        a.invoiceId === invId ? { ...a, allocatedAmount: round2(Math.max(0, val)) } : a
      );
      const summed = round2(next.reduce((s, a) => s + a.allocatedAmount, 0));
      setBaseAmount(summed > 0 ? String(summed) : '');
      return next;
    });
  };

  const selectedCustomer = useMemo(
    () => state.customers.find((c) => c.id === customerId) || null,
    [state.customers, customerId]
  );

  const customerOpenInvoices = useMemo(
    () =>
      (state.salesInvoices || []).filter(
        (inv) =>
          inv.customerId === customerId &&
          inv.status !== 'Voided' &&
          inv.status !== 'Paid' &&
          inv.outstandingAmount > 0.01
      ),
    [state.salesInvoices, customerId]
  );

  const toggleSalesInvoiceAllocation = (invId: string, invNo: string, outstanding: number) => {
    setSalesInvoiceAllocations((prev) => {
      const exists = prev.some((a) => a.invoiceId === invId);
      const next = exists
        ? prev.filter((a) => a.invoiceId !== invId)
        : [...prev, { invoiceId: invId, invoiceNo: invNo, allocatedAmount: round2(outstanding) }];
      const summed = round2(next.reduce((s, a) => s + a.allocatedAmount, 0));
      setCollectionAmount(summed > 0 ? String(summed) : '');
      if (next.length > 0) setIsCustomerAdvance(false);
      return next;
    });
  };

  const updateSalesInvoiceAllocationAmount = (invId: string, val: number) => {
    setSalesInvoiceAllocations((prev) => {
      const next = prev.map((a) =>
        a.invoiceId === invId ? { ...a, allocatedAmount: round2(Math.max(0, val)) } : a
      );
      const summed = round2(next.reduce((s, a) => s + a.allocatedAmount, 0));
      setCollectionAmount(summed > 0 ? String(summed) : '');
      return next;
    });
  };

  // Compute live amounts
  const paymentCalc = useMemo(() => {
    const base = round2(Math.max(0, Number(baseAmount) || 0));
    const tds = round2((base * tdsRate) / 100);
    const vds = round2((base * vdsRate) / 100);
    const netCash = round2(Math.max(0, base - tds - vds));
    return { base, tds, vds, netCash };
  }, [baseAmount, tdsRate, vdsRate]);

  const receiptAmt = round2(Math.max(0, Number(collectionAmount) || 0));

  const journalTotals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const r of journalRows) {
      const val = round2(Math.max(0, Number(r.amount) || 0));
      if (r.side === 'Debit') dr = round2(dr + val);
      else cr = round2(cr + val);
    }
    const diff = round2(Math.abs(dr - cr));
    return { dr, cr, diff, isBalanced: dr > 0 && diff < 0.01 };
  }, [journalRows]);

  const expenseTotal = useMemo(() => {
    if (allocationMode === 'Simple Cost') {
      return round2(Math.max(0, Number(simpleExpenseAmount) || 0));
    }
    return round2(
      expenseSplits.reduce((s, row) => s + Math.max(0, Number(row.amount) || 0), 0)
    );
  }, [allocationMode, simpleExpenseAmount, expenseSplits]);

  // Related Source Documents (Auto-Linker Matrix)
  const linkableSourceDocs = useMemo<VoucherSourceDocLink[]>(() => {
    if (voucherType === 'Payment') {
      if (!selectedSupplier) return [];
      const pos = (state.localPurchaseOrders || [])
        .filter(
          (po) =>
            po.supplierId === selectedSupplier.id ||
            po.supplierName.toLowerCase() === selectedSupplier.name.toLowerCase()
        )
        .map<VoucherSourceDocLink>((po) => ({
          docType: 'PO',
          docId: po.id,
          docRef: po.poNumber,
          label: `${po.category} · Due ${formatBDT(round2(po.grossAmount - po.paidAmount))}`,
          amount: round2(Math.max(0, po.grossAmount - po.paidAmount)) || po.grossAmount,
        }));
      const lcs = (state.importLCs || [])
        .filter((lc) => lc.supplierName.toLowerCase() === selectedSupplier.name.toLowerCase())
        .map<VoucherSourceDocLink>((lc) => ({
          docType: 'LC',
          docId: lc.id,
          docRef: lc.lcNumber,
          label: `${lc.lcType} (${lc.issuingBank}) · ${lc.status}`,
          amount: lc.marginDepositBdt || lc.bdtValue,
        }));
      return [...pos, ...lcs];
    }

    if (voucherType === 'Receipt') {
      if (!selectedCustomer) return [];
      const sos = (state.salesOrders || [])
        .filter(
          (so) =>
            so.customerId === selectedCustomer.id ||
            so.customerName.toLowerCase() === selectedCustomer.name.toLowerCase()
        )
        .map<VoucherSourceDocLink>((so) => ({
          docType: 'SO',
          docId: so.id,
          docRef: so.orderNo,
          label: `${so.channel} · Open AR ${formatBDT(round2(so.grossAmount - so.collectedAmount))}`,
          amount: round2(Math.max(0, so.grossAmount - so.collectedAmount)) || so.grossAmount,
        }));
      const jobs = (state.serviceJobs || [])
        .filter((j) => j.customerName.toLowerCase() === selectedCustomer.name.toLowerCase())
        .map<VoucherSourceDocLink>((j) => ({
          docType: 'JOB',
          docId: j.id,
          docRef: j.jobNo,
          label: `${j.equipmentName} (${j.status})`,
          amount: j.billableAmountBdt,
        }));
      return [...sos, ...jobs];
    }

    if (voucherType === 'Expense') {
      const jobs = (state.serviceJobs || []).slice(0, 4).map<VoucherSourceDocLink>((j) => ({
        docType: 'JOB',
        docId: j.id,
        docRef: j.jobNo,
        label: `${j.customerName} — ${j.equipmentName}`,
        amount: j.totalCostBdt,
      }));
      const claims = (state.warrantyClaims || []).slice(0, 3).map<VoucherSourceDocLink>((w) => ({
        docType: 'WRN',
        docId: w.id,
        docRef: w.claimNo,
        label: `${w.customerName} — ${w.sku}`,
        amount: w.claimCostBdt,
      }));
      return [...jobs, ...claims];
    }

    // Journal Voucher optional linker
    if (!journalPartyFilter) return [];
    const matchedPos = (state.localPurchaseOrders || [])
      .filter((p) => p.supplierName === journalPartyFilter)
      .map<VoucherSourceDocLink>((p) => ({
        docType: 'PO',
        docId: p.id,
        docRef: p.poNumber,
        label: `${p.supplierName} (${p.status})`,
        amount: p.grossAmount,
      }));
    const matchedSos = (state.salesOrders || [])
      .filter((s) => s.customerName === journalPartyFilter)
      .map<VoucherSourceDocLink>((s) => ({
        docType: 'SO',
        docId: s.id,
        docRef: s.orderNo,
        label: `${s.customerName} (${s.status})`,
        amount: s.grossAmount,
      }));
    return [...matchedPos, ...matchedSos];
  }, [
    voucherType,
    selectedSupplier,
    selectedCustomer,
    journalPartyFilter,
    state.localPurchaseOrders,
    state.importLCs,
    state.salesOrders,
    state.serviceJobs,
    state.warrantyClaims,
  ]);

  const toggleSourceDocLink = (doc: VoucherSourceDocLink) => {
    const exists = linkedSourceDocs.some((d) => d.docId === doc.docId);
    if (exists) {
      setLinkedSourceDocs((prev) => prev.filter((d) => d.docId !== doc.docId));
      return;
    }
    setLinkedSourceDocs((prev) => [...prev, doc]);
    if (voucherType === 'Payment' && (!baseAmount || Number(baseAmount) === 0)) {
      setBaseAmount(String(doc.amount));
      if (!narration) setNarration(`Supplier payment against ${doc.docRef} (${doc.label}).`);
    } else if (voucherType === 'Receipt' && (!collectionAmount || Number(collectionAmount) === 0)) {
      setCollectionAmount(String(doc.amount));
      if (!narration) setNarration(`Customer collection against ${doc.docRef}.`);
    } else if (voucherType === 'Expense' && allocationMode === 'Simple Cost' && (!simpleExpenseAmount || Number(simpleExpenseAmount) === 0)) {
      setSimpleExpenseAmount(String(doc.amount));
      if (!narration) setNarration(`Operational expense linked to ${doc.docRef} (${doc.label}).`);
    }
  };

  // Realtime Rules Compliance
  const paidFromSummary = glSummaryMap.get(paidFromGlCode);
  const paidFromBalance = paidFromSummary ? paidFromSummary.closingBalance : 0;

  const depositSummary = glSummaryMap.get(depositToGlCode);
  const depositBalance = depositSummary ? depositSummary.closingBalance : 0;

  const departmentBudget = useMemo(() => {
    const meta = DEPARTMENTS.find((d) => d.name === department) || DEPARTMENTS[0];
    const used = round2(
      (state.vouchers || [])
        .filter((v) => v.voucherType === 'Expense' && v.status !== 'Voided' && v.department === department)
        .reduce((s, v) => s + v.totalAmount, 0)
    );
    const remaining = round2(Math.max(0, meta.annualBudget - used));
    return {
      annualBudget: meta.annualBudget,
      used,
      remaining,
      passes: expenseTotal <= remaining,
      overBy: round2(Math.max(0, expenseTotal - remaining)),
    };
  }, [department, state.vouchers, expenseTotal]);

  const paymentLiquidityPass = paymentCalc.netCash <= paidFromBalance;
  const expenseLiquidityPass = expenseTotal <= paidFromBalance;

  // Double-entry preview generator
  const doubleEntryPreview = useMemo<VoucherDoubleEntryLine[]>(() => {
    const getName = (code: string) => glSummaryMap.get(code)?.name || code;

    if (voucherType === 'Payment') {
      if (paymentCalc.base <= 0) return [];
      const isApSettlement = invoiceAllocations.length > 0;
      const debitGl = isApSettlement ? '2080' : selectedSupplier?.expenseGlCode || '5010';
      const lines: VoucherDoubleEntryLine[] = [
        {
          glCode: debitGl,
          glName: getName(debitGl),
          debit: paymentCalc.base,
          credit: 0,
          memo: isApSettlement
            ? `AP settlement (${invoiceAllocations.map((a) => a.invoiceNo).join(', ')})`
            : undefined,
        },
      ];
      if (paymentCalc.netCash > 0) {
        lines.push({
          glCode: paidFromGlCode,
          glName: getName(paidFromGlCode),
          debit: 0,
          credit: paymentCalc.netCash,
        });
      }
      if (paymentCalc.tds > 0) {
        lines.push({
          glCode: '2200',
          glName: getName('2200'),
          debit: 0,
          credit: paymentCalc.tds,
          memo: `TDS ${tdsRate}%`,
        });
      }
      if (paymentCalc.vds > 0) {
        lines.push({
          glCode: '2210',
          glName: getName('2210'),
          debit: 0,
          credit: paymentCalc.vds,
          memo: `VDS ${vdsRate}%`,
        });
      }
      return lines;
    }

    if (voucherType === 'Receipt') {
      if (receiptAmt <= 0) return [];
      const tdsAmt = round2((receiptAmt * custTdsRate) / 100);
      const vdsAmt = round2((receiptAmt * custVdsRate) / 100);
      const withholdingTotal = round2(tdsAmt + vdsAmt);
      const netBankCash = round2(Math.max(0, receiptAmt - withholdingTotal));
      const creditGl = isCustomerAdvance ? '2110' : selectedCustomer?.receivableGlCode || '1120';
      const lines: VoucherDoubleEntryLine[] = [];
      if (netBankCash > 0) {
        lines.push({
          glCode: depositToGlCode,
          glName: getName(depositToGlCode),
          debit: netBankCash,
          credit: 0,
        });
      }
      if (withholdingTotal > 0) {
        lines.push({
          glCode: '1140',
          glName: getName('1140'),
          debit: withholdingTotal,
          credit: 0,
          memo: `Customer TDS ${custTdsRate}% + VDS ${custVdsRate}%${custCertRef ? ` (${custCertRef})` : ''}`,
        });
      }
      lines.push({
        glCode: creditGl,
        glName: getName(creditGl),
        debit: 0,
        credit: receiptAmt,
        memo: isCustomerAdvance
          ? 'Customer Advance / Contract Liability'
          : salesInvoiceAllocations.length > 0
            ? `Settled: ${salesInvoiceAllocations.map((a) => a.invoiceNo).join(', ')}`
            : undefined,
      });
      return lines;
    }

    if (voucherType === 'Journal') {
      return journalRows
        .filter((r) => r.glCode && Number(r.amount) > 0)
        .map((r) => {
          const val = round2(Number(r.amount) || 0);
          return {
            glCode: r.glCode,
            glName: getName(r.glCode),
            debit: r.side === 'Debit' ? val : 0,
            credit: r.side === 'Credit' ? val : 0,
          };
        });
    }

    // Expense Voucher
    if (expenseTotal <= 0) return [];
    const debitLines: VoucherDoubleEntryLine[] =
      allocationMode === 'Simple Cost'
        ? simpleExpenseGlCode
          ? [
              {
                glCode: simpleExpenseGlCode,
                glName: getName(simpleExpenseGlCode),
                debit: expenseTotal,
                credit: 0,
              },
            ]
          : []
        : expenseSplits
            .filter((s) => s.glCode && Number(s.amount) > 0)
            .map((s) => ({
              glCode: s.glCode,
              glName: getName(s.glCode),
              debit: round2(Number(s.amount) || 0),
              credit: 0,
              memo: s.memo.trim() || undefined,
            }));

    if (debitLines.length === 0) return [];
    return [
      ...debitLines,
      {
        glCode: paidFromGlCode,
        glName: getName(paidFromGlCode),
        debit: 0,
        credit: expenseTotal,
      },
    ];
  }, [
    voucherType,
    paymentCalc,
    selectedSupplier,
    paidFromGlCode,
    tdsRate,
    vdsRate,
    receiptAmt,
    selectedCustomer,
    depositToGlCode,
    journalRows,
    expenseTotal,
    allocationMode,
    simpleExpenseGlCode,
    expenseSplits,
    glSummaryMap,
  ]);

  const canSubmit = useMemo(() => {
    if (!voucherRef.trim() || submitting) return false;
    if (voucherType === 'Payment') {
      return Boolean(selectedSupplier) && paymentCalc.base > 0 && paymentLiquidityPass;
    }
    if (voucherType === 'Receipt') {
      return Boolean(selectedCustomer) && receiptAmt > 0;
    }
    if (voucherType === 'Journal') {
      return journalTotals.isBalanced && doubleEntryPreview.length >= 2;
    }
    return (
      expenseTotal > 0 &&
      doubleEntryPreview.length >= 2 &&
      expenseLiquidityPass &&
      departmentBudget.passes
    );
  }, [
    voucherRef,
    submitting,
    voucherType,
    selectedSupplier,
    paymentCalc.base,
    paymentLiquidityPass,
    selectedCustomer,
    receiptAmt,
    journalTotals.isBalanced,
    doubleEntryPreview.length,
    expenseTotal,
    expenseLiquidityPass,
    departmentBudget.passes,
  ]);

  const handleAutoBalanceJournal = () => {
    const diff = round2(journalTotals.dr - journalTotals.cr);
    if (Math.abs(diff) < 0.01) return;
    const neededSide: 'Debit' | 'Credit' = diff > 0 ? 'Credit' : 'Debit';
    const absDiff = Math.abs(diff);

    // If there is an empty row on the needed side, fill it; otherwise append a row
    const emptyIdx = journalRows.findIndex(
      (r) => r.side === neededSide && (!r.amount || Number(r.amount) === 0)
    );
    if (emptyIdx >= 0) {
      setJournalRows((prev) =>
        prev.map((row, idx) => (idx === emptyIdx ? { ...row, amount: String(absDiff) } : row))
      );
    } else {
      setJournalRows((prev) => [
        ...prev,
        {
          id: `r-${Date.now()}`,
          glCode: neededSide === 'Credit' ? defaultBankCode : '5110',
          side: neededSide,
          amount: String(absDiff),
        },
      ]);
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: VoucherAttachment[] = Array.from(files).map((f, idx) => ({
      id: `ATT-${Date.now()}-${idx}`,
      name: f.name,
      sizeLabel: f.size >= 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`,
      uploadedAt: new Date().toISOString(),
    }));
    setAttachments((prev) => [...prev, ...added]);
    e.target.value = '';
  };

  const handleQuickAttachSample = () => {
    const sampleNames: Record<VoucherKind, string> = {
      Payment: `Vendor_Bill_${voucherRef || 'PV'}.pdf`,
      Receipt: `Bank_Credit_Advice_${voucherRef || 'RV'}.pdf`,
      Journal: `Working_Schedule_${voucherRef || 'JV'}.xlsx`,
      Expense: `Receipt_Voucher_Slip_${voucherRef || 'EV'}.pdf`,
    };
    setAttachments((prev) => [
      ...prev,
      {
        id: `ATT-${Date.now()}`,
        name: sampleNames[voucherType],
        sizeLabel: '248 KB',
        uploadedAt: new Date().toISOString(),
      },
    ]);
  };

  const handleAiDraft = async () => {
    if (!aiPrompt.trim() || aiDrafting) return;
    setSubmitError(null);
    setAiReason(null);
    setAiDrafting(true);
    try {
      const drafted = await api.draftVoucherWithAi(aiPrompt.trim(), voucherType);
      setVoucherDate(drafted.date);
      setPostingDate(drafted.date);
      setNarration(drafted.narration);

      const totalDr = round2(drafted.lines.reduce((s, l) => s + l.debit, 0));
      const partyLower = drafted.counterparty.toLowerCase();

      if (voucherType === 'Journal') {
        setJournalRows(
          drafted.lines.map((l, idx) => ({
            id: `ai-${Date.now()}-${idx}`,
            glCode: l.glCode,
            side: l.debit > 0 ? 'Debit' : 'Credit',
            amount: String(l.debit > 0 ? l.debit : l.credit),
          }))
        );
      } else if (voucherType === 'Payment') {
        setBaseAmount(String(totalDr));
        const matchedSupplier = state.suppliers.find(
          (s) =>
            s.name.toLowerCase().includes(partyLower) ||
            partyLower.includes(s.name.toLowerCase().split(' ')[0])
        );
        if (matchedSupplier) setSupplierId(matchedSupplier.id);
      } else if (voucherType === 'Receipt') {
        setCollectionAmount(String(totalDr));
        const matchedCustomer = state.customers.find(
          (c) =>
            c.name.toLowerCase().includes(partyLower) ||
            partyLower.includes(c.name.toLowerCase().split(' ')[0])
        );
        if (matchedCustomer) setCustomerId(matchedCustomer.id);
      } else if (voucherType === 'Expense') {
        const debitLines = drafted.lines.filter((l) => l.debit > 0);
        if (debitLines.length === 1) {
          setAllocationMode('Simple Cost');
          setSimpleExpenseGlCode(debitLines[0].glCode);
          setSimpleExpenseAmount(String(debitLines[0].debit));
        } else if (debitLines.length > 1) {
          setAllocationMode('Split Multi-Item');
          setExpenseSplits(
            debitLines.map((l, idx) => ({
              id: `ai-sp-${Date.now()}-${idx}`,
              glCode: l.glCode,
              memo: l.memo || drafted.narration,
              amount: String(l.debit),
            }))
          );
        }
      }

      setAiReason(`${drafted.model} · ${drafted.reasoning}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to draft voucher with AI.');
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      setSubmitError(null);

      const splitsPayload: ExpenseSplitItem[] | undefined =
        voucherType === 'Expense'
          ? allocationMode === 'Simple Cost'
            ? [
                {
                  glCode: simpleExpenseGlCode,
                  glName: glSummaryMap.get(simpleExpenseGlCode)?.name || simpleExpenseGlCode,
                  memo: narration.trim() || department,
                  amount: expenseTotal,
                },
              ]
            : expenseSplits
                .filter((s) => s.glCode && Number(s.amount) > 0)
                .map((s) => ({
                  glCode: s.glCode,
                  glName: glSummaryMap.get(s.glCode)?.name || s.glCode,
                  memo: s.memo.trim() || department,
                  amount: round2(Number(s.amount) || 0),
                }))
          : undefined;

      await onSubmit({
        voucherType,
        voucherRef: voucherRef.trim().toUpperCase(),
        voucherDate,
        postingDate,
        status: 'Auto-Approved',
        totalAmount:
          voucherType === 'Payment'
            ? paymentCalc.base
            : voucherType === 'Receipt'
              ? receiptAmt
              : voucherType === 'Journal'
                ? journalTotals.dr
                : expenseTotal,
        narration: narration.trim() || `${voucherType} Voucher ${voucherRef.trim().toUpperCase()}`,
        supplierId: voucherType === 'Payment' ? selectedSupplier?.id : undefined,
        supplierName: voucherType === 'Payment' ? selectedSupplier?.name : undefined,
        baseAmount: voucherType === 'Payment' ? paymentCalc.base : undefined,
        tdsRate: voucherType === 'Payment' ? tdsRate : undefined,
        tdsAmount: voucherType === 'Payment' ? paymentCalc.tds : undefined,
        vdsRate: voucherType === 'Payment' ? vdsRate : undefined,
        vdsAmount: voucherType === 'Payment' ? paymentCalc.vds : undefined,
        netPayableAmount: voucherType === 'Payment' ? paymentCalc.netCash : undefined,
        paymentMode: voucherType === 'Payment' ? paymentMode : undefined,
        paidFromGlCode:
          voucherType === 'Payment' || voucherType === 'Expense' ? paidFromGlCode : undefined,
        bankReferenceNo: voucherType === 'Payment' ? bankReferenceNo.trim() : undefined,
        customerId: voucherType === 'Receipt' ? selectedCustomer?.id : undefined,
        customerName: voucherType === 'Receipt' ? selectedCustomer?.name : undefined,
        collectionAmount: voucherType === 'Receipt' ? receiptAmt : undefined,
        receiptMode: voucherType === 'Receipt' ? receiptMode : undefined,
        depositToGlCode: voucherType === 'Receipt' ? depositToGlCode : undefined,
        salesInvoiceAllocations:
          voucherType === 'Receipt' && salesInvoiceAllocations.length > 0
            ? salesInvoiceAllocations.filter((a) => a.allocatedAmount > 0)
            : undefined,
        isCustomerAdvance: voucherType === 'Receipt' ? isCustomerAdvance : undefined,
        customerWithholding:
          voucherType === 'Receipt' && (custTdsRate > 0 || custVdsRate > 0)
            ? {
                tdsRate: custTdsRate,
                tdsAmount: round2((receiptAmt * custTdsRate) / 100),
                vdsRate: custVdsRate,
                vdsAmount: round2((receiptAmt * custVdsRate) / 100),
                certificateRef: custCertRef.trim() || undefined,
              }
            : undefined,
        postingType: voucherType === 'Journal' ? postingType : undefined,
        autoReverseDate: voucherType === 'Journal' ? autoReverseDate : undefined,
        allocationMode: voucherType === 'Expense' ? allocationMode : undefined,
        employeeName: voucherType === 'Expense' ? employeeName || 'ATCL Corporate Staff' : undefined,
        expenseSplits: splitsPayload,
        department: voucherType === 'Expense' ? department : undefined,
        costCenter: voucherType === 'Expense' ? costCenter : undefined,
        linkedProject: voucherType === 'Expense' ? linkedProject : undefined,
        linkedSourceDocs,
        invoiceAllocations:
          voucherType === 'Payment' && invoiceAllocations.length > 0
            ? invoiceAllocations.filter((a) => a.allocatedAmount > 0)
            : undefined,
        attachments,
        doubleEntryLines: doubleEntryPreview,
        postImmediately,
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to save voucher.');
    } finally {
      setSubmitting(false);
    }
  };

  const HeaderIcon =
    voucherType === 'Payment'
      ? CreditCard
      : voucherType === 'Receipt'
        ? Wallet
        : voucherType === 'Journal'
          ? BookCheck
          : ReceiptText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-5">
      <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Top Modal Header */}
        <div className="bg-[#2563EB] text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <HeaderIcon className="w-4 h-4 text-white/90" />
            <h2 className="text-sm font-bold tracking-tight font-[var(--font-display)]">
              Create New {voucherType} Voucher
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2-Column Body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto ledger-scroll p-4 sm:p-5"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT PANEL: Voucher Form */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4 text-xs">
              {/* AI Smart Voucher Draft */}
              <div className="p-3 rounded-md border border-slate-200 bg-[#F8FAFC] space-y-2">
                <div className="font-semibold text-slate-800">
                  AI Smart {voucherType} Draft (uses active Custom Instructions & COA)
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAiDraft();
                      }
                    }}
                    placeholder={`Describe ${voucherType.toLowerCase()} transaction in plain English...`}
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                  />
                  <button
                    type="button"
                    onClick={handleAiDraft}
                    disabled={aiDrafting || !aiPrompt.trim()}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>{aiDrafting ? 'Drafting...' : 'Smart Fill'}</span>
                  </button>
                </div>
                {aiReason && (
                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    {aiReason}
                  </div>
                )}
              </div>

              {submitError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Row 1: Voucher Date / Posting Date / Voucher Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-4 border-b border-slate-100">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Voucher Date</label>
                  <input
                    type="date"
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Posting Date</label>
                  <input
                    type="date"
                    value={postingDate}
                    onChange={(e) => setPostingDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Voucher Reference</label>
                  <input
                    type="text"
                    value={voucherRef}
                    onChange={(e) => setVoucherRef(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                    required
                  />
                </div>
              </div>

              {/* PAYMENT VOUCHER FIELDS */}
              {voucherType === 'Payment' && (
                <>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Supplier (Vendor) *
                    </label>
                    <select
                      value={supplierId}
                      onChange={(e) => {
                        setSupplierId(e.target.value);
                        setLinkedSourceDocs([]);
                        setInvoiceAllocations([]);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      required
                    >
                      <option value="">— Select Supplier —</option>
                      {state.suppliers.map((sup) => (
                        <option key={sup.id} value={sup.id}>
                          {sup.code} — {sup.name} ({sup.supplierType})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedSupplier && (
                    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-700">
                          Posted Supplier Invoices (AP 2080)
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-medium ${
                            invoiceAllocations.length > 0
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {invoiceAllocations.length > 0
                            ? `${invoiceAllocations.length} Invoice(s) Allocated → Dr 2080`
                            : 'Direct / Advance Payment (No Invoice Linked)'}
                        </span>
                      </div>
                      {supplierOpenInvoices.length > 0 ? (
                        <div className="space-y-1.5 max-h-36 overflow-y-auto">
                          {supplierOpenInvoices.map((inv) => {
                            const alloc = invoiceAllocations.find((a) => a.invoiceId === inv.id);
                            return (
                              <div
                                key={inv.id}
                                className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-[11px]"
                              >
                                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(alloc)}
                                    onChange={() =>
                                      toggleInvoiceAllocation(
                                        inv.id,
                                        inv.invoiceNumber,
                                        inv.outstandingAmount
                                      )
                                    }
                                    className="rounded border-slate-300 text-[#2563EB]"
                                  />
                                  <span className="font-mono font-semibold text-slate-800 truncate">
                                    {inv.invoiceNumber}
                                  </span>
                                  <span className="text-slate-500 truncate">
                                    (Bill: {inv.supplierInvoiceNo} · Due {formatBDT(inv.outstandingAmount)})
                                  </span>
                                </label>
                                {alloc && (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={inv.outstandingAmount}
                                    value={alloc.allocatedAmount}
                                    onChange={(e) =>
                                      updateInvoiceAllocationAmount(inv.id, Number(e.target.value))
                                    }
                                    className="w-28 px-2 py-0.5 border border-slate-200 rounded font-mono text-right text-slate-900"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          No open posted invoices for {selectedSupplier.name}. Payment will post as a direct/advance entry.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        TDS (Tax Deducted at Source)
                      </label>
                      <select
                        value={tdsRate}
                        onChange={(e) => setTdsRate(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      >
                        {TDS_OPTIONS.map((opt) => (
                          <option key={opt.rate} value={opt.rate}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        VAT Withheld (VDS)
                      </label>
                      <select
                        value={vdsRate}
                        onChange={(e) => setVdsRate(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      >
                        {VDS_OPTIONS.map((opt) => (
                          <option key={opt.rate} value={opt.rate}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Base Payment Amount (BDT) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={baseAmount}
                        onChange={(e) => setBaseAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Payment Mode</label>
                      <select
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      >
                        {PAYMENT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {paymentCalc.base > 0 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-md p-3 flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
                      <span className="text-slate-600">Base: {formatBDT(paymentCalc.base)}</span>
                      <span className="text-slate-600">TDS: {formatBDT(paymentCalc.tds)}</span>
                      <span className="text-slate-600">VDS: {formatBDT(paymentCalc.vds)}</span>
                      <span className="font-bold text-[#2563EB]">
                        Net Paid: {formatBDT(paymentCalc.netCash)}
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Paid From (Cash/Bank Account)
                      </label>
                      <select
                        value={paidFromGlCode}
                        onChange={(e) => setPaidFromGlCode(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      >
                        {cashBankAccounts.map((acc) => {
                          const bal = glSummaryMap.get(acc.code)?.closingBalance ?? acc.openingBalance;
                          return (
                            <option key={acc.code} value={acc.code}>
                              {acc.code} — {acc.name} ({formatBDT(bal)})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Bank Reference No
                      </label>
                      <input
                        type="text"
                        value={bankReferenceNo}
                        onChange={(e) => setBankReferenceNo(e.target.value)}
                        placeholder="Ref/UTR/Cheque code"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* RECEIPT VOUCHER FIELDS */}
              {voucherType === 'Receipt' && (
                <>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Customer (Debtor) *
                    </label>
                    <select
                      value={customerId}
                      onChange={(e) => {
                        setCustomerId(e.target.value);
                        setLinkedSourceDocs([]);
                        setSalesInvoiceAllocations([]);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      required
                    >
                      <option value="">— Select Customer —</option>
                      {state.customers.map((cus) => (
                        <option key={cus.id} value={cus.id}>
                          {cus.code} — {cus.name} (AR {formatBDT(cus.currentReceivable)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedCustomer && (
                    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-700">
                          Posted Sales Invoices (AR 1120)
                        </span>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700">
                          <input
                            type="checkbox"
                            checked={isCustomerAdvance}
                            disabled={salesInvoiceAllocations.length > 0}
                            onChange={(e) => setIsCustomerAdvance(e.target.checked)}
                            className="rounded border-slate-300 text-[#2563EB]"
                          />
                          <span>Advance Receipt (Cr 2110)</span>
                        </label>
                      </div>
                      {customerOpenInvoices.length > 0 ? (
                        <div className="space-y-1.5 max-h-36 overflow-y-auto">
                          {customerOpenInvoices.map((inv) => {
                            const alloc = salesInvoiceAllocations.find((a) => a.invoiceId === inv.id);
                            return (
                              <div
                                key={inv.id}
                                className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-[11px]"
                              >
                                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(alloc)}
                                    onChange={() =>
                                      toggleSalesInvoiceAllocation(
                                        inv.id,
                                        inv.invoiceNumber,
                                        inv.outstandingAmount
                                      )
                                    }
                                    className="rounded border-slate-300 text-[#2563EB]"
                                  />
                                  <span className="font-mono font-semibold text-slate-800 truncate">
                                    {inv.invoiceNumber}
                                  </span>
                                  <span className="text-slate-500 truncate">
                                    (Due {formatBDT(inv.outstandingAmount)})
                                  </span>
                                </label>
                                {alloc && (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={inv.outstandingAmount}
                                    value={alloc.allocatedAmount}
                                    onChange={(e) =>
                                      updateSalesInvoiceAllocationAmount(inv.id, Number(e.target.value))
                                    }
                                    className="w-28 px-2 py-0.5 border border-slate-200 rounded font-mono text-right text-slate-900"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          No open posted Sales Invoices for {selectedCustomer.name}. Check &ldquo;Advance Receipt (Cr 2110)&rdquo; for prepayments.
                        </p>
                      )}
                      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200 text-[11px]">
                        <div>
                          <label className="block text-slate-600 mb-0.5">Cust. TDS %</label>
                          <input type="number" step="0.5" min="0" value={custTdsRate} onChange={(e) => setCustTdsRate(Number(e.target.value))} className="w-full px-2 py-1 border border-slate-200 rounded font-mono bg-white" />
                        </div>
                        <div>
                          <label className="block text-slate-600 mb-0.5">Cust. VDS %</label>
                          <input type="number" step="0.5" min="0" value={custVdsRate} onChange={(e) => setCustVdsRate(Number(e.target.value))} className="w-full px-2 py-1 border border-slate-200 rounded font-mono bg-white" />
                        </div>
                        <div>
                          <label className="block text-slate-600 mb-0.5">Challan / Cert Ref</label>
                          <input value={custCertRef} onChange={(e) => setCustCertRef(e.target.value)} placeholder="M6.6 / Cert" className="w-full px-2 py-1 border border-slate-200 rounded font-mono bg-white" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Collection Amount (BDT) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={collectionAmount}
                        onChange={(e) => setCollectionAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Receipt Mode</label>
                      <select
                        value={receiptMode}
                        onChange={(e) => setReceiptMode(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      >
                        {RECEIPT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Deposit to Cash/Bank Account
                    </label>
                    <select
                      value={depositToGlCode}
                      onChange={(e) => setDepositToGlCode(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                    >
                      {cashBankAccounts.map((acc) => {
                        const bal = glSummaryMap.get(acc.code)?.closingBalance ?? acc.openingBalance;
                        return (
                          <option key={acc.code} value={acc.code}>
                            {acc.code} — {acc.name} ({formatBDT(bal)})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </>
              )}

              {/* JOURNAL VOUCHER FIELDS */}
              {voucherType === 'Journal' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Posting Type</label>
                      <select
                        value={postingType}
                        onChange={(e) => setPostingType(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      >
                        {JOURNAL_POSTING_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Auto-Reverse Schedule Date (Optional)
                      </label>
                      <input
                        type="date"
                        value={autoReverseDate}
                        onChange={(e) => setAutoReverseDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      />
                    </div>
                  </div>

                  {/* Multi-Line Ledger Account Details */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500">
                      <div className="col-span-6">Ledger Account Details</div>
                      <div className="col-span-2">Dr / Cr</div>
                      <div className="col-span-3 text-right">Amount (৳)</div>
                      <div className="col-span-1" />
                    </div>
                    {journalRows.map((row) => (
                      <div key={row.id} className="grid grid-cols-12 gap-2 items-center">
                        <select
                          value={row.glCode}
                          onChange={(e) =>
                            setJournalRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, glCode: e.target.value } : r
                              )
                            )
                          }
                          className="col-span-6 px-2.5 py-2 border border-slate-200 rounded-md bg-white font-mono text-xs text-slate-900"
                        >
                          {activeAccounts.map((acc) => {
                            const bal =
                              glSummaryMap.get(acc.code)?.closingBalance ?? acc.openingBalance;
                            return (
                              <option key={acc.code} value={acc.code}>
                                {acc.code} — {acc.name} ({formatBDT(bal)})
                              </option>
                            );
                          })}
                        </select>
                        <select
                          value={row.side}
                          onChange={(e) =>
                            setJournalRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? { ...r, side: e.target.value as 'Debit' | 'Credit' }
                                  : r
                              )
                            )
                          }
                          className="col-span-2 px-2 py-2 border border-slate-200 rounded-md bg-white text-xs text-slate-900"
                        >
                          <option value="Debit">Debit</option>
                          <option value="Credit">Credit</option>
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.amount}
                          onChange={(e) =>
                            setJournalRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, amount: e.target.value } : r
                              )
                            )
                          }
                          placeholder="0.00"
                          className="col-span-3 px-2.5 py-2 border border-slate-200 rounded-md font-mono text-right text-slate-900"
                        />
                        <div className="col-span-1 flex justify-end">
                          <button
                            type="button"
                            disabled={journalRows.length <= 2}
                            onClick={() =>
                              setJournalRows((prev) => prev.filter((r) => r.id !== row.id))
                            }
                            className="p-2 text-red-500 hover:bg-red-50 rounded-md disabled:opacity-30 cursor-pointer"
                            title="Remove row"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setJournalRows((prev) => [
                            ...prev,
                            {
                              id: `r-${Date.now()}`,
                              glCode: activeAccounts[0]?.code || '1210',
                              side: journalTotals.dr > journalTotals.cr ? 'Credit' : 'Debit',
                              amount: '',
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Entry Row</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleAutoBalanceJournal}
                        disabled={journalTotals.diff < 0.01}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#2563EB] bg-[#2563EB]/5 border border-[#2563EB]/25 hover:bg-[#2563EB]/10 rounded-md cursor-pointer disabled:opacity-40"
                      >
                        <Scale className="w-3.5 h-3.5" />
                        <span>Auto-Balance Rows</span>
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* EXPENSE VOUCHER FIELDS */}
              {voucherType === 'Expense' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="block font-medium text-slate-700 mb-2">
                        Allocation Mode
                      </label>
                      <div className="inline-flex items-center gap-4 py-1.5">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-800">
                          <input
                            type="radio"
                            name="allocationMode"
                            checked={allocationMode === 'Simple Cost'}
                            onChange={() => setAllocationMode('Simple Cost')}
                            className="accent-[#2563EB]"
                          />
                          <span>Simple Cost</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-800">
                          <input
                            type="radio"
                            name="allocationMode"
                            checked={allocationMode === 'Split Multi-Item'}
                            onChange={() => setAllocationMode('Split Multi-Item')}
                            className="accent-[#2563EB]"
                          />
                          <span>Split Multi-Item</span>
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Employee / Recipient
                      </label>
                      <select
                        value={employeeName}
                        onChange={(e) => setEmployeeName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900"
                      >
                        <option value="">— Select Employee —</option>
                        {EMPLOYEES.map((emp) => (
                          <option key={emp} value={emp}>
                            {emp}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {allocationMode === 'Simple Cost' ? (
                    <>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">
                          Expense Account Head *
                        </label>
                        <select
                          value={simpleExpenseGlCode}
                          onChange={(e) => setSimpleExpenseGlCode(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white font-mono text-slate-900"
                          required
                        >
                          <option value="">— Select Account —</option>
                          {expenseAccounts.map((acc) => (
                            <option key={acc.code} value={acc.code}>
                              {acc.code} — {acc.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">
                            Expense Amount (BDT) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={simpleExpenseAmount}
                            onChange={(e) => setSimpleExpenseAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono text-slate-900"
                            required
                          />
                        </div>
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">
                            Paid From Account
                          </label>
                          <select
                            value={paidFromGlCode}
                            onChange={(e) => setPaidFromGlCode(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white font-mono text-slate-900"
                          >
                            {cashBankAccounts.map((acc) => {
                              const bal =
                                glSummaryMap.get(acc.code)?.closingBalance ?? acc.openingBalance;
                              return (
                                <option key={acc.code} value={acc.code}>
                                  {acc.code} — {acc.name} ({formatBDT(bal)})
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="font-medium text-slate-700">
                          Split Expense Line Items
                        </label>
                        <span className="font-mono font-semibold text-[#2563EB] tabular-nums">
                          Total: {formatBDT(expenseTotal)}
                        </span>
                      </div>
                      {expenseSplits.map((sp) => (
                        <div key={sp.id} className="grid grid-cols-12 gap-2 items-center">
                          <select
                            value={sp.glCode}
                            onChange={(e) =>
                              setExpenseSplits((prev) =>
                                prev.map((r) =>
                                  r.id === sp.id ? { ...r, glCode: e.target.value } : r
                                )
                              )
                            }
                            className="col-span-5 px-2 py-2 border border-slate-200 rounded-md bg-white font-mono text-xs"
                          >
                            {expenseAccounts.map((acc) => (
                              <option key={acc.code} value={acc.code}>
                                {acc.code} — {acc.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={sp.memo}
                            onChange={(e) =>
                              setExpenseSplits((prev) =>
                                prev.map((r) =>
                                  r.id === sp.id ? { ...r, memo: e.target.value } : r
                                )
                              )
                            }
                            placeholder="Line memo"
                            className="col-span-3 px-2 py-2 border border-slate-200 rounded-md text-xs"
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={sp.amount}
                            onChange={(e) =>
                              setExpenseSplits((prev) =>
                                prev.map((r) =>
                                  r.id === sp.id ? { ...r, amount: e.target.value } : r
                                )
                              )
                            }
                            placeholder="0.00"
                            className="col-span-3 px-2 py-2 border border-slate-200 rounded-md font-mono text-right text-xs"
                          />
                          <div className="col-span-1 flex justify-end">
                            <button
                              type="button"
                              disabled={expenseSplits.length <= 1}
                              onClick={() =>
                                setExpenseSplits((prev) => prev.filter((r) => r.id !== sp.id))
                              }
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-30 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpenseSplits((prev) => [
                              ...prev,
                              {
                                id: `sp-${Date.now()}`,
                                glCode: expenseAccounts[0]?.code || '5190',
                                memo: '',
                                amount: '',
                              },
                            ])
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Expense Split</span>
                        </button>
                        <select
                          value={paidFromGlCode}
                          onChange={(e) => setPaidFromGlCode(e.target.value)}
                          className="px-2.5 py-1.5 border border-slate-200 rounded-md bg-white font-mono text-xs"
                        >
                          {cashBankAccounts.map((acc) => {
                            const bal =
                              glSummaryMap.get(acc.code)?.closingBalance ?? acc.openingBalance;
                            return (
                              <option key={acc.code} value={acc.code}>
                                Paid From: {acc.code} — {acc.name} ({formatBDT(bal)})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Department</label>
                      <select
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900"
                      >
                        {DEPARTMENTS.map((d) => (
                          <option key={d.name} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Cost Center</label>
                      <select
                        value={costCenter}
                        onChange={(e) => setCostCenter(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900"
                      >
                        {COST_CENTERS.map((cc) => (
                          <option key={cc} value={cc}>
                            {cc}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Linked Project</label>
                      <select
                        value={linkedProject}
                        onChange={(e) => setLinkedProject(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900"
                      >
                        {PROJECTS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Narration / Remarks */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Narration / Remarks
                </label>
                <textarea
                  rows={3}
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  placeholder="Detailed transaction explanation..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                />
              </div>

              {/* Support Document Uploads */}
              <div className="border border-slate-200 rounded-md p-3.5 space-y-2.5 bg-slate-50/60">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <FileUp className="w-3.5 h-3.5 text-[#2563EB]" />
                      <span>Support Document Uploads</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Attach vendor bills, PO sheets, GRN slips, bank advices, or tax reports.
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFilePick}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      + Upload File
                    </button>
                    <button
                      type="button"
                      onClick={handleQuickAttachSample}
                      className="px-2.5 py-1.5 text-xs font-medium text-[#2563EB] bg-white border border-slate-200 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      + Attach Slip
                    </button>
                  </div>
                </div>
                {attachments.length > 0 && (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded bg-white">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="px-3 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="font-mono text-slate-700 truncate">{att.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-slate-400 font-mono">{att.sizeLabel}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                            }
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Direct GL Post Option & Submit Footer */}
              <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={postImmediately}
                    onChange={(e) => setPostImmediately(e.target.checked)}
                    className="rounded border-slate-300 accent-[#2563EB]"
                  />
                  <span>Post directly to GL &amp; Register Books</span>
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-45 whitespace-nowrap"
                  >
                    {submitting
                      ? 'Saving Voucher...'
                      : postImmediately
                        ? 'Create & Post to GL'
                        : 'Create Voucher (Auto-Approved)'}
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT SIDEBAR: Auto-Linker Matrix & Realtime Rules Compliance */}
            <div className="lg:col-span-5 space-y-4 text-xs">
              {/* Related Source Documents (Auto-Linker Matrix) */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <Link2 className="w-3.5 h-3.5 text-[#2563EB]" />
                    <span>Related Source Documents</span>
                  </div>
                  <span className="text-[11px] font-medium text-[#2563EB]">
                    Auto-Linker Matrix
                  </span>
                </div>

                {voucherType === 'Journal' && (
                  <select
                    value={journalPartyFilter}
                    onChange={(e) => setJournalPartyFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md bg-white text-xs text-slate-700"
                  >
                    <option value="">Filter by Supplier or Customer to link docs...</option>
                    <optgroup label="Suppliers">
                      {state.suppliers.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Customers">
                      {state.customers.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                )}

                {linkableSourceDocs.length === 0 ? (
                  <div className="border border-dashed border-slate-200 rounded-md p-5 text-center text-slate-500">
                    {voucherType === 'Payment'
                      ? 'Select a supplier to view linkable purchase orders or import LCs.'
                      : voucherType === 'Receipt'
                        ? 'Select a customer to view linkable sales orders or service job invoices.'
                        : 'Select a supplier or customer to view linkable invoices, purchase orders, or requisitions.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto ledger-scroll">
                    {linkableSourceDocs.map((doc) => {
                      const isLinked = linkedSourceDocs.some((d) => d.docId === doc.docId);
                      return (
                        <button
                          key={`${doc.docType}-${doc.docId}`}
                          type="button"
                          onClick={() => toggleSourceDocLink(doc)}
                          className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                            isLinked
                              ? 'border-[#2563EB] bg-[#2563EB]/5'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-slate-900">
                              {doc.docType} · {doc.docRef}
                            </span>
                            <span className="font-mono font-semibold text-[#2563EB] tabular-nums">
                              {formatBDT(doc.amount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5 text-[11px] text-slate-500">
                            <span className="truncate">{doc.label}</span>
                            <span
                              className={`font-medium shrink-0 ${
                                isLinked ? 'text-emerald-700' : 'text-[#2563EB]'
                              }`}
                            >
                              {isLinked ? 'Linked' : 'Click to Link'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Realtime Rules Compliance */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span>Realtime Rules Compliance</span>
                </div>

                {/* Expense Corporate Budget Check */}
                {voucherType === 'Expense' && (
                  <div
                    className={`rounded-md border p-3 ${
                      departmentBudget.passes
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-red-50/80 border-red-200 text-red-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>Corporate Budget Check</span>
                      <span className="font-mono text-[11px]">
                        {departmentBudget.passes ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Validates {department} budget allocation before posting.
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] tabular-nums flex items-center gap-1.5">
                      {departmentBudget.passes ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            Budget within limits. Remaining: {formatBDT(departmentBudget.remaining)}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                          <span>
                            Exceeds remaining budget by {formatBDT(departmentBudget.overBy)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Payment / Expense Liquidity Check */}
                {(voucherType === 'Payment' || voucherType === 'Expense') && (
                  <div
                    className={`rounded-md border p-3 ${
                      (voucherType === 'Payment' ? paymentLiquidityPass : expenseLiquidityPass)
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-red-50/80 border-red-200 text-red-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>Liquidity Check</span>
                      <span className="font-mono text-[11px]">
                        {(voucherType === 'Payment' ? paymentLiquidityPass : expenseLiquidityPass)
                          ? 'PASSED'
                          : 'FAILED'}
                      </span>
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Ensures the cash/bank account contains sufficient funds.
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] tabular-nums flex items-center gap-1.5">
                      {(voucherType === 'Payment' ? paymentLiquidityPass : expenseLiquidityPass) ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            Sufficient funds. Current balance: {formatBDT(paidFromBalance)}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                          <span>
                            Insufficient balance ({formatBDT(paidFromBalance)}) for disbursement.
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Payment Statutory Withholding Check */}
                {voucherType === 'Payment' && (tdsRate > 0 || vdsRate > 0) && (
                  <div className="rounded-md border p-3 bg-emerald-50/70 border-emerald-200 text-emerald-900">
                    <div className="flex items-center justify-between font-semibold">
                      <span>Statutory TDS / VDS Mapping</span>
                      <span className="font-mono text-[11px]">PASSED</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] tabular-nums">
                      AIT ({tdsRate}%): {formatBDT(paymentCalc.tds)} → GL 2040 · VDS ({vdsRate}%):{' '}
                      {formatBDT(paymentCalc.vds)} → GL 2070
                    </div>
                  </div>
                )}

                {/* Receipt Deposit & AR Check */}
                {voucherType === 'Receipt' && (
                  <>
                    <div className="rounded-md border p-3 bg-emerald-50/70 border-emerald-200 text-emerald-900">
                      <div className="flex items-center justify-between font-semibold">
                        <span>Deposit Account Check</span>
                        <span className="font-mono text-[11px]">PASSED</span>
                      </div>
                      <div className="text-[11px] opacity-80 mt-0.5">
                        Validates active cash/bank ledger settlement account.
                      </div>
                      <div className="mt-1.5 font-mono text-[11px] tabular-nums flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          GL {depositToGlCode} balance: {formatBDT(depositBalance)}
                          {receiptAmt > 0 ? ` → ${formatBDT(round2(depositBalance + receiptAmt))}` : ''}
                        </span>
                      </div>
                    </div>
                    {selectedCustomer && (
                      <div
                        className={`rounded-md border p-3 ${
                          receiptAmt <= selectedCustomer.currentReceivable
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : 'bg-amber-50/80 border-amber-200 text-amber-900'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>Receivable Ledger Match</span>
                          <span className="font-mono text-[11px]">
                            {receiptAmt <= selectedCustomer.currentReceivable ? 'PASSED' : 'ADVANCE'}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] tabular-nums">
                          Open AR: {formatBDT(selectedCustomer.currentReceivable)}
                          {receiptAmt > selectedCustomer.currentReceivable
                            ? ' (Collection exceeds open AR — excess treated as advance)'
                            : ''}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Journal Double-Entry Balanced Check */}
                {voucherType === 'Journal' && (
                  <div
                    className={`rounded-md border p-3 ${
                      journalTotals.isBalanced
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-red-50/80 border-red-200 text-red-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>Double-Entry Balanced Check</span>
                      <span className="font-mono text-[11px]">
                        {journalTotals.isBalanced ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Debit total must match Credit total and exceed ৳0.00.
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] tabular-nums flex items-center gap-1.5">
                      {journalTotals.isBalanced ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            Balanced: {formatBDT(journalTotals.dr)} Dr = {formatBDT(journalTotals.cr)} Cr
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                          <span>
                            {journalTotals.dr === 0 && journalTotals.cr === 0
                              ? 'Enter debit and credit amounts to balance.'
                              : `Unbalanced by ${formatBDT(journalTotals.diff)}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Double-Entry GL Impact Preview */}
              {doubleEntryPreview.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2.5">
                  <div className="font-semibold text-slate-800">
                    Double-Entry GL Preview
                  </div>
                  <div className="divide-y divide-slate-100 font-mono text-[11px] tabular-nums">
                    {doubleEntryPreview.map((line, idx) => (
                      <div key={`${line.glCode}-${idx}`} className="py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-semibold text-[#2563EB]">{line.glCode}</span>{' '}
                          <span className="font-sans text-slate-700 truncate">{line.glName}</span>
                        </div>
                        <div className="shrink-0">
                          {line.debit > 0 ? (
                            <span className="text-slate-900">Dr {formatBDT(line.debit)}</span>
                          ) : (
                            <span className="text-emerald-700">Cr {formatBDT(line.credit)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

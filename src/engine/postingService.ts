import type { DoubleEntryPostInput } from './accountingEngine.ts';
import {
  ensurePurchaseControlAccounts,
  ensureSalesControlAccounts,
  postDoubleEntryToGL,
  reverseVoucher,
  round2,
} from './accountingEngine.ts';
import type { LedgerState } from '../types/accounting.ts';

export type PostingSourceModule =
  | 'VOUCHER'
  | 'GRN'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_RETURN'
  | 'IMPORT_LC'
  | 'SALES_INVOICE'
  | 'CREDIT_NOTE'
  | 'POS'
  | 'ADVANCE'
  | 'AMC'
  | 'TAX'
  | 'TREASURY'
  | 'SERVICE_BILLING'
  | 'WARRANTY'
  | 'RETENTION'
  | 'FIXED_ASSET'
  | 'INVENTORY_ADJ';

export interface CentralPostingLine {
  glCode: string;
  glName?: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface CentralPostingRequest extends DoubleEntryPostInput {
  sourceModule: PostingSourceModule;
  sourceDocumentId?: string;
  idempotencyKey?: string;
}

/**
 * Validates fiscal locks, Chart of Accounts existence, idempotency keys,
 * and double-entry balance before posting atomically to JournalLines,
 * PostedTransactions, and GL Register Books.
 */
export function postViaCentralEngine(
  state: LedgerState,
  req: CentralPostingRequest
): { voucherNo: string; linesPosted: number } {
  ensurePurchaseControlAccounts(state);
  ensureSalesControlAccounts(state);

  const lockDate = state.config.globalLockDate;
  if (lockDate && req.date <= lockDate) {
    throw new Error(
      `Fiscal Period Lock: Posting on ${req.date} is blocked because periods are locked through ${lockDate}.`
    );
  }

  const monthKey = req.date.slice(0, 7);
  if ((state.config.lockedMonths || []).includes(monthKey)) {
    throw new Error(
      `Locked Accounting Month: Posting to '${monthKey}' is closed and blocked by Period Lock Policy.`
    );
  }

  state.postedIdempotencyKeys = state.postedIdempotencyKeys || [];
  if (req.idempotencyKey && state.postedIdempotencyKeys.includes(req.idempotencyKey)) {
    throw new Error(
      `Duplicate posting blocked: transaction key '${req.idempotencyKey}' has already been posted to GL.`
    );
  }

  const accMap = new Map(state.accounts.map((a) => [a.code, a]));
  let nonZeroLines = 0;
  for (const line of req.lines) {
    const d = round2(Number(line.debit) || 0);
    const c = round2(Number(line.credit) || 0);
    if (d === 0 && c === 0) continue;
    nonZeroLines += 1;
    const acc = accMap.get(line.glCode);
    if (!acc) {
      throw new Error(
        `Invalid GL Account '${line.glCode}' in ${req.sourceModule} posting: account not found in Chart of Accounts.`
      );
    }
    if (acc.status !== 'Active') {
      throw new Error(
        `Inactive GL Account '${line.glCode} (${acc.name})' cannot receive new postings.`
      );
    }
  }

  postDoubleEntryToGL(state, req);

  if (req.idempotencyKey) {
    state.postedIdempotencyKeys.push(req.idempotencyKey);
  }

  return {
    voucherNo: req.voucherNo.trim(),
    linesPosted: nonZeroLines,
  };
}

/**
 * Generates an immutable reversing journal entry through the central engine.
 */
export function reverseViaCentralEngine(
  state: LedgerState,
  originalVoucherNo: string,
  reason: string
): { reversalVoucherNo: string; linesReversed: number } {
  return reverseVoucher(state, originalVoucherNo, reason);
}

export function buildGrnJournalLines(params: {
  inventoryGlCode?: string;
  grniGlCode?: string;
  amount: number;
  sourceRef?: string;
}): CentralPostingLine[] {
  const amt = round2(params.amount);
  return [
    {
      glCode: params.inventoryGlCode || '1110',
      debit: amt,
      credit: 0,
      memo: `Inventory received${params.sourceRef ? ` (${params.sourceRef})` : ''}`,
    },
    {
      glCode: params.grniGlCode || '2090',
      debit: 0,
      credit: amt,
      memo: 'GRNI accrual',
    },
  ];
}

export function buildPurchaseInvoiceJournalLines(params: {
  debitGlCode: string;
  apGlCode?: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  supplierInvoiceNo: string;
}): CentralPostingLine[] {
  const lines: CentralPostingLine[] = [
    {
      glCode: params.debitGlCode,
      debit: params.netAmount > 0 ? round2(params.netAmount) : round2(params.grossAmount),
      credit: 0,
      memo: `Supplier bill ${params.supplierInvoiceNo}`,
    },
  ];
  if (params.vatAmount > 0 && params.netAmount > 0) {
    lines.push({
      glCode: '2070',
      debit: round2(params.vatAmount),
      credit: 0,
      memo: 'Input VAT / Mushak 6.3',
    });
  }
  lines.push({
    glCode: params.apGlCode || '2080',
    debit: 0,
    credit: round2(params.grossAmount),
    memo: `AP recognized for ${params.supplierInvoiceNo}`,
  });
  return lines;
}

export function buildSalesInvoiceJournalLines(params: {
  arGlCode?: string;
  revenueGlCode?: string;
  vatGlCode?: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  cogsAmount: number;
  invoiceNumber: string;
}): CentralPostingLine[] {
  const lines: CentralPostingLine[] = [
    {
      glCode: params.arGlCode || '1120',
      debit: round2(params.grossAmount),
      credit: 0,
      memo: `AR recognized for ${params.invoiceNumber}`,
    },
    {
      glCode: params.revenueGlCode || '4010',
      debit: 0,
      credit: round2(params.netAmount),
      memo: `Sales Revenue ${params.invoiceNumber}`,
    },
  ];
  if (params.vatAmount > 0) {
    lines.push({
      glCode: params.vatGlCode || '2070',
      debit: 0,
      credit: round2(params.vatAmount),
      memo: `Output VAT ${params.invoiceNumber}`,
    });
  }
  if (params.cogsAmount > 0) {
    lines.push(
      { glCode: '5010', debit: round2(params.cogsAmount), credit: 0, memo: `COGS ${params.invoiceNumber}` },
      { glCode: '1110', debit: 0, credit: round2(params.cogsAmount), memo: `Inventory reduction ${params.invoiceNumber}` }
    );
  }
  return lines;
}

export function buildPosSaleJournalLines(params: {
  settlementGlCode: string;
  paymentMethod: string;
  netRev: number;
  vatAmount: number;
  grandTotal: number;
  totalCogs: number;
  receiptNo: string;
}): CentralPostingLine[] {
  const lines: CentralPostingLine[] = [
    {
      glCode: params.settlementGlCode,
      debit: round2(params.grandTotal),
      credit: 0,
      memo: `POS ${params.paymentMethod}`,
    },
    {
      glCode: '4010',
      debit: 0,
      credit: round2(params.netRev),
      memo: `POS Retail Sale ${params.receiptNo}`,
    },
  ];
  if (params.vatAmount > 0) {
    lines.push({ glCode: '2070', debit: 0, credit: round2(params.vatAmount), memo: 'POS Output VAT' });
  }
  if (params.totalCogs > 0) {
    lines.push(
      { glCode: '5010', debit: round2(params.totalCogs), credit: 0, memo: `POS COGS ${params.receiptNo}` },
      { glCode: '1110', debit: 0, credit: round2(params.totalCogs), memo: 'POS Inventory deduction' }
    );
  }
  return lines;
}

export function buildInventoryAdjustmentJournalLines(params: {
  isIncrease: boolean;
  amount: number;
  inventoryGlCode?: string;
  offsetGlCode?: string;
  adjNo: string;
  reason: string;
}): CentralPostingLine[] {
  const amt = round2(params.amount);
  const invGl = params.inventoryGlCode || '1110';
  const offsetGl = params.offsetGlCode || '5010';
  return params.isIncrease
    ? [
        { glCode: invGl, debit: amt, credit: 0, memo: `Stock Gain ${params.adjNo}: ${params.reason}` },
        { glCode: offsetGl, debit: 0, credit: amt, memo: `Inventory Adjustment Offset ${params.adjNo}` },
      ]
    : [
        { glCode: offsetGl, debit: amt, credit: 0, memo: `Stock Write-off/Shrinkage ${params.adjNo}: ${params.reason}` },
        { glCode: invGl, debit: 0, credit: amt, memo: `Inventory Reduction ${params.adjNo}` },
      ];
}

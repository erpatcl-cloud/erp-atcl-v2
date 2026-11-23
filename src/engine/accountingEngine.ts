import type {
  AccountCategory,
  AuditLogEntry,
  AuditStatus,
  BalanceSheetReport,
  COAValidationResult,
  FinancialRatiosReport,
  FinancialRatiosSnapshot,
  GLAccount,
  GLSummaryRow,
  IncomeStatementGroup,
  IncomeStatementReport,
  InventoryMovementRecord,
  InvoiceAllocation,
  JournalLine,
  JournalValidationResult,
  LedgerState,
  MonthlyMatrixRow,
  MonthlySummaryReport,
  PostedTransaction,
  ReconciliationResult,
  RegisterDiscrepancy,
  RegisterEntry,
  SalesInvoiceAllocation,
  TaxWithholdingRule,
  TrialBalanceReport,
  TrialBalanceRow,
} from '../types/accounting.ts';

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${rand}`;
}

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function formatBDT(amount: number, showDashForZero = false): string {
  const rounded = round2(amount);
  if (showDashForZero && Math.abs(rounded) < 0.005) {
    return '—';
  }
  const absFormatted = Math.abs(rounded).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (rounded < 0) {
    return `(৳${absFormatted})`;
  }
  return `৳${absFormatted}`;
}

export function formatCompactBDT(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 100_000_000) {
    return `${sign}৳${(abs / 10_000_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_000_000) {
    return `${sign}৳${(abs / 1_000_000).toFixed(2)}M`;
  }
  return formatBDT(amount);
}

export function appendAuditLog(
  state: LedgerState,
  module: string,
  action: string,
  details: string,
  status: AuditStatus,
  userEmail?: string
): AuditLogEntry {
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    logId: shortId('AUD'),
    userEmail: userEmail || state.config.operatorEmail,
    module,
    action,
    details,
    status,
  };
  state.auditLogs.unshift(entry);
  return entry;
}

/**
 * Port of 03_RegisterManager.gs -> validateChartOfAccounts()
 */
export function validateChartOfAccounts(state: LedgerState): COAValidationResult {
  const errors: string[] = [];
  const seenCodes = new Set<string>();
  const validCategories: AccountCategory[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

  state.accounts.forEach((acc, idx) => {
    const row = idx + 1;
    const code = acc.code.trim();
    const name = acc.name.trim();

    if (!code) errors.push(`Row ${row}: Missing GL Account Code.`);
    if (seenCodes.has(code)) errors.push(`Row ${row}: Duplicate GL Code '${code}'.`);
    seenCodes.add(code);

    if (!name) errors.push(`Row ${row}: Missing Account Name for code '${code}'.`);
    if (!validCategories.includes(acc.category)) {
      errors.push(`Row ${row}: Invalid Category '${acc.category}' for Account ${code}.`);
    }
  });

  appendAuditLog(
    state,
    'REGISTER_MGR',
    'VALIDATE_COA',
    errors.length === 0
      ? `Validated ${state.accounts.length} accounts. Zero duplicate codes or schema errors.`
      : `COA validation flagged ${errors.length} issue(s).`,
    errors.length === 0 ? 'SUCCESS' : 'ALERT'
  );

  return {
    isValid: errors.length === 0,
    totalAccounts: state.accounts.length,
    errors,
  };
}

/**
 * Port of 03_RegisterManager.gs -> createAllMissingRegisters()
 */
export function createAllMissingRegisters(state: LedgerState): { createdCount: number; createdCodes: string[] } {
  const now = new Date().toISOString();
  const createdCodes: string[] = [];

  for (const acc of state.accounts) {
    if (acc.status !== 'Active') continue;
    const existingReg = state.registers[acc.code];
    if (!acc.registerFileId || !existingReg) {
      const fileId = `REG-ATCL-${acc.code}`;
      const fileName = `${acc.code} - ${acc.name} - Register Book`;
      acc.registerFileId = fileId;
      acc.registerFileName = fileName;
      acc.lastSyncedAt = now;

      state.registers[acc.code] = {
        glCode: acc.code,
        fileId,
        fileName,
        createdAt: now,
        lastSyncedAt: now,
        entries: [],
      };
      createdCodes.push(acc.code);
    }
  }

  if (createdCodes.length > 0) {
    appendAuditLog(
      state,
      'REGISTER_MGR',
      'CREATE_REGISTER',
      `Created and linked ${createdCodes.length} new GL Register Book(s): ${createdCodes.join(', ')}.`,
      'SUCCESS'
    );
  }

  return { createdCount: createdCodes.length, createdCodes };
}

/**
 * Port of 04_JournalPostingEngine.gs -> validateJournalVouchers()
 */
export function validateJournalVouchers(state: LedgerState): JournalValidationResult {
  const validAccounts = new Map<string, GLAccount>(state.accounts.map((a) => [a.code.trim(), a]));
  const postedVouchers = new Set<string>(state.postedTransactions.map((t) => t.voucherNo.trim()));

  const vouchers = new Map<string, JournalLine[]>();
  for (const line of state.journalLines) {
    if (line.postingStatus === 'POSTED') continue;
    const vNo = line.voucherNo.trim();
    if (!vNo) continue;
    if (!vouchers.has(vNo)) vouchers.set(vNo, []);
    vouchers.get(vNo)!.push(line);
  }

  let validVouchers = 0;
  let invalidVouchers = 0;

  vouchers.forEach((lines, vNo) => {
    let vDebit = 0;
    let vCredit = 0;
    const vErrors: string[] = [];

    if (postedVouchers.has(vNo)) {
      vErrors.push(`Voucher ${vNo} has ALREADY been posted to Master Store.`);
    }

    lines.forEach((line, idx) => {
      const code = line.glCode.trim();
      const dr = Number(line.debit) || 0;
      const cr = Number(line.credit) || 0;
      vDebit = round2(vDebit + dr);
      vCredit = round2(vCredit + cr);

      if (!line.date) vErrors.push(`Line ${idx + 1}: Missing Date.`);
      if (!code) {
        vErrors.push(`Line ${idx + 1}: Missing GL Account Code.`);
      } else if (!validAccounts.has(code)) {
        vErrors.push(`Line ${idx + 1}: GL Code '${code}' does not exist in COA.`);
      } else if (validAccounts.get(code)!.status !== 'Active') {
        vErrors.push(`Line ${idx + 1}: GL Code '${code}' is INACTIVE.`);
      }

      if (dr <= 0 && cr <= 0) vErrors.push(`Line ${idx + 1}: Debit or Credit must be > 0.`);
      if (dr > 0 && cr > 0) vErrors.push(`Line ${idx + 1}: Cannot have both Debit and Credit on same line.`);
    });

    const diff = Math.abs(round2(vDebit - vCredit));
    if (diff > 0.005) {
      vErrors.push(
        `Voucher Unbalanced! Dr: ${formatBDT(vDebit)} vs Cr: ${formatBDT(vCredit)} (Diff: ${formatBDT(diff)}).`
      );
    }

    const isValid = vErrors.length === 0;
    if (isValid) validVouchers++;
    else invalidVouchers++;

    lines.forEach((line) => {
      const matched = validAccounts.get(line.glCode.trim());
      if (matched) line.glName = matched.name;
      line.validationRemarks = isValid
        ? 'VALID - Balanced (Ready for Approval)'
        : `INVALID: ${vErrors.join('; ')}`;
    });
  });

  appendAuditLog(
    state,
    'JOURNAL_ENGINE',
    'VALIDATE_VOUCHERS',
    `Validated ${vouchers.size} unposted voucher(s): ${validVouchers} valid, ${invalidVouchers} invalid.`,
    invalidVouchers === 0 ? 'SUCCESS' : 'ALERT'
  );

  return {
    totalVouchers: vouchers.size,
    validVouchers,
    invalidVouchers,
  };
}

/**
 * Port of 04_JournalPostingEngine.gs -> approveValidatedVouchers()
 */
export function approveValidatedVouchers(state: LedgerState): { approvedVouchers: number; approvedLines: number } {
  const voucherMap = new Map<string, { lines: JournalLine[]; isValid: boolean; isPostable: boolean }>();

  for (const line of state.journalLines) {
    const vNo = line.voucherNo.trim();
    if (!vNo) continue;
    if (!voucherMap.has(vNo)) {
      voucherMap.set(vNo, {
        lines: [],
        isValid: true,
        isPostable: line.postingStatus !== 'POSTED',
      });
    }
    const entry = voucherMap.get(vNo)!;
    entry.lines.push(line);
    if (!line.validationRemarks.startsWith('VALID')) entry.isValid = false;
    if (line.postingStatus === 'POSTED') entry.isPostable = false;
  }

  let approvedVouchers = 0;
  let approvedLines = 0;

  voucherMap.forEach((vObj) => {
    if (!vObj.isValid || !vObj.isPostable) return;
    let changed = false;
    for (const line of vObj.lines) {
      if (line.approvalStatus !== 'APPROVED') {
        line.approvalStatus = 'APPROVED';
        approvedLines++;
        changed = true;
      }
    }
    if (changed) approvedVouchers++;
  });

  if (approvedLines > 0) {
    appendAuditLog(
      state,
      'JOURNAL_ENGINE',
      'APPROVE_VOUCHERS',
      `Approved ${approvedVouchers} voucher(s) (${approvedLines} journal lines) for posting.`,
      'SUCCESS'
    );
  }

  return { approvedVouchers, approvedLines };
}

/**
 * Port of 04_JournalPostingEngine.gs -> postApprovedVouchers()
 */
export function postApprovedVouchers(state: LedgerState): {
  postedVouchers: number;
  postedLines: number;
  syncedLines: number;
  updatedRegisters: number;
} {
  const voucherMap = new Map<string, { lines: JournalLine[]; canPost: boolean }>();

  for (const line of state.journalLines) {
    const vNo = line.voucherNo.trim();
    if (!vNo) continue;
    if (!voucherMap.has(vNo)) {
      voucherMap.set(vNo, { lines: [], canPost: true });
    }
    const vObj = voucherMap.get(vNo)!;
    vObj.lines.push(line);

    if (
      line.approvalStatus !== 'APPROVED' ||
      line.postingStatus === 'POSTED' ||
      !line.validationRemarks.startsWith('VALID')
    ) {
      vObj.canPost = false;
    }
  }

  let postedVouchers = 0;
  let postedLines = 0;
  const now = new Date().toISOString();

  voucherMap.forEach((vObj, vNo) => {
    if (!vObj.canPost || vObj.lines.length === 0) return;

    const debits = vObj.lines.filter((l) => l.debit > 0);
    const credits = vObj.lines.filter((l) => l.credit > 0);

    // Double check balance before atomic commit
    const totalDr = round2(debits.reduce((s, l) => s + l.debit, 0));
    const totalCr = round2(credits.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDr - totalCr) > 0.005) return;

    vObj.lines.forEach((line) => {
      let contraCode = '';
      let contraName = '';

      if (line.debit > 0) {
        if (credits.length === 1) {
          contraCode = credits[0].glCode;
          contraName = credits[0].glName;
        } else {
          contraCode = 'MULTI';
          contraName = 'Multiple Credit Accounts';
        }
      } else {
        if (debits.length === 1) {
          contraCode = debits[0].glCode;
          contraName = debits[0].glName;
        } else {
          contraCode = 'MULTI';
          contraName = 'Multiple Debit Accounts';
        }
      }

      const posted: PostedTransaction = {
        postTimestamp: now,
        journalId: line.journalId || shortId('JRN'),
        voucherNo: vNo,
        date: line.date,
        type: line.debit > 0 ? 'Debit Post' : 'Credit Post',
        description: line.description,
        reference: line.reference,
        counterparty: line.counterparty || 'General Client / Supplier',
        glCode: line.glCode.trim(),
        glName: line.glName,
        contraCode,
        contraName,
        debit: round2(line.debit),
        credit: round2(line.credit),
        enteredBy: line.enteredBy || state.config.operatorEmail,
        transactionId: shortId('TXN') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
        registerSynced: 'PENDING',
      };

      state.postedTransactions.push(posted);
      line.postingStatus = 'POSTED';
      line.validationRemarks = 'POSTED - Authoritative Ledger Recorded';
      postedLines++;
    });

    postedVouchers++;
  });

  let syncedLines = 0;
  let updatedRegisters = 0;

  if (postedLines > 0) {
    appendAuditLog(
      state,
      'POSTING_ENGINE',
      'POST_VOUCHERS',
      `Posted ${postedVouchers} voucher(s) (${postedLines} lines) to immutable Master Posted Store.`,
      'SUCCESS'
    );

    if (state.config.autoSyncOnPost) {
      const syncRes = syncPostedTransactionsToRegisters(state);
      syncedLines = syncRes.syncedLines;
      updatedRegisters = syncRes.updatedRegisters;
    }
  }

  return { postedVouchers, postedLines, syncedLines, updatedRegisters };
}

/**
 * Port of 04_JournalPostingEngine.gs -> reverseVoucher()
 */
export function reverseVoucher(
  state: LedgerState,
  originalVoucherNo: string,
  reason: string
): { reversalVoucherNo: string; linesReversed: number } {
  const trimmedNo = originalVoucherNo.trim();
  const matchedLines = state.postedTransactions.filter((t) => t.voucherNo.trim() === trimmedNo);
  if (matchedLines.length === 0) {
    throw new Error(`Voucher '${trimmedNo}' not found in Posted Store.`);
  }

  const revVoucherNo = `REV-${trimmedNo}`;
  const alreadyReversed = state.postedTransactions.some((t) => t.voucherNo === revVoucherNo);
  if (alreadyReversed) {
    throw new Error(`Reversal voucher '${revVoucherNo}' already exists in Posted Store.`);
  }

  const revDate = new Date().toISOString().slice(0, 10);
  const user = state.config.operatorEmail;

  for (const orig of matchedLines) {
    state.journalLines.push({
      journalId: `REV-${orig.journalId}`,
      date: revDate,
      voucherNo: revVoucherNo,
      description: `Reversal of ${trimmedNo}: ${reason}`,
      glCode: orig.glCode,
      glName: orig.glName,
      debit: orig.credit, // Inverted
      credit: orig.debit, // Inverted
      reference: `Ref: ${trimmedNo}`,
      counterparty: orig.counterparty,
      enteredBy: user,
      approvalStatus: 'APPROVED',
      postingStatus: 'UNPOSTED',
      validationRemarks: 'VALID - System Reversal',
    });
  }

  appendAuditLog(
    state,
    'POSTING_ENGINE',
    'REVERSE_VOUCHER',
    `Generated reversal ${revVoucherNo} for ${trimmedNo}. Reason: ${reason}`,
    'SUCCESS'
  );

  postApprovedVouchers(state);
  return { reversalVoucherNo: revVoucherNo, linesReversed: matchedLines.length };
}

/**
 * Port of 05_RegisterSyncEngine.gs -> syncPostedTransactionsToRegisters()
 */
export function syncPostedTransactionsToRegisters(state: LedgerState): {
  syncedLines: number;
  updatedRegisters: number;
} {
  const accountMap = new Map<string, GLAccount>(state.accounts.map((a) => [a.code, a]));
  const pendingByAccount = new Map<string, PostedTransaction[]>();

  for (const txn of state.postedTransactions) {
    if (txn.registerSynced === 'PENDING' && accountMap.has(txn.glCode)) {
      if (!pendingByAccount.has(txn.glCode)) pendingByAccount.set(txn.glCode, []);
      pendingByAccount.get(txn.glCode)!.push(txn);
    }
  }

  if (pendingByAccount.size === 0) {
    return { syncedLines: 0, updatedRegisters: 0 };
  }

  const now = new Date().toISOString();
  let syncedLines = 0;
  let updatedRegisters = 0;

  pendingByAccount.forEach((items, glCode) => {
    const acc = accountMap.get(glCode)!;
    if (!state.registers[glCode]) {
      state.registers[glCode] = {
        glCode,
        fileId: acc.registerFileId || `REG-ATCL-${glCode}`,
        fileName: acc.registerFileName || `${glCode} - ${acc.name} - Register Book`,
        createdAt: now,
        lastSyncedAt: now,
        entries: [],
      };
      acc.registerFileId = state.registers[glCode].fileId;
      acc.registerFileName = state.registers[glCode].fileName;
    }

    const reg = state.registers[glCode];
    const existingTxnIds = new Set<string>(reg.entries.map((e) => e.transactionId));
    let currentBal =
      reg.entries.length === 0
        ? acc.openingBalance
        : reg.entries[reg.entries.length - 1].runningBalance;

    let addedHere = 0;
    for (const txn of items) {
      if (!existingTxnIds.has(txn.transactionId)) {
        if (acc.normalBalance === 'Debit') {
          currentBal = round2(currentBal + txn.debit - txn.credit);
        } else {
          currentBal = round2(currentBal + txn.credit - txn.debit);
        }
        const balanceType: 'Dr' | 'Cr' =
          currentBal >= 0
            ? acc.normalBalance === 'Debit'
              ? 'Dr'
              : 'Cr'
            : acc.normalBalance === 'Debit'
              ? 'Cr'
              : 'Dr';

        reg.entries.push({
          date: txn.date,
          voucherNo: txn.voucherNo,
          type: txn.type,
          description: txn.description,
          reference: txn.reference,
          counterparty: txn.counterparty,
          contraCode: txn.contraCode,
          contraName: txn.contraName,
          debit: txn.debit,
          credit: txn.credit,
          runningBalance: currentBal,
          balanceType,
          enteredBy: txn.enteredBy,
          entryTimestamp: txn.postTimestamp,
          transactionId: txn.transactionId,
        });
        addedHere++;
        syncedLines++;
      }
      txn.registerSynced = 'SYNCED';
    }

    if (addedHere > 0) {
      reg.lastSyncedAt = now;
      acc.lastSyncedAt = now;
      updatedRegisters++;
    }
  });

  state.config.lastSyncTimestamp = now;
  appendAuditLog(
    state,
    'SYNC_ENGINE',
    'BATCH_SYNC',
    `Synchronized ${syncedLines} transaction line(s) across ${updatedRegisters} GL Register Book(s).`,
    'SUCCESS'
  );

  return { syncedLines, updatedRegisters };
}

/**
 * Port of 05_RegisterSyncEngine.gs -> rebuildRegisterFromMaster()
 */
export function rebuildRegisterFromMaster(state: LedgerState, glCode: string): { transactionCount: number } {
  const acc = state.accounts.find((a) => a.code === glCode.trim());
  if (!acc) throw new Error(`GL Account Code '${glCode}' not found in Chart of Accounts.`);

  const now = new Date().toISOString();
  const txns = state.postedTransactions
    .filter((t) => t.glCode === acc.code)
    .sort((a, b) => a.date.localeCompare(b.date) || a.postTimestamp.localeCompare(b.postTimestamp));

  let runningBal = acc.openingBalance;
  const entries: RegisterEntry[] = txns.map((t) => {
    if (acc.normalBalance === 'Debit') {
      runningBal = round2(runningBal + t.debit - t.credit);
    } else {
      runningBal = round2(runningBal + t.credit - t.debit);
    }
    const balanceType: 'Dr' | 'Cr' =
      runningBal >= 0
        ? acc.normalBalance === 'Debit'
          ? 'Dr'
          : 'Cr'
        : acc.normalBalance === 'Debit'
          ? 'Cr'
          : 'Dr';

    t.registerSynced = 'SYNCED';

    return {
      date: t.date,
      voucherNo: t.voucherNo,
      type: t.type,
      description: t.description,
      reference: t.reference,
      counterparty: t.counterparty,
      contraCode: t.contraCode,
      contraName: t.contraName,
      debit: t.debit,
      credit: t.credit,
      runningBalance: runningBal,
      balanceType,
      enteredBy: t.enteredBy,
      entryTimestamp: t.postTimestamp,
      transactionId: t.transactionId,
    };
  });

  const fileId = acc.registerFileId || `REG-ATCL-${acc.code}`;
  const fileName = acc.registerFileName || `${acc.code} - ${acc.name} - Register Book`;
  acc.registerFileId = fileId;
  acc.registerFileName = fileName;
  acc.lastSyncedAt = now;

  state.registers[acc.code] = {
    glCode: acc.code,
    fileId,
    fileName,
    createdAt: state.registers[acc.code]?.createdAt || now,
    lastSyncedAt: now,
    entries,
  };

  appendAuditLog(
    state,
    'REBUILD_ENGINE',
    'REBUILD_REGISTER',
    `Rebuilt Register Book for GL ${acc.code} (${acc.name}) with ${entries.length} transaction(s). Running balance verified.`,
    'SUCCESS'
  );

  return { transactionCount: entries.length };
}

/**
 * Port of 07_AuditAndReconciliation.gs -> reconcileAllRegisters()
 */
export function reconcileAllRegisters(state: LedgerState, recordAudit = true): ReconciliationResult {
  const storeDr = new Map<string, number>();
  const storeCr = new Map<string, number>();
  const storeCount = new Map<string, number>();

  for (const t of state.postedTransactions) {
    storeDr.set(t.glCode, round2((storeDr.get(t.glCode) || 0) + t.debit));
    storeCr.set(t.glCode, round2((storeCr.get(t.glCode) || 0) + t.credit));
    storeCount.set(t.glCode, (storeCount.get(t.glCode) || 0) + 1);
  }

  const discrepancies: RegisterDiscrepancy[] = [];
  let totalChecked = 0;

  for (const acc of state.accounts) {
    if (acc.status !== 'Active') continue;
    totalChecked++;

    const expDr = storeDr.get(acc.code) || 0;
    const expCr = storeCr.get(acc.code) || 0;
    const expCount = storeCount.get(acc.code) || 0;
    const expectedClose =
      acc.normalBalance === 'Debit'
        ? round2(acc.openingBalance + expDr - expCr)
        : round2(acc.openingBalance + expCr - expDr);

    const reg = state.registers[acc.code];
    if (!reg || !acc.registerFileId) {
      discrepancies.push({
        code: acc.code,
        name: acc.name,
        expected: expectedClose,
        actual: 0,
        diff: Math.abs(expectedClose),
        expectedCount: expCount,
        actualCount: 0,
        fileId: acc.registerFileId,
        error: 'Register book not provisioned or unlinked.',
      });
      continue;
    }

    const regDr = round2(reg.entries.reduce((s, e) => s + e.debit, 0));
    const regCr = round2(reg.entries.reduce((s, e) => s + e.credit, 0));
    const actualClose =
      acc.normalBalance === 'Debit'
        ? round2(acc.openingBalance + regDr - regCr)
        : round2(acc.openingBalance + regCr - regDr);

    const diff = Math.abs(round2(expectedClose - actualClose));
    if (diff > 0.01 || reg.entries.length !== expCount) {
      discrepancies.push({
        code: acc.code,
        name: acc.name,
        expected: expectedClose,
        actual: actualClose,
        diff,
        expectedCount: expCount,
        actualCount: reg.entries.length,
        fileId: reg.fileId,
        error:
          reg.entries.length !== expCount
            ? `Entry count mismatch (Master: ${expCount}, Register: ${reg.entries.length}).`
            : undefined,
      });
    }
  }

  if (recordAudit) {
    appendAuditLog(
      state,
      'AUDIT_ENGINE',
      'RECONCILIATION',
      `Audited ${totalChecked} active registers against Master Posted Store. Found ${discrepancies.length} discrepancy(ies).`,
      discrepancies.length === 0 ? 'SUCCESS' : 'DISCREPANCY'
    );
  }

  return {
    totalChecked,
    reconciledCount: totalChecked - discrepancies.length,
    discrepancies,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Port of 07_AuditAndReconciliation.gs -> selfHealDiscrepancies()
 */
export function selfHealDiscrepancies(state: LedgerState): { healedCount: number; healedCodes: string[] } {
  const recon = reconcileAllRegisters(state, false);
  const healedCodes: string[] = [];

  for (const d of recon.discrepancies) {
    rebuildRegisterFromMaster(state, d.code);
    healedCodes.push(d.code);
  }

  appendAuditLog(
    state,
    'AUDIT_ENGINE',
    'SELF_HEAL_COMPLETE',
    healedCodes.length > 0
      ? `Self-healed and resynchronized ${healedCodes.length} register book(s): ${healedCodes.join(', ')}.`
      : 'Self-heal audit ran: all registers already mathematically synchronized.',
    'SUCCESS'
  );

  return { healedCount: healedCodes.length, healedCodes };
}

/**
 * Scope LedgerState to a [fromDate, toDate] reporting window:
 * - Posted transactions before `fromDate` roll forward into each account's openingBalance
 * - Posted transactions within [fromDate, toDate] become period movements
 * - Posted transactions after `toDate` are excluded
 */
export function scopeLedgerStateToPeriod(
  state: LedgerState,
  fromDate?: string,
  toDate?: string
): LedgerState {
  const from = fromDate?.trim() || '';
  const to = toDate?.trim() || '';
  if (!from && !to) return state;

  const priorDr = new Map<string, number>();
  const priorCr = new Map<string, number>();
  const inPeriodTx: LedgerState['postedTransactions'] = [];

  for (const tx of state.postedTransactions) {
    const d = (tx.date || '').slice(0, 10);
    if (to && d > to) {
      continue;
    }
    if (from && d < from) {
      priorDr.set(tx.glCode, round2((priorDr.get(tx.glCode) || 0) + tx.debit));
      priorCr.set(tx.glCode, round2((priorCr.get(tx.glCode) || 0) + tx.credit));
      continue;
    }
    inPeriodTx.push(tx);
  }

  const scopedAccounts = state.accounts.map((acc) => {
    const dr = priorDr.get(acc.code) || 0;
    const cr = priorCr.get(acc.code) || 0;
    if (dr === 0 && cr === 0) return acc;
    const adjustedOpening =
      acc.normalBalance === 'Debit'
        ? round2(acc.openingBalance + dr - cr)
        : round2(acc.openingBalance + cr - dr);
    return {
      ...acc,
      openingBalance: adjustedOpening,
    };
  });

  return {
    ...state,
    accounts: scopedAccounts,
    postedTransactions: inPeriodTx,
  };
}

/**
 * Port of 06_ReportsEngine.gs -> GL Summary Computation
 */
export function computeGLSummary(state: LedgerState): GLSummaryRow[] {
  const drMap = new Map<string, number>();
  const crMap = new Map<string, number>();

  for (const t of state.postedTransactions) {
    drMap.set(t.glCode, round2((drMap.get(t.glCode) || 0) + t.debit));
    crMap.set(t.glCode, round2((crMap.get(t.glCode) || 0) + t.credit));
  }

  return state.accounts.map((acc) => {
    const periodDebit = drMap.get(acc.code) || 0;
    const periodCredit = crMap.get(acc.code) || 0;
    const closingBalance =
      acc.normalBalance === 'Debit'
        ? round2(acc.openingBalance + periodDebit - periodCredit)
        : round2(acc.openingBalance + periodCredit - periodDebit);

    return {
      code: acc.code,
      name: acc.name,
      category: acc.category,
      group: acc.group,
      accountType: acc.accountType || `${acc.category} (${acc.group})`,
      normalBalance: acc.normalBalance,
      openingBalance: acc.openingBalance,
      periodDebit,
      periodCredit,
      closingBalance,
      priorYearDebit: round2(acc.priorYearDebit || 0),
      priorYearCredit: round2(acc.priorYearCredit || 0),
      registerFileId: acc.registerFileId,
      status: acc.status,
    };
  });
}

/**
 * Port of 06_ReportsEngine.gs -> generateTrialBalance()
 */
export function computeTrialBalance(state: LedgerState): TrialBalanceReport {
  const summary = computeGLSummary(state);
  const rows: TrialBalanceRow[] = [];

  let openingDr = 0;
  let openingCr = 0;
  let periodDr = 0;
  let periodCr = 0;
  let closingDr = 0;
  let closingCr = 0;
  let priorDr = 0;
  let priorCr = 0;

  for (const item of summary) {
    const opSigned = item.normalBalance === 'Debit' ? item.openingBalance : -item.openingBalance;
    const opDr = opSigned >= 0 ? round2(opSigned) : 0;
    const opCr = opSigned < 0 ? round2(Math.abs(opSigned)) : 0;
    const net = round2(opDr - opCr + (item.periodDebit - item.periodCredit));
    const clDr = net >= 0 ? net : 0;
    const clCr = net < 0 ? Math.abs(net) : 0;

    openingDr = round2(openingDr + opDr);
    openingCr = round2(openingCr + opCr);
    periodDr = round2(periodDr + item.periodDebit);
    periodCr = round2(periodCr + item.periodCredit);
    closingDr = round2(closingDr + clDr);
    closingCr = round2(closingCr + clCr);
    priorDr = round2(priorDr + item.priorYearDebit);
    priorCr = round2(priorCr + item.priorYearCredit);

    rows.push({
      code: item.code,
      name: item.name,
      category: item.category,
      accountType: item.accountType,
      openingDr: opDr,
      openingCr: opCr,
      periodDr: item.periodDebit,
      periodCr: item.periodCredit,
      closingDr: clDr,
      closingCr: clCr,
      priorDr: item.priorYearDebit,
      priorCr: item.priorYearCredit,
    });
  }

  const openingDiff = Math.abs(round2(openingDr - openingCr));
  const closingDiff = Math.abs(round2(closingDr - closingCr));
  const priorDiff = Math.abs(round2(priorDr - priorCr));

  return {
    rows,
    totals: {
      openingDr,
      openingCr,
      periodDr,
      periodCr,
      closingDr,
      closingCr,
      priorDr,
      priorCr,
    },
    openingDiff,
    closingDiff,
    priorDiff,
    isOpeningBalanced: openingDiff <= 0.5,
    isClosingBalanced: closingDiff <= 0.5,
  };
}

/**
 * Port of 06_ReportsEngine.gs -> generateIncomeStatement()
 */
export function computeIncomeStatement(state: LedgerState): IncomeStatementReport {
  const summary = computeGLSummary(state);

  const priorAmountFor = (item: GLSummaryRow): number =>
    item.normalBalance === 'Debit'
      ? round2(item.priorYearDebit - item.priorYearCredit)
      : round2(item.priorYearCredit - item.priorYearDebit);

  const groupRows = (items: GLSummaryRow[]): IncomeStatementGroup[] => {
    const map = new Map<string, { code: string; name: string; amount: number; priorAmount: number }[]>();
    for (const item of items) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push({
        code: item.code,
        name: item.name,
        amount: item.closingBalance,
        priorAmount: priorAmountFor(item),
      });
    }
    return Array.from(map.entries()).map(([group, accounts]) => ({
      group,
      accounts,
      subtotal: round2(accounts.reduce((s, a) => s + a.amount, 0)),
      priorSubtotal: round2(accounts.reduce((s, a) => s + a.priorAmount, 0)),
    }));
  };

  const isDirectGroup = (g: string) => g === 'Direct Expense' || g === 'Direct Cost';
  const isFinancialGroup = (g: string) => g === 'Financial Expense' || g === 'Finance Costs';
  const isTaxGroup = (g: string) => g === 'Tax Expense' || g === 'Income Tax';

  const incomeItems = summary.filter((s) => s.category === 'Income');
  const directCostItems = summary.filter((s) => s.category === 'Expense' && isDirectGroup(s.group));
  const financialItems = summary.filter((s) => s.category === 'Expense' && isFinancialGroup(s.group));
  const taxItems = summary.filter((s) => s.category === 'Expense' && isTaxGroup(s.group));
  const opExItems = summary.filter(
    (s) =>
      s.category === 'Expense' &&
      !isDirectGroup(s.group) &&
      !isFinancialGroup(s.group) &&
      !isTaxGroup(s.group)
  );

  const incomeGroups = groupRows(incomeItems);
  const directCostGroups = groupRows(directCostItems);
  const operatingExpenseGroups = groupRows(opExItems);
  const financialExpenseGroups = groupRows(financialItems);
  const taxExpenseGroups = groupRows(taxItems);

  const totalIncome = round2(incomeGroups.reduce((s, g) => s + g.subtotal, 0));
  const totalDirectCosts = round2(directCostGroups.reduce((s, g) => s + g.subtotal, 0));
  const grossProfit = round2(totalIncome - totalDirectCosts);
  const totalOperatingExpenses = round2(operatingExpenseGroups.reduce((s, g) => s + g.subtotal, 0));
  const operatingProfit = round2(grossProfit - totalOperatingExpenses);
  const totalFinancialExpenses = round2(financialExpenseGroups.reduce((s, g) => s + g.subtotal, 0));
  const profitBeforeTax = round2(operatingProfit - totalFinancialExpenses);
  const totalTaxExpenses = round2(taxExpenseGroups.reduce((s, g) => s + g.subtotal, 0));
  const netProfit = round2(profitBeforeTax - totalTaxExpenses);

  const priorTotalIncome = round2(incomeGroups.reduce((s, g) => s + g.priorSubtotal, 0));
  const priorTotalDirectCosts = round2(directCostGroups.reduce((s, g) => s + g.priorSubtotal, 0));
  const priorGrossProfit = round2(priorTotalIncome - priorTotalDirectCosts);
  const priorTotalOperatingExpenses = round2(operatingExpenseGroups.reduce((s, g) => s + g.priorSubtotal, 0));
  const priorOperatingProfit = round2(priorGrossProfit - priorTotalOperatingExpenses);
  const priorTotalFinancialExpenses = round2(financialExpenseGroups.reduce((s, g) => s + g.priorSubtotal, 0));
  const priorProfitBeforeTax = round2(priorOperatingProfit - priorTotalFinancialExpenses);
  const priorTotalTaxExpenses = round2(taxExpenseGroups.reduce((s, g) => s + g.priorSubtotal, 0));
  const priorNetProfit = round2(priorProfitBeforeTax - priorTotalTaxExpenses);

  return {
    incomeGroups,
    directCostGroups,
    operatingExpenseGroups,
    financialExpenseGroups,
    taxExpenseGroups,
    totalIncome,
    totalDirectCosts,
    grossProfit,
    totalOperatingExpenses,
    operatingProfit,
    totalFinancialExpenses,
    profitBeforeTax,
    totalTaxExpenses,
    netProfit,
    grossMarginPct: totalIncome > 0 ? round2((grossProfit / totalIncome) * 100) : 0,
    netMarginPct: totalIncome > 0 ? round2((netProfit / totalIncome) * 100) : 0,
    priorYear: {
      totalIncome: priorTotalIncome,
      totalDirectCosts: priorTotalDirectCosts,
      grossProfit: priorGrossProfit,
      totalOperatingExpenses: priorTotalOperatingExpenses,
      operatingProfit: priorOperatingProfit,
      totalFinancialExpenses: priorTotalFinancialExpenses,
      profitBeforeTax: priorProfitBeforeTax,
      totalTaxExpenses: priorTotalTaxExpenses,
      netProfit: priorNetProfit,
    },
  };
}

/**
 * Port of 06_ReportsEngine.gs -> generateBalanceSheet()
 */
export function computeBalanceSheet(state: LedgerState): BalanceSheetReport {
  const summary = computeGLSummary(state);
  const incomeStatement = computeIncomeStatement(state);

  const assetCarryingAmount = (s: GLSummaryRow) =>
    s.normalBalance === 'Credit' ? round2(-s.closingBalance) : s.closingBalance;
  const assetPriorAmount = (s: GLSummaryRow) => round2(s.priorYearDebit - s.priorYearCredit);
  const creditPriorAmount = (s: GLSummaryRow) => round2(s.priorYearCredit - s.priorYearDebit);

  const nonCurrentAssets = summary
    .filter((s) => s.category === 'Asset' && s.group === 'Non-Current Assets')
    .map((s) => ({
      code: s.code,
      name: s.name,
      amount: assetCarryingAmount(s),
      priorAmount: assetPriorAmount(s),
      isContra: s.normalBalance === 'Credit',
    }));

  const currentAssets = summary
    .filter((s) => s.category === 'Asset' && s.group !== 'Non-Current Assets')
    .map((s) => ({
      code: s.code,
      name: s.name,
      amount: assetCarryingAmount(s),
      priorAmount: assetPriorAmount(s),
      isContra: s.normalBalance === 'Credit',
    }));

  const equityItems = summary
    .filter((s) => s.category === 'Equity')
    .map((s) => ({
      code: s.code,
      name: s.name,
      amount: s.closingBalance,
      priorAmount: creditPriorAmount(s),
    }));

  const nonCurrentLiabilities = summary
    .filter((s) => s.category === 'Liability' && s.group === 'Non-Current Liabilities')
    .map((s) => ({
      code: s.code,
      name: s.name,
      amount: s.closingBalance,
      priorAmount: creditPriorAmount(s),
    }));

  const currentLiabilities = summary
    .filter((s) => s.category === 'Liability' && s.group !== 'Non-Current Liabilities')
    .map((s) => ({
      code: s.code,
      name: s.name,
      amount: s.closingBalance,
      priorAmount: creditPriorAmount(s),
    }));

  const totalNonCurrentAssets = round2(nonCurrentAssets.reduce((s, i) => s + i.amount, 0));
  const totalCurrentAssets = round2(currentAssets.reduce((s, i) => s + i.amount, 0));
  const totalAssets = round2(totalNonCurrentAssets + totalCurrentAssets);

  const baseEquity = round2(equityItems.reduce((s, i) => s + i.amount, 0));
  const totalEquity = round2(baseEquity + incomeStatement.netProfit);

  const totalNonCurrentLiabilities = round2(nonCurrentLiabilities.reduce((s, i) => s + i.amount, 0));
  const totalCurrentLiabilities = round2(currentLiabilities.reduce((s, i) => s + i.amount, 0));
  const totalLiabilities = round2(totalNonCurrentLiabilities + totalCurrentLiabilities);

  const totalEquityAndLiabilities = round2(totalEquity + totalLiabilities);
  const variance = round2(totalAssets - totalEquityAndLiabilities);

  // Prior Year (FY 2023-24) Comparative Balance Sheet
  const priorNonCurrentAssets = round2(nonCurrentAssets.reduce((s, i) => s + i.priorAmount, 0));
  const priorCurrentAssets = round2(currentAssets.reduce((s, i) => s + i.priorAmount, 0));
  const priorTotalAssets = round2(priorNonCurrentAssets + priorCurrentAssets);
  const priorBaseEquity = round2(equityItems.reduce((s, i) => s + i.priorAmount, 0));
  const priorTotalEquity = round2(priorBaseEquity + incomeStatement.priorYear.netProfit);
  const priorNonCurrentLiab = round2(nonCurrentLiabilities.reduce((s, i) => s + i.priorAmount, 0));
  const priorCurrentLiab = round2(currentLiabilities.reduce((s, i) => s + i.priorAmount, 0));
  const priorTotalLiab = round2(priorNonCurrentLiab + priorCurrentLiab);
  const priorTotalEqAndLiab = round2(priorTotalEquity + priorTotalLiab);

  return {
    nonCurrentAssets,
    currentAssets,
    totalNonCurrentAssets,
    totalCurrentAssets,
    totalAssets,
    equityItems,
    currentPeriodNetProfit: incomeStatement.netProfit,
    totalEquity,
    nonCurrentLiabilities,
    currentLiabilities,
    totalNonCurrentLiabilities,
    totalCurrentLiabilities,
    totalLiabilities,
    totalEquityAndLiabilities,
    variance,
    isBalanced: Math.abs(variance) <= 0.5,
    priorYear: {
      totalNonCurrentAssets: priorNonCurrentAssets,
      totalCurrentAssets: priorCurrentAssets,
      totalAssets: priorTotalAssets,
      currentPeriodNetProfit: incomeStatement.priorYear.netProfit,
      totalEquity: priorTotalEquity,
      totalNonCurrentLiabilities: priorNonCurrentLiab,
      totalCurrentLiabilities: priorCurrentLiab,
      totalLiabilities: priorTotalLiab,
      totalEquityAndLiabilities: priorTotalEqAndLiab,
    },
  };
}

/**
 * Port of 06_ReportsEngine.gs -> generateMonthlySummary()
 * Uses Bangladesh Fiscal Year (Jul 2024 – Jun 2025)
 */
export function computeMonthlySummary(state: LedgerState): MonthlySummaryReport {
  const monthKeys = [
    '2024-07',
    '2024-08',
    '2024-09',
    '2024-10',
    '2024-11',
    '2024-12',
    '2025-01',
    '2025-02',
    '2025-03',
    '2025-04',
    '2025-05',
    '2025-06',
  ];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const extraMonths = Array.from(
    new Set(
      state.postedTransactions
        .map((t) => t.date.slice(0, 7))
        .filter((mk) => /^\d{4}-\d{2}$/.test(mk) && !monthKeys.includes(mk))
    )
  ).sort();
  monthKeys.push(...extraMonths);

  const monthLabels = monthKeys.map((mk) => {
    const [yr, mo] = mk.split('-');
    const idx = Math.max(0, Math.min(11, parseInt(mo, 10) - 1));
    return `${shortMonths[idx]} ${yr.slice(2)}`;
  });

  const monthlyTotals: Record<string, { debit: number; credit: number }> = {};
  for (const mk of monthKeys) {
    monthlyTotals[mk] = { debit: 0, credit: 0 };
  }

  const accMonthly = new Map<string, Record<string, { debit: number; credit: number; net: number }>>();
  for (const acc of state.accounts) {
    const buckets: Record<string, { debit: number; credit: number; net: number }> = {};
    for (const mk of monthKeys) {
      buckets[mk] = { debit: 0, credit: 0, net: 0 };
    }
    accMonthly.set(acc.code, buckets);
  }

  for (const txn of state.postedTransactions) {
    const mk = txn.date.slice(0, 7);
    if (!monthlyTotals[mk]) continue;
    monthlyTotals[mk].debit = round2(monthlyTotals[mk].debit + txn.debit);
    monthlyTotals[mk].credit = round2(monthlyTotals[mk].credit + txn.credit);

    const acc = state.accounts.find((a) => a.code === txn.glCode);
    const buckets = accMonthly.get(txn.glCode);
    if (acc && buckets && buckets[mk]) {
      buckets[mk].debit = round2(buckets[mk].debit + txn.debit);
      buckets[mk].credit = round2(buckets[mk].credit + txn.credit);
      buckets[mk].net =
        acc.normalBalance === 'Debit'
          ? round2(buckets[mk].debit - buckets[mk].credit)
          : round2(buckets[mk].credit - buckets[mk].debit);
    }
  }

  const rows: MonthlyMatrixRow[] = state.accounts.map((acc) => {
    const months = accMonthly.get(acc.code)!;
    let totalDebit = 0;
    let totalCredit = 0;
    for (const mk of monthKeys) {
      totalDebit = round2(totalDebit + months[mk].debit);
      totalCredit = round2(totalCredit + months[mk].credit);
    }
    const totalNet =
      acc.normalBalance === 'Debit'
        ? round2(totalDebit - totalCredit)
        : round2(totalCredit - totalDebit);

    return {
      code: acc.code,
      name: acc.name,
      category: acc.category,
      months,
      totalDebit,
      totalCredit,
      totalNet,
    };
  });

  return {
    monthKeys,
    monthLabels,
    rows,
    monthlyTotals,
  };
}

/**
 * Computes IFRS Liquidity, Profitability, Solvency, and Efficiency KPIs
 * for both the live fiscal year (FY 2024-25) and prior comparative period (FY 2023-24).
 */
export function computeFinancialRatios(state: LedgerState): FinancialRatiosReport {
  const bs = computeBalanceSheet(state);
  const is = computeIncomeStatement(state);

  const isInventory = (code: string, name: string) =>
    code === '1110' || /inventor|stock/i.test(name);
  const isPrepayment = (code: string, name: string) =>
    code === '1130' || /advance|deposit|prepay/i.test(name);
  const isCashOrBank = (code: string, name: string) =>
    code.startsWith('12') || /\bcash\b|\bbank\b/i.test(name);
  const isReceivable = (code: string, name: string) =>
    code === '1120' || /receivable/i.test(name);

  const safeDiv = (num: number, den: number, mult = 1): number =>
    Math.abs(den) > 0.005 ? round2((num / den) * mult) : 0;

  const buildSnapshot = (usePrior: boolean): FinancialRatiosSnapshot => {
    const val = (item: { amount: number; priorAmount: number }) =>
      usePrior ? item.priorAmount : item.amount;

    const currentAssets = usePrior ? bs.priorYear.totalCurrentAssets : bs.totalCurrentAssets;
    const currentLiabilities = usePrior
      ? bs.priorYear.totalCurrentLiabilities
      : bs.totalCurrentLiabilities;
    const totalAssets = usePrior ? bs.priorYear.totalAssets : bs.totalAssets;
    const totalLiabilities = usePrior ? bs.priorYear.totalLiabilities : bs.totalLiabilities;
    const totalEquity = usePrior ? bs.priorYear.totalEquity : bs.totalEquity;

    const inventories = round2(
      bs.currentAssets
        .filter((a) => isInventory(a.code, a.name))
        .reduce((s, a) => s + val(a), 0)
    );
    const prepaymentsAndAdvances = round2(
      bs.currentAssets
        .filter((a) => isPrepayment(a.code, a.name))
        .reduce((s, a) => s + val(a), 0)
    );
    const cashAndEquivalents = round2(
      bs.currentAssets
        .filter((a) => isCashOrBank(a.code, a.name))
        .reduce((s, a) => s + val(a), 0)
    );
    const tradeReceivables = round2(
      bs.currentAssets
        .filter((a) => isReceivable(a.code, a.name))
        .reduce((s, a) => s + val(a), 0)
    );

    const quickAssets = round2(currentAssets - inventories - prepaymentsAndAdvances);
    const netWorkingCapital = round2(currentAssets - currentLiabilities);

    const revenue = usePrior ? is.priorYear.totalIncome : is.totalIncome;
    const grossProfit = usePrior ? is.priorYear.grossProfit : is.grossProfit;
    const operatingProfit = usePrior ? is.priorYear.operatingProfit : is.operatingProfit;
    const profitBeforeTax = usePrior ? is.priorYear.profitBeforeTax : is.profitBeforeTax;
    const taxExpense = usePrior ? is.priorYear.totalTaxExpenses : is.totalTaxExpenses;
    const netProfit = usePrior ? is.priorYear.netProfit : is.netProfit;

    return {
      currentAssets,
      inventories,
      prepaymentsAndAdvances,
      cashAndEquivalents,
      tradeReceivables,
      quickAssets,
      currentLiabilities,
      totalAssets,
      totalLiabilities,
      totalEquity,
      netWorkingCapital,
      revenue,
      grossProfit,
      operatingProfit,
      profitBeforeTax,
      taxExpense,
      netProfit,
      currentRatio: safeDiv(currentAssets, currentLiabilities, 1),
      quickRatio: safeDiv(quickAssets, currentLiabilities, 1),
      cashRatio: safeDiv(cashAndEquivalents, currentLiabilities, 1),
      debtToEquity: safeDiv(totalLiabilities, totalEquity, 1),
      debtToAssetsPct: safeDiv(totalLiabilities, totalAssets, 100),
      grossMarginPct: safeDiv(grossProfit, revenue, 100),
      operatingMarginPct: safeDiv(operatingProfit, revenue, 100),
      preTaxMarginPct: safeDiv(profitBeforeTax, revenue, 100),
      netProfitMarginPct: safeDiv(netProfit, revenue, 100),
      effectiveTaxRatePct: safeDiv(taxExpense, profitBeforeTax, 100),
      returnOnEquityPct: safeDiv(netProfit, totalEquity, 100),
      returnOnAssetsPct: safeDiv(netProfit, totalAssets, 100),
    };
  };

  return {
    current: buildSnapshot(false),
    prior: buildSnapshot(true),
  };
}

function isCashOrBankAccount(acc: { code: string; name: string; category: string }): boolean {
  if (acc.category !== 'Asset') return false;
  const n = acc.name.toLowerCase();
  return (
    n.includes('cash') ||
    n.includes('bank') ||
    n.includes('petty') ||
    acc.code === '1010' ||
    acc.code === '1020' ||
    acc.code === '1104' ||
    acc.code === '1105' ||
    acc.code === '1106'
  );
}

export function computeCashFlowStatement(state: LedgerState) {
  const summary = computeGLSummary(state);
  const incomeStatement = computeIncomeStatement(state);

  const cashRows = summary.filter((s) => isCashOrBankAccount(s));
  const cashCodes = new Set(cashRows.map((c) => c.code));

  const cashAccounts = cashRows.map((c) => ({
    code: c.code,
    name: c.name,
    opening: round2(c.openingBalance),
    closing: round2(c.closingBalance),
    netChange: round2(c.closingBalance - c.openingBalance),
  }));

  const openingCashBalance = round2(cashAccounts.reduce((s, c) => s + c.opening, 0));
  const closingCashBalance = round2(cashAccounts.reduce((s, c) => s + c.closing, 0));

  // Operating Activities (Indirect Method)
  const operatingItems: Array<{ code?: string; label: string; amount: number; note?: string }> = [];

  for (const s of summary) {
    if (cashCodes.has(s.code)) continue;
    const netPeriodMovement = round2(s.closingBalance - s.openingBalance);
    if (Math.abs(netPeriodMovement) < 0.005) continue;

    if (s.category === 'Asset' && s.group !== 'Non-Current Assets') {
      // Increase in current asset (non-cash) is a cash outflow; contra asset increase is cash inflow
      const cashEffect = s.normalBalance === 'Credit' ? netPeriodMovement : -netPeriodMovement;
      operatingItems.push({
        code: s.code,
        label: `Change in ${s.name}`,
        amount: round2(cashEffect),
        note: cashEffect >= 0 ? 'Working capital inflow' : 'Working capital outflow',
      });
    } else if (s.category === 'Liability' && s.group !== 'Non-Current Liabilities') {
      // Increase in current liability is a cash inflow
      const cashEffect = s.normalBalance === 'Credit' ? netPeriodMovement : -netPeriodMovement;
      operatingItems.push({
        code: s.code,
        label: `Change in ${s.name}`,
        amount: round2(cashEffect),
        note: cashEffect >= 0 ? 'Payable increase (inflow)' : 'Payable settlement (outflow)',
      });
    } else if (s.category === 'Asset' && s.group === 'Non-Current Assets' && s.normalBalance === 'Credit') {
      // Non-cash depreciation / accumulated depreciation add-back
      operatingItems.push({
        code: s.code,
        label: `Non-Cash Adjustment: ${s.name}`,
        amount: round2(netPeriodMovement),
        note: 'Non-cash depreciation add-back',
      });
    }
  }

  const netOperatingCash = round2(
    incomeStatement.netProfit + operatingItems.reduce((s, i) => s + i.amount, 0)
  );

  // Investing Activities: Non-Current Assets (excluding contra/depreciation)
  const investingItems: Array<{ code?: string; label: string; amount: number; note?: string }> = [];
  for (const s of summary) {
    if (s.category === 'Asset' && s.group === 'Non-Current Assets' && s.normalBalance !== 'Credit') {
      const netChange = round2(s.closingBalance - s.openingBalance);
      if (Math.abs(netChange) < 0.005) continue;
      const cashEffect = round2(-netChange);
      investingItems.push({
        code: s.code,
        label: `${cashEffect < 0 ? 'Acquisition of' : 'Disposal of'} ${s.name}`,
        amount: cashEffect,
        note: 'Capital expenditure / fixed asset movement',
      });
    }
  }
  const netInvestingCash = round2(investingItems.reduce((s, i) => s + i.amount, 0));

  // Financing Activities: Non-Current Liabilities + Direct Equity Movements (excl. Net Profit)
  const financingItems: Array<{ code?: string; label: string; amount: number; note?: string }> = [];
  for (const s of summary) {
    if (s.category === 'Liability' && s.group === 'Non-Current Liabilities') {
      const netChange = round2(s.closingBalance - s.openingBalance);
      if (Math.abs(netChange) < 0.005) continue;
      financingItems.push({
        code: s.code,
        label: `Change in ${s.name}`,
        amount: netChange,
        note: netChange >= 0 ? 'Long-term borrowing inflow' : 'Debt repayment outflow',
      });
    } else if (s.category === 'Equity') {
      const netChange = round2(s.closingBalance - s.openingBalance);
      if (Math.abs(netChange) < 0.005) continue;
      financingItems.push({
        code: s.code,
        label: `Capital / Equity Movement: ${s.name}`,
        amount: netChange,
        note: netChange >= 0 ? 'Capital contribution' : 'Dividend / drawing outflow',
      });
    }
  }
  const netFinancingCash = round2(financingItems.reduce((s, i) => s + i.amount, 0));

  const netCashChange = round2(netOperatingCash + netInvestingCash + netFinancingCash);
  const computedClosingCash = round2(openingCashBalance + netCashChange);
  const variance = round2(closingCashBalance - computedClosingCash);

  return {
    netProfit: round2(incomeStatement.netProfit),
    operatingItems,
    netOperatingCash,
    investingItems,
    netInvestingCash,
    financingItems,
    netFinancingCash,
    netCashChange,
    openingCashBalance,
    closingCashBalance,
    computedClosingCash,
    variance,
    isReconciled: Math.abs(variance) < 0.01,
    cashAccounts,
  };
}

export function computeEquityChangesStatement(state: LedgerState) {
  const summary = computeGLSummary(state);
  const incomeStatement = computeIncomeStatement(state);
  const balanceSheet = computeBalanceSheet(state);

  const equitySummaryRows = summary.filter((s) => s.category === 'Equity');

  const rows = equitySummaryRows.map((s) => {
    const opening = round2(s.openingBalance);
    const additions = round2(s.periodCredit);
    const deductions = round2(s.periodDebit);
    const closing = round2(s.closingBalance);
    return {
      code: s.code,
      name: s.name,
      openingBalance: opening,
      additions,
      deductions,
      netProfitShare: 0,
      closingBalance: closing,
    };
  });

  // Current Period Net Profit / (Loss) row
  rows.push({
    code: 'P&L',
    name: 'Current Period Net Profit / (Loss)',
    openingBalance: 0,
    additions: 0,
    deductions: 0,
    netProfitShare: round2(incomeStatement.netProfit),
    closingBalance: round2(incomeStatement.netProfit),
  });

  const totalOpening = round2(rows.reduce((s, r) => s + r.openingBalance, 0));
  const totalAdditions = round2(rows.reduce((s, r) => s + r.additions, 0));
  const totalDeductions = round2(rows.reduce((s, r) => s + r.deductions, 0));
  const totalNetProfit = round2(incomeStatement.netProfit);
  const totalClosing = round2(rows.reduce((s, r) => s + r.closingBalance, 0));

  return {
    rows,
    totalOpening,
    totalAdditions,
    totalDeductions,
    totalNetProfit,
    totalClosing,
    balanceSheetEquity: round2(balanceSheet.totalEquity),
    isReconciled: Math.abs(totalClosing - balanceSheet.totalEquity) < 0.01,
  };
}

export function exportRowsToCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (cell: string | number) => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Ensures statutory AP (2080), GRNI (2090), TDS Payable (2200), and VDS Payable (2210)
 * exist in both COA and Register Books for existing persisted states.
 */
export function ensurePurchaseControlAccounts(state: LedgerState): void {
  const requiredAccounts: Array<{ code: string; name: string }> = [
    { code: '2080', name: 'Accounts Payable — Trade Creditors' },
    { code: '2090', name: 'GRNI — Goods Received Not Invoiced' },
    { code: '2200', name: 'AIT / TDS Payable — Vendor' },
    { code: '2210', name: 'VAT / VDS Payable — Vendor' },
  ];

  const existingCodes = new Set(state.accounts.map((a) => a.code));
  const now = new Date().toISOString();

  for (const acc of requiredAccounts) {
    if (!existingCodes.has(acc.code)) {
      state.accounts.push({
        code: acc.code,
        name: acc.name,
        category: 'Liability',
        group: 'Current Liabilities',
        accountType: 'Liability (Current)',
        normalBalance: 'Credit',
        openingBalance: 0,
        priorYearDebit: 0,
        priorYearCredit: 0,
        registerFileId: `REG-${acc.code}`,
        registerFileName: `ATCL_REG_${acc.code}_${acc.name.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        status: 'Active',
        lastSyncedAt: now,
      });
    }
    if (!state.registers[acc.code]) {
      state.registers[acc.code] = {
        glCode: acc.code,
        fileId: `REG-${acc.code}`,
        fileName: `ATCL_REG_${acc.code}_${acc.name.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        createdAt: now,
        lastSyncedAt: now,
        entries: [],
      };
    }
  }
}

export interface DoubleEntryPostInput {
  voucherNo: string;
  date: string;
  description: string;
  reference: string;
  counterparty: string;
  enteredBy?: string;
  lines: Array<{ glCode: string; glName?: string; debit: number; credit: number; memo?: string }>;
}

/**
 * Atomically validates and posts a balanced double-entry journal to Master Journal,
 * PostedTransactions, and Register Books. Rejects duplicate voucherNos or unbalanced entries.
 */
export function postDoubleEntryToGL(state: LedgerState, input: DoubleEntryPostInput): void {
  const voucherNo = input.voucherNo.trim();
  if (!voucherNo) {
    throw new Error('Voucher reference number is required for GL posting.');
  }
  if (state.postedTransactions.some((t) => t.voucherNo === voucherNo)) {
    throw new Error(`Duplicate posting blocked: Voucher '${voucherNo}' is already posted to GL.`);
  }
  if (!input.lines || input.lines.length < 2) {
    throw new Error('At least two journal lines (Debit and Credit) are required to post to GL.');
  }

  const totalDebit = round2(input.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCredit = round2(input.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Double-entry imbalance: Debits (${totalDebit.toFixed(2)}) must equal Credits (${totalCredit.toFixed(2)}).`
    );
  }

  const accMap = new Map(state.accounts.map((a) => [a.code, a]));
  const now = new Date().toISOString();
  const enteredBy = input.enteredBy || state.config.operatorEmail;
  const firstDebit = input.lines.find((l) => l.debit > 0);
  const firstCredit = input.lines.find((l) => l.credit > 0);

  for (const line of input.lines) {
    const acc = accMap.get(line.glCode);
    const glName = acc?.name || line.glName || line.glCode;
    const debit = round2(Number(line.debit) || 0);
    const credit = round2(Number(line.credit) || 0);
    if (debit === 0 && credit === 0) continue;

    const contra = debit > 0 ? firstCredit : firstDebit;
    const contraCode = contra?.glCode || '';
    const contraName = contraCode ? accMap.get(contraCode)?.name || contra?.glName || contraCode : '';

    const jId = shortId('JRN');
    state.journalLines.push({
      journalId: jId,
      date: input.date,
      voucherNo,
      description: line.memo ? `${input.description} — ${line.memo}` : input.description,
      glCode: line.glCode,
      glName,
      debit,
      credit,
      reference: input.reference,
      counterparty: input.counterparty,
      enteredBy,
      approvalStatus: 'APPROVED',
      postingStatus: 'POSTED',
      validationRemarks: 'Atomic P2P / Voucher GL Posting',
    });

    state.postedTransactions.push({
      transactionId: shortId('TXN'),
      journalId: jId,
      date: input.date,
      voucherNo,
      type: debit > 0 ? 'Debit Post' : 'Credit Post',
      description: line.memo ? `${input.description} — ${line.memo}` : input.description,
      glCode: line.glCode,
      glName,
      debit,
      credit,
      reference: input.reference,
      counterparty: input.counterparty,
      contraCode,
      contraName,
      enteredBy,
      postTimestamp: now,
      registerSynced: 'PENDING',
    });
  }

  syncPostedTransactionsToRegisters(state);
}

/**
 * Applies (or reverses) payment allocations against PurchaseInvoiceRecord balances.
 */
export function applyPaymentAllocationsToInvoices(
  state: LedgerState,
  allocations: InvoiceAllocation[] | undefined,
  reverse = false
): void {
  if (!allocations || allocations.length === 0) return;
  const invoices = state.purchaseInvoices || [];

  for (const alloc of allocations) {
    const inv = invoices.find((i) => i.id === alloc.invoiceId);
    if (!inv || inv.status === 'Voided') continue;

    const amt = round2(Number(alloc.allocatedAmount) || 0);
    if (amt <= 0) continue;

    if (!reverse) {
      if (amt > inv.outstandingAmount + 0.01) {
        throw new Error(
          `Over-allocation blocked: Payment (${amt.toFixed(2)}) exceeds outstanding balance (${inv.outstandingAmount.toFixed(2)}) on invoice ${inv.invoiceNumber}.`
        );
      }
      inv.paidAmount = round2(inv.paidAmount + amt);
    } else {
      inv.paidAmount = round2(Math.max(0, inv.paidAmount - amt));
    }

    inv.outstandingAmount = round2(Math.max(0, inv.grossAmount - inv.paidAmount));
    inv.status =
      inv.outstandingAmount <= 0.01
        ? 'Paid'
        : inv.paidAmount > 0.01
          ? 'Partially Paid'
          : 'Posted';
    inv.updatedAt = new Date().toISOString();
  }
}

/**
 * Ensures O2C control accounts exist in COA and Register Books:
 * - 1140 Customer TDS/VDS Receivable (Asset)
 * - 1250 POS / Card / MFS Clearing (Asset)
 * - 2110 Customer Advances / Contract Liability (Liability)
 * - 2120 Deferred AMC Revenue (Liability)
 */
export function ensureSalesControlAccounts(state: LedgerState): void {
  const required: Array<{
    code: string;
    name: string;
    category: 'Asset' | 'Liability';
    group: string;
    normalBalance: 'Debit' | 'Credit';
  }> = [
    {
      code: '1140',
      name: 'Customer TDS / VDS Receivable',
      category: 'Asset',
      group: 'Current Assets',
      normalBalance: 'Debit',
    },
    {
      code: '1135',
      name: 'Retention Money Receivable',
      category: 'Asset',
      group: 'Current Assets',
      normalBalance: 'Debit',
    },
    {
      code: '1250',
      name: 'POS / Card / MFS Clearing',
      category: 'Asset',
      group: 'Current Assets',
      normalBalance: 'Debit',
    },
    {
      code: '2110',
      name: 'Customer Advances / Contract Liability',
      category: 'Liability',
      group: 'Current Liabilities',
      normalBalance: 'Credit',
    },
    {
      code: '2120',
      name: 'Deferred AMC Revenue',
      category: 'Liability',
      group: 'Current Liabilities',
      normalBalance: 'Credit',
    },
  ];

  const existingCodes = new Set(state.accounts.map((a) => a.code));
  const now = new Date().toISOString();

  for (const acc of required) {
    if (!existingCodes.has(acc.code)) {
      state.accounts.push({
        code: acc.code,
        name: acc.name,
        category: acc.category,
        group: acc.group,
        accountType: acc.category === 'Asset' ? 'Asset (Current)' : 'Liability (Current)',
        normalBalance: acc.normalBalance,
        openingBalance: 0,
        priorYearDebit: 0,
        priorYearCredit: 0,
        registerFileId: `REG-${acc.code}`,
        registerFileName: `ATCL_REG_${acc.code}_${acc.name.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        status: 'Active',
        lastSyncedAt: now,
      });
    }
    if (!state.registers[acc.code]) {
      state.registers[acc.code] = {
        glCode: acc.code,
        fileId: `REG-${acc.code}`,
        fileName: `ATCL_REG_${acc.code}_${acc.name.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        createdAt: now,
        lastSyncedAt: now,
        entries: [],
      };
    }
  }
}

/**
 * Applies (or reverses) receipt voucher allocations against SalesInvoiceRecord balances.
 */
export function applyReceiptAllocationsToSalesInvoices(
  state: LedgerState,
  allocations: SalesInvoiceAllocation[] | undefined,
  reverse = false
): void {
  if (!allocations || allocations.length === 0) return;
  const invoices = state.salesInvoices || [];

  for (const alloc of allocations) {
    const inv = invoices.find((i) => i.id === alloc.invoiceId);
    if (!inv || inv.status === 'Voided') continue;

    const amt = round2(Number(alloc.allocatedAmount) || 0);
    if (amt <= 0) continue;

    if (!reverse) {
      if (amt > inv.outstandingAmount + 0.01) {
        throw new Error(
          `Over-collection blocked: Allocation (${amt.toFixed(2)}) exceeds outstanding balance (${inv.outstandingAmount.toFixed(2)}) on Sales Invoice ${inv.invoiceNumber}.`
        );
      }
      inv.paidAmount = round2(inv.paidAmount + amt);
    } else {
      inv.paidAmount = round2(Math.max(0, inv.paidAmount - amt));
    }

    inv.outstandingAmount = round2(
      Math.max(0, inv.grossAmount - inv.creditNoteAmount - inv.paidAmount)
    );
    inv.status =
      inv.outstandingAmount <= 0.01
        ? 'Paid'
        : inv.paidAmount > 0.01
          ? 'Partially Paid'
          : 'Posted';
    inv.updatedAt = new Date().toISOString();
  }
}

export interface CustomerLiveARSummary {
  openingReceivable: number;
  invoicedAmount: number;
  creditNoteAmount: number;
  collectedAmount: number;
  advanceUnapplied: number;
  outstanding: number;
  overdueAmount: number;
  aging: {
    notDue: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
  };
}

export function computeCustomerLiveAR(
  state: LedgerState,
  customerId: string,
  asOfDate?: string
): CustomerLiveARSummary {
  const customer = state.customers.find((c) => c.id === customerId);
  const openingReceivable = round2(customer?.openingReceivable ?? 0);
  const invoices = (state.salesInvoices || []).filter(
    (i) => i.customerId === customerId && i.status !== 'Voided'
  );
  const advances = (state.customerAdvances || []).filter(
    (a) => a.customerId === customerId && a.unappliedAmount > 0.01
  );

  const invoicedAmount = round2(invoices.reduce((s, i) => s + i.grossAmount, 0));
  const creditNoteAmount = round2(invoices.reduce((s, i) => s + i.creditNoteAmount, 0));
  const collectedAmount = round2(invoices.reduce((s, i) => s + i.paidAmount, 0));
  const advanceUnapplied = round2(advances.reduce((s, a) => s + a.unappliedAmount, 0));

  const refMs = asOfDate ? new Date(asOfDate).getTime() : Date.now();
  const aging = { notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90Plus: 0 };
  let overdueAmount = 0;

  for (const inv of invoices) {
    if (inv.outstandingAmount <= 0.01) continue;
    const dueMs = new Date(inv.dueDate).getTime();
    const days = Number.isNaN(dueMs) ? 0 : Math.floor((refMs - dueMs) / 86_400_000);
    if (days <= 0) {
      aging.notDue = round2(aging.notDue + inv.outstandingAmount);
    } else {
      overdueAmount = round2(overdueAmount + inv.outstandingAmount);
      if (days <= 30) aging.days1to30 = round2(aging.days1to30 + inv.outstandingAmount);
      else if (days <= 60) aging.days31to60 = round2(aging.days31to60 + inv.outstandingAmount);
      else if (days <= 90) aging.days61to90 = round2(aging.days61to90 + inv.outstandingAmount);
      else aging.days90Plus = round2(aging.days90Plus + inv.outstandingAmount);
    }
  }

  const invoiceOutstanding = round2(
    aging.notDue + aging.days1to30 + aging.days31to60 + aging.days61to90 + aging.days90Plus
  );

  return {
    openingReceivable,
    invoicedAmount,
    creditNoteAmount,
    collectedAmount,
    advanceUnapplied,
    outstanding: invoices.length > 0 ? invoiceOutstanding : round2(customer?.currentReceivable ?? openingReceivable),
    overdueAmount,
    aging,
  };
}

export interface SupplierLiveAPSummary {
  invoicedAmount: number;
  returnedAmount: number;
  paidAmount: number;
  outstanding: number;
}

export function computeSupplierLiveAP(state: LedgerState, supplierId: string): SupplierLiveAPSummary {
  const invoices = (state.purchaseInvoices || []).filter(
    (i) => i.supplierId === supplierId && i.status !== 'Voided'
  );
  const returns = (state.purchaseReturns || []).filter((r) => r.supplierId === supplierId);
  const invoicedAmount = round2(invoices.reduce((s, i) => s + i.grossAmount, 0));
  const paidAmount = round2(invoices.reduce((s, i) => s + i.paidAmount, 0));
  const returnedAmount = round2(returns.reduce((s, r) => s + r.returnAmount, 0));
  const outstanding = round2(invoices.reduce((s, i) => s + i.outstandingAmount, 0));
  return { invoicedAmount, returnedAmount, paidAmount, outstanding };
}

export function recordInventoryMovement(
  state: LedgerState,
  input: Omit<InventoryMovementRecord, 'id' | 'createdBy'>
): void {
  state.inventoryMovements = state.inventoryMovements || [];
  state.inventoryMovements.unshift({
    ...input,
    id: `MOV-${String(state.inventoryMovements.length + 1).padStart(5, '0')}`,
    createdBy: state.config.operatorEmail,
  });
}

export interface StockAvailabilityRow {
  sku: string;
  productName: string;
  category: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  inTransitQty: number;
  bondedQty: number;
  qcHoldQty: number;
  issuedQty: number;
  unitCost: number;
  valuationBdt: number;
  reorderLevel: number;
  needsReorder: boolean;
}

export function computeStockAvailability(state: LedgerState): StockAvailabilityRow[] {
  const serials = state.inventorySerials || [];
  return (state.products || []).map((prod) => {
    const skuKey = prod.sku.trim().toUpperCase();
    const matched = serials.filter((u) => u.sku.trim().toUpperCase() === skuKey);
    const reservedQty = matched.filter((u) => u.status === 'Reserved').length;
    const inTransitQty = matched.filter((u) => u.status === 'In Transit').length;
    const bondedQty = matched.filter((u) => u.status === 'Bonded').length;
    const qcHoldQty = matched.filter((u) => u.status === 'QC Hold').length;
    const issuedQty = matched.filter((u) => u.status === 'Issued to Project').length;
    const onHandQty = Number(prod.stockQty) || 0;
    const availableQty = Math.max(0, onHandQty - reservedQty - qcHoldQty);
    const unitCost = round2(Number(prod.unitCost) || 0);
    const valuationBdt = round2(onHandQty * unitCost);
    const reorderLevel = Number(prod.reorderLevel) || 0;
    return {
      sku: prod.sku,
      productName: prod.name,
      category: prod.category,
      onHandQty,
      reservedQty,
      availableQty,
      inTransitQty,
      bondedQty,
      qcHoldQty,
      issuedQty,
      unitCost,
      valuationBdt,
      reorderLevel,
      needsReorder: onHandQty <= reorderLevel,
    };
  });
}

export function ensureDefaultTaxRules(state: LedgerState): TaxWithholdingRule[] {
  if (state.taxRules && state.taxRules.length > 0) return state.taxRules;
  state.taxRules = [
    {
      id: 'TAX-RULE-01',
      category: 'IT Hardware & Electrical Supply',
      vatRate: 15,
      tdsRate: 2,
      vdsRate: 7.5,
      effectiveFrom: '2024-07-01',
      nbrSectionRef: 'ITA 2023 Sec 89 / VAT SRO 2024',
      description: 'Standard local supply of switchgear, UPS, routers & industrial hardware.',
      active: true,
    },
    {
      id: 'TAX-RULE-02',
      category: 'Engineering, Commissioning & AMC Service',
      vatRate: 15,
      tdsRate: 5,
      vdsRate: 10,
      effectiveFrom: '2024-07-01',
      nbrSectionRef: 'ITA 2023 Sec 90 / VAT Act Sec 49',
      description: 'Field installation, substation testing, repair & annual maintenance contracts.',
      active: true,
    },
    {
      id: 'TAX-RULE-03',
      category: 'C&F Agent & Port Logistics',
      vatRate: 15,
      tdsRate: 5,
      vdsRate: 7.5,
      effectiveFrom: '2024-07-01',
      nbrSectionRef: 'ITA 2023 Sec 92 / VAT SRO',
      description: 'Customs clearing, port handling & domestic freight charges.',
      active: true,
    },
    {
      id: 'TAX-RULE-04',
      category: 'Audit, Legal & Professional Fees',
      vatRate: 15,
      tdsRate: 10,
      vdsRate: 15,
      effectiveFrom: '2024-07-01',
      nbrSectionRef: 'ITA 2023 Sec 90',
      description: 'External statutory audit, consultancy and advisory retainers.',
      active: true,
    },
    {
      id: 'TAX-RULE-05',
      category: 'Exempted Import / Zero-Rated Supply',
      vatRate: 0,
      tdsRate: 0,
      vdsRate: 0,
      effectiveFrom: '2024-07-01',
      nbrSectionRef: 'VAT Act Schedule-1 Exemption',
      description: 'Zero-rated export / exempted statutory supplies.',
      active: true,
    },
  ];
  return state.taxRules;
}

export function validateBackupSnapshot(snap: unknown): Record<string, unknown> {
  if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) {
    throw new Error('Invalid backup file format.');
  }
  const rec = snap as Record<string, unknown>;
  for (const key of ['accounts', 'journalLines', 'postedTransactions'] as const) {
    if (rec[key] !== undefined && !Array.isArray(rec[key])) {
      throw new Error(`Invalid backup snapshot: ${key} must be an array.`);
    }
  }
  return rec;
}

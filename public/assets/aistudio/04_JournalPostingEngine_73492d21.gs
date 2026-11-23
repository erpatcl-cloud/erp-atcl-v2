/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 04_JournalPostingEngine.gs
 * Description: Validation, approval, multi-line atomic posting, and reversal of Journal Vouchers.
 */

/**
 * Validates multi-line journal vouchers in Master_Journal sheet.
 * Verifies:
 * 1. Total Debit == Total Credit per voucher.
 * 2. Every GL Code exists and is active in Chart of Accounts.
 * 3. Mandatory fields (Date, Voucher No, Description, Amount).
 * 4. Checks against duplicate posting in Posted_Journal_Store.
 */
function validateJournalVouchers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jSheet = ss.getSheetByName(CONFIG.SHEETS.JOURNAL);
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);

  const lastRow = jSheet.getLastRow();
  if (lastRow < 6) return { totalVouchers: 0, validVouchers: 0, invalidVouchers: 0 };

  // Load COA Active Codes
  const coaData = coaSheet.getRange(6, 1, coaSheet.getLastRow() - 5, 9).getValues();
  const validAccounts = new Map();
  coaData.forEach(r => {
    const code = String(r[0]).trim();
    const name = String(r[1]).trim();
    const status = String(r[8]).trim();
    if (code) validAccounts.set(code, { name: name, active: status.toLowerCase() === "active" });
  });

  // Load already posted Voucher Numbers to prevent duplicates
  const postedVouchers = new Set();
  if (postedSheet.getLastRow() >= 6) {
    const pData = postedSheet.getRange(6, 3, postedSheet.getLastRow() - 5, 1).getValues();
    pData.forEach(r => {
      const v = String(r[0]).trim();
      if (v) postedVouchers.add(v);
    });
  }

  // Read Journal: Cols A to M
  // A: Journal ID, B: Date, C: Voucher No, D: Description, E: GL Code, F: GL Name,
  // G: Debit, H: Credit, I: Ref, J: Entered By, K: Approval Status, L: Posting Status, M: Validation Remarks
  const jRange = jSheet.getRange(6, 1, lastRow - 5, 13);
  const jData = jRange.getValues();

  // Group by Voucher Number
  const vouchers = new Map();
  for (let i = 0; i < jData.length; i++) {
    const vNo = String(jData[i][2]).trim();
    if (!vNo) continue;
    if (!vouchers.has(vNo)) {
      vouchers.set(vNo, []);
    }
    vouchers.get(vNo).push({ index: i, rowNum: 6 + i, data: jData[i] });
  }

  let validVoucherCount = 0;
  let invalidVoucherCount = 0;

  vouchers.forEach((lines, vNo) => {
    let vDebit = 0;
    let vCredit = 0;
    const vErrors = [];

    // Duplicate check
    if (postedVouchers.has(vNo)) {
      vErrors.push(`Voucher ${vNo} has ALREADY been posted to Master Store.`);
    }

    lines.forEach(line => {
      const row = line.data;
      const dt = row[1];
      const code = String(row[4]).trim();
      const dr = Number(row[6]) || 0;
      const cr = Number(row[7]) || 0;

      vDebit += dr;
      vCredit += cr;

      if (!dt) vErrors.push(`Row ${line.rowNum}: Missing Date.`);
      if (!code) {
        vErrors.push(`Row ${line.rowNum}: Missing GL Account Code.`);
      } else if (!validAccounts.has(code)) {
        vErrors.push(`Row ${line.rowNum}: GL Code '${code}' does not exist in COA.`);
      } else if (!validAccounts.get(code).active) {
        vErrors.push(`Row ${line.rowNum}: GL Code '${code}' is INACTIVE.`);
      }

      if (dr <= 0 && cr <= 0) vErrors.push(`Row ${line.rowNum}: Debit or Credit must be > 0.`);
      if (dr > 0 && cr > 0) vErrors.push(`Row ${line.rowNum}: Cannot have both Debit and Credit on same line.`);
    });

    // Check Balance: Total Dr == Total Cr
    const diff = Math.abs(vDebit - vCredit);
    if (diff > 0.001) {
      vErrors.push(`Voucher Unbalanced! Dr: ৳${vDebit.toFixed(2)} vs Cr: ৳${vCredit.toFixed(2)} (Diff: ৳${diff.toFixed(2)}).`);
    }

    const isVoucherValid = vErrors.length === 0;
    if (isVoucherValid) validVoucherCount++; else invalidVoucherCount++;

    // Write back remarks and update auto-fill name
    lines.forEach(line => {
      const code = String(line.data[4]).trim();
      if (validAccounts.has(code)) {
        jSheet.getRange(line.rowNum, 6).setValue(validAccounts.get(code).name);
      }
      const remarkCell = jSheet.getRange(line.rowNum, 13);
      if (isVoucherValid) {
        remarkCell.setValue("VALID - Balanced (Ready for Approval)").setFontColor(CONFIG.COLORS.SUCCESS_GREEN);
      } else {
        remarkCell.setValue("INVALID: " + vErrors.join("; ")).setFontColor(CONFIG.COLORS.ERROR_RED);
      }
    });
  });

  return {
    totalVouchers: vouchers.size,
    validVouchers: validVoucherCount,
    invalidVouchers: invalidVoucherCount
  };
}

/**
 * Approves all currently valid vouchers that are in DRAFT or PENDING_APPROVAL status.
 */
function approveValidatedVouchers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jSheet = ss.getSheetByName(CONFIG.SHEETS.JOURNAL);
  const lastRow = jSheet.getLastRow();
  if (lastRow < 6) return 0;

  const user = Session.getActiveUser().getEmail() || "System Approver";
  const range = jSheet.getRange(6, 1, lastRow - 5, 13);
  const values = range.getValues();
  let approvedCount = 0;

  // Group by voucher to ensure atomic voucher-level approval
  const voucherStatus = new Map();
  for (let i = 0; i < values.length; i++) {
    const vNo = String(values[i][2]).trim();
    const remark = String(values[i][12]).trim();
    const postStatus = String(values[i][11]).trim();
    if (!vNo) continue;
    if (!voucherStatus.has(vNo)) voucherStatus.set(vNo, { isValid: true, isPostable: postStatus !== CONFIG.POSTING_STATUS.POSTED });
    if (!remark.startsWith("VALID")) voucherStatus.get(vNo).isValid = false;
  }

  for (let i = 0; i < values.length; i++) {
    const row = 6 + i;
    const vNo = String(values[i][2]).trim();
    const currentApproval = String(values[i][10]).trim();
    const currentPosting = String(values[i][11]).trim();

    if (vNo && voucherStatus.get(vNo).isValid && voucherStatus.get(vNo).isPostable) {
      if (currentApproval !== CONFIG.APPROVAL_STATUS.APPROVED) {
        jSheet.getRange(row, 11).setValue(CONFIG.APPROVAL_STATUS.APPROVED);
        jSheet.getRange(row, 10).setValue(user); // Approver / Entered By
        approvedCount++;
      }
    }
  }

  logAudit("JOURNAL_ENGINE", "APPROVE_VOUCHERS", `Approved ${approvedCount} journal lines by ${user}`, "SUCCESS");
  return approvedCount;
}

/**
 * Posts approved, unposted journal vouchers to the immutable Posted_Journal_Store.
 * Uses LockService to guarantee atomic transactions.
 */
function postApprovedVouchers() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 30 sec lock
  } catch (e) {
    throw new Error("Could not acquire lock. Another user or process is currently posting transactions.");
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const jSheet = ss.getSheetByName(CONFIG.SHEETS.JOURNAL);
    const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
    const lastRow = jSheet.getLastRow();
    if (lastRow < 6) return { postedVouchers: 0, postedLines: 0 };

    const data = jSheet.getRange(6, 1, lastRow - 5, 13).getValues();

    // Group vouchers to ensure only fully balanced and approved vouchers post
    const vouchers = new Map();
    for (let i = 0; i < data.length; i++) {
      const vNo = String(data[i][2]).trim();
      const approval = String(data[i][10]).trim();
      const posting = String(data[i][11]).trim();
      const remarks = String(data[i][12]).trim();

      if (!vNo) continue;
      if (!vouchers.has(vNo)) vouchers.set(vNo, { lines: [], canPost: true });
      vouchers.get(vNo).lines.push({ rowIndex: 6 + i, data: data[i] });

      if (approval !== CONFIG.APPROVAL_STATUS.APPROVED || posting === CONFIG.POSTING_STATUS.POSTED || !remarks.startsWith("VALID")) {
        vouchers.get(vNo).canPost = false;
      }
    }

    const rowsToPost = [];
    const journalRowsToUpdate = [];
    let postedVoucherCount = 0;

    vouchers.forEach((vObj, vNo) => {
      if (!vObj.canPost || vObj.lines.length === 0) return;

      // Contra-account relationship preservation logic
      const debits = vObj.lines.filter(l => (Number(l.data[6]) || 0) > 0);
      const credits = vObj.lines.filter(l => (Number(l.data[7]) || 0) > 0);

      vObj.lines.forEach(l => {
        const row = l.data;
        const jId = row[0] || Utilities.getUuid().substring(0, 8);
        const dt = row[1];
        const desc = row[3];
        const glCode = String(row[4]).trim();
        const glName = row[5];
        const dr = Number(row[6]) || 0;
        const cr = Number(row[7]) || 0;
        const ref = row[8];
        const user = row[9] || Session.getActiveUser().getEmail();
        const txnId = Utilities.getUuid();
        const postTimestamp = new Date();

        // Determine contra account code and name
        let contraCode = "";
        let contraName = "";
        if (dr > 0) {
          // Current line is Debit, look for Credit counterpart
          if (credits.length === 1) {
            contraCode = credits[0].data[4];
            contraName = credits[0].data[5];
          } else {
            contraCode = "MULTI";
            contraName = "Multiple Credit Accounts";
          }
        } else {
          // Current line is Credit, look for Debit counterpart
          if (debits.length === 1) {
            contraCode = debits[0].data[4];
            contraName = debits[0].data[5];
          } else {
            contraCode = "MULTI";
            contraName = "Multiple Debit Accounts";
          }
        }

        // Target store row:
        // Col A: Post Timestamp, B: Journal ID, C: Voucher No, D: Date, E: Type, F: Description,
        // G: Ref, H: Counterparty, I: GL Code, J: GL Name, K: Contra Code, L: Contra Name,
        // M: Debit, N: Credit, O: Entered By, P: Transaction ID, Q: Register Synced
        rowsToPost.push([
          postTimestamp,
          jId,
          vNo,
          dt,
          dr > 0 ? "Debit Post" : "Credit Post",
          desc,
          ref,
          "General Client / Supplier",
          glCode,
          glName,
          contraCode,
          contraName,
          dr,
          cr,
          user,
          txnId,
          "PENDING"
        ]);

        journalRowsToUpdate.push(l.rowIndex);
      });

      postedVoucherCount++;
    });

    if (rowsToPost.length > 0) {
      // Append atomically to Posted_Journal_Store
      const pStartRow = postedSheet.getLastRow() + 1;
      postedSheet.getRange(pStartRow, 1, rowsToPost.length, 17).setValues(rowsToPost);

      // Update Master Journal Status to POSTED
      journalRowsToUpdate.forEach(r => {
        jSheet.getRange(r, 12).setValue(CONFIG.POSTING_STATUS.POSTED);
        jSheet.getRange(r, 13).setValue("POSTED - Authoritative Ledger Recorded").setFontColor(CONFIG.COLORS.SUCCESS_GREEN);
      });

      logAudit("POSTING_ENGINE", "POST_VOUCHERS", `Posted ${postedVoucherCount} vouchers (${rowsToPost.length} lines) to Master Store.`, "SUCCESS");

      // Trigger asynchronous/immediate sync to individual register books
      syncPostedTransactionsToRegisters();
      refreshMasterDashboard();
    }

    return { postedVouchers: postedVoucherCount, postedLines: rowsToPost.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates and posts an approved reversal voucher for an existing voucher.
 */
function reverseVoucher(originalVoucherNo, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  const jSheet = ss.getSheetByName(CONFIG.SHEETS.JOURNAL);

  const lastRow = postedSheet.getLastRow();
  if (lastRow < 6) throw new Error("No posted transactions exist to reverse.");

  const data = postedSheet.getRange(6, 1, lastRow - 5, 17).getValues();
  const matchedLines = data.filter(r => String(r[2]).trim() === originalVoucherNo);
  if (matchedLines.length === 0) throw new Error(`Voucher ${originalVoucherNo} not found in Posted Store.`);

  const revVoucherNo = `REV-${originalVoucherNo}`;
  const revDate = new Date();
  const user = Session.getActiveUser().getEmail() || "System Auditor";

  const newRows = [];
  matchedLines.forEach(l => {
    const glCode = l[8];
    const glName = l[9];
    const origDr = Number(l[12]) || 0;
    const origCr = Number(l[13]) || 0;

    // INVERT: original debit becomes credit, original credit becomes debit
    const revDr = origCr;
    const revCr = origDr;

    newRows.push([
      `REV-${l[1]}`,
      revDate,
      revVoucherNo,
      `Reversal of ${originalVoucherNo}: ${reason}`,
      glCode,
      glName,
      revDr,
      revCr,
      `Ref: ${originalVoucherNo}`,
      user,
      CONFIG.APPROVAL_STATUS.APPROVED,
      CONFIG.POSTING_STATUS.UNPOSTED,
      "VALID - System Reversal"
    ]);
  });

  // Append reversal lines to Master Journal
  const startRow = jSheet.getLastRow() + 1;
  jSheet.getRange(startRow, 1, newRows.length, 13).setValues(newRows);

  logAudit("POSTING_ENGINE", "REVERSE_VOUCHER", `Generated reversal ${revVoucherNo} for ${originalVoucherNo}. Reason: ${reason}`, "SUCCESS");

  // Immediately post the reversal
  postApprovedVouchers();
  return revVoucherNo;
}

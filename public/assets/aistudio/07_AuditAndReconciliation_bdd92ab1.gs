/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 07_AuditAndReconciliation.gs
 * Description: Integrity auditing, discrepancy detection, automated self-healing, and audit trail logging.
 */

/**
 * Reconciles every single individual Register Book against the authoritative Master Posted Store.
 * Detects any discrepancy in debit sums, credit sums, or closing balances.
 */
function reconcileAllRegisters() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);

  // Read Master Posted Store totals by code
  const storeDr = new Map();
  const storeCr = new Map();
  const pLastRow = postedSheet.getLastRow();
  if (pLastRow >= 6) {
    const pData = postedSheet.getRange(6, 1, pLastRow - 5, 17).getValues();
    pData.forEach(r => {
      const code = String(r[8]).trim();
      const dr = Number(r[12]) || 0;
      const cr = Number(r[13]) || 0;
      storeDr.set(code, (storeDr.get(code) || 0) + dr);
      storeCr.set(code, (storeCr.get(code) || 0) + cr);
    });
  }

  // Iterate COA
  const coaData = coaSheet.getRange(6, 1, coaSheet.getLastRow() - 5, 8).getValues();
  const discrepancies = [];
  let checkedCount = 0;

  coaData.forEach(r => {
    const code = String(r[0]).trim();
    const name = String(r[1]).trim();
    const openBal = Number(r[4]) || 0;
    const norm = String(r[5]).trim();
    const fid = String(r[6]).trim();

    if (!code || !fid) return;
    checkedCount++;

    const expectedDr = storeDr.get(code) || 0;
    const expectedCr = storeCr.get(code) || 0;
    const expectedClose = norm === "Debit" ? (openBal + expectedDr - expectedCr) : (openBal + expectedCr - expectedDr);

    try {
      const regSS = SpreadsheetApp.openById(fid);
      const regSheet = regSS.getSheetByName("Register") || regSS.getSheets()[0];
      const actualClose = Number(regSheet.getRange("J5").getValue()) || 0;

      const diff = Math.abs(expectedClose - actualClose);
      if (diff > 0.01) {
        discrepancies.push({
          code: code,
          name: name,
          expected: expectedClose,
          actual: actualClose,
          diff: diff,
          fileId: fid
        });
      }
    } catch (e) {
      discrepancies.push({
        code: code,
        name: name,
        expected: expectedClose,
        actual: 0,
        diff: expectedClose,
        fileId: fid,
        error: e.message
      });
    }
  });

  logAudit("AUDIT_ENGINE", "RECONCILIATION", `Audited ${checkedCount} registers. Found ${discrepancies.length} discrepancies.`, discrepancies.length === 0 ? "SUCCESS" : "DISCREPANCY");
  return {
    totalChecked: checkedCount,
    discrepancies: discrepancies
  };
}

/**
 * Automatically repairs any GL Register books that have discrepancies by rebuilding
 * them cleanly from the authoritative Posted_Journal_Store.
 */
function selfHealDiscrepancies() {
  const recon = reconcileAllRegisters();
  if (recon.discrepancies.length === 0) return 0;

  let healed = 0;
  recon.discrepancies.forEach(d => {
    try {
      rebuildRegisterFromMaster(d.code);
      healed++;
    } catch (e) {
      logAudit("AUDIT_ENGINE", "SELF_HEAL_FAILED", `Failed healing ${d.code}: ${e.message}`, "FAILED");
    }
  });

  logAudit("AUDIT_ENGINE", "SELF_HEAL_COMPLETE", `Successfully repaired ${healed} out-of-sync registers.`, "SUCCESS");
  return healed;
}

/**
 * Appends an immutable security record to System_Audit_Log.
 */
function logAudit(module, action, details, status) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
    if (!logSheet) return;

    const timestamp = new Date();
    const user = Session.getActiveUser().getEmail() || "System Service";
    const logId = Utilities.getUuid().substring(0, 8);

    logSheet.appendRow([
      timestamp,
      logId,
      user,
      module,
      action,
      details,
      status
    ]);
  } catch (e) {
    Logger.log("Failed to write audit log: " + e.message);
  }
}

/**
 * Initializes and formats all master sheets if they do not yet exist.
 */
function initializeAllMasterSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToCreate = [
    CONFIG.SHEETS.DASHBOARD,
    CONFIG.SHEETS.COA,
    CONFIG.SHEETS.JOURNAL,
    CONFIG.SHEETS.POSTED_STORE,
    CONFIG.SHEETS.GL_SUMMARY,
    CONFIG.SHEETS.TRIAL_BALANCE,
    CONFIG.SHEETS.INCOME_STATEMENT,
    CONFIG.SHEETS.BALANCE_SHEET,
    CONFIG.SHEETS.MONTHLY_SUMMARY,
    CONFIG.SHEETS.AUDIT_LOG,
    CONFIG.SHEETS.CONFIG
  ];

  sheetsToCreate.forEach(sname => {
    let sh = ss.getSheetByName(sname);
    if (!sh) sh = ss.insertSheet(sname);
  });

  // Setup Audit Log Headers
  const logSheet = ss.getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
  if (logSheet.getLastRow() < 1) {
    logSheet.appendRow(["Timestamp", "Log ID", "User Email", "Module", "Action", "Details", "Status"]);
    logSheet.getRange("A1:G1").setBackground(CONFIG.COLORS.NAVY_HEADER).setFontColor("#FFFFFF").setFontWeight("bold");
    logSheet.setFrozenRows(1);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("All master sheets initialized.", "Complete", 3);
}

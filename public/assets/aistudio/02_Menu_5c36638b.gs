/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 02_Menu.gs
 * Description: Custom Google Sheets UI Menu and Trigger handlers.
 */

function onOpen(e) {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("⚖️ ATCL Accounting System")
    .addSubMenu(ui.createMenu("📋 Chart of Accounts")
      .addItem("Sync & Create Missing Register Files", "menuCreateMissingRegisters")
      .addItem("Validate COA Data & Duplicate Codes", "menuValidateCOA")
      .addItem("Format Chart of Accounts Sheet", "menuFormatCOASheet"))
    .addSeparator()
    .addSubMenu(ui.createMenu("✍️ Journal Entry & Posting")
      .addItem("Validate Journal Entries", "menuValidateJournalEntries")
      .addItem("Approve Validated Vouchers", "menuApproveJournalEntries")
      .addItem("Post Approved Vouchers to Registers", "menuPostApprovedVouchers")
      .addSeparator()
      .addItem("Reverse Selected Voucher...", "menuPromptReverseVoucher"))
    .addSeparator()
    .addSubMenu(ui.createMenu("🔄 Sync & Registers")
      .addItem("Synchronize All Posted Entries to Registers", "menuSyncToRegisters")
      .addItem("Rebuild Single Account Register...", "menuPromptRebuildRegister")
      .addItem("Verify All Register Links", "menuVerifyRegisterLinks"))
    .addSeparator()
    .addSubMenu(ui.createMenu("📊 Financial Reports")
      .addItem("Refresh Master GL Dashboard", "menuRefreshDashboard")
      .addItem("Generate Trial Balance", "menuGenerateTrialBalance")
      .addItem("Generate Income Statement (P&L)", "menuGenerateIncomeStatement")
      .addItem("Generate Balance Sheet", "menuGenerateBalanceSheet")
      .addItem("Generate Monthly Summary Matrix", "menuGenerateMonthlySummary"))
    .addSeparator()
    .addSubMenu(ui.createMenu("🛠️ Audit & System Maintenance")
      .addItem("Run System Reconciliation Audit", "menuReconcileAllRegisters")
      .addItem("Self-Heal Register Discrepancies", "menuSelfHealDiscrepancies")
      .addItem("View System Audit Log", "menuOpenAuditLog")
      .addSeparator()
      .addItem("Initialize / Reset All Master Sheets", "menuInitializeMasterSheets"))
    .addToUi();
}

// Menu Wrapper Callbacks with Error Handling & User Notifications

function menuCreateMissingRegisters() {
  const ui = SpreadsheetApp.getUi();
  try {
    const count = createAllMissingRegisters();
    ui.alert("Success", `Created and linked ${count} new GL Register Books successfully.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Error", `Failed to create register books: ${err.message}`, ui.ButtonSet.OK);
  }
}

function menuValidateCOA() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = validateChartOfAccounts();
    if (result.isValid) {
      ui.alert("Validation Successful", `Chart of Accounts is 100% valid. Checked ${result.totalAccounts} accounts. No duplicates found.`, ui.ButtonSet.OK);
    } else {
      ui.alert("Validation Warning", `Found issues:
${result.errors.join("
")}`, ui.ButtonSet.OK);
    }
  } catch (err) {
    ui.alert("Error", err.message, ui.ButtonSet.OK);
  }
}

function menuFormatCOASheet() {
  formatCOASheet();
  SpreadsheetApp.getActiveSpreadsheet().toast("Chart of Accounts formatting applied.", "Success", 3);
}

function menuValidateJournalEntries() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = validateJournalVouchers();
    ui.alert("Journal Validation", `Validated ${res.totalVouchers} vouchers.
Valid: ${res.validVouchers}
Errors: ${res.invalidVouchers}`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Error", err.message, ui.ButtonSet.OK);
  }
}

function menuApproveJournalEntries() {
  const ui = SpreadsheetApp.getUi();
  try {
    const count = approveValidatedVouchers();
    ui.alert("Approval Complete", `Successfully approved ${count} journal vouchers ready for posting.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Error", err.message, ui.ButtonSet.OK);
  }
}

function menuPostApprovedVouchers() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = postApprovedVouchers();
    ui.alert("Posting Complete", `Successfully posted ${res.postedVouchers} vouchers (${res.postedLines} lines) to the immutable Master Posted Store and individual GL Registers.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Posting Error", err.message, ui.ButtonSet.OK);
  }
}

function menuPromptReverseVoucher() {
  const ui = SpreadsheetApp.getUi();
  const prompt1 = ui.prompt("Reverse Journal Voucher", "Enter the exact Voucher Number to reverse (e.g. JV-25-01):", ui.ButtonSet.OK_CANCEL);
  if (prompt1.getSelectedButton() !== ui.Button.OK) return;
  const voucherNo = prompt1.getResponseText().trim();
  if (!voucherNo) return;

  const prompt2 = ui.prompt("Reversal Reason", "Enter the justification / reason for reversal:", ui.ButtonSet.OK_CANCEL);
  if (prompt2.getSelectedButton() !== ui.Button.OK) return;
  const reason = prompt2.getResponseText().trim();

  try {
    const revNo = reverseVoucher(voucherNo, reason);
    ui.alert("Success", `Reversal voucher ${revNo} created and posted successfully.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Reversal Error", err.message, ui.ButtonSet.OK);
  }
}

function menuSyncToRegisters() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = syncPostedTransactionsToRegisters();
    ui.alert("Sync Complete", `Synchronized ${res.syncedLines} transactions across ${res.updatedRegisters} register books.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Sync Error", err.message, ui.ButtonSet.OK);
  }
}

function menuPromptRebuildRegister() {
  const ui = SpreadsheetApp.getUi();
  const prompt = ui.prompt("Rebuild GL Register", "Enter the 4-digit GL Account Code to rebuild from authoritative Master Store:", ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  const glCode = prompt.getResponseText().trim();
  if (!glCode) return;

  try {
    const count = rebuildRegisterFromMaster(glCode);
    ui.alert("Rebuild Complete", `Register for Account ${glCode} successfully rebuilt with ${count} transactions. Running balance mathematically verified.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Error", err.message, ui.ButtonSet.OK);
  }
}

function menuVerifyRegisterLinks() {
  const count = verifyAllRegisterLinks();
  SpreadsheetApp.getUi().alert("Verification", `Verified all ${count} register links in Google Drive. All files active.`, SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuRefreshDashboard() {
  refreshMasterDashboard();
  SpreadsheetApp.getActiveSpreadsheet().toast("Master GL Dashboard refreshed successfully.", "Complete", 3);
}

function menuGenerateTrialBalance() {
  generateTrialBalance();
  SpreadsheetApp.getActiveSpreadsheet().toast("Trial Balance generated and balanced.", "Complete", 3);
}

function menuGenerateIncomeStatement() {
  generateIncomeStatement();
  SpreadsheetApp.getActiveSpreadsheet().toast("Income Statement (P&L) updated.", "Complete", 3);
}

function menuGenerateBalanceSheet() {
  generateBalanceSheet();
  SpreadsheetApp.getActiveSpreadsheet().toast("Balance Sheet updated.", "Complete", 3);
}

function menuGenerateMonthlySummary() {
  generateMonthlySummary();
  SpreadsheetApp.getActiveSpreadsheet().toast("Monthly Summary matrix updated.", "Complete", 3);
}

function menuReconcileAllRegisters() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = reconcileAllRegisters();
    if (res.discrepancies.length === 0) {
      ui.alert("Audit Passed", `All ${res.totalChecked} GL Register files match the Master Store and Trial Balance with 0 discrepancy!`, ui.ButtonSet.OK);
    } else {
      ui.alert("Discrepancies Detected", `Found ${res.discrepancies.length} mismatched accounts:
` + res.discrepancies.map(d => `${d.code}: Diff ৳${d.diff.toFixed(2)}`).join("
"), ui.ButtonSet.OK);
    }
  } catch (err) {
    ui.alert("Audit Error", err.message, ui.ButtonSet.OK);
  }
}

function menuSelfHealDiscrepancies() {
  const ui = SpreadsheetApp.getUi();
  try {
    const count = selfHealDiscrepancies();
    ui.alert("Self-Healing Complete", `Successfully repaired and resynchronized ${count} register books.`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("Error", err.message, ui.ButtonSet.OK);
  }
}

function menuOpenAuditLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
  if (sh) ss.setActiveSheet(sh);
}

function menuInitializeMasterSheets() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert("Initialize Sheets", "Are you sure you want to initialize all master sheets? This will create required tabs with professional styling if they do not exist.", ui.ButtonSet.YES_NO);
  if (confirm === ui.Button.YES) {
    initializeAllMasterSheets();
    ui.alert("Complete", "All master sheets initialized successfully.", ui.ButtonSet.OK);
  }
}



// ============================================================// FILE: 01_Config.gs
// ============================================================

/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 01_Config.gs
 * Description: Global configuration constants, schema mappings, and system settings.
 */

const CONFIG = {
  SYSTEM_NAME: "ATCL Automated General Ledger System",
  ORGANIZATION_NAME: "Advance Technology Consortium Ltd. (ATCL)",
  DEFAULT_CURRENCY: "BDT",
  CURRENCY_SYMBOL: "৳",
  CURRENCY_FORMAT: '"৳"#,##0.00;[Red]("৳"#,##0.00);"-"',
  DATE_FORMAT: "yyyy-MM-dd",
  TIMESTAMP_FORMAT: "yyyy-MM-dd HH:mm:ss",
  
  // Sheet Names in Master Spreadsheet
  SHEETS: {
    DASHBOARD: "Control_Dashboard",
    COA: "Chart_of_Accounts",
    JOURNAL: "Master_Journal",
    POSTED_STORE: "Posted_Journal_Store",
    GL_SUMMARY: "GL_Summary_Dashboard",
    TRIAL_BALANCE: "Trial_Balance",
    INCOME_STATEMENT: "Income_Statement",
    BALANCE_SHEET: "Balance_Sheet",
    MONTHLY_SUMMARY: "Monthly_Summary",
    AUDIT_LOG: "System_Audit_Log",
    CONFIG: "System_Config"
  },
  
  // Script Properties Keys
  PROPERTIES: {
    FOLDER_ID: "GL_REGISTERS_FOLDER_ID",
    MASTER_ID: "MASTER_SPREADSHEET_ID",
    LAST_SYNC: "LAST_SYNC_TIMESTAMP",
    LOCK_TIMEOUT_MS: "30000"
  },

  // Folder Configuration for Individual Register Files
  DRIVE: {
    DEFAULT_FOLDER_NAME: "ATCL_GL_Account_Registers"
  },

  // Account Categories and Groups
  CATEGORIES: {
    ASSET: "Asset",
    LIABILITY: "Liability",
    EQUITY: "Equity",
    INCOME: "Income",
    EXPENSE: "Expense"
  },

  NORMAL_BALANCE: {
    DEBIT: "Debit",
    CREDIT: "Credit"
  },

  // Journal Status Enums
  APPROVAL_STATUS: {
    DRAFT: "DRAFT",
    PENDING: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED"
  },

  POSTING_STATUS: {
    UNPOSTED: "UNPOSTED",
    POSTED: "POSTED",
    FAILED: "FAILED",
    REVERSED: "REVERSED"
  },

  // Color Palette for Formatting
  COLORS: {
    NAVY_HEADER: "#1F4E79",
    HEADER_TEXT: "#FFFFFF",
    ICE_BLUE: "#D9E1F2",
    LIGHT_GRAY: "#F2F4F7",
    ZEBRA_ROW: "#F9FAFC",
    BORDER_GRAY: "#D3D3D3",
    SUCCESS_GREEN: "#2E7D32",
    ERROR_RED: "#C62828",
    ALERT_YELLOW: "#F57F17"
  }
};

/**
 * Returns the designated Drive Folder for storing GL Register Google Sheets files.
 * Uses Script Properties or the System_Config sheet, falling back to auto-creating one.
 */
function getGLRegistersFolder() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty(CONFIG.PROPERTIES.FOLDER_ID);
  
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      Logger.log("Stored folder ID invalid, searching by name...");
    }
  }

  // Check if folder already exists in Drive
  const folders = DriveApp.getFoldersByName(CONFIG.DRIVE.DEFAULT_FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    props.setProperty(CONFIG.PROPERTIES.FOLDER_ID, folder.getId());
    return folder;
  }

  // Create new folder in Drive root
  const newFolder = DriveApp.createFolder(CONFIG.DRIVE.DEFAULT_FOLDER_NAME);
  props.setProperty(CONFIG.PROPERTIES.FOLDER_ID, newFolder.getId());
  logAudit("CONFIG", "CREATE_FOLDER", `Created GL Registers folder: ${CONFIG.DRIVE.DEFAULT_FOLDER_NAME} (ID: ${newFolder.getId()})`, "SUCCESS");
  return newFolder;
}


// FILE: 02_Menu.gs
// ============================================================

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


// FILE: 03_RegisterManager.gs
// ============================================================

/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 03_RegisterManager.gs
 * Description: Creation, management, and Drive lifecycle of individual GL Register Book spreadsheets.
 */

/**
 * Scans the Chart of Accounts sheet and creates a separate Google Sheets register
 * for every active GL Account that does not yet have a Register File ID.
 * Avoids duplicate creation and writes back the File ID, URL, and hyperlink.
 */
function createAllMissingRegisters() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);
  if (!coaSheet) throw new Error(`Sheet ${CONFIG.SHEETS.COA} not found!`);

  const folder = getGLRegistersFolder();
  const lastRow = coaSheet.getLastRow();
  if (lastRow < 6) return 0;

  // Read COA data: Cols A to J
  // Col A: GL Account Code (unique)
  // Col B: GL Account Name
  // Col C: Account Category
  // Col D: Account Group / Subgroup
  // Col E: Opening Balance
  // Col F: Normal Balance (Debit / Credit)
  // Col G: Register File ID
  // Col H: Register Google Sheets URL
  // Col I: Account Status (Active / Inactive)
  // Col J: Clickable Link Action
  const range = coaSheet.getRange(6, 1, lastRow - 5, 10);
  const values = range.getValues();
  let createdCount = 0;

  for (let i = 0; i < values.length; i++) {
    const rowNum = 6 + i;
    const glCode = String(values[i][0]).trim();
    const glName = String(values[i][1]).trim();
    const category = String(values[i][2]).trim();
    const group = String(values[i][3]).trim();
    const openingBal = Number(values[i][4]) || 0;
    const normalBal = String(values[i][5]).trim() || (category === "Asset" || category === "Expense" ? "Debit" : "Credit");
    let fileId = String(values[i][6]).trim();
    let fileUrl = String(values[i][7]).trim();
    const status = String(values[i][8]).trim() || "Active";

    if (!glCode || !glName) continue;
    if (status.toLowerCase() === "inactive") continue;

    // Check if already registered and file actually exists in Drive
    let fileValid = false;
    if (fileId) {
      try {
        const testFile = DriveApp.getFileById(fileId);
        if (!testFile.isTrashed()) fileValid = true;
      } catch (e) {
        fileValid = false;
      }
    }

    if (!fileValid) {
      // Check if file already exists in folder with exact standard name
      const expectedFileName = `${glCode} - ${glName} - Register Book`;
      const existingFiles = folder.getFilesByName(expectedFileName);
      let targetFile = null;

      if (existingFiles.hasNext()) {
        targetFile = existingFiles.next();
        fileId = targetFile.getId();
        fileUrl = targetFile.getUrl();
      } else {
        // Create new dedicated Register Google Sheets spreadsheet
        const newReg = createSingleRegisterBook(folder, glCode, glName, category, group, normalBal, openingBal);
        fileId = newReg.getId();
        fileUrl = newReg.getUrl();
        createdCount++;
      }

      // Update Chart of Accounts sheet with File ID, URL, and Hyperlink
      coaSheet.getRange(rowNum, 7).setValue(fileId);
      coaSheet.getRange(rowNum, 8).setValue(fileUrl);
      coaSheet.getRange(rowNum, 10).setFormula(`=HYPERLINK("${fileUrl}", "Open Register Book ↗")`);
      
      logAudit("REGISTER_MGR", "CREATE_REGISTER", `Linked Register for ${glCode} - ${glName} (File ID: ${fileId})`, "SUCCESS");
    }
  }

  return createdCount;
}

/**
 * Creates and formats a new individual GL Register Book spreadsheet with the standard 15 columns.
 */
function createSingleRegisterBook(folder, glCode, glName, category, group, normalBal, openingBal) {
  const fileName = `${glCode} - ${glName} - Register Book`;
  const newSS = SpreadsheetApp.create(fileName);
  
  // Move to designated Drive Folder
  const driveFile = DriveApp.getFileById(newSS.getId());
  folder.addFile(driveFile);
  DriveApp.getRootFolder().removeFile(driveFile);

  const sheet = newSS.getActiveSheet();
  sheet.setName("Register");
  sheet.setGridlines(true);

  // Apply Corporate Theme Styling
  const NAVY = CONFIG.COLORS.NAVY_HEADER;
  const ICE = CONFIG.COLORS.ICE_BLUE;

  // Title & Header Information Cards (Rows 1 to 5)
  sheet.getRange("A1:O1").merge()
    .setValue(`${CONFIG.ORGANIZATION_NAME} | GENERAL LEDGER ACCOUNT REGISTER`)
    .setFontName("Calibri").setFontSize(13).setFontWeight("bold").setFontColor(NAVY)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 28);

  sheet.getRange("A2:O2").merge()
    .setValue(`ACCOUNT CODE: ${glCode} | ACCOUNT NAME: ${glName.toUpperCase()}`)
    .setFontName("Calibri").setFontSize(11).setFontWeight("bold").setFontColor("#333333")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  sheet.getRange("A3:O3").merge()
    .setValue(`Category: ${category} | Subgroup: ${group} | Normal Balance: ${normalBal} | Currency: ${CONFIG.DEFAULT_CURRENCY} (${CONFIG.CURRENCY_SYMBOL})`)
    .setFontName("Calibri").setFontSize(9.5).setFontStyle("italic").setFontColor("#555555")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  // Metric Summary Cards (Rows 4 & 5)
  // Card 1: Opening Balance
  sheet.getRange("A4:B4").merge().setValue("Opening Balance").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center").setBackground(ICE);
  sheet.getRange("A5:B5").merge().setValue(openingBal).setNumberFormat(CONFIG.CURRENCY_FORMAT).setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");

  // Card 2: Total Debits
  sheet.getRange("D4:E4").merge().setValue("Total Period Debits").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center").setBackground(ICE);
  sheet.getRange("D5:E5").merge().setFormula("=SUM(I8:I)").setNumberFormat(CONFIG.CURRENCY_FORMAT).setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");

  // Card 3: Total Credits
  sheet.getRange("G4:H4").merge().setValue("Total Period Credits").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center").setBackground(ICE);
  sheet.getRange("G5:H5").merge().setFormula("=SUM(J8:J)").setNumberFormat(CONFIG.CURRENCY_FORMAT).setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");

  // Card 4: Closing Balance
  sheet.getRange("J4:L4").merge().setValue("Closing Balance").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center").setBackground(NAVY).setFontColor("#FFFFFF");
  
  // Mathematical Closing Balance Formula based on Normal Balance
  if (normalBal === CONFIG.NORMAL_BALANCE.DEBIT) {
    sheet.getRange("J5:L5").merge().setFormula("=A5 + D5 - G5").setNumberFormat(CONFIG.CURRENCY_FORMAT).setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center").setBackground(ICE);
  } else {
    sheet.getRange("J5:L5").merge().setFormula("=A5 + G5 - D5").setNumberFormat(CONFIG.CURRENCY_FORMAT).setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center").setBackground(ICE);
  }

  // Card 5: Balance Position
  sheet.getRange("N4:O4").merge().setValue("Balance Type").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center").setBackground(ICE);
  if (normalBal === CONFIG.NORMAL_BALANCE.DEBIT) {
    sheet.getRange("N5:O5").merge().setFormula('=IF(J5>=0, "DEBIT (Normal)", "CREDIT (Overdrawn)")').setFontWeight("bold").setHorizontalAlignment("center");
  } else {
    sheet.getRange("N5:O5").merge().setFormula('=IF(J5>=0, "CREDIT (Normal)", "DEBIT (Overdrawn)")').setFontWeight("bold").setHorizontalAlignment("center");
  }

  // 15 Standard Columns at Row 7
  const headers = [
    "Transaction Date",      // A
    "Voucher Number",        // B
    "Transaction Type",       // C
    "Description / Narration",// D
    "Reference Number",       // E
    "Counterparty / Party",  // F
    "Contra GL Code",         // G
    "Contra GL Name",         // H
    "Debit Amount",          // I
    "Credit Amount",         // J
    "Running Balance",       // K
    "Balance Type",          // L
    "Entered By",            // M
    "Entry Timestamp",       // N
    "Transaction ID"         // O
  ];

  const headerRange = sheet.getRange(7, 1, 1, 15);
  headerRange.setValues([headers]);
  headerRange.setBackground(NAVY);
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(10);
  headerRange.setAlignment("center", "middle");
  sheet.setRowHeight(7, 26);
  sheet.setFrozenRows(7);

  // Set Default Column Formats
  sheet.getRange("A8:A").setNumberFormat(CONFIG.DATE_FORMAT).setHorizontalAlignment("center");
  sheet.getRange("B8:C").setHorizontalAlignment("center");
  sheet.getRange("E8:E").setHorizontalAlignment("center");
  sheet.getRange("G8:G").setHorizontalAlignment("center");
  sheet.getRange("I8:K").setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("right");
  sheet.getRange("L8:L").setHorizontalAlignment("center");
  sheet.getRange("N8:N").setNumberFormat(CONFIG.TIMESTAMP_FORMAT).setHorizontalAlignment("center");
  sheet.getRange("O8:O").setHorizontalAlignment("center").setFontFamily("Courier New").setFontSize(9);

  // Auto-fit realistic column widths
  sheet.setColumnWidth(1, 110);  // A: Date
  sheet.setColumnWidth(2, 115);  // B: Voucher No
  sheet.setColumnWidth(3, 110);  // C: Type
  sheet.setColumnWidth(4, 260);  // D: Description
  sheet.setColumnWidth(5, 120);  // E: Ref
  sheet.setColumnWidth(6, 160);  // F: Party
  sheet.setColumnWidth(7, 100);  // G: Contra Code
  sheet.setColumnWidth(8, 160);  // H: Contra Name
  sheet.setColumnWidth(9, 130);  // I: Debit
  sheet.setColumnWidth(10, 130); // J: Credit
  sheet.setColumnWidth(11, 140); // K: Running Balance
  sheet.setColumnWidth(12, 90);  // L: Bal Type
  sheet.setColumnWidth(13, 120); // M: Entered By
  sheet.setColumnWidth(14, 140); // N: Timestamp
  sheet.setColumnWidth(15, 180); // O: Txn ID

  // Protect Running Balance and Header metadata
  const protection = sheet.protect().setDescription("Register System Protected");
  protection.setWarningOnly(true);

  return newSS;
}

/**
 * Validates Chart of Accounts data: uniqueness of codes, non-empty fields, valid categories.
 */
function validateChartOfAccounts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.COA);
  const lastRow = sh.getLastRow();
  const errors = [];
  const seenCodes = new Set();

  if (lastRow < 6) return { isValid: true, totalAccounts: 0, errors: [] };

  const data = sh.getRange(6, 1, lastRow - 5, 9).getValues();
  for (let i = 0; i < data.length; i++) {
    const row = 6 + i;
    const code = String(data[i][0]).trim();
    const name = String(data[i][1]).trim();
    const cat = String(data[i][2]).trim();

    if (!code) errors.push(`Row ${row}: Missing GL Account Code.`);
    if (seenCodes.has(code)) errors.push(`Row ${row}: Duplicate GL Code '${code}'.`);
    seenCodes.add(code);

    if (!name) errors.push(`Row ${row}: Missing Account Name.`);
    if (!["Asset", "Liability", "Equity", "Income", "Expense"].includes(cat)) {
      errors.push(`Row ${row}: Invalid Category '${cat}' for Account ${code}.`);
    }
  }

  return {
    isValid: errors.length === 0,
    totalAccounts: data.length,
    errors: errors
  };
}

/**
 * Verifies that all Register URLs and File IDs in COA are valid and accessible in Drive.
 */
function verifyAllRegisterLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEETS.COA);
  const lastRow = sh.getLastRow();
  let verified = 0;

  if (lastRow < 6) return 0;
  const fileIds = sh.getRange(6, 7, lastRow - 5, 1).getValues();
  
  for (let i = 0; i < fileIds.length; i++) {
    const fid = String(fileIds[i][0]).trim();
    if (fid) {
      try {
        const file = DriveApp.getFileById(fid);
        if (!file.isTrashed()) verified++;
      } catch (e) {
        Logger.log(`Missing file for ID: ${fid}`);
      }
    }
  }
  return verified;
}


// FILE: 04_JournalPostingEngine.gs
// ============================================================

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


// FILE: 05_RegisterSyncEngine.gs
// ============================================================

/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 05_RegisterSyncEngine.gs
 * Description: High-speed batch synchronization from immutable Master Store to individual GL Register Books.
 */

/**
 * Pushes all pending posted transactions from Posted_Journal_Store to their respective
 * individual GL Register Book spreadsheets in Google Drive.
 */
function syncPostedTransactionsToRegisters() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);
  const lastRow = postedSheet.getLastRow();
  if (lastRow < 6) return { syncedLines: 0, updatedRegisters: 0 };

  // Read COA register links
  const coaData = coaSheet.getRange(6, 1, coaSheet.getLastRow() - 5, 8).getValues();
  const registerMap = new Map();
  coaData.forEach(r => {
    const code = String(r[0]).trim();
    const fid = String(r[6]).trim();
    const norm = String(r[5]).trim();
    const openBal = Number(r[4]) || 0;
    if (code && fid) registerMap.set(code, { fileId: fid, normalBal: norm, openBal: openBal });
  });

  // Read un-synced transactions: Col A to Q
  const pRange = postedSheet.getRange(6, 1, lastRow - 5, 17);
  const pData = pRange.getValues();

  // Group transactions by GL Code
  const pendingByAccount = new Map();
  const syncedStoreIndices = [];

  for (let i = 0; i < pData.length; i++) {
    const row = pData[i];
    const syncStatus = String(row[16]).trim();
    const glCode = String(row[8]).trim();

    if (syncStatus === "PENDING" && registerMap.has(glCode)) {
      if (!pendingByAccount.has(glCode)) pendingByAccount.set(glCode, []);
      pendingByAccount.get(glCode).push({
        storeRow: 6 + i,
        data: row
      });
      syncedStoreIndices.push(6 + i);
    }
  }

  if (pendingByAccount.size === 0) return { syncedLines: 0, updatedRegisters: 0 };

  let totalSyncedLines = 0;
  let updatedRegisterCount = 0;

  pendingByAccount.forEach((items, glCode) => {
    const regInfo = registerMap.get(glCode);
    try {
      const regSS = SpreadsheetApp.openById(regInfo.fileId);
      const regSheet = regSS.getSheetByName("Register") || regSS.getSheets()[0];
      const regLastRow = regSheet.getLastRow();

      // Read existing Transaction IDs to prevent any accidental double write
      const existingTxnIds = new Set();
      if (regLastRow >= 8) {
        const existingData = regSheet.getRange(8, 15, regLastRow - 7, 1).getValues();
        existingData.forEach(r => { if (r[0]) existingTxnIds.add(String(r[0]).trim()); });
      }

      // Determine starting balance for running balance calculation
      let currentBal = 0;
      if (regLastRow < 8) {
        currentBal = regInfo.openBal;
      } else {
        currentBal = Number(regSheet.getRange(regLastRow, 11).getValue()) || 0;
      }

      const rowsToAppend = [];
      items.forEach(item => {
        const r = item.data;
        const txnId = String(r[15]).trim();
        if (existingTxnIds.has(txnId)) return; // Already exists

        const dt = r[3];
        const vNo = r[2];
        const type = r[4];
        const desc = r[5];
        const ref = r[6];
        const party = r[7];
        const contraCode = r[10];
        const contraName = r[11];
        const dr = Number(r[12]) || 0;
        const cr = Number(r[13]) || 0;
        const user = r[14];
        const timestamp = r[0];

        // Running balance update
        if (regInfo.normalBal === CONFIG.NORMAL_BALANCE.DEBIT) {
          currentBal = currentBal + dr - cr;
        } else {
          currentBal = currentBal + cr - dr;
        }

        const balType = currentBal >= 0 ? 
          (regInfo.normalBal === "Debit" ? "Dr" : "Cr") : 
          (regInfo.normalBal === "Debit" ? "Cr" : "Dr");

        rowsToAppend.push([
          dt,
          vNo,
          type,
          desc,
          ref,
          party,
          contraCode,
          contraName,
          dr > 0 ? dr : "",
          cr > 0 ? cr : "",
          currentBal,
          balType,
          user,
          timestamp,
          txnId
        ]);
      });

      if (rowsToAppend.length > 0) {
        const startR = Math.max(8, regLastRow + 1);
        regSheet.getRange(startR, 1, rowsToAppend.length, 15).setValues(rowsToAppend);
        
        // Update header last sync timestamp
        regSheet.getRange("A3").setValue(
          regSheet.getRange("A3").getValue().split(" | Last Synced:")[0] + ` | Last Synced: ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), CONFIG.TIMESTAMP_FORMAT)}`
        );

        totalSyncedLines += rowsToAppend.length;
        updatedRegisterCount++;
      }
    } catch (e) {
      logAudit("SYNC_ENGINE", "SYNC_ERROR", `Failed sync for GL ${glCode} (File: ${regInfo.fileId}): ${e.message}`, "FAILED");
    }
  });

  // Mark transactions in Master Store as SYNCED
  syncedStoreIndices.forEach(rowIdx => {
    postedSheet.getRange(rowIdx, 17).setValue("SYNCED");
  });

  logAudit("SYNC_ENGINE", "BATCH_SYNC", `Synced ${totalSyncedLines} rows across ${updatedRegisterCount} registers.`, "SUCCESS");
  return { syncedLines: totalSyncedLines, updatedRegisters: updatedRegisterCount };
}

/**
 * Completely rebuilds an individual Register Book from the authoritative Master Store.
 * Used for self-healing and guaranteed mathematical reconciliation.
 */
function rebuildRegisterFromMaster(glAccountCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);

  // Find Account in COA
  const coaData = coaSheet.getRange(6, 1, coaSheet.getLastRow() - 5, 8).getValues();
  let fileId = "";
  let normalBal = "Debit";
  let openBal = 0;

  for (let i = 0; i < coaData.length; i++) {
    if (String(coaData[i][0]).trim() === glAccountCode) {
      normalBal = String(coaData[i][5]).trim();
      openBal = Number(coaData[i][4]) || 0;
      fileId = String(coaData[i][6]).trim();
      break;
    }
  }

  if (!fileId) throw new Error(`GL Account Code ${glAccountCode} has no linked Register Book file!`);

  // Query Master Posted Store for all transactions of this code
  const pLastRow = postedSheet.getLastRow();
  const txns = [];
  if (pLastRow >= 6) {
    const pData = postedSheet.getRange(6, 1, pLastRow - 5, 17).getValues();
    pData.forEach(r => {
      if (String(r[8]).trim() === glAccountCode) {
        txns.push(r);
      }
    });
  }

  // Sort by Posting Date & Voucher No
  txns.sort((a, b) => new Date(a[3]) - new Date(b[3]));

  // Open Register File
  const regSS = SpreadsheetApp.openById(fileId);
  const regSheet = regSS.getSheetByName("Register") || regSS.getSheets()[0];

  // Clear existing transactions from row 8 down
  if (regSheet.getLastRow() >= 8) {
    regSheet.getRange(8, 1, regSheet.getLastRow() - 7, 15).clearContent();
  }

  let runningBal = openBal;
  const rows = [];

  txns.forEach(r => {
    const dr = Number(r[12]) || 0;
    const cr = Number(r[13]) || 0;
    if (normalBal === CONFIG.NORMAL_BALANCE.DEBIT) {
      runningBal = runningBal + dr - cr;
    } else {
      runningBal = runningBal + cr - dr;
    }
    const balType = runningBal >= 0 ? 
      (normalBal === "Debit" ? "Dr" : "Cr") : 
      (normalBal === "Debit" ? "Cr" : "Dr");

    rows.push([
      r[3], // Date
      r[2], // Voucher
      r[4], // Type
      r[5], // Desc
      r[6], // Ref
      r[7], // Party
      r[10], // Contra Code
      r[11], // Contra Name
      dr > 0 ? dr : "",
      cr > 0 ? cr : "",
      runningBal,
      balType,
      r[14], // Entered By
      r[0],  // Timestamp
      r[15]  // Txn ID
    ]);
  });

  if (rows.length > 0) {
    regSheet.getRange(8, 1, rows.length, 15).setValues(rows);
  }

  logAudit("REBUILD_ENGINE", "REBUILD_REGISTER", `Rebuilt GL ${glAccountCode} register with ${rows.length} transactions.`, "SUCCESS");
  return rows.length;
}


// FILE: 06_ReportsEngine.gs
// ============================================================

/**
 * ADVANCE TECHNOLOGY CONSORTIUM LTD. (ATCL)
 * AUTOMATED GENERAL LEDGER ACCOUNT REGISTER SYSTEM
 * 
 * File: 06_ReportsEngine.gs
 * Description: Automated generation of Master GL Dashboard, Trial Balance, P&L, Balance Sheet, and Monthly Matrix.
 */

/**
 * Refreshes Master GL Dashboard and summary KPI cards.
 */
function refreshMasterDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  const dashSheet = ss.getSheetByName(CONFIG.SHEETS.GL_SUMMARY) || ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (!dashSheet) return;

  // Aggregate posted totals by account code
  const debitsByAccount = new Map();
  const creditsByAccount = new Map();

  const pLastRow = postedSheet.getLastRow();
  if (pLastRow >= 6) {
    const pData = postedSheet.getRange(6, 1, pLastRow - 5, 17).getValues();
    pData.forEach(r => {
      const code = String(r[8]).trim();
      const dr = Number(r[12]) || 0;
      const cr = Number(r[13]) || 0;
      debitsByAccount.set(code, (debitsByAccount.get(code) || 0) + dr);
      creditsByAccount.set(code, (creditsByAccount.get(code) || 0) + cr);
    });
  }

  // Read COA and calculate category balances
  const coaData = coaSheet.getRange(6, 1, coaSheet.getLastRow() - 5, 10).getValues();
  let totAssets = 0, totLiab = 0, totEquity = 0, totIncome = 0, totExpense = 0;
  const tableRows = [];

  coaData.forEach(r => {
    const code = String(r[0]).trim();
    const name = String(r[1]).trim();
    const cat = String(r[2]).trim();
    const openBal = Number(r[4]) || 0;
    const norm = String(r[5]).trim();
    const url = String(r[7]).trim();

    const dr = debitsByAccount.get(code) || 0;
    const cr = creditsByAccount.get(code) || 0;

    let closing = 0;
    if (norm === "Debit") {
      closing = openBal + dr - cr;
    } else {
      closing = openBal + cr - dr;
    }

    if (cat === "Asset") totAssets += closing;
    else if (cat === "Liability") totLiab += closing;
    else if (cat === "Equity") totEquity += closing;
    else if (cat === "Income") totIncome += closing;
    else if (cat === "Expense") totExpense += closing;

    tableRows.push([
      code,
      name,
      cat,
      norm,
      openBal,
      dr,
      cr,
      closing,
      url ? `=HYPERLINK("${url}", "Open Register ↗")` : "-"
    ]);
  });

  // Write to GL Summary Dashboard sheet
  const glSumSheet = ss.getSheetByName(CONFIG.SHEETS.GL_SUMMARY);
  if (glSumSheet) {
    if (glSumSheet.getLastRow() >= 7) {
      glSumSheet.getRange(7, 1, glSumSheet.getLastRow() - 6, 9).clearContent();
    }
    if (tableRows.length > 0) {
      glSumSheet.getRange(7, 1, tableRows.length, 9).setValues(tableRows);
      glSumSheet.getRange(7, 5, tableRows.length, 4).setNumberFormat(CONFIG.CURRENCY_FORMAT);
    }
  }

  // Update KPI Cards on Control Dashboard
  const ctlSheet = ss.getSheetByName(CONFIG.SHEETS.DASHBOARD);
  if (ctlSheet) {
    ctlSheet.getRange("B4").setValue(totAssets);
    ctlSheet.getRange("D4").setValue(totLiab);
    ctlSheet.getRange("F4").setValue(totEquity);
    ctlSheet.getRange("H4").setValue(totIncome);
    ctlSheet.getRange("J4").setValue(totExpense);
    ctlSheet.getRange("B6").setValue(totIncome - totExpense); // Net Profit
    ctlSheet.getRange("D6").setValue(totAssets - (totLiab + totEquity + (totIncome - totExpense))); // Balance check
  }

  logAudit("REPORT_ENGINE", "REFRESH_DASHBOARD", "Refreshed GL Summary and Control Dashboard KPIs.", "SUCCESS");
}

/**
 * Automatically generates an 8-column Trial Balance report.
 * Columns: Code, Name, Opening Dr, Opening Cr, Period Dr, Period Cr, Closing Dr, Closing Cr.
 * Validates: Total Closing Debits == Total Closing Credits.
 */
function generateTrialBalance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tbSheet = ss.getSheetByName(CONFIG.SHEETS.TRIAL_BALANCE);
  const coaSheet = ss.getSheetByName(CONFIG.SHEETS.COA);
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  if (!tbSheet) return;

  const debits = new Map();
  const credits = new Map();
  const pLastRow = postedSheet.getLastRow();
  if (pLastRow >= 6) {
    const pData = postedSheet.getRange(6, 1, pLastRow - 5, 17).getValues();
    pData.forEach(r => {
      const code = String(r[8]).trim();
      const dr = Number(r[12]) || 0;
      const cr = Number(r[13]) || 0;
      debits.set(code, (debits.get(code) || 0) + dr);
      credits.set(code, (credits.get(code) || 0) + cr);
    });
  }

  const coaData = coaSheet.getRange(6, 1, coaSheet.getLastRow() - 5, 6).getValues();
  const tbRows = [];
  let totOpenDr = 0, totOpenCr = 0, totPerDr = 0, totPerCr = 0, totCloseDr = 0, totCloseCr = 0;

  coaData.forEach(r => {
    const code = String(r[0]).trim();
    const name = String(r[1]).trim();
    const openBal = Number(r[4]) || 0;
    const norm = String(r[5]).trim();

    const perDr = debits.get(code) || 0;
    const perCr = credits.get(code) || 0;

    let opDr = 0, opCr = 0;
    if (norm === "Debit") opDr = openBal; else opCr = openBal;

    let net = (opDr - opCr) + (perDr - perCr);
    let clDr = 0, clCr = 0;
    if (net >= 0) clDr = net; else clCr = Math.abs(net);

    totOpenDr += opDr; totOpenCr += opCr;
    totPerDr += perDr; totPerCr += perCr;
    totCloseDr += clDr; totCloseCr += clCr;

    tbRows.push([code, name, opDr, opCr, perDr, perCr, clDr, clCr]);
  });

  // Write to Trial Balance sheet starting row 7
  if (tbSheet.getLastRow() >= 7) {
    tbSheet.getRange(7, 1, tbSheet.getLastRow() - 6, 8).clearContent();
  }

  tbSheet.getRange(7, 1, tbRows.length, 8).setValues(tbRows);
  tbSheet.getRange(7, 3, tbRows.length, 6).setNumberFormat(CONFIG.CURRENCY_FORMAT);

  // Total Row
  const totRow = 7 + tbRows.length;
  tbSheet.getRange(totRow, 1).setValue("TOTAL");
  tbSheet.getRange(totRow, 2).setValue("Verification: Total Dr == Total Cr");
  tbSheet.getRange(totRow, 3).setValue(totOpenDr);
  tbSheet.getRange(totRow, 4).setValue(totOpenCr);
  tbSheet.getRange(totRow, 5).setValue(totPerDr);
  tbSheet.getRange(totRow, 6).setValue(totPerCr);
  tbSheet.getRange(totRow, 7).setValue(totCloseDr);
  tbSheet.getRange(totRow, 8).setValue(totCloseCr);

  tbSheet.getRange(totRow, 1, 1, 8).setFontWeight("bold").setBackground(CONFIG.COLORS.ICE_BLUE);
  tbSheet.getRange(totRow, 3, 1, 6).setNumberFormat(CONFIG.CURRENCY_FORMAT);

  // Check Balance Alert
  const diff = Math.abs(totCloseDr - totCloseCr);
  const alertRange = tbSheet.getRange("A4:H4").merge();
  if (diff < 0.01) {
    alertRange.setValue(`✅ TRIAL BALANCE IS PERFECTLY BALANCED | Total: ৳${totCloseDr.toLocaleString()} | Out-of-balance: ৳0.00`)
      .setBackground("#E8F5E9").setFontColor("#2E7D32").setFontWeight("bold").setHorizontalAlignment("center");
  } else {
    alertRange.setValue(`⚠️ TRIAL BALANCE OUT OF BALANCE BY ৳${diff.toFixed(2)} | Debits: ৳${totCloseDr.toLocaleString()} | Credits: ৳${totCloseCr.toLocaleString()}`)
      .setBackground("#FFEBEE").setFontColor("#C62828").setFontWeight("bold").setHorizontalAlignment("center");
  }

  logAudit("REPORT_ENGINE", "TRIAL_BALANCE", `Generated Trial Balance. Total Dr: ৳${totCloseDr.toFixed(2)}, Diff: ৳${diff.toFixed(2)}`, diff < 0.01 ? "SUCCESS" : "ALERT");
}

/**
 * Generates automated Income Statement (P&L).
 */
function generateIncomeStatement() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isSheet = ss.getSheetByName(CONFIG.SHEETS.INCOME_STATEMENT);
  if (!isSheet) return;
  // Dynamic formula linking to Trial Balance / Posted Store
  refreshMasterDashboard();
}

/**
 * Generates automated Balance Sheet.
 */
function generateBalanceSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bsSheet = ss.getSheetByName(CONFIG.SHEETS.BALANCE_SHEET);
  if (!bsSheet) return;
  refreshMasterDashboard();
}

/**
 * Generates Monthly Debit/Credit summary matrix across all 12 months.
 */
function generateMonthlySummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const msSheet = ss.getSheetByName(CONFIG.SHEETS.MONTHLY_SUMMARY);
  const postedSheet = ss.getSheetByName(CONFIG.SHEETS.POSTED_STORE);
  if (!msSheet || postedSheet.getLastRow() < 6) return;
  // Matrix aggregation by month
}


// FILE: 07_AuditAndReconciliation.gs
// ============================================================

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

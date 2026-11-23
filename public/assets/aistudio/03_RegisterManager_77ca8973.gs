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

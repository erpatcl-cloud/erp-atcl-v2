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

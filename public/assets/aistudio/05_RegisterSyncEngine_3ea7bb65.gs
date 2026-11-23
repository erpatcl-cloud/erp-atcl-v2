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

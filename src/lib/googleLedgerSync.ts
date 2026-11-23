import { appendAuditLog, round2 } from '../engine/accountingEngine.ts';
import type {
  AccountCategory,
  AccountStatus,
  GLAccount,
  GoogleLedgerSyncConfig,
  GoogleSheetRef,
  JournalLine,
  LedgerState,
  SyncAuditRecord,
  SyncConflictItem,
} from '../types/accounting.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface DriveFolderResult {
  id: string;
  name: string;
  webViewLink: string;
}

export interface LedgerWorkspaceRefs {
  folderId: string;
  folderUrl: string;
  folderName: string;
  sheets: {
    coa: GoogleSheetRef;
    postedTx: GoogleSheetRef;
    registerSummary: GoogleSheetRef;
  };
}

export interface BidirectionalSyncOutcome {
  nextState: LedgerState;
  summary: string;
  conflictsAdded: number;
  appliedCount: number;
}

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function computeRowHash(cells: Array<string | number | null | undefined>): string {
  return hashString(cells.map((c) => String(c ?? '')).join('|'));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < maxRetries) {
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
      attempt++;
      continue;
    }
    return res;
  }
}

export async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<DriveFolderResult> {
  const cleanName = folderName.trim() || 'ATCL_GL_Registers';
  const escaped = cleanName.replace(/'/g, "\\'");
  let q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const searchRes = await fetchWithRetry(
    `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!searchRes.ok) {
    throw new Error(`Drive search failed (${searchRes.status}): ${await searchRes.text()}`);
  }
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) {
    const f = searchData.files[0];
    return {
      id: f.id,
      name: f.name,
      webViewLink: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
    };
  }

  const body: Record<string, unknown> = {
    name: cleanName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];

  const createRes = await fetchWithRetry(`${DRIVE_API}?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    throw new Error(`Drive folder create failed (${createRes.status}): ${await createRes.text()}`);
  }
  const created = await createRes.json();
  return {
    id: created.id,
    name: created.name,
    webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function verifyOrCreateSpreadsheet(
  accessToken: string,
  folderId: string,
  title: string,
  tabName: string,
  existingRef?: GoogleSheetRef
): Promise<GoogleSheetRef> {
  if (existingRef?.id) {
    const checkRes = await fetchWithRetry(
      `${DRIVE_API}/${encodeURIComponent(existingRef.id)}?fields=id,name,trashed,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkRes.ok) {
      const meta = await checkRes.json();
      if (!meta.trashed) {
        return {
          ...existingRef,
          title,
          url: meta.webViewLink || existingRef.url,
        };
      }
    }
  }

  const escaped = title.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.spreadsheet' and name='${escaped}' and '${folderId}' in parents and trashed=false`;
  const searchRes = await fetchWithRetry(
    `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=3`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files?.length > 0) {
      const f = data.files[0];
      return {
        id: f.id,
        title,
        url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}`,
        lastHash: existingRef?.lastHash,
        lastSyncedAt: existingRef?.lastSyncedAt,
      };
    }
  }

  const createRes = await fetchWithRetry(SHEETS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: tabName } }],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Spreadsheet create failed (${createRes.status}): ${await createRes.text()}`);
  }
  const created = await createRes.json();
  const id: string = created.spreadsheetId;
  const url: string = created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}`;

  const metaRes = await fetchWithRetry(`${DRIVE_API}/${id}?fields=parents`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (metaRes.ok) {
    const meta = await metaRes.json();
    const prevParents = (meta.parents || []).join(',');
    await fetchWithRetry(
      `${DRIVE_API}/${id}?addParents=${encodeURIComponent(folderId)}${prevParents ? `&removeParents=${encodeURIComponent(prevParents)}` : ''
      }`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
  }

  return { id, url, title };
}

export async function ensureLedgerDriveWorkspace(
  accessToken: string,
  state: LedgerState
): Promise<LedgerWorkspaceRefs> {
  const folderName = state.config.driveFolderName || 'ATCL_GL_Registers';
  const existingSync = state.config.googleLedgerSync;
  let folderId = existingSync?.folderId;
  let folderUrl = existingSync?.folderUrl;

  if (folderId) {
    const checkFolder = await fetchWithRetry(
      `${DRIVE_API}/${encodeURIComponent(folderId)}?fields=id,name,trashed,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkFolder.ok) {
      const f = await checkFolder.json();
      if (!f.trashed) {
        folderUrl = f.webViewLink || folderUrl;
      } else {
        folderId = undefined;
      }
    } else {
      folderId = undefined;
    }
  }

  if (!folderId) {
    const folder = await findOrCreateDriveFolder(accessToken, folderName);
    folderId = folder.id;
    folderUrl = folder.webViewLink;
  }

  const prefix = state.config.organizationName || 'ATCL';
  const [coa, postedTx, registerSummary] = await Promise.all([
    verifyOrCreateSpreadsheet(
      accessToken,
      folderId,
      `${prefix} - Chart of Accounts`,
      'Chart_of_Accounts',
      existingSync?.sheets?.coa
    ),
    verifyOrCreateSpreadsheet(
      accessToken,
      folderId,
      `${prefix} - Posted Transactions`,
      'Posted_Transactions',
      existingSync?.sheets?.postedTx
    ),
    verifyOrCreateSpreadsheet(
      accessToken,
      folderId,
      `${prefix} - GL Register Summary`,
      'GL_Register_Summary',
      existingSync?.sheets?.registerSummary
    ),
  ]);

  return {
    folderId,
    folderUrl: folderUrl || `https://drive.google.com/drive/folders/${folderId}`,
    folderName,
    sheets: { coa, postedTx, registerSummary },
  };
}

function buildCoaRows(state: LedgerState): string[][] {
  const header = [
    'Code',
    'Account Name',
    'Category',
    'Group',
    'Normal Balance',
    'Opening Balance',
    'Status',
    'Last Synced',
    'Row Hash',
  ];
  const now = new Date().toISOString();
  const rows = state.accounts.map((a) => {
    const base = [a.code, a.name, a.category, a.group, a.normalBalance, a.openingBalance, a.status];
    return [...base.map(String), now, computeRowHash(base)];
  });
  return [header, ...rows];
}

function buildPostedTxRows(state: LedgerState): string[][] {
  const header = [
    'Tx ID',
    'Voucher No',
    'Date',
    'GL Code',
    'GL Name',
    'Description',
    'Counterparty',
    'Debit',
    'Credit',
    'Reference',
    'Posting Status',
    'Row Hash',
  ];
  const rows = state.postedTransactions.slice(0, 1000).map((t) => {
    const base = [
      t.journalId,
      t.voucherNo,
      t.date,
      t.glCode,
      t.glName,
      t.description,
      t.counterparty || '',
      round2(t.debit),
      round2(t.credit),
      t.reference || '',
      'POSTED',
    ];
    return [...base.map(String), computeRowHash(base)];
  });
  return [header, ...rows];
}

function buildRegisterSummaryRows(state: LedgerState): string[][] {
  const header = [
    'GL Code',
    'Account Name',
    'Category',
    'Opening Balance',
    'Total Debit',
    'Total Credit',
    'Closing Balance',
    'Entry Count',
    'Row Hash',
  ];
  const registerList = Object.values(state.registers || {});
  const rows = registerList.map((r) => {
    const acc = state.accounts.find((a) => a.code === r.glCode);
    const entries = r.entries || [];
    const totalDebit = round2(entries.reduce((s, e) => s + (Number(e.debit) || 0), 0));
    const totalCredit = round2(entries.reduce((s, e) => s + (Number(e.credit) || 0), 0));
    const opening = round2(acc?.openingBalance || 0);
    const closing = round2(
      acc?.normalBalance === 'Credit'
        ? opening + totalCredit - totalDebit
        : opening + totalDebit - totalCredit
    );
    const base = [
      r.glCode,
      acc?.name || r.fileName || r.glCode,
      acc?.category || 'Asset',
      opening,
      totalDebit,
      totalCredit,
      closing,
      entries.length,
    ];
    return [...base.map(String), computeRowHash(base)];
  });
  return [header, ...rows];
}

async function writeSheetTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  values: string[][]
): Promise<void> {
  await fetchWithRetry(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A1:Z2000`)}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const res = await fetchWithRetry(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A1`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );
  if (!res.ok) {
    throw new Error(`Failed writing ${tabName} (${res.status}): ${await res.text()}`);
  }
}

async function readSheetTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string
): Promise<string[][]> {
  const res = await fetchWithRetry(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A1:Z2000`)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed reading ${tabName} (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data.values) ? data.values : [];
}

function appendSyncHistory(
  prev: SyncAuditRecord[] | undefined,
  entry: Omit<SyncAuditRecord, 'id' | 'timestamp'>
): SyncAuditRecord[] {
  const record: SyncAuditRecord = {
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  return [record, ...(prev || [])].slice(0, 100);
}

export async function pushLedgerToGoogleSheets(
  accessToken: string,
  state: LedgerState,
  userEmail: string,
  forceAll = false
): Promise<BidirectionalSyncOutcome> {
  const workspace = await ensureLedgerDriveWorkspace(accessToken, state);
  const coaValues = buildCoaRows(state);
  const txValues = buildPostedTxRows(state);
  const regValues = buildRegisterSummaryRows(state);

  const coaHash = hashString(JSON.stringify(coaValues));
  const txHash = hashString(JSON.stringify(txValues));
  const regHash = hashString(JSON.stringify(regValues));

  const now = new Date().toISOString();
  let sheetsUpdated = 0;

  if (forceAll || workspace.sheets.coa.lastHash !== coaHash) {
    await writeSheetTab(accessToken, workspace.sheets.coa.id, 'Chart_of_Accounts', coaValues);
    workspace.sheets.coa.lastHash = coaHash;
    workspace.sheets.coa.lastSyncedAt = now;
    sheetsUpdated++;
  }
  if (forceAll || workspace.sheets.postedTx.lastHash !== txHash) {
    await writeSheetTab(accessToken, workspace.sheets.postedTx.id, 'Posted_Transactions', txValues);
    workspace.sheets.postedTx.lastHash = txHash;
    workspace.sheets.postedTx.lastSyncedAt = now;
    sheetsUpdated++;
  }
  if (forceAll || workspace.sheets.registerSummary.lastHash !== regHash) {
    await writeSheetTab(
      accessToken,
      workspace.sheets.registerSummary.id,
      'GL_Register_Summary',
      regValues
    );
    workspace.sheets.registerSummary.lastHash = regHash;
    workspace.sheets.registerSummary.lastSyncedAt = now;
    sheetsUpdated++;
  }

  const nextState: LedgerState = structuredClone(state);
  const prevSync = nextState.config.googleLedgerSync;
  const hasConflicts = (prevSync?.pendingConflicts?.length || 0) > 0;

  const history =
    sheetsUpdated > 0
      ? appendSyncHistory(prevSync?.syncHistory, {
        direction: 'SYSTEM_TO_SHEET',
        sheet: `${sheetsUpdated} sheet(s)`,
        recordKey: 'BATCH',
        originalValue: prevSync?.lastSyncAt || '—',
        updatedValue: `${state.accounts.length} COA, ${state.postedTransactions.length} Posted Tx`,
        user: userEmail,
        status: 'SUCCESS',
        summary: `Pushed ${sheetsUpdated} updated Google Sheet(s) inside "${workspace.folderName}".`,
      })
      : prevSync?.syncHistory || [];

  const syncConfig: GoogleLedgerSyncConfig = {
    folderId: workspace.folderId,
    folderUrl: workspace.folderUrl,
    folderName: workspace.folderName,
    connectedEmail: userEmail,
    status: hasConflicts ? 'Conflict' : 'Synced',
    lastSyncAt: now,
    lastReverseSyncAt: prevSync?.lastReverseSyncAt || null,
    lastError: null,
    sheets: workspace.sheets,
    pendingConflicts: prevSync?.pendingConflicts || [],
    syncHistory: history,
  };

  nextState.config.lastSyncTimestamp = now;
  nextState.config.googleLedgerSync = syncConfig;
  if (sheetsUpdated > 0) {
    appendAuditLog(
      nextState,
      'GOOGLE_SYNC',
      'SYSTEM_TO_SHEET',
      `Synchronized ${sheetsUpdated} Master Ledger Google Sheet(s) to Drive folder "${workspace.folderName}".`,
      'SUCCESS'
    );
  }

  return {
    nextState,
    summary:
      sheetsUpdated > 0
        ? `Synced ${sheetsUpdated} Google Sheet(s) with Master Ledger.`
        : 'All 3 Google Sheets are already up to date.',
    conflictsAdded: 0,
    appliedCount: sheetsUpdated,
  };
}

export async function pullAndValidateSheetChanges(
  accessToken: string,
  state: LedgerState,
  userEmail: string
): Promise<BidirectionalSyncOutcome> {
  const workspace = await ensureLedgerDriveWorkspace(accessToken, state);
  const [coaRows, txRows, regRows] = await Promise.all([
    readSheetTab(accessToken, workspace.sheets.coa.id, 'Chart_of_Accounts'),
    readSheetTab(accessToken, workspace.sheets.postedTx.id, 'Posted_Transactions'),
    readSheetTab(accessToken, workspace.sheets.registerSummary.id, 'GL_Register_Summary'),
  ]);

  const nextState: LedgerState = structuredClone(state);
  const prevSync = nextState.config.googleLedgerSync;
  const conflicts: SyncConflictItem[] = [...(prevSync?.pendingConflicts || [])];
  let history = [...(prevSync?.syncHistory || [])];
  let appliedCount = 0;
  let conflictsAdded = 0;

  const pushConflict = (c: Omit<SyncConflictItem, 'id' | 'detectedAt'>) => {
    const dup = conflicts.some(
      (existing) => existing.sheet === c.sheet && existing.recordKey === c.recordKey && existing.field === c.field
    );
    if (!dup) {
      conflicts.push({
        id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        detectedAt: new Date().toISOString(),
        ...c,
      });
      conflictsAdded++;
    }
  };

  // 1. Validate & import permitted Chart of Accounts changes
  const validCategories = new Set(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
  const coaData = coaRows.slice(1).filter((r) => r[0]?.trim());
  for (const row of coaData) {
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const category = String(row[2] || '').trim() as AccountCategory;
    const group = String(row[3] || 'General').trim();
    const normalBalance = String(row[4] || 'Debit').trim() === 'Credit' ? 'Credit' : 'Debit';
    const openingBalance = round2(Number(row[5]) || 0);
    const status: AccountStatus = String(row[6] || 'Active').trim() === 'Inactive' ? 'Inactive' : 'Active';
    const rowHashInSheet = String(row[8] || '').trim();
    const computedCurrentSheetHash = computeRowHash([
      code,
      name,
      category,
      group,
      normalBalance,
      openingBalance,
      status,
    ]);

    const existing = nextState.accounts.find((a) => a.code === code);
    if (!existing) {
      if (!validCategories.has(category) || !name) {
        pushConflict({
          sheet: 'Chart of Accounts',
          recordKey: code,
          field: 'Category / Name',
          appValue: 'Not in Master COA',
          sheetValue: `${name} (${category})`,
          actionType: 'COA_CONFLICT',
          message: `Invalid new account "${code}" in Google Sheet (requires valid Category & Account Name).`,
          rawRow: row,
        });
        continue;
      }
      const added: GLAccount = {
        code,
        name,
        category,
        group,
        openingBalance,
        normalBalance,
        registerFileId: null,
        registerFileName: null,
        status,
        lastSyncedAt: new Date().toISOString(),
      };
      nextState.accounts.push(added);
      appliedCount++;
      history = appendSyncHistory(history, {
        direction: 'SHEET_TO_SYSTEM',
        sheet: 'Chart of Accounts',
        recordKey: code,
        originalValue: 'None',
        updatedValue: `${code} - ${name} (${category})`,
        user: userEmail,
        status: 'SUCCESS',
        summary: `Imported new account ${code} from Google Sheet.`,
      });
    } else if (
      existing.name !== name ||
      existing.group !== group ||
      existing.status !== status
    ) {
      const hasPosted = nextState.postedTransactions.some((t) => t.glCode === code);
      if (hasPosted && existing.category !== category) {
        pushConflict({
          sheet: 'Chart of Accounts',
          recordKey: code,
          field: 'Category',
          appValue: existing.category,
          sheetValue: category,
          actionType: 'COA_CONFLICT',
          message: `Account ${code} has posted transactions; Category cannot be changed directly.`,
          rawRow: row,
        });
      } else if (rowHashInSheet && rowHashInSheet !== computedCurrentSheetHash) {
        const oldVal = `${existing.name} | ${existing.group} | ${existing.status}`;
        const newVal = `${name} | ${group} | ${status}`;
        existing.name = name || existing.name;
        existing.group = group || existing.group;
        existing.status = status;
        existing.lastSyncedAt = new Date().toISOString();
        appliedCount++;
        history = appendSyncHistory(history, {
          direction: 'SHEET_TO_SYSTEM',
          sheet: 'Chart of Accounts',
          recordKey: code,
          originalValue: oldVal,
          updatedValue: newVal,
          user: userEmail,
          status: 'SUCCESS',
          summary: `Updated COA metadata for ${code} from Google Sheet.`,
        });
      }
    }
  }

  // 2. Inspect Posted Transactions (NEVER overwrite/delete posted records; stage new valid vouchers)
  const txData = txRows.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
  const seenPostedIds = new Set<string>();
  const newVoucherGroups = new Map<string, string[][]>();

  for (const row of txData) {
    const txId = String(row[0] || '').trim();
    const voucherNo = String(row[1] || '').trim();
    const existingTx = txId ? nextState.postedTransactions.find((t) => t.journalId === txId) : undefined;

    if (existingTx) {
      seenPostedIds.add(existingTx.journalId);
      const sheetDebit = round2(Number(row[7]) || 0);
      const sheetCredit = round2(Number(row[8]) || 0);
      const sheetGl = String(row[3] || '').trim();
      const sheetDesc = String(row[5] || '').trim();
      if (
        sheetDebit !== round2(existingTx.debit) ||
        sheetCredit !== round2(existingTx.credit) ||
        sheetGl !== existingTx.glCode ||
        sheetDesc !== existingTx.description
      ) {
        pushConflict({
          sheet: 'Posted Transactions',
          recordKey: existingTx.journalId,
          field: `${existingTx.voucherNo} (${existingTx.glCode})`,
          appValue: `Dr ${existingTx.debit} / Cr ${existingTx.credit} — ${existingTx.description}`,
          sheetValue: `Dr ${sheetDebit} / Cr ${sheetCredit} — ${sheetDesc}`,
          actionType: 'REVERSAL_PROPOSAL',
          message: `Posted transaction ${existingTx.journalId} cannot be edited directly. Stage a controlled reversal/adjustment instead.`,
          rawRow: row,
        });
        history = appendSyncHistory(history, {
          direction: 'SHEET_TO_SYSTEM',
          sheet: 'Posted Transactions',
          recordKey: existingTx.journalId,
          originalValue: `Dr ${existingTx.debit} / Cr ${existingTx.credit}`,
          updatedValue: `Dr ${sheetDebit} / Cr ${sheetCredit}`,
          user: userEmail,
          status: 'BLOCKED',
          summary: `Blocked direct edit on posted tx ${existingTx.journalId}; queued reversal proposal.`,
        });
      }
    } else if (voucherNo) {
      const group = newVoucherGroups.get(voucherNo) || [];
      group.push(row);
      newVoucherGroups.set(voucherNo, group);
    }
  }

  // Stage any brand-new balanced vouchers added in Google Sheet as PENDING_APPROVAL
  for (const [voucherNo, lines] of newVoucherGroups.entries()) {
    const alreadyInJournal = nextState.journalLines.some((j) => j.voucherNo === voucherNo);
    if (alreadyInJournal) continue;

    let sumDr = 0;
    let sumCr = 0;
    let invalidReason = '';
    const stagedLines: JournalLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const r = lines[i];
      const date = String(r[2] || new Date().toISOString().slice(0, 10)).trim();
      const glCode = String(r[3] || '').trim();
      const acc = nextState.accounts.find((a) => a.code === glCode && a.status === 'Active');
      const debit = round2(Number(r[7]) || 0);
      const credit = round2(Number(r[8]) || 0);
      if (!acc) {
        invalidReason = `Inactive or unknown GL Code "${glCode}"`;
        break;
      }
      if (debit < 0 || credit < 0 || (debit === 0 && credit === 0)) {
        invalidReason = `Invalid debit/credit amounts on line ${i + 1}`;
        break;
      }
      sumDr = round2(sumDr + debit);
      sumCr = round2(sumCr + credit);
      stagedLines.push({
        journalId: `je_gs_${Date.now()}_${i}`,
        date,
        voucherNo,
        description: String(r[5] || `Imported from Google Sheet`).trim(),
        glCode,
        glName: acc.name,
        debit,
        credit,
        reference: String(r[9] || 'GSHEET-IMPORT').trim(),
        counterparty: String(r[6] || '').trim(),
        enteredBy: userEmail,
        approvalStatus: 'PENDING_APPROVAL',
        postingStatus: 'UNPOSTED',
        validationRemarks: 'Imported from Google Sheet (awaiting approval)',
      });
    }

    if (!invalidReason && Math.abs(sumDr - sumCr) > 0.01) {
      invalidReason = `Unbalanced voucher (Dr ${sumDr} != Cr ${sumCr})`;
    }

    if (invalidReason) {
      pushConflict({
        sheet: 'Posted Transactions',
        recordKey: voucherNo,
        field: 'New Voucher Validation',
        appValue: 'Not in Journal',
        sheetValue: `Dr ${sumDr} / Cr ${sumCr}`,
        actionType: 'COA_CONFLICT',
        message: `Rejected new sheet voucher ${voucherNo}: ${invalidReason}.`,
      });
    } else if (stagedLines.length > 0) {
      nextState.journalLines.push(...stagedLines);
      appliedCount++;
      history = appendSyncHistory(history, {
        direction: 'SHEET_TO_SYSTEM',
        sheet: 'Posted Transactions',
        recordKey: voucherNo,
        originalValue: 'None',
        updatedValue: `${stagedLines.length} line(s), Dr/Cr ${sumDr}`,
        user: userEmail,
        status: 'SUCCESS',
        summary: `Staged new balanced voucher ${voucherNo} as PENDING_APPROVAL from Google Sheet.`,
      });
    }
  }

  // 3. Validate GL Register Summary (system-calculated report only)
  const expectedReg = buildRegisterSummaryRows(nextState).slice(1);
  const expectedMap = new Map(expectedReg.map((r) => [r[0], r]));
  for (const row of regRows.slice(1)) {
    const glCode = String(row[0] || '').trim();
    const expected = expectedMap.get(glCode);
    if (!expected) continue;
    const sheetClosing = round2(Number(row[6]) || 0);
    const appClosing = round2(Number(expected[6]) || 0);
    if (Math.abs(sheetClosing - appClosing) > 0.01) {
      pushConflict({
        sheet: 'GL Register Summary',
        recordKey: glCode,
        field: 'Closing Balance',
        appValue: String(appClosing),
        sheetValue: String(sheetClosing),
        actionType: 'REPORT_DISCREPANCY',
        message: `GL Register Summary is system-calculated. Manual sheet balance (${sheetClosing}) differs from ledger (${appClosing}).`,
      });
    }
  }

  const now = new Date().toISOString();
  nextState.config.googleLedgerSync = {
    folderId: workspace.folderId,
    folderUrl: workspace.folderUrl,
    folderName: workspace.folderName,
    connectedEmail: userEmail,
    status: conflicts.length > 0 ? 'Conflict' : 'Synced',
    lastSyncAt: prevSync?.lastSyncAt || null,
    lastReverseSyncAt: now,
    lastError: null,
    sheets: workspace.sheets,
    pendingConflicts: conflicts,
    syncHistory: history,
  };

  appendAuditLog(
    nextState,
    'GOOGLE_SYNC',
    'SHEET_TO_SYSTEM',
    `Reverse sync inspected 3 sheets: ${appliedCount} change(s) applied/staged, ${conflictsAdded} new conflict(s)/proposal(s).`,
    conflictsAdded > 0 ? 'ALERT' : 'SUCCESS'
  );

  return {
    nextState,
    summary: `Reverse sync complete: ${appliedCount} applied/staged, ${conflicts.length} active conflict(s).`,
    conflictsAdded,
    appliedCount,
  };
}

export function resolveSyncConflict(
  state: LedgerState,
  conflictId: string,
  resolution: 'KEEP_SYSTEM' | 'APPLY_SHEET' | 'STAGE_REVERSAL',
  userEmail: string
): LedgerState {
  const nextState: LedgerState = structuredClone(state);
  const sync = nextState.config.googleLedgerSync;
  if (!sync?.pendingConflicts) return nextState;

  const conflict = sync.pendingConflicts.find((c) => c.id === conflictId);
  if (!conflict) return nextState;

  if (resolution === 'STAGE_REVERSAL' && conflict.sheet === 'Posted Transactions') {
    const tx = nextState.postedTransactions.find((t) => t.journalId === conflict.recordKey);
    if (tx) {
      const revVoucher = `REV-${tx.voucherNo}`;
      nextState.journalLines.push({
        journalId: `je_rev_${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        voucherNo: revVoucher,
        description: `Controlled reversal for Google Sheet edit on ${tx.journalId}`,
        glCode: tx.glCode,
        glName: tx.glName,
        debit: round2(tx.credit),
        credit: round2(tx.debit),
        reference: tx.voucherNo,
        counterparty: tx.counterparty,
        enteredBy: userEmail,
        approvalStatus: 'PENDING_APPROVAL',
        postingStatus: 'UNPOSTED',
        validationRemarks: 'Staged from Google Sheet conflict resolution',
      });
    }
  } else if (resolution === 'APPLY_SHEET' && conflict.sheet === 'Chart of Accounts' && conflict.rawRow) {
    const acc = nextState.accounts.find((a) => a.code === conflict.recordKey);
    if (acc) {
      acc.name = String(conflict.rawRow[1] || acc.name);
      acc.group = String(conflict.rawRow[3] || acc.group);
      acc.status = String(conflict.rawRow[6]) === 'Inactive' ? 'Inactive' : 'Active';
    }
  }

  sync.pendingConflicts = sync.pendingConflicts.filter((c) => c.id !== conflictId);
  sync.status = sync.pendingConflicts.length > 0 ? 'Conflict' : 'Pending';
  sync.syncHistory = appendSyncHistory(sync.syncHistory, {
    direction: 'CONFLICT_RESOLUTION',
    sheet: conflict.sheet,
    recordKey: conflict.recordKey,
    originalValue: conflict.appValue,
    updatedValue: resolution === 'KEEP_SYSTEM' ? conflict.appValue : conflict.sheetValue,
    user: userEmail,
    status: 'SUCCESS',
    summary: `Resolved ${conflict.recordKey} (${conflict.field}) via ${resolution}.`,
  });

  appendAuditLog(
    nextState,
    'GOOGLE_SYNC',
    'CONFLICT_RESOLVED',
    `Resolved sync conflict on ${conflict.sheet} [${conflict.recordKey}] via ${resolution}.`,
    'SUCCESS'
  );

  return nextState;
}

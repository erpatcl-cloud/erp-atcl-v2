import { appendAuditLog, round2 } from '../engine/accountingEngine.ts';
import { findOrCreateDriveFolder } from './googleLedgerSync.ts';
import type {
  AccountCategory,
  AccountStatus,
  CustomerRecord,
  CustomerSegment,
  GLAccount,
  GoogleMasterWorkbookConfig,
  JournalLine,
  LedgerState,
  MasterTabSyncMeta,
  MasterWorkbookTabId,
  ProductItem,
  ProductItemType,
  SparePartCategory,
  SparePartItem,
  SupplierRecord,
  SupplierType,
  SyncAuditRecord,
  SyncConflictItem,
} from '../types/accounting.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const MASTER_WORKBOOK_TITLE = 'ATCL ERP — Master Data & Accounting Ledger';

export interface MasterTabSpec {
  no: string;
  tabId: MasterWorkbookTabId;
  sheetName: string;
  moduleLabel: string;
  routePath: string;
  permanentKey: string;
  reversePolicy: string;
}

export const MASTER_WORKBOOK_TABS: MasterTabSpec[] = [
  { no: '01', tabId: 'coa', sheetName: 'Chart of Accounts', moduleLabel: 'Accounting — Chart of Accounts', routePath: '/coa', permanentKey: 'code', reversePolicy: 'Permitted: Add/Update Name, Group, Status' },
  { no: '02', tabId: 'postedTx', sheetName: 'Posted Transactions', moduleLabel: 'Accounting — Posted Transactions', routePath: '/journal', permanentKey: 'journalId', reversePolicy: 'Protected: Edits → Reversal; New balanced → Pending' },
  { no: '03', tabId: 'registerSummary', sheetName: 'GL Register Summary', moduleLabel: 'Accounting — General Ledger', routePath: '/registers', permanentKey: 'glCode', reversePolicy: 'Read-Only Report: Edits flagged as Discrepancy' },
  { no: '04', tabId: 'products', sheetName: 'Products', moduleLabel: 'Products Catalog', routePath: '/products', permanentKey: 'id', reversePolicy: 'Permitted: Catalog & Pricing (Stock protected)' },
  { no: '05', tabId: 'customers', sheetName: 'Customers', moduleLabel: 'Customers Directory', routePath: '/customers', permanentKey: 'id', reversePolicy: 'Permitted: Add/Update Profile & Credit Limit' },
  { no: '06', tabId: 'suppliers', sheetName: 'Suppliers', moduleLabel: 'Suppliers Directory', routePath: '/suppliers', permanentKey: 'id', reversePolicy: 'Permitted: Add/Update Profile & Terms' },
  { no: '07', tabId: 'localPOs', sheetName: 'Local Procurement', moduleLabel: 'Local Procurement (PO)', routePath: '/local-procurement', permanentKey: 'id', reversePolicy: 'Draft POs editable; Approved/Settled locked' },
  { no: '08', tabId: 'importLCs', sheetName: 'Import & LC', moduleLabel: 'Import & LC Files', routePath: '/import-lc', permanentKey: 'id', reversePolicy: 'Opened LC notes editable; Settled/Released locked' },
  { no: '09', tabId: 'inventorySerials', sheetName: 'Inventory & Serial', moduleLabel: 'Inventory & Serial Units', routePath: '/inventory-serial', permanentKey: 'id', reversePolicy: 'Metadata/Notes editable; Stock status protected' },
  { no: '10', tabId: 'salesOrders', sheetName: 'Sales & Distribution', moduleLabel: 'Sales & Distribution', routePath: '/sales-distribution', permanentKey: 'id', reversePolicy: 'Quotation/Draft editable; Invoiced/Collected locked' },
  { no: '11', tabId: 'posTransactions', sheetName: 'Retail POS', moduleLabel: 'Retail POS Receipts', routePath: '/retail-pos', permanentKey: 'id', reversePolicy: 'Protected: Finalized POS receipts immutable' },
  { no: '12', tabId: 'warrantyClaims', sheetName: 'Warranty', moduleLabel: 'Warranty & RMA Claims', routePath: '/warranty', permanentKey: 'id', reversePolicy: 'Logged/Inspection editable; Approved/Resolved locked' },
  { no: '13', tabId: 'serviceJobs', sheetName: 'Service Workshop', moduleLabel: 'Service Workshop Jobs', routePath: '/service-workshop', permanentKey: 'id', reversePolicy: 'Open job notes/dates editable; Completed locked' },
  { no: '14', tabId: 'spareParts', sheetName: 'Spare Parts', moduleLabel: 'Spare Parts Inventory', routePath: '/spare-parts', permanentKey: 'id', reversePolicy: 'Permitted: Catalog & Min Stock (StockQty protected)' },
  { no: '15', tabId: 'vouchers', sheetName: 'Vouchers', moduleLabel: 'Accounting Vouchers', routePath: '/vouchers', permanentKey: 'id', reversePolicy: 'Protected: Posted/Auto-Approved vouchers locked' },
];

export interface MasterSyncOutcome {
  nextState: LedgerState;
  summary: string;
  tabsUpdated: number;
  appliedCount: number;
  conflictsAdded: number;
}

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function computeRowHash(cells: Array<string | number | boolean | null | undefined>): string {
  return hashString(cells.map((c) => String(c ?? '')).join('|'));
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
      attempt++;
      continue;
    }
    return res;
  }
}

function appendSyncHistory(
  prev: SyncAuditRecord[] | undefined,
  entry: Omit<SyncAuditRecord, 'id' | 'timestamp'>
): SyncAuditRecord[] {
  const record: SyncAuditRecord = {
    id: `msync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  return [record, ...(prev || [])].slice(0, 120);
}

export async function checkWorkbookDriveModified(
  accessToken: string,
  workbookId: string
): Promise<string | null> {
  const res = await fetchWithRetry(
    `${DRIVE_API}/${encodeURIComponent(workbookId)}?fields=modifiedTime,trashed`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.trashed) return null;
  return data.modifiedTime || null;
}

export async function ensureMasterWorkbook(
  accessToken: string,
  state: LedgerState
): Promise<{
  folderId: string;
  folderUrl: string;
  folderName: string;
  workbookId: string;
  workbookUrl: string;
  tabGids: Record<string, number>;
}> {
  const folderName = state.config.driveFolderName || 'ATCL_GL_Registers';
  const prev = state.config.googleMasterSync;

  let folderId = prev?.folderId;
  let folderUrl = prev?.folderUrl;
  if (folderId) {
    const fRes = await fetchWithRetry(
      `${DRIVE_API}/${encodeURIComponent(folderId)}?fields=id,trashed,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (fRes.ok) {
      const fMeta = await fRes.json();
      if (!fMeta.trashed) folderUrl = fMeta.webViewLink || folderUrl;
      else folderId = undefined;
    } else {
      folderId = undefined;
    }
  }
  if (!folderId) {
    const folder = await findOrCreateDriveFolder(accessToken, folderName);
    folderId = folder.id;
    folderUrl = folder.webViewLink;
  }

  let workbookId = prev?.workbookId;
  let workbookUrl = prev?.workbookUrl;

  if (workbookId) {
    const wRes = await fetchWithRetry(
      `${DRIVE_API}/${encodeURIComponent(workbookId)}?fields=id,trashed,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (wRes.ok) {
      const wMeta = await wRes.json();
      if (!wMeta.trashed) workbookUrl = wMeta.webViewLink || workbookUrl;
      else workbookId = undefined;
    } else {
      workbookId = undefined;
    }
  }

  if (!workbookId) {
    const escaped = MASTER_WORKBOOK_TITLE.replace(/'/g, "\\'");
    const q = `mimeType='application/vnd.google-apps.spreadsheet' and name='${escaped}' and '${folderId}' in parents and trashed=false`;
    const searchRes = await fetchWithRetry(
      `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=3`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (searchRes.ok) {
      const sData = await searchRes.json();
      if (sData.files?.length > 0) {
        workbookId = sData.files[0].id;
        workbookUrl = sData.files[0].webViewLink || `https://docs.google.com/spreadsheets/d/${workbookId}`;
      }
    }
  }

  if (!workbookId) {
    const createRes = await fetchWithRetry(SHEETS_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: MASTER_WORKBOOK_TITLE },
        sheets: MASTER_WORKBOOK_TABS.map((t) => ({ properties: { title: t.sheetName } })),
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed creating Master Workbook (${createRes.status}): ${await createRes.text()}`);
    }
    const created = await createRes.json();
    workbookId = created.spreadsheetId;
    workbookUrl = created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${workbookId}`;

    // Move into designated Drive folder
    const metaRes = await fetchWithRetry(`${DRIVE_API}/${workbookId}?fields=parents`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      const prevParents = (meta.parents || []).join(',');
      await fetchWithRetry(
        `${DRIVE_API}/${workbookId}?addParents=${encodeURIComponent(folderId)}${
          prevParents ? `&removeParents=${encodeURIComponent(prevParents)}` : ''
        }`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` } }
      );
    }
  }

  // Verify all 15 tabs exist and collect their sheetId (gid)
  const metaRes = await fetchWithRetry(
    `${SHEETS_API}/${encodeURIComponent(workbookId!)}?fields=sheets.properties(sheetId,title)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) {
    throw new Error(`Failed reading workbook tabs (${metaRes.status}): ${await metaRes.text()}`);
  }
  const metaJson = await metaRes.json();
  const existingSheets: Array<{ sheetId: number; title: string }> = (metaJson.sheets || []).map(
    (s: any) => s.properties
  );
  const existingTitles = new Set(existingSheets.map((s) => s.title));
  const missingTabs = MASTER_WORKBOOK_TABS.filter((t) => !existingTitles.has(t.sheetName));

  if (missingTabs.length > 0) {
    const batchAdd = await fetchWithRetry(
      `${SHEETS_API}/${encodeURIComponent(workbookId!)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingTabs.map((t) => ({ addSheet: { properties: { title: t.sheetName } } })),
        }),
      }
    );
    if (batchAdd.ok) {
      const addedJson = await batchAdd.json();
      (addedJson.replies || []).forEach((r: any) => {
        if (r.addSheet?.properties) existingSheets.push(r.addSheet.properties);
      });
    }
  }

  const tabGids: Record<string, number> = {};
  existingSheets.forEach((s) => {
    tabGids[s.title] = s.sheetId;
  });

  return {
    folderId,
    folderUrl: folderUrl || `https://drive.google.com/drive/folders/${folderId}`,
    folderName,
    workbookId: workbookId!,
    workbookUrl: workbookUrl || `https://docs.google.com/spreadsheets/d/${workbookId}`,
    tabGids,
  };
}

function serializeTabRows(tabId: MasterWorkbookTabId, state: LedgerState): { rows: string[][]; count: number } {
  const now = new Date().toISOString();
  switch (tabId) {
    case 'coa': {
      const h = ['Code', 'Account Name', 'Category', 'Group', 'Normal Balance', 'Opening Balance', 'Status', 'Last Synced', 'Row Hash'];
      const r = state.accounts.map((a) => {
        const b = [a.code, a.name, a.category, a.group, a.normalBalance, a.openingBalance, a.status];
        return [...b.map(String), now, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'postedTx': {
      const h = ['Tx ID', 'Voucher No', 'Date', 'GL Code', 'GL Name', 'Description', 'Counterparty', 'Debit', 'Credit', 'Reference', 'Posting Status', 'Row Hash'];
      const r = state.postedTransactions.slice(0, 1500).map((t) => {
        const b = [t.journalId, t.voucherNo, t.date, t.glCode, t.glName, t.description, t.counterparty || '', round2(t.debit), round2(t.credit), t.reference || '', 'POSTED'];
        return [...b.map(String), computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'registerSummary': {
      const h = ['GL Code', 'Account Name', 'Category', 'Opening Balance', 'Total Debit', 'Total Credit', 'Closing Balance', 'Entry Count', 'Row Hash'];
      const regs = Object.values(state.registers || {});
      const r = regs.map((reg) => {
        const acc = state.accounts.find((a) => a.code === reg.glCode);
        const entries = reg.entries || [];
        const dr = round2(entries.reduce((s, e) => s + (Number(e.debit) || 0), 0));
        const cr = round2(entries.reduce((s, e) => s + (Number(e.credit) || 0), 0));
        const op = round2(acc?.openingBalance || 0);
        const cl = round2(acc?.normalBalance === 'Credit' ? op + cr - dr : op + dr - cr);
        const b = [reg.glCode, acc?.name || reg.fileName || reg.glCode, acc?.category || 'Asset', op, dr, cr, cl, entries.length];
        return [...b.map(String), computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'products': {
      const h = ['Product ID', 'SKU', 'Product Name', 'Inventory', 'Category', 'Model / Reference', 'Manufacturer', 'Brand', 'Origin Country', 'Unit/Kg', 'Short Product Details', 'Action', 'Updated At', 'Row Hash'];
      const r = state.products.map((p) => {
        const b = [
          p.id,
          p.sku,
          p.name,
          p.itemType,
          p.category,
          p.modelReference || '',
          p.manufacturer || '',
          p.brand || '',
          p.originCountry || '',
          p.unit,
          p.shortDetails || '',
          p.status,
        ];
        return [...b.map(String), p.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'customers': {
      const h = ['Customer ID', 'Code', 'Name', 'Segment', 'Contact Person', 'Email', 'Phone', 'City', 'BIN Number', 'Payment Terms', 'Credit Limit', 'Current Receivable', 'YTD Revenue', 'Receivable GL', 'Status', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.customers.map((c) => {
        const b = [c.id, c.code, c.name, c.segment, c.contactPerson, c.email, c.phone, c.city, c.binNumber, c.paymentTerms, c.creditLimit, c.currentReceivable, c.ytdRevenue, c.receivableGlCode, c.status, c.notes];
        return [...b.map(String), c.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'suppliers': {
      const h = ['Supplier ID', 'Code', 'Name', 'Supplier Type', 'Country', 'Contact Person', 'Email', 'Phone', 'BIN Number', 'Payment Terms', 'Bank Name', 'Payable Balance', 'YTD Spend', 'Expense GL', 'Status', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.suppliers.map((s) => {
        const b = [s.id, s.code, s.name, s.supplierType, s.country, s.contactPerson, s.email, s.phone, s.binNumber, s.paymentTerms, s.bankName, s.payableBalance, s.ytdSpend, s.expenseGlCode, s.status, s.notes];
        return [...b.map(String), s.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'localPOs': {
      const h = ['PO ID', 'PO Number', 'PO Date', 'Expected Date', 'Supplier ID', 'Supplier Name', 'Category', 'Description', 'Net Amount', 'VAT Amount', 'AIT Amount', 'Gross Amount', 'Paid Amount', 'Expense GL', 'Status', 'GRN Number', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.localPurchaseOrders.map((po) => {
        const b = [po.id, po.poNumber, po.poDate, po.expectedDate, po.supplierId, po.supplierName, po.category, po.description, po.netAmount, po.vatAmount, po.aitAmount, po.grossAmount, po.paidAmount, po.expenseGlCode, po.status, po.grnNumber, po.notes];
        return [...b.map(String), po.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'importLCs': {
      const h = ['LC ID', 'LC Number', 'Open Date', 'Shipment Date', 'Maturity Date', 'Supplier Name', 'Origin Country', 'Issuing Bank', 'LC Type', 'Currency', 'Foreign Amount', 'Exchange Rate', 'BDT Value', 'Total Landed Cost', 'Port', 'Bill of Entry', 'Goods Description', 'Status', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.importLCs.map((lc) => {
        const b = [lc.id, lc.lcNumber, lc.openDate, lc.shipmentDate, lc.maturityDate, lc.supplierName, lc.originCountry, lc.issuingBank, lc.lcType, lc.currency, lc.foreignAmount, lc.exchangeRate, lc.bdtValue, lc.totalLandedCostBdt, lc.portOfDischarge, lc.billOfEntryNo, lc.goodsDescription, lc.status, lc.notes];
        return [...b.map(String), lc.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'inventorySerials': {
      const h = ['Serial ID', 'Serial Number', 'Batch / LC Ref', 'SKU', 'Product Name', 'Category', 'Warehouse Location', 'Stock / Unit', 'Unit Cost', 'Selling Price', 'Margin', 'Stock Value', 'GL Mapping', 'Received Date', 'Warranty Expiry', 'Assigned Customer', 'Project Ref', 'Status', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.inventorySerials.map((u) => {
        const prod = state.products.find((p) => p.sku === u.sku || p.name === u.productName);
        const unitCost = u.unitCost || prod?.unitCost || 0;
        const sellingPrice = prod?.sellingPrice || 0;
        const margin = sellingPrice > 0 ? `${(((sellingPrice - unitCost) / sellingPrice) * 100).toFixed(1)}%` : '0.0%';
        const stockVal = u.status === 'In Stock' || u.status === 'Reserved' ? unitCost : 0;
        const glMap = `${prod?.inventoryGlCode || u.glCode || '1110'} / ${prod?.revenueGlCode || '4010'} / ${prod?.cogsGlCode || '5010'}`;
        const stockUnit = prod ? `${prod.stockQty} ${prod.unit}` : '1 Unit';
        const b = [u.id, u.serialNumber, u.batchOrLcRef, u.sku, u.productName, u.category, u.warehouseLocation, stockUnit, unitCost, sellingPrice, margin, stockVal, glMap, u.receivedDate, u.warrantyExpiry, u.assignedCustomer, u.projectRef, u.status, u.notes];
        return [...b.map(String), u.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'salesOrders': {
      const h = ['Order ID', 'Order No', 'Order Date', 'Delivery Date', 'Customer ID', 'Customer Name', 'Channel', 'Sales Rep', 'Description', 'Net Amount', 'VAT Amount', 'Gross Amount', 'Collected Amount', 'Revenue GL', 'Challan No', 'Status', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.salesOrders.map((so) => {
        const b = [so.id, so.orderNo, so.orderDate, so.deliveryDate, so.customerId, so.customerName, so.channel, so.salesRep, so.description, so.netAmount, so.vatAmount, so.grossAmount, so.collectedAmount, so.revenueGlCode, so.challanNo, so.status, so.notes];
        return [...b.map(String), so.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'posTransactions': {
      const h = ['POS ID', 'Receipt No', 'Sale Date', 'Customer Name', 'Customer Phone', 'Payment Method', 'Settlement GL', 'Items Count', 'Subtotal', 'Discount', 'VAT Amount', 'Grand Total', 'Cashier', 'Status', 'Updated At', 'Row Hash'];
      const r = state.posTransactions.map((p) => {
        const b = [p.id, p.receiptNo, p.saleDate, p.customerName, p.customerPhone, p.paymentMethod, p.settlementGlCode, p.items.length, p.subtotal, p.discountAmount, p.vatAmount, p.grandTotal, p.cashier, p.status];
        return [...b.map(String), p.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'warrantyClaims': {
      const h = ['Claim ID', 'Claim No', 'Claim Date', 'Serial Number', 'SKU', 'Product Name', 'Customer Name', 'Warranty Expiry', 'Coverage Type', 'Issue Summary', 'Claim Cost BDT', 'OEM Recovery BDT', 'Expense GL', 'Status', 'Resolution Notes', 'Updated At', 'Row Hash'];
      const r = state.warrantyClaims.map((w) => {
        const b = [w.id, w.claimNo, w.claimDate, w.serialNumber, w.sku, w.productName, w.customerName, w.warrantyExpiry, w.coverageType, w.issueSummary, w.claimCostBdt, w.oemRecoveryBdt, w.expenseGlCode, w.status, w.resolutionNotes];
        return [...b.map(String), w.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'serviceJobs': {
      const h = ['Job ID', 'Job No', 'Intake Date', 'Promised Date', 'Customer Name', 'Equipment Name', 'Serial Number', 'Service Type', 'Technician', 'Priority', 'Parts Cost', 'Labor Cost', 'Total Cost', 'Billable Amount', 'Expense GL', 'Status', 'Notes', 'Updated At', 'Row Hash'];
      const r = state.serviceJobs.map((j) => {
        const b = [j.id, j.jobNo, j.intakeDate, j.promisedDate, j.customerName, j.equipmentName, j.serialNumber, j.serviceType, j.technician, j.priority, j.partsCostBdt, j.laborCostBdt, j.totalCostBdt, j.billableAmountBdt, j.expenseGlCode, j.status, j.notes];
        return [...b.map(String), j.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'spareParts': {
      const h = ['Part ID', 'Part Code', 'Name', 'Category', 'Compatible System', 'Bin Location', 'Unit', 'Stock Qty', 'Min Stock Level', 'Unit Cost', 'Selling Price', 'GL Code', 'Status', 'Updated At', 'Row Hash'];
      const r = state.spareParts.map((sp) => {
        const b = [sp.id, sp.partCode, sp.name, sp.category, sp.compatibleSystem, sp.binLocation, sp.unit, sp.stockQty, sp.minStockLevel, sp.unitCost, sp.sellingPrice, sp.glCode, sp.status];
        return [...b.map(String), sp.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
    case 'vouchers': {
      const h = ['Voucher ID', 'Voucher Type', 'Voucher Ref', 'Voucher Date', 'Posting Date', 'Status', 'Total Amount', 'Narration', 'Posted To GL', 'Posted Voucher No', 'Created By', 'Updated At', 'Row Hash'];
      const r = state.vouchers.map((v) => {
        const b = [v.id, v.voucherType, v.voucherRef, v.voucherDate, v.postingDate, v.status, v.totalAmount, v.narration, v.postedToGl, v.postedVoucherNo || '', v.createdBy];
        return [...b.map(String), v.updatedAt, computeRowHash(b)];
      });
      return { rows: [h, ...r], count: r.length };
    }
  }
}

export async function pushMasterWorkbook(
  accessToken: string,
  state: LedgerState,
  userEmail: string,
  options?: { tabIds?: MasterWorkbookTabId[]; force?: boolean }
): Promise<MasterSyncOutcome> {
  const wb = await ensureMasterWorkbook(accessToken, state);
  const targetSpecs = options?.tabIds?.length
    ? MASTER_WORKBOOK_TABS.filter((t) => options.tabIds!.includes(t.tabId))
    : MASTER_WORKBOOK_TABS;

  const prevMeta = state.config.googleMasterSync;
  const nextTabs: Partial<Record<MasterWorkbookTabId, MasterTabSyncMeta>> = { ...(prevMeta?.tabs || {}) };
  const valueUpdates: Array<{ range: string; values: string[][] }> = [];
  const clearRanges: string[] = [];
  const now = new Date().toISOString();
  let tabsUpdated = 0;

  for (const spec of targetSpecs) {
    const { rows, count } = serializeTabRows(spec.tabId, state);
    const contentHash = hashString(JSON.stringify(rows.map((r) => r.slice(0, -1))));
    const prevTab = nextTabs[spec.tabId];

    if (options?.force || !prevTab?.lastHash || prevTab.lastHash !== contentHash) {
      clearRanges.push(`${spec.sheetName}!A1:Z3000`);
      valueUpdates.push({ range: `${spec.sheetName}!A1`, values: rows });
      nextTabs[spec.tabId] = {
        tabId: spec.tabId,
        sheetName: spec.sheetName,
        sheetGid: wb.tabGids[spec.sheetName],
        lastHash: contentHash,
        lastSyncedAt: now,
        recordCount: count,
        status: 'Synced',
        lastError: null,
      };
      tabsUpdated++;
    } else {
      nextTabs[spec.tabId] = {
        ...prevTab,
        sheetGid: wb.tabGids[spec.sheetName] ?? prevTab.sheetGid,
        recordCount: count,
        status: prevTab.status === 'Conflict' ? 'Conflict' : 'Synced',
      };
    }
  }

  if (valueUpdates.length > 0) {
    await fetchWithRetry(
      `${SHEETS_API}/${encodeURIComponent(wb.workbookId)}/values:batchClear`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ranges: clearRanges }),
      }
    );

    const updateRes = await fetchWithRetry(
      `${SHEETS_API}/${encodeURIComponent(wb.workbookId)}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: valueUpdates,
        }),
      }
    );
    if (!updateRes.ok) {
      throw new Error(`Master Workbook push failed (${updateRes.status}): ${await updateRes.text()}`);
    }
  }

  const nextState: LedgerState = structuredClone(state);
  const conflicts = prevMeta?.pendingConflicts || [];
  const history =
    tabsUpdated > 0
      ? appendSyncHistory(prevMeta?.syncHistory, {
          direction: 'SYSTEM_TO_SHEET',
          sheet: `${tabsUpdated} tab(s)`,
          recordKey: 'MASTER_WORKBOOK',
          originalValue: prevMeta?.lastSyncAt || '—',
          updatedValue: `${tabsUpdated} tab(s) synced`,
          user: userEmail,
          status: 'SUCCESS',
          summary: `Pushed ${tabsUpdated} tab(s) to "${MASTER_WORKBOOK_TITLE}".`,
        })
      : prevMeta?.syncHistory || [];

  const syncConfig: GoogleMasterWorkbookConfig = {
    folderId: wb.folderId,
    folderUrl: wb.folderUrl,
    folderName: wb.folderName,
    workbookId: wb.workbookId,
    workbookTitle: MASTER_WORKBOOK_TITLE,
    workbookUrl: wb.workbookUrl,
    connectedEmail: userEmail,
    status: conflicts.length > 0 ? 'Conflict' : 'Synced',
    lastSyncAt: now,
    lastReverseSyncAt: prevMeta?.lastReverseSyncAt || null,
    lastError: null,
    tabs: nextTabs,
    pendingConflicts: conflicts,
    syncHistory: history,
  };

  nextState.config.lastSyncTimestamp = now;
  nextState.config.googleMasterSync = syncConfig;
  if (tabsUpdated > 0) {
    appendAuditLog(
      nextState,
      'GOOGLE_SYNC',
      'MASTER_WORKBOOK_PUSH',
      `Synchronized ${tabsUpdated} worksheet tab(s) to "${MASTER_WORKBOOK_TITLE}".`,
      'SUCCESS'
    );
  }

  return {
    nextState,
    summary:
      tabsUpdated > 0
        ? `Synced ${tabsUpdated} tab(s) to "${MASTER_WORKBOOK_TITLE}".`
        : 'All 15 tabs are already up to date.',
    tabsUpdated,
    appliedCount: tabsUpdated,
    conflictsAdded: 0,
  };
}

export async function pullMasterWorkbookChanges(
  accessToken: string,
  state: LedgerState,
  userEmail: string,
  tabIds?: MasterWorkbookTabId[]
): Promise<MasterSyncOutcome> {
  const wb = await ensureMasterWorkbook(accessToken, state);
  const targetSpecs = tabIds?.length
    ? MASTER_WORKBOOK_TABS.filter((t) => tabIds.includes(t.tabId))
    : MASTER_WORKBOOK_TABS;

  const rangesQuery = targetSpecs
    .map((t) => `ranges=${encodeURIComponent(`${t.sheetName}!A1:Z3000`)}`)
    .join('&');
  const batchRes = await fetchWithRetry(
    `${SHEETS_API}/${encodeURIComponent(wb.workbookId)}/values:batchGet?${rangesQuery}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!batchRes.ok) {
    throw new Error(`Master Workbook read failed (${batchRes.status}): ${await batchRes.text()}`);
  }
  const batchJson = await batchRes.json();
  const valueRanges: Array<{ range: string; values?: string[][] }> = batchJson.valueRanges || [];

  const nextState: LedgerState = structuredClone(state);
  const prevMeta = nextState.config.googleMasterSync;
  const conflicts: SyncConflictItem[] = [...(prevMeta?.pendingConflicts || [])];
  let history = [...(prevMeta?.syncHistory || [])];
  const nextTabs: Partial<Record<MasterWorkbookTabId, MasterTabSyncMeta>> = { ...(prevMeta?.tabs || {}) };
  let appliedCount = 0;
  let conflictsAdded = 0;

  const addConflict = (c: Omit<SyncConflictItem, 'id' | 'detectedAt'>) => {
    const dup = conflicts.some(
      (x) => x.sheet === c.sheet && x.recordKey === c.recordKey && x.field === c.field
    );
    if (!dup) {
      conflicts.push({
        id: `mconf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        detectedAt: new Date().toISOString(),
        ...c,
      });
      conflictsAdded++;
    }
  };

  targetSpecs.forEach((spec, idx) => {
    const rows = (valueRanges[idx]?.values || []).slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
    let tabApplied = 0;
    let tabConflicts = 0;

    if (spec.tabId === 'coa') {
      const validCats = new Set(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
      for (const r of rows) {
        const code = String(r[0] || '').trim();
        const name = String(r[1] || '').trim();
        const category = String(r[2] || '').trim() as AccountCategory;
        const group = String(r[3] || 'General').trim();
        const normalBalance = String(r[4] || 'Debit').trim() === 'Credit' ? 'Credit' : 'Debit';
        const openingBalance = round2(Number(r[5]) || 0);
        const status: AccountStatus = String(r[6] || 'Active').trim() === 'Inactive' ? 'Inactive' : 'Active';
        if (!code || !name) continue;
        const existing = nextState.accounts.find((a) => a.code === code);
        if (!existing) {
          if (!validCats.has(category)) {
            addConflict({ sheet: spec.sheetName, recordKey: code, field: 'Category', appValue: 'None', sheetValue: category, actionType: 'COA_CONFLICT', message: `Invalid category "${category}" for new COA ${code}.`, rawRow: r });
            tabConflicts++;
            continue;
          }
          const created: GLAccount = { code, name, category, group, openingBalance, normalBalance, registerFileId: null, registerFileName: null, status, lastSyncedAt: new Date().toISOString() };
          nextState.accounts.push(created);
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: code, originalValue: 'None', updatedValue: `${code} - ${name}`, user: userEmail, status: 'SUCCESS', summary: `Added COA ${code} from Google Sheet.` });
        } else if (existing.name !== name || existing.group !== group || existing.status !== status) {
          const prevVal = `${existing.name} | ${existing.group} | ${existing.status}`;
          existing.name = name;
          existing.group = group;
          existing.status = status;
          existing.lastSyncedAt = new Date().toISOString();
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: code, originalValue: prevVal, updatedValue: `${name} | ${group} | ${status}`, user: userEmail, status: 'SUCCESS', summary: `Updated COA ${code} from Google Sheet.` });
        }
      }
    } else if (spec.tabId === 'postedTx') {
      const newGroups = new Map<string, string[][]>();
      for (const r of rows) {
        const txId = String(r[0] || '').trim();
        const voucherNo = String(r[1] || '').trim();
        const existing = txId ? nextState.postedTransactions.find((t) => t.journalId === txId) : undefined;
        if (existing) {
          const dr = round2(Number(r[7]) || 0);
          const cr = round2(Number(r[8]) || 0);
          const desc = String(r[5] || '').trim();
          if (dr !== round2(existing.debit) || cr !== round2(existing.credit) || desc !== existing.description) {
            addConflict({ sheet: spec.sheetName, recordKey: existing.journalId, field: existing.voucherNo, appValue: `Dr ${existing.debit} / Cr ${existing.credit}`, sheetValue: `Dr ${dr} / Cr ${cr}`, actionType: 'REVERSAL_PROPOSAL', message: `Posted transaction ${existing.journalId} is immutable. Stage a controlled reversal.`, rawRow: r });
            tabConflicts++;
          }
        } else if (voucherNo) {
          const arr = newGroups.get(voucherNo) || [];
          arr.push(r);
          newGroups.set(voucherNo, arr);
        }
      }
      for (const [vNo, vLines] of newGroups.entries()) {
        if (nextState.journalLines.some((j) => j.voucherNo === vNo)) continue;
        let dr = 0; let cr = 0; let err = '';
        const staged: JournalLine[] = [];
        for (let i = 0; i < vLines.length; i++) {
          const r = vLines[i];
          const glCode = String(r[3] || '').trim();
          const acc = nextState.accounts.find((a) => a.code === glCode && a.status === 'Active');
          const d = round2(Number(r[7]) || 0);
          const c = round2(Number(r[8]) || 0);
          if (!acc) { err = `Invalid GL Code ${glCode}`; break; }
          dr = round2(dr + d); cr = round2(cr + c);
          staged.push({ journalId: `je_gs_${Date.now()}_${i}`, date: String(r[2] || new Date().toISOString().slice(0, 10)), voucherNo: vNo, description: String(r[5] || 'Sheet Import'), glCode, glName: acc.name, debit: d, credit: c, reference: String(r[9] || 'GSHEET'), counterparty: String(r[6] || ''), enteredBy: userEmail, approvalStatus: 'PENDING_APPROVAL', postingStatus: 'UNPOSTED', validationRemarks: 'Staged from Master Workbook' });
        }
        if (!err && Math.abs(dr - cr) > 0.01) err = `Unbalanced (Dr ${dr} != Cr ${cr})`;
        if (err) {
          addConflict({ sheet: spec.sheetName, recordKey: vNo, field: 'New Voucher', appValue: 'Not in Journal', sheetValue: err, actionType: 'PROTECTED_RECORD', message: `Rejected voucher ${vNo}: ${err}` });
          tabConflicts++;
        } else if (staged.length > 0) {
          nextState.journalLines.push(...staged);
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: vNo, originalValue: 'None', updatedValue: `${staged.length} line(s)`, user: userEmail, status: 'SUCCESS', summary: `Staged balanced voucher ${vNo} as PENDING_APPROVAL.` });
        }
      }
    } else if (spec.tabId === 'registerSummary') {
      for (const r of rows) {
        const glCode = String(r[0] || '').trim();
        const reg = nextState.registers[glCode];
        if (!reg) continue;
        const acc = nextState.accounts.find((a) => a.code === glCode);
        const dr = (reg.entries || []).reduce((s, e) => s + (Number(e.debit) || 0), 0);
        const cr = (reg.entries || []).reduce((s, e) => s + (Number(e.credit) || 0), 0);
        const op = acc?.openingBalance || 0;
        const appCl = round2(acc?.normalBalance === 'Credit' ? op + cr - dr : op + dr - cr);
        const sheetCl = round2(Number(r[6]) || 0);
        if (Math.abs(appCl - sheetCl) > 0.01) {
          addConflict({ sheet: spec.sheetName, recordKey: glCode, field: 'Closing Balance', appValue: String(appCl), sheetValue: String(sheetCl), actionType: 'REPORT_DISCREPANCY', message: `GL Register Summary is system-calculated; manual edit (${sheetCl}) differs from ledger (${appCl}).` });
          tabConflicts++;
        }
      }
    } else if (spec.tabId === 'products') {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const fallbackCode = `PRD-${String(i + 1).padStart(3, '0')}`;
        const id = String(r[0] || '').trim() || fallbackCode;
        const sku = String(r[1] || '').trim() || `ATCL-${String(i + 1).padStart(3, '0')}`;
        const name = String(r[2] || '').trim();
        if (!name) continue;
        const itemType = (String(r[3] || 'Inventory').trim() as ProductItemType);
        const category = String(r[4] || 'General').trim();
        const modelReference = String(r[5] || '').trim();
        const manufacturer = String(r[6] || '').trim();
        const brand = String(r[7] || '').trim();
        const originCountry = String(r[8] || '').trim();
        const unit = String(r[9] || 'Unit').trim();
        const shortDetails = String(r[10] || '').trim();
        const status: AccountStatus = String(r[11] || 'Active').trim() === 'Inactive' ? 'Inactive' : 'Active';
        const existing = nextState.products.find((p) => p.id === id || p.sku === sku || (p.name === name && (p.modelReference || '') === modelReference));
        if (!existing) {
          const item: ProductItem = {
            id, sku, name, itemType, category, unit, hsnCode: '', unitCost: 0, sellingPrice: 0, stockQty: 0, reorderLevel: 0, inventoryGlCode: '1110', revenueGlCode: '4010', cogsGlCode: '5010', modelReference, manufacturer, brand, originCountry, shortDetails, status, updatedAt: new Date().toISOString(),
          };
          nextState.products.push(item);
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: sku, originalValue: 'None', updatedValue: name, user: userEmail, status: 'SUCCESS', summary: `Added product ${name} from Google Sheet.` });
        } else if (
          existing.name !== name ||
          existing.category !== category ||
          (existing.modelReference || '') !== modelReference ||
          (existing.manufacturer || '') !== manufacturer ||
          (existing.brand || '') !== brand ||
          (existing.originCountry || '') !== originCountry ||
          existing.unit !== unit ||
          (existing.shortDetails || '') !== shortDetails ||
          existing.status !== status
        ) {
          const old = `${existing.name} (${existing.modelReference || ''})`;
          existing.name = name;
          existing.itemType = itemType;
          existing.category = category;
          existing.modelReference = modelReference;
          existing.manufacturer = manufacturer;
          existing.brand = brand;
          existing.originCountry = originCountry;
          existing.unit = unit;
          existing.shortDetails = shortDetails;
          existing.status = status;
          existing.updatedAt = new Date().toISOString();
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: existing.sku, originalValue: old, updatedValue: `${name} (${modelReference})`, user: userEmail, status: 'SUCCESS', summary: `Updated product ${existing.sku} from Google Sheet.` });
        }
      }
    } else if (spec.tabId === 'customers') {
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        const code = String(r[1] || '').trim();
        const name = String(r[2] || '').trim();
        if (!id || !name) continue;
        const email = String(r[5] || '').trim();
        const phone = String(r[6] || '').trim();
        const city = String(r[7] || '').trim();
        const creditLimit = round2(Number(r[10]) || 0);
        const status = (String(r[14] || 'Active') as CustomerRecord['status']);
        const existing = nextState.customers.find((c) => c.id === id || c.code === code);
        if (!existing) {
          const cust: CustomerRecord = { id, code: code || id, name, segment: (String(r[3] || 'Commercial') as CustomerSegment), contactPerson: String(r[4] || ''), email, phone, city, binNumber: String(r[8] || ''), paymentTerms: String(r[9] || 'Net 30'), creditLimit, openingReceivable: 0, currentReceivable: 0, ytdRevenue: 0, aging: { current: 0, days30: 0, days60: 0, days90Plus: 0 }, receivableGlCode: String(r[13] || '1100'), status: status || 'Active', notes: String(r[15] || ''), updatedAt: new Date().toISOString() };
          nextState.customers.push(cust);
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: code || id, originalValue: 'None', updatedValue: name, user: userEmail, status: 'SUCCESS', summary: `Added customer ${name} from Google Sheet.` });
        } else if (existing.name !== name || existing.email !== email || existing.phone !== phone || existing.creditLimit !== creditLimit || existing.status !== status) {
          const old = `${existing.name} | Limit ${existing.creditLimit}`;
          existing.name = name; existing.email = email; existing.phone = phone; existing.city = city; existing.creditLimit = creditLimit; existing.status = status; existing.notes = String(r[15] || existing.notes); existing.updatedAt = new Date().toISOString();
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: existing.code, originalValue: old, updatedValue: `${name} | Limit ${creditLimit}`, user: userEmail, status: 'SUCCESS', summary: `Updated customer ${existing.code} from Google Sheet.` });
        }
      }
    } else if (spec.tabId === 'suppliers') {
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        const code = String(r[1] || '').trim();
        const name = String(r[2] || '').trim();
        if (!id || !name) continue;
        const email = String(r[6] || '').trim();
        const phone = String(r[7] || '').trim();
        const status: AccountStatus = String(r[14] || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
        const existing = nextState.suppliers.find((s) => s.id === id || s.code === code);
        if (!existing) {
          const sup: SupplierRecord = { id, code: code || id, name, supplierType: (String(r[3] || 'Local Material') as SupplierType), country: String(r[4] || 'Bangladesh'), contactPerson: String(r[5] || ''), email, phone, binNumber: String(r[8] || ''), paymentTerms: String(r[9] || 'Net 30'), bankName: String(r[10] || ''), advanceBalance: 0, payableBalance: 0, ytdSpend: 0, expenseGlCode: String(r[13] || '5000'), status, notes: String(r[15] || ''), updatedAt: new Date().toISOString() };
          nextState.suppliers.push(sup);
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: code || id, originalValue: 'None', updatedValue: name, user: userEmail, status: 'SUCCESS', summary: `Added supplier ${name} from Google Sheet.` });
        } else if (existing.name !== name || existing.email !== email || existing.phone !== phone || existing.status !== status) {
          const old = existing.name;
          existing.name = name; existing.email = email; existing.phone = phone; existing.status = status; existing.notes = String(r[15] || existing.notes); existing.updatedAt = new Date().toISOString();
          tabApplied++;
          history = appendSyncHistory(history, { direction: 'SHEET_TO_SYSTEM', sheet: spec.sheetName, recordKey: existing.code, originalValue: old, updatedValue: name, user: userEmail, status: 'SUCCESS', summary: `Updated supplier ${existing.code} from Google Sheet.` });
        }
      }
    } else if (spec.tabId === 'spareParts') {
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        const partCode = String(r[1] || '').trim();
        const name = String(r[2] || '').trim();
        if (!id || !name) continue;
        const minStockLevel = round2(Number(r[8]) || 0);
        const unitCost = round2(Number(r[9]) || 0);
        const sellingPrice = round2(Number(r[10]) || 0);
        const status: AccountStatus = String(r[12] || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
        const existing = nextState.spareParts.find((sp) => sp.id === id || sp.partCode === partCode);
        if (!existing) {
          const sp: SparePartItem = { id, partCode: partCode || id, name, category: (String(r[3] || 'PLC & Modules') as SparePartCategory), compatibleSystem: String(r[4] || ''), binLocation: String(r[5] || ''), unit: String(r[6] || 'Pcs'), stockQty: 0, minStockLevel, unitCost, sellingPrice, glCode: String(r[11] || '1200'), status, updatedAt: new Date().toISOString() };
          nextState.spareParts.push(sp);
          tabApplied++;
        } else if (existing.name !== name || existing.unitCost !== unitCost || existing.sellingPrice !== sellingPrice || existing.minStockLevel !== minStockLevel || existing.status !== status) {
          existing.name = name; existing.unitCost = unitCost; existing.sellingPrice = sellingPrice; existing.minStockLevel = minStockLevel; existing.status = status; existing.updatedAt = new Date().toISOString();
          tabApplied++;
        }
      }
    } else if (spec.tabId === 'localPOs') {
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        const existing = nextState.localPurchaseOrders.find((p) => p.id === id);
        if (!existing) continue;
        const notes = String(r[16] || '').trim();
        const desc = String(r[7] || '').trim();
        if (existing.status === 'Draft') {
          if (existing.description !== desc || existing.notes !== notes) {
            existing.description = desc; existing.notes = notes; existing.updatedAt = new Date().toISOString();
            tabApplied++;
          }
        } else if (existing.description !== desc || existing.notes !== notes) {
          addConflict({ sheet: spec.sheetName, recordKey: existing.poNumber, field: existing.status, appValue: existing.description, sheetValue: desc, actionType: 'PROTECTED_RECORD', message: `PO ${existing.poNumber} is "${existing.status}" and locked against direct sheet edits.` });
          tabConflicts++;
        }
      }
    } else if (spec.tabId === 'salesOrders') {
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        const existing = nextState.salesOrders.find((s) => s.id === id);
        if (!existing) continue;
        const desc = String(r[8] || '').trim();
        const notes = String(r[16] || '').trim();
        if (existing.status === 'Quotation') {
          if (existing.description !== desc || existing.notes !== notes) {
            existing.description = desc; existing.notes = notes; existing.updatedAt = new Date().toISOString();
            tabApplied++;
          }
        } else if (existing.description !== desc || existing.notes !== notes) {
          addConflict({ sheet: spec.sheetName, recordKey: existing.orderNo, field: existing.status, appValue: existing.description, sheetValue: desc, actionType: 'PROTECTED_RECORD', message: `Sales Order ${existing.orderNo} is "${existing.status}" and locked against direct sheet edits.` });
          tabConflicts++;
        }
      }
    } else if (spec.tabId === 'inventorySerials') {
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        const existing = nextState.inventorySerials.find((u) => u.id === id);
        if (!existing) continue;
        const sheetStatus = String(r[17] || '').trim();
        const notes = String(r[18] || '').trim();
        if (sheetStatus && sheetStatus !== existing.status) {
          addConflict({ sheet: spec.sheetName, recordKey: existing.serialNumber, field: 'Status', appValue: existing.status, sheetValue: sheetStatus, actionType: 'PROTECTED_RECORD', message: `Serial status must change via ERP inventory/sales transactions.` });
          tabConflicts++;
        } else if (notes !== existing.notes) {
          existing.notes = notes; existing.updatedAt = new Date().toISOString();
          tabApplied++;
        }
      }
    } else if (spec.tabId === 'posTransactions' || spec.tabId === 'vouchers') {
      // Finalized POS receipts and Vouchers are strictly protected
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        if (spec.tabId === 'posTransactions') {
          const existing = nextState.posTransactions.find((p) => p.id === id);
          if (existing && round2(Number(r[11]) || 0) !== round2(existing.grandTotal)) {
            addConflict({ sheet: spec.sheetName, recordKey: existing.receiptNo, field: 'Grand Total', appValue: String(existing.grandTotal), sheetValue: String(r[11]), actionType: 'PROTECTED_RECORD', message: `Finalized POS receipt ${existing.receiptNo} cannot be modified from Google Sheets.` });
            tabConflicts++;
          }
        } else {
          const existing = nextState.vouchers.find((v) => v.id === id);
          if (existing && (existing.postedToGl || existing.status !== 'Auto-Approved') && round2(Number(r[6]) || 0) !== round2(existing.totalAmount)) {
            addConflict({ sheet: spec.sheetName, recordKey: existing.voucherRef, field: 'Total Amount', appValue: String(existing.totalAmount), sheetValue: String(r[6]), actionType: 'PROTECTED_RECORD', message: `Posted voucher ${existing.voucherRef} cannot be modified from Google Sheets.` });
            tabConflicts++;
          }
        }
      }
    } else if (spec.tabId === 'importLCs' || spec.tabId === 'warrantyClaims' || spec.tabId === 'serviceJobs') {
      // Notes/remarks editable on non-closed records
      for (const r of rows) {
        const id = String(r[0] || '').trim();
        if (spec.tabId === 'importLCs') {
          const lc = nextState.importLCs.find((x) => x.id === id);
          if (lc && lc.notes !== String(r[18] || '') && lc.status !== 'Retired / Settled') {
            lc.notes = String(r[18] || ''); lc.updatedAt = new Date().toISOString(); tabApplied++;
          }
        } else if (spec.tabId === 'warrantyClaims') {
          const w = nextState.warrantyClaims.find((x) => x.id === id);
          if (w && w.resolutionNotes !== String(r[14] || '') && w.status !== 'Replaced / Resolved') {
            w.resolutionNotes = String(r[14] || ''); w.updatedAt = new Date().toISOString(); tabApplied++;
          }
        } else {
          const j = nextState.serviceJobs.find((x) => x.id === id);
          if (j && j.notes !== String(r[16] || '') && j.status !== 'Completed & Handed Over') {
            j.notes = String(r[16] || ''); j.updatedAt = new Date().toISOString(); tabApplied++;
          }
        }
      }
    }

    appliedCount += tabApplied;
    nextTabs[spec.tabId] = {
      ...(nextTabs[spec.tabId] || { tabId: spec.tabId, sheetName: spec.sheetName }),
      sheetGid: wb.tabGids[spec.sheetName],
      recordCount: rows.length,
      lastSyncedAt: nextTabs[spec.tabId]?.lastSyncedAt || new Date().toISOString(),
      status: tabConflicts > 0 ? 'Conflict' : 'Synced',
    };
  });

  const now = new Date().toISOString();
  nextState.config.googleMasterSync = {
    folderId: wb.folderId,
    folderUrl: wb.folderUrl,
    folderName: wb.folderName,
    workbookId: wb.workbookId,
    workbookTitle: MASTER_WORKBOOK_TITLE,
    workbookUrl: wb.workbookUrl,
    connectedEmail: userEmail,
    status: conflicts.length > 0 ? 'Conflict' : 'Synced',
    lastSyncAt: prevMeta?.lastSyncAt || null,
    lastReverseSyncAt: now,
    lastError: null,
    tabs: nextTabs,
    pendingConflicts: conflicts,
    syncHistory: history,
  };

  appendAuditLog(
    nextState,
    'GOOGLE_SYNC',
    'MASTER_WORKBOOK_PULL',
    `Reverse sync across ${targetSpecs.length} tab(s): ${appliedCount} applied/staged, ${conflictsAdded} conflict(s).`,
    conflictsAdded > 0 ? 'ALERT' : 'SUCCESS'
  );

  return {
    nextState,
    summary: `Reverse sync complete: ${appliedCount} applied/staged, ${conflicts.length} active conflict(s).`,
    tabsUpdated: targetSpecs.length,
    appliedCount,
    conflictsAdded,
  };
}

export function resolveMasterSyncConflict(
  state: LedgerState,
  conflictId: string,
  resolution: 'KEEP_SYSTEM' | 'APPLY_SHEET' | 'STAGE_REVERSAL',
  userEmail: string
): LedgerState {
  const nextState: LedgerState = structuredClone(state);
  const sync = nextState.config.googleMasterSync;
  if (!sync?.pendingConflicts) return nextState;

  const conflict = sync.pendingConflicts.find((c) => c.id === conflictId);
  if (!conflict) return nextState;

  if (resolution === 'STAGE_REVERSAL' && conflict.sheet === 'Posted Transactions') {
    const tx = nextState.postedTransactions.find((t) => t.journalId === conflict.recordKey);
    if (tx) {
      nextState.journalLines.push({
        journalId: `je_rev_${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        voucherNo: `REV-${tx.voucherNo}`,
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
        validationRemarks: 'Staged from Master Workbook conflict resolution',
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
    summary: `Resolved ${conflict.sheet} [${conflict.recordKey}] via ${resolution}.`,
  });

  appendAuditLog(
    nextState,
    'GOOGLE_SYNC',
    'MASTER_CONFLICT_RESOLVED',
    `Resolved Master Workbook conflict on ${conflict.sheet} [${conflict.recordKey}] via ${resolution}.`,
    'SUCCESS'
  );

  return nextState;
}

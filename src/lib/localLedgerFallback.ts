import {
  buildInitialProducts,
  buildInitialSerialRegister,
  createInitialLedgerState,
  createSamplePopulatedLedgerState,
} from '../data/seedData.ts';
import { auth } from './firebase.ts';
import {
  getUserRole,
  saveLedgerStateToFirestore,
} from './firestoreSync.ts';
import { normalizeBDPhone, validateBDPhone } from './phoneUtils.ts';
import {
  appendAuditLog,
  applyPaymentAllocationsToInvoices,
  applyReceiptAllocationsToSalesInvoices,
  approveValidatedVouchers,
  computeTrialBalance,
  createAllMissingRegisters,
  ensureDefaultTaxRules,
  ensurePurchaseControlAccounts,
  ensureSalesControlAccounts,
  postApprovedVouchers,
  rebuildRegisterFromMaster,
  reconcileAllRegisters,
  recordInventoryMovement,
  round2,
  selfHealDiscrepancies,
  syncPostedTransactionsToRegisters,
  validateBackupSnapshot,
  validateChartOfAccounts,
  validateJournalVouchers,
} from '../engine/accountingEngine.ts';
import {
  buildGrnJournalLines,
  buildInventoryAdjustmentJournalLines,
  buildPosSaleJournalLines,
  buildPurchaseInvoiceJournalLines,
  buildSalesInvoiceJournalLines,
  postViaCentralEngine,
  reverseViaCentralEngine,
} from '../engine/postingService.ts';
import type {
  AmcContractRecord,
  ApprovalRequestRecord,
  BankReconciliationEntry,
  ChequeRecord,
  CustomerAdvanceRecord,
  DeliveryOrderRecord,
  DepartmentBudgetRecord,
  FixedAssetRecord,
  FundTransferRecord,
  GoodsReceiptRecord,
  ImportLCFile,
  InventorySerialUnit,
  LedgerState,
  LocalPurchaseOrder,
  PosTransaction,
  PurchaseInvoiceRecord,
  PurchaseRequisitionRecord,
  PurchaseReturnRecord,
  SalesCreditNoteRecord,
  SalesInvoiceRecord,
  SalesOrderRecord,
  SalesQuotationRecord,
  ServiceJobCard,
  SparePartItem,
  SupplierQuotationRecord,
  TaxRemittanceRecord,
  TaxWithholdingRule,
  TenderProjectRecord,
  VoucherRecord,
  WarrantyClaimRecord,
} from '../types/accounting.ts';

const STORAGE_KEY = 'atcl_v2_ledger_state_v1';
const PRE_RESTORE_KEY = 'atcl_v2_pre_restore_backup';

export interface PersistenceSyncStatus {
  mode: 'cloud' | 'local';
  lastCloudSyncAt: string | null;
  lastSyncError: string | null;
  version: number | null;
}

let syncStatus: PersistenceSyncStatus = {
  mode: 'local',
  lastCloudSyncAt: null,
  lastSyncError: null,
  version: null,
};

let cloudSyncTimer: number | null = null;

export function getPersistenceSyncStatus(): PersistenceSyncStatus {
  return { ...syncStatus };
}

export function hydrateLocalLedgerFromCloud(
  partial: Partial<LedgerState>,
  version?: number
): LedgerState {
  const current = loadState();
  const merged: LedgerState = {
    ...current,
    ...partial,
    registers: current.registers || {},
  };
  ensurePurchaseControlAccounts(merged);
  ensureSalesControlAccounts(merged);
  ensureDefaultTaxRules(merged);
  syncPostedTransactionsToRegisters(merged);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // ignore quota errors
  }
  syncStatus = {
    mode: 'cloud',
    lastCloudSyncAt: new Date().toISOString(),
    lastSyncError: null,
    version: version ?? syncStatus.version,
  };
  return merged;
}

function scheduleCloudSave(state: LedgerState): void {
  if (typeof window === 'undefined') return;
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    syncStatus = { ...syncStatus, mode: 'local' };
    return;
  }
  if (cloudSyncTimer !== null) {
    window.clearTimeout(cloudSyncTimer);
  }
  cloudSyncTimer = window.setTimeout(async () => {
    try {
      const nextVersion = await saveLedgerStateToFirestore(user, state);
      syncStatus = {
        mode: 'cloud',
        lastCloudSyncAt: new Date().toISOString(),
        lastSyncError: null,
        version: nextVersion,
      };
    } catch (err) {
      syncStatus = {
        mode: 'local',
        lastCloudSyncAt: syncStatus.lastCloudSyncAt,
        lastSyncError: err instanceof Error ? err.message : 'Cloud sync unavailable',
        version: syncStatus.version,
      };
    }
  }, 1500);
}

function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LedgerState;
      if (parsed && Array.isArray(parsed.accounts)) {
        if (!parsed.products?.some((p) => p.manufacturer || p.shortDetails)) {
          parsed.products = buildInitialProducts();
          saveState(parsed);
        }
        if (!parsed.inventorySerials?.some((s) => s.batchOrLcRef === 'ATCL-CAT-2026')) {
          parsed.inventorySerials = buildInitialSerialRegister();
          saveState(parsed);
        }
        parsed.goodsReceipts = parsed.goodsReceipts || [];
        parsed.purchaseInvoices = parsed.purchaseInvoices || [];
        parsed.purchaseRequisitions = parsed.purchaseRequisitions || [];
        parsed.supplierQuotations = parsed.supplierQuotations || [];
        parsed.purchaseReturns = parsed.purchaseReturns || [];
        parsed.taxRemittances = parsed.taxRemittances || [];
        parsed.salesInvoices = parsed.salesInvoices || [];
        parsed.customerAdvances = parsed.customerAdvances || [];
        parsed.salesQuotations = parsed.salesQuotations || [];
        parsed.deliveryOrders = parsed.deliveryOrders || [];
        parsed.salesCreditNotes = parsed.salesCreditNotes || [];
        parsed.amcContracts = parsed.amcContracts || [];
        ensurePurchaseControlAccounts(parsed);
        ensureSalesControlAccounts(parsed);
        return parsed;
      }
    }
  } catch {
    // fall through to seed
  }
  const seeded = createSamplePopulatedLedgerState();
  saveState(seeded);
  return seeded;
}

function saveState(state: LedgerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
  scheduleCloudSave(state);
}

function parseBody(options?: RequestInit): Record<string, any> {
  if (!options?.body || typeof options.body !== 'string') return {};
  try {
    return JSON.parse(options.body);
  } catch {
    return {};
  }
}

export async function handleLocalApiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const body = parseBody(options);
  const path = url.split('?')[0];
  let state = loadState();

  if (path === '/api/state' && method === 'GET') {
    return { state } as T;
  }

  if (path === '/api/load-sample' && method === 'POST') {
    state = createSamplePopulatedLedgerState();
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/reset' && method === 'POST') {
    state = createInitialLedgerState();
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/accounts' && method === 'POST') {
    const code = String(body.code || '').trim();
    if (!code) throw new Error('Account code is required.');
    if (state.accounts.some((a) => a.code === code)) {
      throw new Error(`Account ${code} already exists.`);
    }
    const opening = round2(Number(body.openingBalance) || 0);
    const category = body.category || 'Asset';
    const normalBalance =
      category === 'Liability' || category === 'Equity' || category === 'Revenue' || category === 'Income'
        ? 'Credit'
        : 'Debit';
    state.accounts.push({
      code,
      name: String(body.name || code),
      category,
      group: String(body.group || 'General'),
      openingBalance: opening,
      normalBalance,
      registerFileId: null,
      registerFileName: null,
      status: 'Active',
      lastSyncedAt: new Date().toISOString(),
    });
    if (body.autoCreateRegister) {
      createAllMissingRegisters(state);
    }
    appendAuditLog(state, 'COA', 'ADD_ACCOUNT', `Added account ${code} (${body.name}).`, 'SUCCESS');
    saveState(state);
    return { state } as T;
  }

  if (path.startsWith('/api/accounts/') && method === 'PATCH') {
    const code = decodeURIComponent(path.replace('/api/accounts/', ''));
    const acc = state.accounts.find((a) => a.code === code);
    if (!acc) throw new Error('Account not found.');
    if (body.status) acc.status = body.status;
    if (body.name) acc.name = body.name;
    if (body.group) acc.group = body.group;
    acc.lastSyncedAt = new Date().toISOString();
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/coa/validate' && method === 'POST') {
    const result = validateChartOfAccounts(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/coa/create-registers' && method === 'POST') {
    const result = createAllMissingRegisters(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/journal/voucher' && method === 'POST') {
    const voucherNo = String(body.voucherNo || `JV-${Date.now()}`).trim();
    const date = String(body.date || new Date().toISOString().slice(0, 10));
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const newEntries = lines.map((l: any, idx: number) => {
      const acc = state.accounts.find((a) => a.code === l.glCode);
      return {
        journalId: `je_${Date.now()}_${idx}`,
        date,
        voucherNo,
        description: String(body.description || ''),
        glCode: l.glCode,
        glName: acc?.name || l.glCode,
        debit: round2(Number(l.debit) || 0),
        credit: round2(Number(l.credit) || 0),
        reference: String(body.reference || ''),
        counterparty: String(body.counterparty || ''),
        enteredBy: 'Web User',
        approvalStatus: body.approvalStatus || 'PENDING_APPROVAL',
        postingStatus: 'UNPOSTED' as const,
        validationRemarks: '',
      };
    });
    state.journalLines.push(...newEntries);
    appendAuditLog(state, 'JOURNAL', 'CREATE_VOUCHER', `Created voucher ${voucherNo}.`, 'SUCCESS');
    saveState(state);
    return { state, voucherNo } as T;
  }

  if (path.startsWith('/api/journal/') && method === 'DELETE') {
    const voucherNo = decodeURIComponent(path.replace('/api/journal/', ''));
    state.journalLines = state.journalLines.filter((e) => e.voucherNo !== voucherNo);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/journal/validate' && method === 'POST') {
    const result = validateJournalVouchers(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/journal/approve' && method === 'POST') {
    const result = approveValidatedVouchers(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/journal/post' && method === 'POST') {
    const result = postApprovedVouchers(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/journal/reverse' && method === 'POST') {
    const result = reverseViaCentralEngine(state, String(body.voucherNo || ''), String(body.reason || 'Reversal'));
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/registers/sync' && method === 'POST') {
    const result = syncPostedTransactionsToRegisters(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path.startsWith('/api/registers/') && path.endsWith('/rebuild') && method === 'POST') {
    const code = decodeURIComponent(
      path.replace('/api/registers/', '').replace('/rebuild', '')
    );
    const result = rebuildRegisterFromMaster(state, code);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/audit/reconcile' && method === 'POST') {
    const result = reconcileAllRegisters(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/audit/self-heal' && method === 'POST') {
    const result = selfHealDiscrepancies(state);
    saveState(state);
    return { state, result } as T;
  }

  if (path === '/api/config' && method === 'PATCH') {
    state.config = { ...state.config, ...body };
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/audit/prune' && method === 'POST') {
    const before = state.auditLogs.length;
    state.auditLogs = state.auditLogs.slice(-200);
    saveState(state);
    return {
      state,
      result: { removedCount: before - state.auditLogs.length, remainingCount: state.auditLogs.length },
    } as T;
  }

  if (path === '/api/backup/restore' && method === 'POST') {
    const snap = body.snapshot || {};
    validateBackupSnapshot(snap);
    try {
      localStorage.setItem(PRE_RESTORE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota
    }
    state = { ...state, ...snap };
    ensurePurchaseControlAccounts(state);
    ensureSalesControlAccounts(state);
    syncPostedTransactionsToRegisters(state);
    appendAuditLog(state, 'BACKUP', 'RESTORE_SNAPSHOT', 'Validated and restored ERP backup snapshot (pre-restore backup saved).', 'WARNING');
    saveState(state);
    return {
      state,
      summary: {
        accounts: state.accounts.length,
        postedTransactions: state.postedTransactions.length,
        vouchers: state.journalLines.length,
        templates: state.templates.length,
      },
    } as T;
  }

  if (path === '/api/scripts' && method === 'GET') {
    const staticFiles = [
      '01_Config_32b9119e.gs',
      '02_Menu_5c36638b.gs',
      '03_RegisterManager_77ca8973.gs',
      '04_JournalPostingEngine_73492d21.gs',
      '05_RegisterSyncEngine_3ea7bb65.gs',
      '06_ReportsEngine_e5839f38.gs',
      '07_AuditAndReconciliation_bdd92ab1.gs',
      'Bundled_Code_ba6208e6.gs',
    ];
    const scripts = (
      await Promise.all(
        staticFiles.map(async (rawFilename) => {
          try {
            const res = await fetch(`/assets/aistudio/${rawFilename}`);
            if (!res.ok) return null;
            const content = await res.text();
            if (content.trimStart().startsWith('<')) return null;
            return {
              filename: rawFilename.replace(/_[a-f0-9]{8}\.gs$/, '.gs'),
              rawFilename,
              sizeBytes: new Blob([content]).size,
              content,
            };
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    return { scripts } as T;
  }

  if (path === '/api/master/products' && method === 'POST') {
    const role = await getUserRole(auth.currentUser);
    if (role !== 'admin') {
      throw new Error('Access Denied: Administrator privileges are required to create products.');
    }
    const sku = String(body.sku || '').trim().toUpperCase();
    if (!sku) throw new Error('SKU is required.');
    if (state.products.some((p) => p.sku.trim().toUpperCase() === sku)) {
      throw new Error(`Duplicate SKU blocked: '${sku}' already exists in Product Master.`);
    }
    const newProd = {
      ...body,
      sku,
      id: `PRD-${String(state.products.length + 1).padStart(3, '0')}`,
      updatedAt: new Date().toISOString(),
    } as any;
    state.products.unshift(newProd);
    saveState(state);
    return { state, product: newProd } as T;
  }

  if (path.startsWith('/api/master/products/') && method === 'PATCH') {
    const role = await getUserRole(auth.currentUser);
    if (role !== 'admin') {
      appendAuditLog(state, 'SECURITY', 'RBAC_DENIED', `Unauthorized attempt to edit product (${role}) blocked.`, 'FAILED');
      saveState(state);
      throw new Error('Access Denied: Administrator privileges are required to edit products.');
    }
    const id = decodeURIComponent(path.replace('/api/master/products/', ''));
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Product not found.');
    const existing = state.products[idx];
    const nextSku = body.sku !== undefined ? String(body.sku).trim().toUpperCase() : existing.sku;
    if (!nextSku) throw new Error('SKU cannot be empty.');
    if (state.products.some((p) => p.id !== id && p.sku.trim().toUpperCase() === nextSku)) {
      throw new Error(`Duplicate SKU blocked: '${nextSku}' belongs to another product.`);
    }
    const updated = {
      ...existing,
      ...body,
      sku: nextSku,
      // Protect stockQty from silent manual overwrite when transactions exist
      stockQty: existing.stockQty,
      updatedAt: new Date().toISOString(),
    };
    state.products[idx] = updated;
    // Sync ONLY non-financial display metadata (never overwrite historical unitCost or posted glCode on serials)
    state.inventorySerials = state.inventorySerials.map((u) =>
      u.sku === updated.sku || u.productName === updated.name
        ? {
            ...u,
            productName: updated.name,
            category: updated.category,
            updatedAt: updated.updatedAt,
          }
        : u
    );
    saveState(state);
    return { state, product: updated } as T;
  }

  if (path.startsWith('/api/master/products/') && method === 'DELETE') {
    const role = await getUserRole(auth.currentUser);
    if (role !== 'admin') {
      appendAuditLog(state, 'SECURITY', 'RBAC_DENIED', `Unauthorized attempt to delete product (${role}) blocked.`, 'FAILED');
      saveState(state);
      throw new Error('Access Denied: Administrator privileges are required to delete products.');
    }
    const id = decodeURIComponent(path.replace('/api/master/products/', ''));
    const prod = state.products.find((p) => p.id === id);
    if (prod) {
      const hasRefs =
        state.inventorySerials.some((s) => s.sku === prod.sku) ||
        state.posTransactions.some((t) => t.items.some((i) => i.sku === prod.sku));
      if (hasRefs) {
        throw new Error(
          `Cannot delete product '${prod.sku}' because it has linked serials or POS transactions. Set Status to 'Inactive' instead.`
        );
      }
    }
    state.products = state.products.filter((p) => p.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/master/serials' && method === 'POST') {
    const sn = String(body.serialNumber || '').trim().toUpperCase();
    if (!sn) throw new Error('Serial Number is required.');
    const dup = state.inventorySerials.find((s) => s.serialNumber.trim().toUpperCase() === sn);
    if (dup) {
      throw new Error(`Duplicate Serial Blocked: '${sn}' is already registered under ${dup.productName}.`);
    }
    const prod = state.products.find((p) => p.sku === body.sku || p.name === body.productName);
    const newSerial = {
      ...body,
      serialNumber: sn,
      id: `SER-${String(state.inventorySerials.length + 1).padStart(3, '0')}`,
      glCode: body.glCode || prod?.inventoryGlCode || '1110',
      updatedAt: new Date().toISOString(),
    } as any;
    state.inventorySerials.unshift(newSerial);
    saveState(state);
    return { state, serial: newSerial } as T;
  }

  if (path.startsWith('/api/master/serials/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/master/serials/', ''));
    const idx = state.inventorySerials.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error('Serial unit not found.');
    if (body.serialNumber !== undefined) {
      const nextSn = String(body.serialNumber).trim().toUpperCase();
      const dup = state.inventorySerials.find(
        (s) => s.id !== id && s.serialNumber.trim().toUpperCase() === nextSn
      );
      if (dup) throw new Error(`Duplicate Serial Blocked: '${nextSn}' already exists.`);
    }
    const updated = {
      ...state.inventorySerials[idx],
      ...body,
      updatedAt: new Date().toISOString(),
    };
    state.inventorySerials[idx] = updated;
    saveState(state);
    return { state, serial: updated } as T;
  }

  if (path.startsWith('/api/master/serials/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/master/serials/', ''));
    state.inventorySerials = state.inventorySerials.filter((u) => u.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path.startsWith('/api/master/customers/check-phone') && method === 'GET') {
    const qs = path.includes('?') ? path.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const norm = normalizeBDPhone(params.get('phone') || '');
    const excludeId = params.get('excludeId') || '';
    const match = norm
      ? state.customers.find(
          (c) => c.id !== excludeId && normalizeBDPhone(c.phone) === norm
        )
      : undefined;
    return {
      duplicate: Boolean(match),
      existingCustomer: match
        ? {
            id: match.id,
            code: match.code,
            name: match.name,
            phone: match.phone,
            status: match.status,
          }
        : null,
    } as T;
  }

  if (path === '/api/master/customers' && method === 'POST') {
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    const phoneCheck = validateBDPhone(String(body.phone || ''));
    if (!code || !name) {
      throw new Error('Customer Code and Legal Name are required.');
    }
    if (!phoneCheck.valid) {
      throw new Error(phoneCheck.error || 'Invalid phone number.');
    }
    const existingByPhone = state.customers.find(
      (c) => normalizeBDPhone(c.phone) === phoneCheck.normalized
    );
    if (existingByPhone) {
      throw new Error(
        `Duplicate Customer Detected! Phone ${phoneCheck.normalized} is already registered under ${existingByPhone.code} (${existingByPhone.name}).`
      );
    }
    if (state.customers.some((c) => c.code.toUpperCase() === code)) {
      throw new Error(`Customer Code '${code}' already exists.`);
    }
    const m = /^CUST-(\d+)$/.exec(code);
    if (m) {
      const n = parseInt(m[1], 10);
      state.config.highestCustomerCodeNum = Math.max(
        state.config.highestCustomerCodeNum || 1000,
        n
      );
    }
    const now = new Date().toISOString();
    const openingAr = round2(Math.max(0, Number(body.openingReceivable) || 0));
    const newCust = {
      ...body,
      id: `CUS-${String(state.customers.length + 1).padStart(3, '0')}`,
      code,
      name,
      receivableGlCode: '1120',
      openingReceivable: openingAr,
      currentReceivable: openingAr,
      ytdRevenue: 0,
      aging: { current: openingAr, days30: 0, days60: 0, days90Plus: 0 },
      status: String(body.status || '').trim() || 'Active',
      createdAt: now,
      updatedAt: now,
    } as any;
    state.customers.unshift(newCust);
    saveState(state);
    return { state, customer: newCust } as T;
  }

  if (path.startsWith('/api/master/customers/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/master/customers/', ''));
    const idx = state.customers.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Customer record not found.');
    const existing = state.customers[idx];
    const nextPhoneRaw = body.phone !== undefined ? String(body.phone) : existing.phone;
    const phoneCheck = validateBDPhone(nextPhoneRaw);
    if (!phoneCheck.valid) {
      throw new Error(phoneCheck.error || 'Invalid phone number.');
    }
    const dupPhone = state.customers.find(
      (c) => c.id !== id && normalizeBDPhone(c.phone) === phoneCheck.normalized
    );
    if (dupPhone) {
      throw new Error(
        `This phone number is already registered to another customer (${dupPhone.code} — ${dupPhone.name}).`
      );
    }
    const updated = {
      ...existing,
      ...body,
      phone: phoneCheck.normalized,
      // Protect posted opening AR & calculated totals from manual overwrite
      openingReceivable: existing.openingReceivable,
      currentReceivable: existing.currentReceivable,
      ytdRevenue: existing.ytdRevenue,
      receivableGlCode: '1120',
      updatedAt: new Date().toISOString(),
    };
    state.customers[idx] = updated;
    saveState(state);
    return { state, customer: updated } as T;
  }

  if (path.startsWith('/api/master/customers/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/master/customers/', ''));
    const hasRefs =
      state.salesOrders.some((o) => o.customerId === id) ||
      (state.salesInvoices || []).some((i) => i.customerId === id) ||
      state.vouchers.some((v) => v.customerId === id);
    if (hasRefs) {
      throw new Error(
        `Cannot delete customer because it has linked Sales Orders, Invoices, or Vouchers. Set Status to 'Inactive' instead.`
      );
    }
    state.customers = state.customers.filter((c) => c.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path.startsWith('/api/master/suppliers/check-phone') && method === 'GET') {
    const qs = path.includes('?') ? path.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const norm = normalizeBDPhone(params.get('phone') || '');
    const excludeId = params.get('excludeId') || '';
    const match = norm
      ? state.suppliers.find(
          (s) => s.id !== excludeId && normalizeBDPhone(s.phone) === norm
        )
      : undefined;
    return {
      duplicate: Boolean(match),
      existingSupplier: match
        ? {
            id: match.id,
            code: match.code,
            name: match.name,
            phone: match.phone,
            status: match.status,
          }
        : null,
    } as T;
  }

  if (path === '/api/master/suppliers' && method === 'POST') {
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    const country = String(body.country || 'Bangladesh').trim();
    const isBD = country.toLowerCase() === 'bangladesh';
    const rawPhone = String(body.phone || '').trim();
    const phoneCheck = isBD
      ? validateBDPhone(rawPhone, 'Supplier phone number is required.')
      : { valid: rawPhone.length >= 6, normalized: rawPhone, error: 'International supplier phone is required.' };
    if (!code || !name) {
      throw new Error('Supplier Code and Legal Name are required.');
    }
    if (!phoneCheck.valid) {
      throw new Error(phoneCheck.error || 'Supplier phone number is required.');
    }
    const dupSup = state.suppliers.find((s) =>
      isBD ? normalizeBDPhone(s.phone) === phoneCheck.normalized : s.phone.trim() === phoneCheck.normalized
    );
    if (dupSup) {
      throw new Error(
        `Duplicate Supplier Detected! Phone ${phoneCheck.normalized} is already registered under ${dupSup.code} (${dupSup.name}).`
      );
    }
    if (state.suppliers.some((s) => s.code.toUpperCase() === code)) {
      throw new Error(`Supplier Code '${code}' already exists.`);
    }
    const m = /^VEND-(\d+)$/.exec(code);
    if (m) {
      const n = parseInt(m[1], 10);
      state.config.highestSupplierCodeNum = Math.max(
        state.config.highestSupplierCodeNum || 2000,
        n
      );
    }
    const newSup = {
      ...body,
      id: `SUP-${String(state.suppliers.length + 1).padStart(3, '0')}`,
      code,
      name,
      phone: phoneCheck.normalized,
      updatedAt: new Date().toISOString(),
    } as any;
    state.suppliers.unshift(newSup);
    saveState(state);
    return { state, supplier: newSup } as T;
  }

  if (path.startsWith('/api/master/suppliers/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/master/suppliers/', ''));
    const idx = state.suppliers.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Supplier record not found.');
    const existing = state.suppliers[idx];
    const nextCountry = String(body.country !== undefined ? body.country : existing.country || 'Bangladesh').trim();
    const isBD = nextCountry.toLowerCase() === 'bangladesh';
    const nextPhoneRaw = String(body.phone !== undefined ? body.phone : existing.phone).trim();
    const phoneCheck = isBD
      ? validateBDPhone(nextPhoneRaw, 'Supplier phone number is required.')
      : { valid: nextPhoneRaw.length >= 6, normalized: nextPhoneRaw, error: 'International supplier phone is required.' };
    if (!phoneCheck.valid) {
      throw new Error(phoneCheck.error || 'Supplier phone number is required.');
    }
    const dupSup = state.suppliers.find(
      (s) =>
        s.id !== id &&
        (isBD ? normalizeBDPhone(s.phone) === phoneCheck.normalized : s.phone.trim() === phoneCheck.normalized)
    );
    if (dupSup) {
      throw new Error(
        `This phone number is already registered to another supplier (${dupSup.code} — ${dupSup.name}).`
      );
    }
    const updated = {
      ...existing,
      ...body,
      phone: phoneCheck.normalized,
      // Protect calculated AP/advance/spend totals from manual overwrite on edit
      payableBalance: existing.payableBalance,
      advanceBalance: existing.advanceBalance,
      ytdSpend: existing.ytdSpend,
      updatedAt: new Date().toISOString(),
    };
    state.suppliers[idx] = updated;
    saveState(state);
    return { state, supplier: updated } as T;
  }

  if (path.startsWith('/api/master/suppliers/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/master/suppliers/', ''));
    const sup = state.suppliers.find((s) => s.id === id);
    const hasRefs =
      state.localPurchaseOrders.some((o) => o.supplierId === id) ||
      (state.purchaseInvoices || []).some((i) => i.supplierId === id) ||
      state.vouchers.some((v) => v.supplierId === id) ||
      (sup ? state.importLCs.some((lc) => lc.supplierName.toLowerCase() === sup.name.toLowerCase()) : false);
    if (hasRefs) {
      throw new Error(
        `Cannot delete supplier because it has linked POs, Import LCs, Invoices, or Vouchers. Set Status to 'In Active' instead.`
      );
    }
    state.suppliers = state.suppliers.filter((s) => s.id !== id);
    saveState(state);
    return { state } as T;
  }

  // Supply Chain: Local Purchase Orders
  if (path === '/api/supply-chain/local-pos' && method === 'POST') {
    const now = new Date().toISOString();
    const grossAmt = round2(Number(body.grossAmount) || 0);
    const limit = state.config.autoApproveLimit || 250000;
    const needsApproval = grossAmt >= limit && body.approvalStatus !== 'Approved';
    const newPo: LocalPurchaseOrder = {
      ...(body as Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>),
      id: `LPO-${String(state.localPurchaseOrders.length + 1).padStart(4, '0')}`,
      approvalStatus: needsApproval ? 'Draft' : ((body.approvalStatus as LocalPurchaseOrder['approvalStatus']) || 'Approved'),
      status: needsApproval ? 'Draft' : ((body.status as LocalPurchaseOrder['status']) || 'Approved'),
      updatedAt: now,
    };
    state.localPurchaseOrders.unshift(newPo);
    if (needsApproval) {
      state.approvalRequests = state.approvalRequests || [];
      state.approvalRequests.unshift({
        id: `APR-${String(state.approvalRequests.length + 1).padStart(4, '0')}`,
        requestNo: `APR-${newPo.poNumber}`,
        requestType: 'PO',
        module: 'Procurement',
        referenceId: newPo.id,
        referenceNo: newPo.poNumber,
        summary: `High-value Local PO for ${newPo.supplierName} (exceeds ${limit.toLocaleString()} limit)`,
        amount: grossAmt,
        requestedBy: state.config.operatorEmail,
        requestedAt: now,
        requiredRole: 'finance_controller',
        status: 'Pending',
      });
    }
    appendAuditLog(
      state,
      'PROCUREMENT',
      'CREATE_PO',
      `Issued PO ${newPo.poNumber} for ${newPo.supplierName}${needsApproval ? ' (Queued for Approval)' : ''}.`,
      'SUCCESS'
    );
    saveState(state);
    return { state, order: newPo } as T;
  }

  if (path.startsWith('/api/supply-chain/local-pos/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/supply-chain/local-pos/', ''));
    const idx = state.localPurchaseOrders.findIndex((o) => o.id === id);
    if (idx === -1) throw new Error('Purchase Order not found.');
    const updated: LocalPurchaseOrder = {
      ...state.localPurchaseOrders[idx],
      ...(body as Partial<LocalPurchaseOrder>),
      updatedAt: new Date().toISOString(),
    };
    state.localPurchaseOrders[idx] = updated;
    saveState(state);
    return { state, order: updated } as T;
  }

  if (path.startsWith('/api/supply-chain/local-pos/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/supply-chain/local-pos/', ''));
    state.localPurchaseOrders = state.localPurchaseOrders.filter((o) => o.id !== id);
    saveState(state);
    return { state } as T;
  }

  // Supply Chain: Purchase Requisitions (PR)
  if (path === '/api/supply-chain/requisitions' && method === 'POST') {
    state.purchaseRequisitions = state.purchaseRequisitions || [];
    const now = new Date().toISOString();
    const newPr: PurchaseRequisitionRecord = {
      ...(body as Omit<PurchaseRequisitionRecord, 'id' | 'updatedAt'>),
      id: `PR-${String(state.purchaseRequisitions.length + 1).padStart(4, '0')}`,
      updatedAt: now,
    };
    state.purchaseRequisitions.unshift(newPr);
    appendAuditLog(state, 'PROCUREMENT', 'CREATE_PR', `Created PR ${newPr.prNumber} (${newPr.department}).`, 'SUCCESS');
    saveState(state);
    return { state, requisition: newPr } as T;
  }

  if (path.startsWith('/api/supply-chain/requisitions/') && method === 'PATCH') {
    state.purchaseRequisitions = state.purchaseRequisitions || [];
    const id = decodeURIComponent(path.replace('/api/supply-chain/requisitions/', ''));
    const idx = state.purchaseRequisitions.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Purchase Requisition not found.');
    const updated: PurchaseRequisitionRecord = {
      ...state.purchaseRequisitions[idx],
      ...(body as Partial<PurchaseRequisitionRecord>),
      updatedAt: new Date().toISOString(),
    };
    state.purchaseRequisitions[idx] = updated;
    saveState(state);
    return { state, requisition: updated } as T;
  }

  // Supply Chain: Supplier Quotations (RFQ)
  if (path === '/api/supply-chain/quotations' && method === 'POST') {
    state.supplierQuotations = state.supplierQuotations || [];
    const now = new Date().toISOString();
    const newQuote: SupplierQuotationRecord = {
      ...(body as Omit<SupplierQuotationRecord, 'id' | 'updatedAt'>),
      id: `RFQ-${String(state.supplierQuotations.length + 1).padStart(4, '0')}`,
      updatedAt: now,
    };
    state.supplierQuotations.unshift(newQuote);
    saveState(state);
    return { state, quotation: newQuote } as T;
  }

  if (path.startsWith('/api/supply-chain/quotations/') && path.endsWith('/award') && method === 'POST') {
    state.supplierQuotations = state.supplierQuotations || [];
    const id = decodeURIComponent(path.replace('/api/supply-chain/quotations/', '').replace('/award', ''));
    const quote = state.supplierQuotations.find((q) => q.id === id);
    if (!quote) throw new Error('Supplier Quotation not found.');

    const now = new Date().toISOString();
    const supplier = state.suppliers.find((s) => s.id === quote.supplierId);
    const poNumber = `PO-${new Date().getFullYear()}-${String(state.localPurchaseOrders.length + 101).padStart(4, '0')}`;
    const vatAmount = round2((quote.quotedNetAmount * (quote.vatRate || 0)) / 100);
    const grossAmount = round2(quote.quotedNetAmount + vatAmount);

    const newOrder: LocalPurchaseOrder = {
      id: `LPO-${String(state.localPurchaseOrders.length + 1).padStart(4, '0')}`,
      poNumber,
      poDate: now.slice(0, 10),
      expectedDate: now.slice(0, 10),
      supplierId: quote.supplierId,
      supplierName: quote.supplierName,
      category: 'Local Material',
      description: quote.itemSummary,
      netAmount: quote.quotedNetAmount,
      vatRate: quote.vatRate || 0,
      vatAmount,
      aitRate: 0,
      aitAmount: 0,
      grossAmount,
      paidAmount: 0,
      paymentBank: supplier?.bankName || 'Shahjalal Islami Bank PLC',
      expenseGlCode: supplier?.expenseGlCode || '5010',
      status: 'Approved',
      approvalStatus: 'Approved',
      receiptStatus: 'Pending',
      invoiceStatus: 'Unbilled',
      paymentStatus: 'Unpaid',
      grnNumber: '',
      notes: `Awarded from ${quote.rfqNumber}${quote.prNumber ? ` / ${quote.prNumber}` : ''}`,
      updatedAt: now,
    };
    state.localPurchaseOrders.unshift(newOrder);
    quote.status = 'Awarded';
    quote.linkedPoNumber = poNumber;
    quote.updatedAt = now;
    appendAuditLog(state, 'PROCUREMENT', 'AWARD_RFQ', `Awarded ${quote.rfqNumber} to ${quote.supplierName} → issued ${poNumber}.`, 'SUCCESS');
    saveState(state);
    return { state, quotation: quote, order: newOrder } as T;
  }

  // Supply Chain: Purchase Returns (RTV — Dr AP/GRNI / Cr Inventory 1110)
  if (path === '/api/supply-chain/purchase-returns' && method === 'POST') {
    ensurePurchaseControlAccounts(state);
    state.purchaseReturns = state.purchaseReturns || [];
    const now = new Date().toISOString();
    const retNo = String(body.returnNumber || '').trim().toUpperCase();
    const amount = round2(Number(body.returnAmount) || 0);
    if (!retNo || amount <= 0) throw new Error('Return Number and positive Return Amount are required.');

    const invGl = String(body.inventoryGlCode || '1110');
    const offsetGl = String(body.offsetGlCode || '2080');
    const voucherNo = `JRN-${retNo}`;
    postViaCentralEngine(state, {
      sourceModule: 'PURCHASE_RETURN',
      idempotencyKey: `RTV:${retNo}`,
      voucherNo,
      date: String(body.returnDate || now.slice(0, 10)),
      description: `Purchase Return ${retNo} — ${String(body.reason || 'Returned to vendor')}`,
      reference: String(body.grnNumber || body.poNumber || retNo),
      counterparty: String(body.supplierName || 'Vendor'),
      lines: [
        { glCode: offsetGl, debit: amount, credit: 0, memo: 'Reverse AP / GRNI liability' },
        { glCode: invGl, debit: 0, credit: amount, memo: 'Reverse Inventory asset' },
      ],
    });

    const retSku = body.sku ? String(body.sku).trim() : '';
    const retQty = Math.max(0, Number(body.qty) || 0);
    if (retSku && retQty > 0) {
      const prod = state.products.find((p) => p.sku.toUpperCase() === retSku.toUpperCase());
      if (prod) {
        const before = prod.stockQty;
        prod.stockQty = Math.max(0, before - retQty);
        prod.updatedAt = now;
        recordInventoryMovement(state, {
          movementDate: String(body.returnDate || now.slice(0, 10)),
          sku: prod.sku,
          productName: prod.name,
          movementType: 'Purchase Return',
          qtyDelta: -retQty,
          qtyBefore: before,
          qtyAfter: prod.stockQty,
          unitCost: prod.unitCost || 0,
          valuationBdt: -round2(retQty * (prod.unitCost || 0)),
          warehouse: String(body.warehouse || 'Dhaka Central Warehouse'),
          sourceRef: retNo,
        });
      }
    }

    const newRet: PurchaseReturnRecord = {
      ...(body as Omit<PurchaseReturnRecord, 'id' | 'updatedAt' | 'postedToGl' | 'postedVoucherNo'>),
      id: `RTV-${String(state.purchaseReturns.length + 1).padStart(4, '0')}`,
      returnNumber: retNo,
      returnAmount: amount,
      inventoryGlCode: invGl,
      offsetGlCode: offsetGl,
      postedToGl: true,
      postedVoucherNo: voucherNo,
      updatedAt: now,
    };
    state.purchaseReturns.unshift(newRet);
    appendAuditLog(state, 'PROCUREMENT', 'CREATE_RTV', `Posted Purchase Return ${retNo} (BDT ${amount.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, purchaseReturn: newRet } as T;
  }

  // Supply Chain: Import LCs & Landed Cost Allocation
  if (path === '/api/supply-chain/import-lcs' && method === 'POST') {
    const now = new Date().toISOString();
    const newLc: ImportLCFile = {
      ...(body as Omit<ImportLCFile, 'id' | 'updatedAt'>),
      id: `LC-${String(state.importLCs.length + 1).padStart(4, '0')}`,
      updatedAt: now,
    };
    state.importLCs.unshift(newLc);
    saveState(state);
    return { state, lc: newLc } as T;
  }

  if (path.startsWith('/api/supply-chain/import-lcs/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/supply-chain/import-lcs/', ''));
    const idx = state.importLCs.findIndex((l) => l.id === id);
    if (idx === -1) throw new Error('Import LC record not found.');
    const updated = {
      ...state.importLCs[idx],
      ...(body as Partial<ImportLCFile>),
      updatedAt: new Date().toISOString(),
    };
    state.importLCs[idx] = updated;
    saveState(state);
    return { state, lc: updated } as T;
  }

  if (path.startsWith('/api/supply-chain/import-lcs/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/supply-chain/import-lcs/', ''));
    state.importLCs = state.importLCs.filter((l) => l.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/supply-chain/landed-cost' && method === 'POST') {
    const lcId = String(body.lcId || '');
    const lc = state.importLCs.find((l) => l.id === lcId);
    if (!lc) throw new Error('Import LC file not found.');
    const prevReleasedCount = (lc.shipments || []).filter((s) => s.status === 'Released').length;
    lc.settlementExchangeRate =
      body.settlementExchangeRate !== undefined ? Number(body.settlementExchangeRate) : lc.settlementExchangeRate;
    lc.fxDifferenceBdt =
      body.fxDifferenceBdt !== undefined ? Number(body.fxDifferenceBdt) : lc.fxDifferenceBdt;
    if (Array.isArray(body.shipments)) lc.shipments = body.shipments as any;
    if (Array.isArray(body.landedAllocations)) lc.landedAllocations = body.landedAllocations as any;
    const nextReleasedCount = (lc.shipments || []).filter((s) => s.status === 'Released').length;
    const now = new Date().toISOString();
    if (nextReleasedCount > prevReleasedCount && lc.landedAllocations && lc.landedAllocations.length > 0) {
      for (const alloc of lc.landedAllocations) {
        const prod = state.products.find((p) => p.sku.toUpperCase() === alloc.sku.toUpperCase());
        if (prod && alloc.qty > 0) {
          const before = prod.stockQty;
          prod.stockQty += alloc.qty;
          if (alloc.unitLandedCostBdt > 0) prod.unitCost = round2(alloc.unitLandedCostBdt);
          prod.updatedAt = now;
          recordInventoryMovement(state, {
            movementDate: now.slice(0, 10),
            sku: prod.sku,
            productName: prod.name,
            movementType: 'LC Release',
            qtyDelta: alloc.qty,
            qtyBefore: before,
            qtyAfter: prod.stockQty,
            unitCost: alloc.unitLandedCostBdt || prod.unitCost,
            valuationBdt: round2(alloc.totalLandedBdt || alloc.qty * prod.unitCost),
            warehouse: 'Dhaka Central Warehouse',
            sourceRef: lc.lcNumber,
          });
        }
      }
    }
    lc.updatedAt = now;
    appendAuditLog(state, 'PROCUREMENT', 'LANDED_COST_ALLOCATION', `Updated shipments & SKU landed costs for ${lc.lcNumber}.`, 'SUCCESS');
    saveState(state);
    return { state, lc } as T;
  }

  // Supply Chain: Inventory Serials (with Duplicate Serial Prevention)
  if (path === '/api/supply-chain/serials' && method === 'POST') {
    const serialNumber = String(body.serialNumber || '').trim().toUpperCase();
    if (!serialNumber) throw new Error('Serial Number is required.');
    const dup = state.inventorySerials.find(
      (s) => s.serialNumber.trim().toUpperCase() === serialNumber
    );
    if (dup) {
      throw new Error(
        `Duplicate Serial Blocked: '${serialNumber}' is already registered under ${dup.productName} (${dup.batchOrLcRef}).`
      );
    }
    const now = new Date().toISOString();
    const newSerial: InventorySerialUnit = {
      ...(body as Omit<InventorySerialUnit, 'id' | 'updatedAt'>),
      id: `SER-${String(state.inventorySerials.length + 1).padStart(4, '0')}`,
      serialNumber,
      updatedAt: now,
    };
    state.inventorySerials.unshift(newSerial);
    saveState(state);
    return { state, unit: newSerial } as T;
  }

  if (path.startsWith('/api/supply-chain/serials/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/supply-chain/serials/', ''));
    const idx = state.inventorySerials.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Serial unit not found.');
    if (body.serialNumber !== undefined) {
      const nextSn = String(body.serialNumber).trim().toUpperCase();
      const dup = state.inventorySerials.find(
        (s) => s.id !== id && s.serialNumber.trim().toUpperCase() === nextSn
      );
      if (dup) {
        throw new Error(`Duplicate Serial Blocked: '${nextSn}' already exists.`);
      }
    }
    const updated = {
      ...state.inventorySerials[idx],
      ...(body as Partial<InventorySerialUnit>),
      updatedAt: new Date().toISOString(),
    };
    state.inventorySerials[idx] = updated;
    saveState(state);
    return { state, unit: updated } as T;
  }

  if (path.startsWith('/api/supply-chain/serials/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/supply-chain/serials/', ''));
    state.inventorySerials = state.inventorySerials.filter((s) => s.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/supply-chain/stock-adjustments' && method === 'POST') {
    const now = new Date().toISOString();
    const sku = String(body.sku || '').trim();
    const qtyDelta = Number(body.qtyDelta) || 0;
    const warehouse = String(body.warehouse || 'Dhaka Central Warehouse').trim();
    const reason = String(body.reason || '').trim();
    const adjustmentDate = String(body.adjustmentDate || now.slice(0, 10));
    const offsetGlCode = String(body.offsetGlCode || '5010');

    if (!sku || qtyDelta === 0 || !reason) {
      throw new Error('SKU, non-zero Quantity Delta, and Adjustment Reason are required.');
    }
    const prod = state.products.find((p) => p.sku.toUpperCase() === sku.toUpperCase());
    if (!prod) throw new Error(`Product SKU '${sku}' not found in Product Master.`);
    if (prod.stockQty + qtyDelta < 0) {
      throw new Error(
        `Negative stock blocked: ${prod.name} (${prod.sku}) has ${prod.stockQty} units, cannot adjust by ${qtyDelta}.`
      );
    }

    const qtyBefore = prod.stockQty;
    const qtyAfter = qtyBefore + qtyDelta;
    prod.stockQty = qtyAfter;
    prod.updatedAt = now;

    const unitCost = round2(prod.unitCost || 0);
    const valDelta = round2(Math.abs(qtyDelta) * unitCost);
    const adjNo = `ADJ-${Date.now().toString().slice(-6)}`;

    if (valDelta > 0) {
      postViaCentralEngine(state, {
        sourceModule: 'INVENTORY_ADJ',
        idempotencyKey: `ADJ:${adjNo}:${prod.sku}`,
        voucherNo: adjNo,
        date: adjustmentDate,
        description: `Inventory Stock Adjustment ${adjNo} (${prod.sku}) — ${reason}`,
        reference: prod.sku,
        counterparty: warehouse,
        lines: buildInventoryAdjustmentJournalLines({
          isIncrease: qtyDelta > 0,
          amount: valDelta,
          inventoryGlCode: prod.inventoryGlCode || '1110',
          offsetGlCode,
          adjNo,
          reason,
        }),
      });
    }

    recordInventoryMovement(state, {
      movementDate: adjustmentDate,
      sku: prod.sku,
      productName: prod.name,
      movementType: 'Adjustment',
      qtyDelta,
      qtyBefore,
      qtyAfter,
      unitCost,
      valuationBdt: round2(qtyDelta * unitCost),
      warehouse,
      sourceRef: adjNo,
    });
    if (valDelta >= 50000) {
      state.approvalRequests = state.approvalRequests || [];
      state.approvalRequests.unshift({
        id: `APR-${String(state.approvalRequests.length + 1).padStart(4, '0')}`,
        requestNo: `APR-${adjNo}`,
        requestType: 'STOCK_ADJUSTMENT',
        module: 'Inventory',
        referenceId: adjNo,
        referenceNo: adjNo,
        summary: `High-value stock adjustment on ${prod.sku} (${qtyDelta > 0 ? `+${qtyDelta}` : qtyDelta} units): ${reason}`,
        amount: valDelta,
        requestedBy: state.config.operatorEmail,
        requestedAt: now,
        requiredRole: 'finance_controller',
        status: 'Pending',
      });
    }
    appendAuditLog(
      state,
      'INVENTORY',
      'STOCK_ADJUSTMENT',
      `Adjusted ${prod.sku} by ${qtyDelta > 0 ? `+${qtyDelta}` : qtyDelta} (${qtyBefore} → ${qtyAfter}) at ${warehouse}: ${reason}.`,
      'SUCCESS'
    );
    saveState(state);
    return { state } as T;
  }

  // Supply Chain: Treasury Tax Remittances (Dr 2200/2210 / Cr Bank)
  if (path === '/api/supply-chain/tax-remittances' && method === 'POST') {
    ensurePurchaseControlAccounts(state);
    state.taxRemittances = state.taxRemittances || [];
    const now = new Date().toISOString();
    const challanNo = String(body.challanNo || '').trim().toUpperCase();
    const amount = round2(Number(body.amount) || 0);
    if (!challanNo || amount <= 0) {
      throw new Error('Treasury Challan No. and positive Remittance Amount are required.');
    }
    const taxType = (body.taxType as 'TDS' | 'VDS') || 'TDS';
    const glCode = taxType === 'VDS' ? '2210' : '2200';
    const paidFromGlCode = String(body.paidFromGlCode || '1240');
    const voucherNo = `CHL-${challanNo}`;

    postViaCentralEngine(state, {
      sourceModule: 'TAX',
      idempotencyKey: `TAX:${voucherNo}`,
      voucherNo,
      date: String(body.remittanceDate || now.slice(0, 10)),
      description: `Treasury ${taxType} Remittance — Challan ${challanNo}`,
      reference: String(body.mushak66Ref || challanNo),
      counterparty: 'National Board of Revenue (NBR)',
      lines: [
        { glCode, debit: amount, credit: 0, memo: `${taxType} statutory deposit` },
        { glCode: paidFromGlCode, debit: 0, credit: amount, memo: `Challan ${challanNo}` },
      ],
    });

    const rem: TaxRemittanceRecord = {
      id: `TAX-${String(state.taxRemittances.length + 1).padStart(4, '0')}`,
      challanNo,
      remittanceDate: String(body.remittanceDate || now.slice(0, 10)),
      taxType,
      glCode,
      paidFromGlCode,
      amount,
      mushak66Ref: body.mushak66Ref ? String(body.mushak66Ref) : undefined,
      postedToGl: true,
      postedVoucherNo: voucherNo,
      notes: String(body.notes || ''),
      updatedAt: now,
    };
    state.taxRemittances.unshift(rem);
    appendAuditLog(state, 'TAX', 'TREASURY_REMITTANCE', `Posted ${taxType} Challan ${challanNo} for BDT ${amount.toFixed(2)}.`, 'SUCCESS');
    saveState(state);
    return { state, remittance: rem } as T;
  }

  // Supply Chain: Goods Receipts (Dr Inventory 1110 / Cr GRNI 2090)
  if (path === '/api/supply-chain/grns' && method === 'POST') {
    ensurePurchaseControlAccounts(state);
    state.goodsReceipts = state.goodsReceipts || [];
    const grnNo = String(body.grnNumber || '').trim().toUpperCase();
    if (!grnNo) throw new Error('GRN Number is required.');
    if (state.goodsReceipts.some((g) => g.grnNumber.toUpperCase() === grnNo)) {
      throw new Error(`Duplicate GRN blocked: '${grnNo}' already exists.`);
    }
    const now = new Date().toISOString();
    const totalAmount = round2(Number(body.totalAmount) || 0);
    const invGl = String(body.inventoryGlCode || '1110');
    const grniGl = String(body.grniGlCode || '2090');
    const shouldPost = body.postToGl !== false && totalAmount > 0;
    const voucherNo = shouldPost ? `JRN-${grnNo}` : undefined;

    if (shouldPost && voucherNo) {
      postViaCentralEngine(state, {
        sourceModule: 'GRN',
        idempotencyKey: `GRN:${grnNo}`,
        voucherNo,
        date: String(body.grnDate || now.slice(0, 10)),
        description: `Goods Receipt ${grnNo} (${String(body.sourceRef || '')})`,
        reference: grnNo,
        counterparty: String(body.supplierName || 'Vendor'),
        lines: buildGrnJournalLines({
          inventoryGlCode: invGl,
          grniGlCode: grniGl,
          amount: totalAmount,
          sourceRef: String(body.sourceRef || ''),
        }),
      });
    }

    const poMatch = body.sourceId
      ? state.localPurchaseOrders.find((p) => p.id === String(body.sourceId))
      : undefined;
    if (poMatch) {
      const receivedLines = Array.isArray(body.lines)
        ? (body.lines as Array<{ lineId?: string; sku?: string; receivedQty?: number }>)
        : [];
      if (poMatch.lines && receivedLines.length > 0) {
        for (const rLine of receivedLines) {
          const qty = Math.max(0, Number(rLine.receivedQty) || 0);
          if (qty <= 0) continue;
          const pLine = poMatch.lines.find((l) => l.id === rLine.lineId || (l.sku && l.sku === rLine.sku));
          if (pLine) {
            pLine.receivedQty = (pLine.receivedQty || 0) + qty;
          }
          const targetSku = rLine.sku || pLine?.sku;
          if (targetSku) {
            const prod = state.products.find((pr) => pr.sku.toUpperCase() === targetSku.toUpperCase());
            if (prod) {
              const before = prod.stockQty;
              prod.stockQty += qty;
              prod.updatedAt = now;
              recordInventoryMovement(state, {
                movementDate: String(body.grnDate || now.slice(0, 10)),
                sku: prod.sku,
                productName: prod.name,
                movementType: 'GRN',
                qtyDelta: qty,
                qtyBefore: before,
                qtyAfter: prod.stockQty,
                unitCost: prod.unitCost || 0,
                valuationBdt: round2(qty * (prod.unitCost || 0)),
                warehouse: String(body.warehouse || 'Dhaka Central Warehouse'),
                sourceRef: grnNo,
              });
            }
          }
        }
        const allReceived = poMatch.lines.every((l) => (l.receivedQty || 0) >= l.qty);
        poMatch.receiptStatus = allReceived ? 'Received' : 'Partially Received';
        poMatch.status = allReceived ? 'Received' : 'Partially Received';
      } else if (body.status === 'Accepted') {
        poMatch.receiptStatus = totalAmount >= poMatch.netAmount - 1 ? 'Received' : 'Partially Received';
        poMatch.status = totalAmount >= poMatch.netAmount - 1 ? 'Received' : 'Partially Received';
      }
      poMatch.grnNumber = poMatch.grnNumber ? `${poMatch.grnNumber}, ${grnNo}` : grnNo;
      poMatch.updatedAt = now;
    }

    const newGrn: GoodsReceiptRecord = {
      id: `GRN-${String(state.goodsReceipts.length + 1).padStart(4, '0')}`,
      grnNumber: grnNo,
      grnDate: String(body.grnDate || now.slice(0, 10)),
      sourceType: (body.sourceType as 'PO' | 'LC') || 'PO',
      sourceId: String(body.sourceId || ''),
      sourceRef: String(body.sourceRef || ''),
      supplierId: String(body.supplierId || ''),
      supplierName: String(body.supplierName || ''),
      warehouse: String(body.warehouse || 'Dhaka Central Warehouse'),
      inventoryGlCode: invGl,
      grniGlCode: grniGl,
      totalAmount,
      status: (body.status as GoodsReceiptRecord['status']) || 'Accepted',
      postedToGl: shouldPost,
      postedVoucherNo: voucherNo,
      notes: String(body.notes || ''),
      updatedAt: now,
    };
    state.goodsReceipts.unshift(newGrn);
    appendAuditLog(state, 'PROCUREMENT', 'CREATE_GRN', `Created GRN ${grnNo} (BDT ${totalAmount.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, grn: newGrn } as T;
  }

  // Supply Chain: Purchase Invoices (Dr GRNI 2090 / Cr AP 2080)
  if (path === '/api/supply-chain/purchase-invoices' && method === 'POST') {
    ensurePurchaseControlAccounts(state);
    state.purchaseInvoices = state.purchaseInvoices || [];
    const invNo = String(body.invoiceNumber || '').trim().toUpperCase();
    const supInvNo = String(body.supplierInvoiceNo || '').trim().toUpperCase();
    const supplierId = String(body.supplierId || '').trim();
    if (!invNo || !supInvNo || !supplierId) {
      throw new Error('Internal Invoice No., Supplier Bill No., and Supplier are required.');
    }
    const dup = state.purchaseInvoices.find(
      (i) =>
        i.status !== 'Voided' &&
        (i.invoiceNumber.toUpperCase() === invNo ||
          (i.supplierId === supplierId && i.supplierInvoiceNo.toUpperCase() === supInvNo))
    );
    if (dup) {
      throw new Error(
        `Duplicate Supplier Invoice blocked: Bill '${supInvNo}' is already recorded under ${dup.invoiceNumber}.`
      );
    }

    const now = new Date().toISOString();
    const netAmount = round2(Number(body.netAmount) || 0);
    const vatAmount = round2(Number(body.vatAmount) || 0);
    const grossAmount = round2(Number(body.grossAmount) || netAmount + vatAmount);
    if (grossAmount <= 0) {
      throw new Error('Invoice gross amount must be greater than zero.');
    }

    const debitGl = String(body.debitGlCode || (body.grnId ? '2090' : '5010'));
    const apGl = String(body.apGlCode || '2080');
    const shouldPost = body.postToGl !== false;
    const voucherNo = shouldPost ? `JRN-${invNo}` : undefined;

    if (shouldPost && voucherNo) {
      postViaCentralEngine(state, {
        sourceModule: 'PURCHASE_INVOICE',
        idempotencyKey: `PINV:${invNo}`,
        voucherNo,
        date: String(body.invoiceDate || now.slice(0, 10)),
        description: `Purchase Invoice ${invNo} (Vendor Bill ${supInvNo})`,
        reference: supInvNo,
        counterparty: String(body.supplierName || 'Vendor'),
        lines: buildPurchaseInvoiceJournalLines({
          debitGlCode: debitGl,
          apGlCode: apGl,
          netAmount,
          vatAmount,
          grossAmount,
          supplierInvoiceNo: supInvNo,
        }),
      });
    }
    if (body.sourceId) {
      const poMatch = state.localPurchaseOrders.find((p) => p.id === String(body.sourceId));
      if (poMatch) {
        poMatch.invoiceStatus = grossAmount >= poMatch.grossAmount - 1 ? 'Billed' : 'Partially Billed';
        poMatch.updatedAt = now;
      }
    }

    const newInv: PurchaseInvoiceRecord = {
      id: `PINV-${String(state.purchaseInvoices.length + 1).padStart(4, '0')}`,
      invoiceNumber: invNo,
      supplierInvoiceNo: supInvNo,
      invoiceDate: String(body.invoiceDate || now.slice(0, 10)),
      dueDate: String(body.dueDate || now.slice(0, 10)),
      supplierId,
      supplierName: String(body.supplierName || ''),
      sourceType: (body.sourceType as PurchaseInvoiceRecord['sourceType']) || 'PO',
      sourceId: body.sourceId ? String(body.sourceId) : undefined,
      sourceRef: body.sourceRef ? String(body.sourceRef) : undefined,
      grnId: body.grnId ? String(body.grnId) : undefined,
      grnNumber: body.grnNumber ? String(body.grnNumber) : undefined,
      debitGlCode: debitGl,
      apGlCode: apGl,
      netAmount,
      vatAmount,
      grossAmount,
      paidAmount: 0,
      outstandingAmount: grossAmount,
      mushak63Ref: body.mushak63Ref ? String(body.mushak63Ref) : undefined,
      status: shouldPost ? 'Posted' : 'Draft',
      postedToGl: shouldPost,
      postedVoucherNo: voucherNo,
      notes: String(body.notes || ''),
      updatedAt: now,
    };
    state.purchaseInvoices.unshift(newInv);
    appendAuditLog(state, 'PROCUREMENT', 'CREATE_PURCHASE_INVOICE', `Posted Purchase Invoice ${invNo} (${supInvNo}) for BDT ${grossAmount.toFixed(2)}.`, 'SUCCESS');
    saveState(state);
    return { state, invoice: newInv } as T;
  }

  // Voucher Management: Create, Post to GL (atomic & duplicate-safe), Void/Reverse, Delete
  if (path === '/api/vouchers' && method === 'POST') {
    ensurePurchaseControlAccounts(state);
    const now = new Date().toISOString();
    const postImmediately = Boolean(body.postImmediately);
    const voucherRef = String(body.voucherRef || '').trim();
    if (!voucherRef) throw new Error('Voucher Reference is required.');
    if (state.vouchers.some((v) => v.voucherRef.toUpperCase() === voucherRef.toUpperCase() && v.status !== 'Voided')) {
      throw new Error(`Duplicate Voucher Reference '${voucherRef}' already exists.`);
    }

    const newVoucher: VoucherRecord = {
      ...(body as Omit<VoucherRecord, 'id' | 'updatedAt' | 'createdBy' | 'postedToGl'>),
      id: `VCH-${String(state.vouchers.length + 1).padStart(4, '0')}`,
      voucherRef,
      status: 'Auto-Approved',
      postedToGl: false,
      createdBy: state.config.operatorEmail,
      updatedAt: now,
    };

    if (postImmediately) {
      applyPaymentAllocationsToInvoices(state, newVoucher.invoiceAllocations, false);
      applyReceiptAllocationsToSalesInvoices(state, newVoucher.salesInvoiceAllocations, false);
      postViaCentralEngine(state, {
        sourceModule: 'VOUCHER',
        idempotencyKey: `VCH:${newVoucher.voucherRef}`,
        voucherNo: newVoucher.voucherRef,
        date: newVoucher.postingDate || newVoucher.voucherDate,
        description: newVoucher.narration || `${newVoucher.voucherType} Voucher ${newVoucher.voucherRef}`,
        reference: newVoucher.bankReferenceNo || newVoucher.voucherRef,
        counterparty: newVoucher.supplierName || newVoucher.customerName || newVoucher.employeeName || 'ATCL',
        lines: newVoucher.doubleEntryLines,
      });
      newVoucher.postedToGl = true;
      newVoucher.status = 'Posted to GL';
      newVoucher.postedVoucherNo = newVoucher.voucherRef;

      if (newVoucher.voucherType === 'Receipt' && newVoucher.isCustomerAdvance && newVoucher.customerId) {
        state.customerAdvances = state.customerAdvances || [];
        const advAmt = round2(Number(newVoucher.collectionAmount || newVoucher.totalAmount) || 0);
        if (advAmt > 0) {
          state.customerAdvances.unshift({
            id: `ADV-${String(state.customerAdvances.length + 1).padStart(4, '0')}`,
            advanceNo: `ADV-${newVoucher.voucherRef}`,
            receiptDate: newVoucher.voucherDate,
            customerId: newVoucher.customerId,
            customerName: newVoucher.customerName || 'Customer',
            amount: advAmt,
            appliedAmount: 0,
            unappliedAmount: advAmt,
            depositToGlCode: newVoucher.depositToGlCode || '1240',
            advanceGlCode: '2110',
            postedVoucherNo: newVoucher.voucherRef,
            status: 'Open',
            updatedAt: now,
          });
        }
      }
    }

    state.vouchers.unshift(newVoucher);
    if (!postImmediately && newVoucher.totalAmount >= (state.config.dualApprovalThreshold || 1000000)) {
      state.approvalRequests = state.approvalRequests || [];
      state.approvalRequests.unshift({
        id: `APR-${String(state.approvalRequests.length + 1).padStart(4, '0')}`,
        requestNo: `APR-${newVoucher.voucherRef}`,
        requestType: newVoucher.voucherType === 'Payment' ? 'PAYMENT' : 'VOUCHER',
        module: 'Vouchers',
        referenceId: newVoucher.id,
        referenceNo: newVoucher.voucherRef,
        summary: `${newVoucher.voucherType} Voucher >= dual approval threshold (${newVoucher.narration})`,
        amount: newVoucher.totalAmount,
        requestedBy: newVoucher.createdBy,
        requestedAt: now,
        requiredRole: 'finance_controller',
        status: 'Pending',
      });
    }
    appendAuditLog(
      state,
      'VOUCHERS',
      postImmediately ? 'CREATE_AND_POST_VOUCHER' : 'CREATE_VOUCHER',
      `${newVoucher.voucherType} Voucher ${newVoucher.voucherRef} (${postImmediately ? 'Posted to GL' : 'Auto-Approved'}).`,
      'SUCCESS'
    );
    saveState(state);
    return { state, voucher: newVoucher } as T;
  }

  if (path.startsWith('/api/vouchers/') && path.endsWith('/post-gl') && method === 'POST') {
    ensurePurchaseControlAccounts(state);
    ensureSalesControlAccounts(state);
    const id = decodeURIComponent(path.replace('/api/vouchers/', '').replace('/post-gl', ''));
    const voucher = state.vouchers.find((v) => v.id === id);
    if (!voucher) throw new Error('Voucher record not found.');
    if (voucher.postedToGl) {
      throw new Error(`Duplicate posting blocked: Voucher ${voucher.voucherRef} is already posted to GL.`);
    }
    if (voucher.status === 'Voided') {
      throw new Error(`Cannot post a voided voucher (${voucher.voucherRef}).`);
    }

    applyPaymentAllocationsToInvoices(state, voucher.invoiceAllocations, false);
    applyReceiptAllocationsToSalesInvoices(state, voucher.salesInvoiceAllocations, false);
    postViaCentralEngine(state, {
      sourceModule: 'VOUCHER',
      idempotencyKey: `VCH:${voucher.voucherRef}`,
      voucherNo: voucher.voucherRef,
      date: voucher.postingDate || voucher.voucherDate,
      description: voucher.narration || `${voucher.voucherType} Voucher ${voucher.voucherRef}`,
      reference: voucher.bankReferenceNo || voucher.voucherRef,
      counterparty: voucher.supplierName || voucher.customerName || voucher.employeeName || 'ATCL',
      lines: voucher.doubleEntryLines,
    });
    voucher.postedToGl = true;
    voucher.status = 'Posted to GL';
    voucher.postedVoucherNo = voucher.voucherRef;
    voucher.updatedAt = new Date().toISOString();

    if (voucher.voucherType === 'Receipt' && voucher.isCustomerAdvance && voucher.customerId) {
      state.customerAdvances = state.customerAdvances || [];
      const advAmt = round2(Number(voucher.collectionAmount || voucher.totalAmount) || 0);
      if (advAmt > 0) {
        state.customerAdvances.unshift({
          id: `ADV-${String(state.customerAdvances.length + 1).padStart(4, '0')}`,
          advanceNo: `ADV-${voucher.voucherRef}`,
          receiptDate: voucher.voucherDate,
          customerId: voucher.customerId,
          customerName: voucher.customerName || 'Customer',
          amount: advAmt,
          appliedAmount: 0,
          unappliedAmount: advAmt,
          depositToGlCode: voucher.depositToGlCode || '1240',
          advanceGlCode: '2110',
          postedVoucherNo: voucher.voucherRef,
          status: 'Open',
          updatedAt: voucher.updatedAt,
        });
      }
    }

    appendAuditLog(state, 'VOUCHERS', 'POST_VOUCHER_GL', `Posted ${voucher.voucherRef} to General Ledger.`, 'SUCCESS');
    saveState(state);
    return { state, voucher } as T;
  }

  if (path.startsWith('/api/vouchers/') && path.endsWith('/void') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/vouchers/', '').replace('/void', ''));
    const voucher = state.vouchers.find((v) => v.id === id);
    if (!voucher) throw new Error('Voucher record not found.');
    if (voucher.status === 'Voided') {
      throw new Error(`Voucher ${voucher.voucherRef} is already voided.`);
    }

    if (voucher.postedToGl) {
      applyPaymentAllocationsToInvoices(state, voucher.invoiceAllocations, true);
      applyReceiptAllocationsToSalesInvoices(state, voucher.salesInvoiceAllocations, true);
      if (voucher.postedVoucherNo) {
        reverseViaCentralEngine(state, voucher.postedVoucherNo, `Void / Reversal of ${voucher.voucherRef}`);
      }
    }
    voucher.status = 'Voided';
    voucher.updatedAt = new Date().toISOString();
    appendAuditLog(state, 'VOUCHERS', 'VOID_VOUCHER', `Voided voucher ${voucher.voucherRef}${voucher.postedToGl ? ' with GL reversal' : ''}.`, 'WARNING');
    saveState(state);
    return { state, voucher } as T;
  }

  if (path.startsWith('/api/vouchers/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/vouchers/', ''));
    const voucher = state.vouchers.find((v) => v.id === id);
    if (!voucher) throw new Error('Voucher record not found.');
    if (voucher.postedToGl) {
      throw new Error(`Posted voucher ${voucher.voucherRef} cannot be deleted. Use Void / Reverse instead.`);
    }
    state.vouchers = state.vouchers.filter((v) => v.id !== id);
    saveState(state);
    return { state } as T;
  }

  // Sales & Service: Sales Orders (with Credit Control), Dedicated Sales Invoices (AR 1120), Customer Advances (2110)
  if (path === '/api/sales-service/sales-orders' && method === 'POST') {
    const now = new Date().toISOString();
    const customer = state.customers.find((c) => c.id === String(body.customerId || ''));
    const gross = round2(Number(body.grossAmount) || 0);
    const overrideReason = String(body.creditOverrideReason || '').trim();
    if (customer) {
      if (customer.status !== 'Active' && !overrideReason) {
        throw new Error(
          `Credit Control Block: Customer '${customer.name}' is ${customer.status}. Provide an authorized Credit Override Reason to proceed.`
        );
      }
      if (customer.creditLimit > 0 && customer.currentReceivable + gross > customer.creditLimit && !overrideReason) {
        throw new Error(
          `Credit Limit Exceeded: Receivable (${(customer.currentReceivable + gross).toLocaleString()}) exceeds limit (${customer.creditLimit.toLocaleString()}). Provide an authorized Credit Override Reason.`
        );
      }
    }
    const newOrder: SalesOrderRecord = {
      ...(body as Omit<SalesOrderRecord, 'id' | 'updatedAt'>),
      id: `SO-${String(state.salesOrders.length + 1).padStart(4, '0')}`,
      orderStatus: (body.orderStatus as SalesOrderRecord['orderStatus']) || 'Confirmed',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Unpaid',
      updatedAt: now,
    };
    state.salesOrders.unshift(newOrder);
    if (overrideReason) {
      state.approvalRequests = state.approvalRequests || [];
      state.approvalRequests.unshift({
        id: `APR-${String(state.approvalRequests.length + 1).padStart(4, '0')}`,
        requestNo: `APR-${newOrder.orderNo}`,
        requestType: 'CREDIT_OVERRIDE',
        module: 'Sales',
        referenceId: newOrder.id,
        referenceNo: newOrder.orderNo,
        summary: `Credit control override for ${newOrder.customerName}: ${overrideReason}`,
        amount: gross,
        requestedBy: state.config.operatorEmail,
        requestedAt: now,
        requiredRole: 'finance_controller',
        status: 'Pending',
      });
      appendAuditLog(
        state,
        'SALES',
        'CREDIT_OVERRIDE',
        `Credit override on ${newOrder.orderNo} for ${newOrder.customerName}: ${overrideReason}`,
        'WARNING'
      );
    } else {
      appendAuditLog(state, 'SALES', 'CREATE_SO', `Created Sales Order ${newOrder.orderNo} for ${newOrder.customerName}.`, 'SUCCESS');
    }
    saveState(state);
    return { state, order: newOrder } as T;
  }

  // Sales & Service: Quotations & Conversion to Sales Order
  if (path === '/api/sales-service/quotations' && method === 'POST') {
    state.salesQuotations = state.salesQuotations || [];
    const now = new Date().toISOString();
    const newQuote: SalesQuotationRecord = {
      ...(body as Omit<SalesQuotationRecord, 'id' | 'updatedAt'>),
      id: `QTN-${String(state.salesQuotations.length + 1).padStart(4, '0')}`,
      updatedAt: now,
    };
    state.salesQuotations.unshift(newQuote);
    appendAuditLog(state, 'SALES', 'CREATE_QUOTATION', `Issued Quotation ${newQuote.quoteNo} for ${newQuote.customerName}.`, 'SUCCESS');
    saveState(state);
    return { state, quotation: newQuote } as T;
  }

  if (path.startsWith('/api/sales-service/quotations/') && path.endsWith('/convert') && method === 'POST') {
    state.salesQuotations = state.salesQuotations || [];
    const id = decodeURIComponent(path.replace('/api/sales-service/quotations/', '').replace('/convert', ''));
    const quote = state.salesQuotations.find((q) => q.id === id);
    if (!quote) throw new Error('Sales Quotation not found.');
    if (quote.status === 'Converted') throw new Error(`Quotation ${quote.quoteNo} is already converted.`);

    const now = new Date().toISOString();
    const orderNo = `SO-${new Date().getFullYear()}-${String(state.salesOrders.length + 101).padStart(4, '0')}`;
    const newOrder: SalesOrderRecord = {
      id: `SO-${String(state.salesOrders.length + 1).padStart(4, '0')}`,
      orderNo,
      orderDate: now.slice(0, 10),
      deliveryDate: now.slice(0, 10),
      customerId: quote.customerId,
      customerName: quote.customerName,
      channel: quote.channel,
      salesRep: state.config.operatorEmail,
      description: quote.lines.map((l) => `${l.description} (${l.qty} ${l.unit})`).join(', ') || quote.quoteNo,
      lines: quote.lines,
      netAmount: quote.netAmount,
      vatRate: quote.netAmount > 0 ? round2((quote.vatAmount / quote.netAmount) * 100) : 15,
      vatAmount: quote.vatAmount,
      grossAmount: quote.grossAmount,
      collectedAmount: 0,
      commissionAmount: 0,
      revenueGlCode: '4010',
      challanNo: '',
      status: 'Confirmed',
      orderStatus: 'Confirmed',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Unpaid',
      notes: `Converted from Quotation ${quote.quoteNo}`,
      updatedAt: now,
    };
    state.salesOrders.unshift(newOrder);
    quote.status = 'Converted';
    quote.linkedOrderNo = orderNo;
    quote.updatedAt = now;
    appendAuditLog(state, 'SALES', 'CONVERT_QUOTATION', `Converted ${quote.quoteNo} → ${orderNo}.`, 'SUCCESS');
    saveState(state);
    return { state, quotation: quote, order: newOrder } as T;
  }

  // Sales & Service: Delivery Orders / Challans & Serial Dispatch Validation
  if (path === '/api/sales-service/delivery-orders' && method === 'POST') {
    state.deliveryOrders = state.deliveryOrders || [];
    const now = new Date().toISOString();
    const challanNo = String(body.challanNo || '').trim().toUpperCase();
    const so = state.salesOrders.find((o) => o.id === String(body.salesOrderId || ''));
    if (!challanNo || !so) throw new Error('Challan Number and Sales Order are required.');
    if (state.deliveryOrders.some((d) => d.challanNo.toUpperCase() === challanNo && d.status !== 'Cancelled')) {
      throw new Error(`Duplicate Challan Number '${challanNo}' already exists.`);
    }

    const allocatedSerials = Array.isArray(body.allocatedSerials) ? (body.allocatedSerials as string[]) : [];
    for (const sn of allocatedSerials) {
      const unit = state.inventorySerials.find((u) => u.serialNumber.toUpperCase() === sn.toUpperCase());
      if (!unit) throw new Error(`Serial '${sn}' not found in Inventory Serial Register.`);
      if (unit.status !== 'In Stock' && unit.status !== 'Reserved') {
        throw new Error(`Serial '${sn}' cannot be dispatched (current status: ${unit.status}).`);
      }
      if (unit.warehouseLocation === 'Chattogram Port Bonded') {
        throw new Error(`Serial '${sn}' is in Chattogram Port Bonded stock and cannot be dispatched until customs cleared.`);
      }
    }

    for (const sn of allocatedSerials) {
      const unit = state.inventorySerials.find((u) => u.serialNumber.toUpperCase() === sn.toUpperCase());
      if (unit) {
        const fromWarehouse = unit.warehouseLocation || String(body.warehouse || 'Dhaka Central Warehouse');
        unit.status = 'Issued to Project';
        unit.warehouseLocation = 'Client Site Deployed';
        unit.assignedCustomer = so.customerName;
        unit.updatedAt = now;
        const prod = state.products.find((p) => p.sku.toUpperCase() === unit.sku.toUpperCase());
        const before = prod?.stockQty ?? 1;
        if (prod && prod.stockQty > 0) {
          prod.stockQty -= 1;
          prod.updatedAt = now;
        }
        recordInventoryMovement(state, {
          movementDate: String(body.deliveryDate || now.slice(0, 10)),
          sku: unit.sku,
          productName: unit.productName,
          movementType: 'Sales Dispatch',
          qtyDelta: -1,
          qtyBefore: before,
          qtyAfter: prod ? prod.stockQty : Math.max(0, before - 1),
          unitCost: unit.unitCost,
          valuationBdt: -round2(unit.unitCost),
          warehouse: fromWarehouse,
          sourceRef: challanNo,
        });
      }
    }

    const deliveryLines = Array.isArray(body.lines) ? (body.lines as Array<{ sku?: string; dispatchedQty?: number; description?: string }>) : [];
    if (so.lines && deliveryLines.length > 0) {
      for (const dl of deliveryLines) {
        const dQty = Math.max(0, Number(dl.dispatchedQty) || 0);
        if (dQty <= 0) continue;
        const sLine = so.lines.find((l) => (dl.sku && l.sku === dl.sku) || l.description === dl.description);
        if (sLine) {
          sLine.deliveredQty = (sLine.deliveredQty || 0) + dQty;
        }
        if (allocatedSerials.length === 0 && dl.sku) {
          const prod = state.products.find((p) => p.sku.toUpperCase() === dl.sku!.toUpperCase());
          if (prod) {
            const before = prod.stockQty;
            prod.stockQty = Math.max(0, before - dQty);
            prod.updatedAt = now;
            recordInventoryMovement(state, {
              movementDate: String(body.deliveryDate || now.slice(0, 10)),
              sku: prod.sku,
              productName: prod.name,
              movementType: 'Sales Dispatch',
              qtyDelta: -dQty,
              qtyBefore: before,
              qtyAfter: prod.stockQty,
              unitCost: prod.unitCost,
              valuationBdt: -round2(dQty * prod.unitCost),
              warehouse: String(body.warehouse || 'Dhaka Central Warehouse'),
              sourceRef: challanNo,
            });
          }
        }
      }
    }

    const newDo: DeliveryOrderRecord = {
      ...(body as Omit<DeliveryOrderRecord, 'id' | 'updatedAt'>),
      id: `DO-${String(state.deliveryOrders.length + 1).padStart(4, '0')}`,
      challanNo,
      salesOrderId: so.id,
      salesOrderNo: so.orderNo,
      customerId: so.customerId,
      customerName: so.customerName,
      allocatedSerials,
      updatedAt: now,
    };
    state.deliveryOrders.unshift(newDo);
    so.challanNo = so.challanNo ? `${so.challanNo}, ${challanNo}` : challanNo;
    const allLinesDelivered =
      so.lines && so.lines.length > 0
        ? so.lines.every((l) => (l.deliveredQty || 0) >= l.qty)
        : body.status === 'Delivered';
    so.deliveryStatus = allLinesDelivered ? 'Fully Delivered' : 'Partially Delivered';
    if (so.status === 'Confirmed') so.status = 'Dispatched';
    so.updatedAt = now;
    appendAuditLog(state, 'SALES', 'CREATE_DELIVERY', `Dispatched Challan ${challanNo} against ${so.orderNo} (${allocatedSerials.length} serials).`, 'SUCCESS');
    saveState(state);
    return { state, deliveryOrder: newDo } as T;
  }

  if (path.startsWith('/api/sales-service/delivery-orders/') && path.endsWith('/cancel') && method === 'PATCH') {
    state.deliveryOrders = state.deliveryOrders || [];
    const id = decodeURIComponent(path.replace('/api/sales-service/delivery-orders/', '').replace('/cancel', ''));
    const dOrder = state.deliveryOrders.find((d) => d.id === id);
    if (!dOrder) throw new Error('Delivery Order not found.');
    if (dOrder.status === 'Cancelled') throw new Error('Delivery Order is already cancelled.');

    const now = new Date().toISOString();
    for (const sn of dOrder.allocatedSerials) {
      const unit = state.inventorySerials.find((u) => u.serialNumber.toUpperCase() === sn.toUpperCase());
      if (unit) {
        unit.status = 'In Stock';
        unit.warehouseLocation = (dOrder.warehouse as InventorySerialUnit['warehouseLocation']) || 'Dhaka Central Warehouse';
        unit.assignedCustomer = '';
        unit.updatedAt = now;
        const prod = state.products.find((p) => p.sku.toUpperCase() === unit.sku.toUpperCase());
        const before = prod?.stockQty ?? 0;
        if (prod) {
          prod.stockQty += 1;
          prod.updatedAt = now;
        }
        recordInventoryMovement(state, {
          movementDate: now.slice(0, 10),
          sku: unit.sku,
          productName: unit.productName,
          movementType: 'Adjustment',
          qtyDelta: 1,
          qtyBefore: before,
          qtyAfter: prod ? prod.stockQty : before + 1,
          unitCost: unit.unitCost,
          valuationBdt: round2(unit.unitCost),
          warehouse: unit.warehouseLocation,
          sourceRef: dOrder.challanNo,
        });
      }
    }
    dOrder.status = 'Cancelled';
    dOrder.updatedAt = now;
    appendAuditLog(state, 'SALES', 'CANCEL_DELIVERY', `Cancelled Challan ${dOrder.challanNo} and restored ${dOrder.allocatedSerials.length} serials to In Stock.`, 'WARNING');
    saveState(state);
    return { state, deliveryOrder: dOrder } as T;
  }

  if (path.startsWith('/api/sales-service/sales-orders/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/sales-service/sales-orders/', ''));
    const idx = state.salesOrders.findIndex((o) => o.id === id);
    if (idx === -1) throw new Error('Sales Order not found.');
    const updated = {
      ...state.salesOrders[idx],
      ...(body as Partial<SalesOrderRecord>),
      updatedAt: new Date().toISOString(),
    };
    state.salesOrders[idx] = updated;
    saveState(state);
    return { state, order: updated } as T;
  }

  if (path.startsWith('/api/sales-service/sales-orders/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/sales-service/sales-orders/', ''));
    state.salesOrders = state.salesOrders.filter((o) => o.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/sales-service/sales-invoices' && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.salesInvoices = state.salesInvoices || [];
    const invNo = String(body.invoiceNumber || '').trim().toUpperCase();
    const customerId = String(body.customerId || '').trim();
    if (!invNo || !customerId) throw new Error('Invoice Number and Customer are required.');
    if (state.salesInvoices.some((i) => i.invoiceNumber.toUpperCase() === invNo && i.status !== 'Voided')) {
      throw new Error(`Duplicate Sales Invoice blocked: '${invNo}' already exists.`);
    }

    const now = new Date().toISOString();
    const netAmount = round2(Number(body.netAmount) || 0);
    const vatAmount = round2(Number(body.vatAmount) || 0);
    const grossAmount = round2(Number(body.grossAmount) || netAmount + vatAmount);
    const cogsAmount = round2(Number(body.cogsAmount) || 0);
    if (grossAmount <= 0) throw new Error('Sales Invoice gross amount must be greater than zero.');

    const arGl = String(body.arGlCode || '1120');
    const revGl = String(body.revenueGlCode || '4010');
    const vatGl = String(body.vatGlCode || '2070');
    const shouldPost = body.postToGl !== false;
    const voucherNo = shouldPost ? `JRN-${invNo}` : undefined;

    if (shouldPost && voucherNo) {
      postViaCentralEngine(state, {
        sourceModule: 'SALES_INVOICE',
        idempotencyKey: `SINV:${invNo}`,
        voucherNo,
        date: String(body.invoiceDate || now.slice(0, 10)),
        description: `Sales Invoice ${invNo}${body.salesOrderNo ? ` (${String(body.salesOrderNo)})` : ''}`,
        reference: invNo,
        counterparty: String(body.customerName || 'Customer'),
        lines: buildSalesInvoiceJournalLines({
          arGlCode: arGl,
          revenueGlCode: revGl,
          vatGlCode: vatGl,
          netAmount,
          vatAmount,
          grossAmount,
          cogsAmount,
          invoiceNumber: invNo,
        }),
      });
    }
    if (body.salesOrderId) {
      const soMatch = state.salesOrders.find((o) => o.id === String(body.salesOrderId));
      if (soMatch) {
        if (soMatch.lines && Array.isArray(body.lines)) {
          for (const il of body.lines as Array<{ sku?: string; qty?: number; description?: string }>) {
            const sLine = soMatch.lines.find((l) => (il.sku && l.sku === il.sku) || l.description === il.description);
            if (sLine) {
              sLine.invoicedQty = (sLine.invoicedQty || 0) + (Number(il.qty) || 0);
            }
          }
        }
        soMatch.invoiceStatus = grossAmount >= soMatch.grossAmount - 1 ? 'Fully Invoiced' : 'Partially Invoiced';
        if (soMatch.status === 'Confirmed' || soMatch.status === 'Dispatched') {
          soMatch.status = 'Invoiced';
        }
        soMatch.updatedAt = now;
      }
    }

    const newInv: SalesInvoiceRecord = {
      id: `SINV-${String(state.salesInvoices.length + 1).padStart(4, '0')}`,
      invoiceNumber: invNo,
      invoiceDate: String(body.invoiceDate || now.slice(0, 10)),
      dueDate: String(body.dueDate || now.slice(0, 10)),
      customerId,
      customerName: String(body.customerName || ''),
      salesOrderId: body.salesOrderId ? String(body.salesOrderId) : undefined,
      salesOrderNo: body.salesOrderNo ? String(body.salesOrderNo) : undefined,
      deliveryOrderNo: body.deliveryOrderNo ? String(body.deliveryOrderNo) : undefined,
      projectCode: body.projectCode ? String(body.projectCode) : undefined,
      lines: Array.isArray(body.lines) ? (body.lines as any) : [],
      netAmount,
      vatAmount,
      grossAmount,
      paidAmount: 0,
      tdsDeductedAmount: 0,
      vdsDeductedAmount: 0,
      creditNoteAmount: 0,
      outstandingAmount: grossAmount,
      cogsAmount,
      revenueGlCode: revGl,
      arGlCode: arGl,
      vatGlCode: vatGl,
      mushak63Ref: body.mushak63Ref ? String(body.mushak63Ref) : undefined,
      status: shouldPost ? 'Posted' : 'Draft',
      postedToGl: shouldPost,
      postedVoucherNo: voucherNo,
      notes: String(body.notes || ''),
      updatedAt: now,
    };
    state.salesInvoices.unshift(newInv);
    appendAuditLog(state, 'SALES', 'CREATE_SALES_INVOICE', `Posted Sales Invoice ${invNo} for BDT ${grossAmount.toFixed(2)}.`, 'SUCCESS');
    saveState(state);
    return { state, invoice: newInv } as T;
  }

  if (path === '/api/sales-service/customer-advances/apply' && method === 'POST') {
    ensureSalesControlAccounts(state);
    const advance = (state.customerAdvances || []).find((a) => a.id === String(body.advanceId || ''));
    const invoice = (state.salesInvoices || []).find((i) => i.id === String(body.invoiceId || ''));
    const amt = round2(Number(body.amount) || 0);
    if (!advance || !invoice) throw new Error('Customer Advance and Sales Invoice are required.');
    if (amt <= 0 || amt > advance.unappliedAmount + 0.01 || amt > invoice.outstandingAmount + 0.01) {
      throw new Error('Invalid advance application amount.');
    }
    const now = new Date().toISOString();
    const voucherNo = `ADVA-${advance.advanceNo}-${invoice.invoiceNumber}`;
    postViaCentralEngine(state, {
      sourceModule: 'ADVANCE',
      idempotencyKey: `ADV:${voucherNo}`,
      voucherNo,
      date: now.slice(0, 10),
      description: `Apply Customer Advance ${advance.advanceNo} to ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      counterparty: invoice.customerName,
      lines: [
        { glCode: '2110', debit: amt, credit: 0, memo: `Settle Customer Advance ${advance.advanceNo}` },
        { glCode: invoice.arGlCode || '1120', debit: 0, credit: amt, memo: `Reduce AR on ${invoice.invoiceNumber}` },
      ],
    });
    advance.appliedAmount = round2(advance.appliedAmount + amt);
    advance.unappliedAmount = round2(Math.max(0, advance.amount - advance.appliedAmount));
    advance.status = advance.unappliedAmount <= 0.01 ? 'Applied' : 'Partially Applied';
    advance.updatedAt = now;
    applyReceiptAllocationsToSalesInvoices(
      state,
      [{ invoiceId: invoice.id, invoiceNo: invoice.invoiceNumber, allocatedAmount: amt }],
      false
    );
    saveState(state);
    return { state, advance, invoice } as T;
  }

  // Sales & Service: Retail Counter POS (Stock Deduction, COGS & Clearing GL 1250)
  if (path === '/api/sales-service/pos-sales' && method === 'POST') {
    ensureSalesControlAccounts(state);
    const now = new Date().toISOString();
    const items = Array.isArray(body.items) ? (body.items as PosTransaction['items']) : [];
    if (items.length === 0) throw new Error('At least one POS line item is required.');

    const receiptNo = `POS-${new Date().getFullYear()}-${String(state.posTransactions.length + 1001).padStart(4, '0')}`;
    let totalCogs = 0;
    for (const item of items) {
      const qty = Math.max(1, Number(item.qty) || 1);
      const prod = state.products.find((p) => p.sku === item.sku);
      if (prod) {
        if (prod.stockQty < qty) {
          throw new Error(`Insufficient stock for ${prod.name} (${prod.sku}): available ${prod.stockQty}, requested ${qty}.`);
        }
        const before = prod.stockQty;
        prod.stockQty -= qty;
        prod.updatedAt = now;
        totalCogs = round2(totalCogs + qty * (prod.unitCost || 0));
        recordInventoryMovement(state, {
          movementDate: String(body.saleDate || now.slice(0, 10)),
          sku: prod.sku,
          productName: prod.name,
          movementType: 'POS Sale',
          qtyDelta: -qty,
          qtyBefore: before,
          qtyAfter: prod.stockQty,
          unitCost: prod.unitCost || 0,
          valuationBdt: -round2(qty * (prod.unitCost || 0)),
          warehouse: 'Retail Counter',
          sourceRef: receiptNo,
        });
      } else {
        const spare = state.spareParts.find((sp) => sp.partCode === item.sku);
        if (spare) {
          if (spare.stockQty < qty) {
            throw new Error(`Insufficient spare stock for ${spare.name}: available ${spare.stockQty}, requested ${qty}.`);
          }
          const before = spare.stockQty;
          spare.stockQty -= qty;
          spare.updatedAt = now;
          totalCogs = round2(totalCogs + qty * (spare.unitCost || 0));
          recordInventoryMovement(state, {
            movementDate: String(body.saleDate || now.slice(0, 10)),
            sku: spare.partCode,
            productName: spare.name,
            movementType: 'POS Sale',
            qtyDelta: -qty,
            qtyBefore: before,
            qtyAfter: spare.stockQty,
            unitCost: spare.unitCost || 0,
            valuationBdt: -round2(qty * (spare.unitCost || 0)),
            warehouse: 'Retail Counter',
            sourceRef: receiptNo,
          });
        }
      }
    }

    const paymentMethod = (body.paymentMethod as PosTransaction['paymentMethod']) || 'Cash';
    const settlementGlCode =
      paymentMethod === 'Cash' ? '1210' : paymentMethod === 'Card / POS' || paymentMethod === 'bKash / MFS' ? '1250' : String(body.settlementGlCode || '1240');
    const netRev = round2(Math.max(0, (Number(body.subtotal) || 0) - (Number(body.discountAmount) || 0)));
    const vatAmt = round2(Number(body.vatAmount) || 0);
    const grandTotal = round2(Number(body.grandTotal) || netRev + vatAmt);

    postViaCentralEngine(state, {
      sourceModule: 'POS',
      idempotencyKey: `POS:${receiptNo}`,
      voucherNo: receiptNo,
      date: String(body.saleDate || now.slice(0, 10)),
      description: `POS Counter Sale ${receiptNo} (${String(body.customerName || 'Walk-in')})`,
      reference: receiptNo,
      counterparty: String(body.customerName || 'Walk-in Customer'),
      lines: buildPosSaleJournalLines({
        settlementGlCode,
        paymentMethod,
        netRev,
        vatAmount: vatAmt,
        grandTotal,
        totalCogs,
        receiptNo,
      }),
    });

    const tx: PosTransaction = {
      ...(body as Omit<PosTransaction, 'id' | 'receiptNo' | 'updatedAt'>),
      id: `POS-${String(state.posTransactions.length + 1).padStart(4, '0')}`,
      receiptNo,
      settlementGlCode,
      status: 'Completed',
      updatedAt: now,
    };
    state.posTransactions.unshift(tx);
    appendAuditLog(state, 'POS', 'CREATE_POS_SALE', `Completed POS ${receiptNo} (BDT ${grandTotal.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, transaction: tx } as T;
  }

  if (path.startsWith('/api/sales-service/pos-sales/') && path.endsWith('/void') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/sales-service/pos-sales/', '').replace('/void', ''));
    const tx = state.posTransactions.find((p) => p.id === id);
    if (!tx) throw new Error('POS receipt not found.');
    if (tx.status === 'Voided') throw new Error('POS receipt is already voided.');

    const now = new Date().toISOString();
    for (const item of tx.items) {
      const prod = state.products.find((p) => p.sku === item.sku);
      if (prod) {
        const before = prod.stockQty;
        prod.stockQty += item.qty;
        prod.updatedAt = now;
        recordInventoryMovement(state, {
          movementDate: now.slice(0, 10),
          sku: prod.sku,
          productName: prod.name,
          movementType: 'POS Void',
          qtyDelta: item.qty,
          qtyBefore: before,
          qtyAfter: prod.stockQty,
          unitCost: prod.unitCost || 0,
          valuationBdt: round2(item.qty * (prod.unitCost || 0)),
          warehouse: 'Retail Counter',
          sourceRef: tx.receiptNo,
        });
      }
      const spare = state.spareParts.find((sp) => sp.partCode === item.sku);
      if (spare) {
        const before = spare.stockQty;
        spare.stockQty += item.qty;
        spare.updatedAt = now;
        recordInventoryMovement(state, {
          movementDate: now.slice(0, 10),
          sku: spare.partCode,
          productName: spare.name,
          movementType: 'POS Void',
          qtyDelta: item.qty,
          qtyBefore: before,
          qtyAfter: spare.stockQty,
          unitCost: spare.unitCost || 0,
          valuationBdt: round2(item.qty * (spare.unitCost || 0)),
          warehouse: 'Retail Counter',
          sourceRef: tx.receiptNo,
        });
      }
    }
    reverseViaCentralEngine(state, tx.receiptNo, `Void POS Receipt ${tx.receiptNo}`);
    tx.status = 'Voided';
    tx.updatedAt = now;
    saveState(state);
    return { state, transaction: tx } as T;
  }

  // Sales & Service: Sales Returns & Credit Notes
  if (path === '/api/sales-service/credit-notes' && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.salesCreditNotes = state.salesCreditNotes || [];
    const now = new Date().toISOString();
    const cnNo = String(body.creditNoteNo || '').trim().toUpperCase();
    const inv = (state.salesInvoices || []).find((i) => i.id === String(body.salesInvoiceId || ''));
    if (!cnNo || !inv) throw new Error('Credit Note No. and Sales Invoice are required.');

    const netAmount = round2(Number(body.netAmount) || 0);
    const vatAmount = round2(Number(body.vatAmount) || 0);
    const grossAmount = round2(Number(body.grossAmount) || netAmount + vatAmount);
    const cogsRev = round2(Number(body.cogsReversalAmount) || 0);
    if (grossAmount <= 0 || grossAmount > inv.outstandingAmount + inv.paidAmount + 0.01) {
      throw new Error('Invalid Credit Note amount.');
    }

    const voucherNo = `JRN-${cnNo}`;
    const lines: Array<{ glCode: string; debit: number; credit: number; memo?: string }> = [
      { glCode: inv.revenueGlCode || '4010', debit: netAmount, credit: 0, memo: `Sales Return ${cnNo}` },
    ];
    if (vatAmount > 0) lines.push({ glCode: inv.vatGlCode || '2070', debit: vatAmount, credit: 0, memo: `Output VAT reversal` });
    lines.push({ glCode: inv.arGlCode || '1120', debit: 0, credit: grossAmount, memo: `Credit Note ${cnNo}` });

    if (body.disposition === 'Restock' && cogsRev > 0) {
      lines.push(
        { glCode: '1110', debit: cogsRev, credit: 0, memo: `Restock returned inventory` },
        { glCode: '5010', debit: 0, credit: cogsRev, memo: `Reverse COGS` }
      );
    }

    postViaCentralEngine(state, {
      sourceModule: 'CREDIT_NOTE',
      idempotencyKey: `SCN:${cnNo}`,
      voucherNo,
      date: String(body.returnDate || now.slice(0, 10)),
      description: `Sales Credit Note ${cnNo} against ${inv.invoiceNumber}`,
      reference: inv.invoiceNumber,
      counterparty: inv.customerName,
      lines,
    });

    if (body.returnedSerial && body.disposition === 'Restock') {
      const unit = state.inventorySerials.find(
        (u) => u.serialNumber.toUpperCase() === String(body.returnedSerial).trim().toUpperCase()
      );
      if (unit) {
        unit.status = 'In Stock';
        unit.warehouseLocation = 'Dhaka Central Warehouse';
        unit.updatedAt = now;
        const prod = state.products.find((p) => p.sku.toUpperCase() === unit.sku.toUpperCase());
        const before = prod?.stockQty ?? 0;
        if (prod) {
          prod.stockQty += 1;
          prod.updatedAt = now;
        }
        recordInventoryMovement(state, {
          movementDate: String(body.returnDate || now.slice(0, 10)),
          sku: unit.sku,
          productName: unit.productName,
          movementType: 'Sales Return',
          qtyDelta: 1,
          qtyBefore: before,
          qtyAfter: prod ? prod.stockQty : before + 1,
          unitCost: unit.unitCost,
          valuationBdt: round2(unit.unitCost),
          warehouse: 'Dhaka Central Warehouse',
          sourceRef: cnNo,
        });
      }
    }

    inv.creditNoteAmount = round2(inv.creditNoteAmount + grossAmount);
    inv.outstandingAmount = round2(Math.max(0, inv.grossAmount - inv.creditNoteAmount - inv.paidAmount));
    inv.status = inv.outstandingAmount <= 0.01 ? 'Paid' : inv.status;
    inv.updatedAt = now;

    const cn: SalesCreditNoteRecord = {
      ...(body as Omit<SalesCreditNoteRecord, 'id' | 'updatedAt' | 'postedToGl' | 'postedVoucherNo'>),
      id: `SCN-${String(state.salesCreditNotes.length + 1).padStart(4, '0')}`,
      creditNoteNo: cnNo,
      postedToGl: true,
      postedVoucherNo: voucherNo,
      updatedAt: now,
    };
    state.salesCreditNotes.unshift(cn);
    appendAuditLog(state, 'SALES', 'CREATE_CREDIT_NOTE', `Posted Credit Note ${cnNo} (BDT ${grossAmount.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, creditNote: cn } as T;
  }

  // Sales & Service: AMC Contracts & Deferred Revenue Recognition (GL 2120 -> 4010)
  if (path === '/api/sales-service/amc-contracts' && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.amcContracts = state.amcContracts || [];
    const now = new Date().toISOString();
    const annualValue = round2(Number(body.annualValue) || 0);
    const contractNo = String(body.contractNo || '').trim().toUpperCase();
    if (!contractNo || annualValue <= 0) throw new Error('Contract No. and positive Annual Value are required.');

    postViaCentralEngine(state, {
      sourceModule: 'AMC',
      idempotencyKey: `AMC:${contractNo}`,
      voucherNo: `AMC-${contractNo}`,
      date: String(body.startDate || now.slice(0, 10)),
      description: `AMC Contract Deferred Billing ${contractNo}`,
      reference: contractNo,
      counterparty: String(body.customerName || 'Customer'),
      lines: [
        { glCode: '1120', debit: annualValue, credit: 0, memo: `AMC Receivable ${contractNo}` },
        { glCode: '2120', debit: 0, credit: annualValue, memo: `Deferred AMC Revenue` },
      ],
    });

    const contract: AmcContractRecord = {
      ...(body as Omit<AmcContractRecord, 'id' | 'updatedAt' | 'recognizedAmount' | 'deferredAmount'>),
      id: `AMC-${String(state.amcContracts.length + 1).padStart(4, '0')}`,
      contractNo,
      annualValue,
      recognizedAmount: 0,
      deferredAmount: annualValue,
      deferredGlCode: '2120',
      revenueGlCode: '4010',
      status: 'Active',
      updatedAt: now,
    };
    state.amcContracts.unshift(contract);
    saveState(state);
    return { state, contract } as T;
  }

  if (path.startsWith('/api/sales-service/amc-contracts/') && path.endsWith('/recognize') && method === 'POST') {
    state.amcContracts = state.amcContracts || [];
    const id = decodeURIComponent(path.replace('/api/sales-service/amc-contracts/', '').replace('/recognize', ''));
    const contract = state.amcContracts.find((c) => c.id === id);
    if (!contract) throw new Error('AMC Contract not found.');
    const amt = round2(Number(body.amount) || 0);
    if (amt <= 0 || amt > contract.deferredAmount + 0.01) {
      throw new Error('Recognition amount exceeds deferred AMC balance.');
    }
    const now = new Date().toISOString();
    const recRef = `AMCR-${contract.contractNo}-${Date.now().toString().slice(-4)}`;
    postViaCentralEngine(state, {
      sourceModule: 'AMC',
      idempotencyKey: `AMCR:${recRef}`,
      voucherNo: recRef,
      date: now.slice(0, 10),
      description: `AMC Revenue Recognition — ${contract.contractNo}`,
      reference: contract.contractNo,
      counterparty: contract.customerName,
      lines: [
        { glCode: '2120', debit: amt, credit: 0, memo: `Amortize Deferred AMC` },
        { glCode: contract.revenueGlCode || '4010', debit: 0, credit: amt, memo: `Recognized AMC Revenue` },
      ],
    });
    contract.recognizedAmount = round2(contract.recognizedAmount + amt);
    contract.deferredAmount = round2(Math.max(0, contract.annualValue - contract.recognizedAmount));
    contract.updatedAt = now;
    saveState(state);
    return { state, contract } as T;
  }

  // Governance: Role-Based Approval Workflow Queue
  if (path === '/api/governance/approvals' && method === 'GET') {
    state.approvalRequests = state.approvalRequests || [];
    return { state, approvals: state.approvalRequests } as T;
  }

  if (path === '/api/governance/approvals' && method === 'POST') {
    state.approvalRequests = state.approvalRequests || [];
    const now = new Date().toISOString();
    const req: ApprovalRequestRecord = {
      ...(body as Omit<ApprovalRequestRecord, 'id' | 'requestNo' | 'requestedAt' | 'requestedBy' | 'status'>),
      id: `APR-${String(state.approvalRequests.length + 1).padStart(4, '0')}`,
      requestNo: `APR-${Date.now().toString().slice(-6)}`,
      requestedBy: state.config.operatorEmail,
      requestedAt: now,
      status: 'Pending',
    };
    state.approvalRequests.unshift(req);
    appendAuditLog(state, 'GOVERNANCE', 'CREATE_APPROVAL', `Submitted ${req.requestNo} (${req.requestType}) for ${req.referenceNo}.`, 'SUCCESS');
    saveState(state);
    return { state, approval: req } as T;
  }

  if (path.startsWith('/api/governance/approvals/') && path.endsWith('/decide') && method === 'PATCH') {
    state.approvalRequests = state.approvalRequests || [];
    const id = decodeURIComponent(path.replace('/api/governance/approvals/', '').replace('/decide', ''));
    const req = state.approvalRequests.find((a) => a.id === id);
    if (!req) throw new Error('Approval request not found.');
    if (req.status !== 'Pending') {
      throw new Error(`Request ${req.requestNo} is already ${req.status}.`);
    }

    const decision = body.decision as 'Approved' | 'Rejected';
    const reviewNotes = String(body.reviewNotes || '').trim();
    if (decision !== 'Approved' && decision !== 'Rejected') {
      throw new Error('Decision must be Approved or Rejected.');
    }
    if (decision === 'Rejected' && !reviewNotes) {
      throw new Error('Rejection reason is mandatory.');
    }

    const activeRole = state.config.activeRole || 'finance_controller';
    if (activeRole === 'external_auditor' || activeRole === 'voucher_clerk') {
      appendAuditLog(state, 'SECURITY', 'APPROVAL_DENIED', `Role '${activeRole}' attempted to decide ${req.requestNo}.`, 'FAILED');
      saveState(state);
      throw new Error(`Access Denied: Role '${activeRole}' does not have authorization to approve or reject requests.`);
    }

    const reviewer = auth.currentUser?.email || state.config.operatorEmail;
    const now = new Date().toISOString();
    req.status = decision;
    req.reviewedBy = reviewer;
    req.reviewedAt = now;
    req.reviewNotes = reviewNotes || undefined;

    if (req.requestType === 'PO') {
      const po = state.localPurchaseOrders.find((p) => p.id === req.referenceId || p.poNumber === req.referenceNo);
      if (po) {
        po.approvalStatus = decision;
        if (decision === 'Approved' && po.status === 'Draft') po.status = 'Approved';
        po.updatedAt = now;
      }
    }

    appendAuditLog(
      state,
      'GOVERNANCE',
      decision === 'Approved' ? 'APPROVE_REQUEST' : 'REJECT_REQUEST',
      `${decision} ${req.requestNo} (${req.requestType} · ${req.referenceNo})${reviewNotes ? `: ${reviewNotes}` : ''}`,
      decision === 'Approved' ? 'SUCCESS' : 'ALERT'
    );
    saveState(state);
    return { state, approval: req } as T;
  }

  // Treasury: Cheque Register, Inter-Bank Transfers & Bank Statement Reconciliation
  if (path === '/api/treasury/cheques' && method === 'POST') {
    state.cheques = state.cheques || [];
    const now = new Date().toISOString();
    const chequeNo = String(body.chequeNo || '').trim().toUpperCase();
    const amount = round2(Number(body.amount) || 0);
    if (!chequeNo || amount <= 0) {
      throw new Error('Cheque No. and positive Amount are required.');
    }
    const direction = (body.direction as ChequeRecord['direction']) || 'Issued';
    if (state.cheques.some((c) => c.chequeNo.toUpperCase() === chequeNo && c.direction === direction && c.status !== 'Cancelled')) {
      throw new Error(`Duplicate ${direction} Cheque '${chequeNo}' already exists.`);
    }
    const cheque: ChequeRecord = {
      ...(body as Omit<ChequeRecord, 'id' | 'updatedAt'>),
      id: `CHQ-${String(state.cheques.length + 1).padStart(4, '0')}`,
      chequeNo,
      direction,
      amount,
      updatedAt: now,
    };
    state.cheques.unshift(cheque);
    appendAuditLog(state, 'TREASURY', 'RECORD_CHEQUE', `Logged ${direction} Cheque ${chequeNo} (BDT ${amount.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, cheque } as T;
  }

  if (path.startsWith('/api/treasury/cheques/') && path.endsWith('/status') && method === 'PATCH') {
    state.cheques = state.cheques || [];
    const id = decodeURIComponent(path.replace('/api/treasury/cheques/', '').replace('/status', ''));
    const cheque = state.cheques.find((c) => c.id === id);
    if (!cheque) throw new Error('Cheque record not found.');
    const nextStatus = body.status as ChequeRecord['status'];
    const now = new Date().toISOString();
    cheque.status = nextStatus;
    if (nextStatus === 'Cleared') {
      cheque.clearedDate = String(body.clearedDate || now.slice(0, 10));
    }
    cheque.updatedAt = now;
    appendAuditLog(
      state,
      'TREASURY',
      'CHEQUE_STATUS',
      `Cheque ${cheque.chequeNo} transitioned to ${nextStatus}.`,
      nextStatus === 'Bounced' ? 'ALERT' : 'SUCCESS'
    );
    saveState(state);
    return { state, cheque } as T;
  }

  if (path === '/api/treasury/transfers' && method === 'POST') {
    state.fundTransfers = state.fundTransfers || [];
    const now = new Date().toISOString();
    const transferNo = String(body.transferNo || '').trim().toUpperCase();
    const fromGlCode = String(body.fromGlCode || '').trim();
    const toGlCode = String(body.toGlCode || '').trim();
    const amount = round2(Number(body.amount) || 0);
    const bankChargeAmount = round2(Math.max(0, Number(body.bankChargeAmount) || 0));

    if (!transferNo || !fromGlCode || !toGlCode || fromGlCode === toGlCode || amount <= 0) {
      throw new Error('Transfer No., distinct Source/Destination GLs, and positive Amount are required.');
    }

    const totalOutflow = round2(amount + bankChargeAmount);
    const voucherNo = `TRN-${transferNo}`;
    const lines: Array<{ glCode: string; debit: number; credit: number; memo?: string }> = [
      { glCode: toGlCode, debit: amount, credit: 0, memo: `${String(body.channel || 'BEFTN')} Inflow` },
    ];
    if (bankChargeAmount > 0) {
      lines.push({ glCode: '5420', debit: bankChargeAmount, credit: 0, memo: `Bank transfer / RTGS fee` });
    }
    lines.push({ glCode: fromGlCode, debit: 0, credit: totalOutflow, memo: `Transfer ${transferNo}` });

    postViaCentralEngine(state, {
      sourceModule: 'TREASURY',
      idempotencyKey: `TRN:${transferNo}`,
      voucherNo,
      date: String(body.transferDate || now.slice(0, 10)),
      description: `${String(body.channel || 'BEFTN')} Fund Transfer ${transferNo} (${fromGlCode} → ${toGlCode})`,
      reference: String(body.reference || transferNo),
      counterparty: `Internal Treasury (${toGlCode})`,
      lines,
    });

    const transfer: FundTransferRecord = {
      ...(body as Omit<FundTransferRecord, 'id' | 'postedVoucherNo' | 'updatedAt'>),
      id: `TRF-${String(state.fundTransfers.length + 1).padStart(4, '0')}`,
      transferNo,
      fromGlCode,
      toGlCode,
      amount,
      bankChargeAmount,
      postedVoucherNo: voucherNo,
      updatedAt: now,
    };
    state.fundTransfers.unshift(transfer);
    appendAuditLog(state, 'TREASURY', 'FUND_TRANSFER', `Posted ${transferNo}: BDT ${amount.toFixed(2)} (${fromGlCode} → ${toGlCode}).`, 'SUCCESS');
    saveState(state);
    return { state, transfer } as T;
  }

  if (path === '/api/treasury/bank-statements' && method === 'POST') {
    state.bankStatements = state.bankStatements || [];
    const entry: BankReconciliationEntry = {
      ...(body as Omit<BankReconciliationEntry, 'id' | 'reconciled' | 'reconciledAt'>),
      id: `BST-${String(state.bankStatements.length + 1).padStart(4, '0')}`,
      debit: round2(Number(body.debit) || 0),
      credit: round2(Number(body.credit) || 0),
      reconciled: false,
    };
    state.bankStatements.unshift(entry);
    saveState(state);
    return { state, entry } as T;
  }

  if (path.startsWith('/api/treasury/bank-statements/') && path.endsWith('/match') && method === 'PATCH') {
    state.bankStatements = state.bankStatements || [];
    const id = decodeURIComponent(path.replace('/api/treasury/bank-statements/', '').replace('/match', ''));
    const entry = state.bankStatements.find((e) => e.id === id);
    if (!entry) throw new Error('Bank statement line not found.');
    entry.matchedTxnId = String(body.matchedTxnId || '');
    entry.reconciled = Boolean(entry.matchedTxnId);
    entry.reconciledAt = entry.reconciled ? new Date().toISOString() : undefined;
    saveState(state);
    return { state, entry } as T;
  }

  // Bangladesh Tax & NBR Withholding Rules
  if (path === '/api/tax/rules' && method === 'POST') {
    ensureDefaultTaxRules(state);
    state.taxRules = state.taxRules || [];
    const rule: TaxWithholdingRule = {
      ...(body as Omit<TaxWithholdingRule, 'id'>),
      id: `TAX-RULE-${String(state.taxRules.length + 1).padStart(2, '0')}`,
      vatRate: Number(body.vatRate ?? 15),
      tdsRate: Number(body.tdsRate || 0),
      vdsRate: Number(body.vdsRate || 0),
    };
    state.taxRules.unshift(rule);
    appendAuditLog(state, 'TAX', 'CREATE_TAX_RULE', `Added NBR rule '${rule.category}' (TDS ${rule.tdsRate}% / VDS ${rule.vdsRate}%).`, 'SUCCESS');
    saveState(state);
    return { state, rule } as T;
  }

  if (path.startsWith('/api/tax/rules/') && method === 'PATCH') {
    ensureDefaultTaxRules(state);
    state.taxRules = state.taxRules || [];
    const id = decodeURIComponent(path.replace('/api/tax/rules/', ''));
    const idx = state.taxRules.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Tax rule not found.');
    const updated = { ...state.taxRules[idx], ...(body as Partial<TaxWithholdingRule>) };
    state.taxRules[idx] = updated;
    saveState(state);
    return { state, rule: updated } as T;
  }

  if (path.startsWith('/api/tax/rules/') && method === 'DELETE') {
    ensureDefaultTaxRules(state);
    const id = decodeURIComponent(path.replace('/api/tax/rules/', ''));
    state.taxRules = (state.taxRules || []).filter((r) => r.id !== id);
    saveState(state);
    return { state } as T;
  }

  // Tenders & Turnkey Projects (with Retention Receivable GL 1135)
  if (path === '/api/projects/tenders' && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.tenderProjects = state.tenderProjects || [];
    const now = new Date().toISOString();
    const projectCode = String(body.projectCode || '').trim().toUpperCase();
    if (!projectCode) throw new Error('Project Code is required.');
    if (state.tenderProjects.some((p) => p.projectCode.toUpperCase() === projectCode)) {
      throw new Error(`Duplicate Project Code '${projectCode}' already exists.`);
    }
    const project: TenderProjectRecord = {
      ...(body as Omit<TenderProjectRecord, 'id' | 'updatedAt'>),
      id: `PRJ-${String(state.tenderProjects.length + 1).padStart(4, '0')}`,
      projectCode,
      updatedAt: now,
    };
    state.tenderProjects.unshift(project);
    appendAuditLog(state, 'PROJECTS', 'CREATE_TENDER_PROJECT', `Registered project ${projectCode} (${project.title}).`, 'SUCCESS');
    saveState(state);
    return { state, project } as T;
  }

  if (path.startsWith('/api/projects/tenders/') && path.endsWith('/retention-hold') && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.tenderProjects = state.tenderProjects || [];
    const id = decodeURIComponent(path.replace('/api/projects/tenders/', '').replace('/retention-hold', ''));
    const project = state.tenderProjects.find((p) => p.id === id);
    if (!project) throw new Error('Tender project not found.');
    const amount = round2(Number(body.amount) || 0);
    if (amount <= 0) throw new Error('Positive retention amount is required.');
    const now = new Date().toISOString();
    const ref = String(body.reference || `${project.projectCode}-RET`).trim();
    const voucherNo = `RETH-${project.projectCode}-${Date.now().toString().slice(-4)}`;
    postViaCentralEngine(state, {
      sourceModule: 'RETENTION',
      idempotencyKey: `RETH:${project.id}:${ref}:${amount}`,
      voucherNo,
      date: String(body.date || now.slice(0, 10)),
      description: `Hold Project Retention Receivable ${project.projectCode} (${ref})`,
      reference: ref,
      counterparty: project.customerName,
      lines: [
        { glCode: '1135', debit: amount, credit: 0, memo: `Retention held on ${project.projectCode}` },
        { glCode: '1120', debit: 0, credit: amount, memo: `Transfer from AR 1120` },
      ],
    });
    project.retentionHeld = round2(project.retentionHeld + amount);
    project.updatedAt = now;
    appendAuditLog(state, 'PROJECTS', 'HOLD_RETENTION', `Held BDT ${amount.toFixed(2)} on GL 1135 for ${project.projectCode}.`, 'SUCCESS');
    saveState(state);
    return { state, project } as T;
  }

  if (path.startsWith('/api/projects/tenders/') && path.endsWith('/retention-release') && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.tenderProjects = state.tenderProjects || [];
    const id = decodeURIComponent(path.replace('/api/projects/tenders/', '').replace('/retention-release', ''));
    const project = state.tenderProjects.find((p) => p.id === id);
    if (!project) throw new Error('Tender project not found.');
    const amount = round2(Number(body.amount) || 0);
    const remainingHeld = round2(Math.max(0, project.retentionHeld - project.retentionReleased));
    if (amount <= 0 || amount > remainingHeld + 0.01) {
      throw new Error(`Invalid release amount: max releasable retention is ${remainingHeld.toFixed(2)}.`);
    }
    const now = new Date().toISOString();
    const bankGl = String(body.bankGlCode || '1240');
    const ref = String(body.reference || `${project.projectCode}-REL`).trim();
    const voucherNo = `RETL-${project.projectCode}-${Date.now().toString().slice(-4)}`;
    postViaCentralEngine(state, {
      sourceModule: 'RETENTION',
      idempotencyKey: `RETL:${project.id}:${ref}:${amount}`,
      voucherNo,
      date: String(body.date || now.slice(0, 10)),
      description: `Release Project Retention ${project.projectCode} to ${bankGl}`,
      reference: ref,
      counterparty: project.customerName,
      lines: [
        { glCode: bankGl, debit: amount, credit: 0, memo: `Retention collected (${ref})` },
        { glCode: '1135', debit: 0, credit: amount, memo: `Clear Retention Money Receivable` },
      ],
    });
    project.retentionReleased = round2(project.retentionReleased + amount);
    project.collectedAmount = round2(project.collectedAmount + amount);
    project.updatedAt = now;
    appendAuditLog(state, 'PROJECTS', 'RELEASE_RETENTION', `Released BDT ${amount.toFixed(2)} from GL 1135 into ${bankGl} for ${project.projectCode}.`, 'SUCCESS');
    saveState(state);
    return { state, project } as T;
  }

  if (path.startsWith('/api/projects/tenders/') && method === 'PATCH') {
    state.tenderProjects = state.tenderProjects || [];
    const id = decodeURIComponent(path.replace('/api/projects/tenders/', ''));
    const idx = state.tenderProjects.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Tender project not found.');
    const updated = {
      ...state.tenderProjects[idx],
      ...(body as Partial<TenderProjectRecord>),
      updatedAt: new Date().toISOString(),
    };
    state.tenderProjects[idx] = updated;
    saveState(state);
    return { state, project: updated } as T;
  }

  // Sales & Service: Warranty Management Persistence & GL 5310 Integration
  if (path === '/api/sales-service/warranties' && method === 'POST') {
    const now = new Date().toISOString();
    const claim: WarrantyClaimRecord = {
      ...(body as Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>),
      id: `WRN-${String(state.warrantyClaims.length + 1).padStart(4, '0')}`,
      updatedAt: now,
    };
    state.warrantyClaims.unshift(claim);
    if (claim.serialNumber) {
      const unit = state.inventorySerials.find(
        (u) => u.serialNumber.toUpperCase() === claim.serialNumber.toUpperCase()
      );
      if (unit && claim.status !== 'Rejected') {
        unit.status = 'RMA / Warranty';
        unit.updatedAt = now;
      }
    }
    appendAuditLog(state, 'WARRANTY', 'CREATE_CLAIM', `Logged Warranty Claim ${claim.claimNo} for ${claim.serialNumber}.`, 'SUCCESS');
    saveState(state);
    return { state, claim } as T;
  }

  if (path.startsWith('/api/sales-service/warranties/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/sales-service/warranties/', ''));
    const idx = state.warrantyClaims.findIndex((w) => w.id === id);
    if (idx === -1) throw new Error('Warranty claim not found.');
    const prev = state.warrantyClaims[idx];
    const now = new Date().toISOString();
    const updated: WarrantyClaimRecord = {
      ...prev,
      ...(body as Partial<WarrantyClaimRecord>),
      updatedAt: now,
    };
    state.warrantyClaims[idx] = updated;
    if (
      prev.status !== 'Replaced / Resolved' &&
      updated.status === 'Replaced / Resolved' &&
      updated.claimCostBdt > 0
    ) {
      const voucherNo = `WRNC-${updated.claimNo}`;
      const idempKey = `WRN:${updated.claimNo}`;
      if (!(state.postedIdempotencyKeys || []).includes(idempKey)) {
        postViaCentralEngine(state, {
          sourceModule: 'WARRANTY',
          idempotencyKey: idempKey,
          voucherNo,
          date: now.slice(0, 10),
          description: `Warranty Replacement Cost ${updated.claimNo} (${updated.serialNumber})`,
          reference: updated.claimNo,
          counterparty: updated.customerName,
          lines: [
            { glCode: updated.expenseGlCode || '5310', debit: round2(updated.claimCostBdt), credit: 0, memo: 'Warranty replacement cost' },
            { glCode: '1110', debit: 0, credit: round2(updated.claimCostBdt), memo: 'Spare / unit issued under warranty' },
          ],
        });
        recordInventoryMovement(state, {
          movementDate: now.slice(0, 10),
          sku: updated.sku || updated.serialNumber,
          productName: updated.productName,
          movementType: 'Warranty Replacement',
          qtyDelta: -1,
          unitCost: round2(updated.claimCostBdt),
          valuationBdt: -round2(updated.claimCostBdt),
          warehouse: 'Dhaka Central Warehouse',
          sourceRef: updated.claimNo,
        });
      }
    }
    saveState(state);
    return { state, claim: updated } as T;
  }

  if (path.startsWith('/api/sales-service/warranties/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/sales-service/warranties/', ''));
    state.warrantyClaims = state.warrantyClaims.filter((w) => w.id !== id);
    saveState(state);
    return { state } as T;
  }

  // Sales & Service: Workshop Job Cards + Billing to AR (1120) & GL (4010 / 5320)
  if (path === '/api/sales-service/service-jobs' && method === 'POST') {
    const job: ServiceJobCard = {
      ...(body as Omit<ServiceJobCard, 'id' | 'updatedAt'>),
      id: `SRV-${String(state.serviceJobs.length + 1).padStart(4, '0')}`,
      updatedAt: new Date().toISOString(),
    };
    state.serviceJobs.unshift(job);
    appendAuditLog(state, 'WORKSHOP', 'CREATE_SERVICE_JOB', `Created Job Card ${job.jobNo} (${job.customerName}).`, 'SUCCESS');
    saveState(state);
    return { state, job } as T;
  }

  if (path.startsWith('/api/sales-service/service-jobs/') && path.endsWith('/bill') && method === 'POST') {
    ensureSalesControlAccounts(state);
    state.salesInvoices = state.salesInvoices || [];
    const id = decodeURIComponent(path.replace('/api/sales-service/service-jobs/', '').replace('/bill', ''));
    const job = state.serviceJobs.find((j) => j.id === id);
    if (!job) throw new Error('Service Job Card not found.');
    if (job.billedToGl) throw new Error(`Job Card ${job.jobNo} is already billed (${job.billedInvoiceNo}).`);

    const netAmount = round2(Number(job.billableAmountBdt) || 0);
    if (netAmount <= 0) throw new Error('Service Job has zero billable amount.');
    const vatRate = Number(body.vatRate ?? state.config.defaultVatPct ?? 15);
    const vatAmount = round2((netAmount * vatRate) / 100);
    const grossAmount = round2(netAmount + vatAmount);
    const partsCost = round2(Number(job.partsCostBdt) || 0);
    const now = new Date().toISOString();
    const invDate = String(body.invoiceDate || now.slice(0, 10));
    const invNo = `SRVI-${job.jobNo}`;
    const voucherNo = `JRN-${invNo}`;

    if (job.partsConsumed && job.partsConsumed.length > 0) {
      for (const pc of job.partsConsumed) {
        const spare = state.spareParts.find((sp) => sp.id === pc.partId || sp.partCode === pc.partCode);
        if (spare) {
          const before = spare.stockQty;
          spare.stockQty = Math.max(0, before - pc.qty);
          spare.updatedAt = now;
          recordInventoryMovement(state, {
            movementDate: invDate,
            sku: spare.partCode,
            productName: spare.name,
            movementType: 'Service Issue',
            qtyDelta: -pc.qty,
            qtyBefore: before,
            qtyAfter: spare.stockQty,
            unitCost: spare.unitCost,
            valuationBdt: -round2(pc.qty * spare.unitCost),
            warehouse: 'Dhaka Central Warehouse',
            sourceRef: invNo,
          });
        }
      }
    }

    const lines: Array<{ glCode: string; debit: number; credit: number; memo?: string }> = [
      { glCode: '1120', debit: grossAmount, credit: 0, memo: `Service AR ${invNo}` },
      { glCode: '4010', debit: 0, credit: netAmount, memo: `Service Revenue (${job.jobNo})` },
    ];
    if (vatAmount > 0) {
      lines.push({ glCode: '2070', debit: 0, credit: vatAmount, memo: `Output VAT ${invNo}` });
    }
    if (partsCost > 0) {
      lines.push(
        { glCode: job.expenseGlCode || '5320', debit: partsCost, credit: 0, memo: `Service parts cost (${job.jobNo})` },
        { glCode: '1110', debit: 0, credit: partsCost, memo: `Spare inventory consumed` }
      );
    }

    postViaCentralEngine(state, {
      sourceModule: 'SERVICE_BILLING',
      idempotencyKey: `SRV:${job.jobNo}`,
      voucherNo,
      date: invDate,
      description: `Service Workshop Billing ${job.jobNo} — ${job.equipmentName}`,
      reference: invNo,
      counterparty: job.customerName,
      lines,
    });

    const customer = state.customers.find((c) => c.name.toLowerCase() === job.customerName.toLowerCase());
    const invoice: SalesInvoiceRecord = {
      id: `SINV-${String(state.salesInvoices.length + 1).padStart(4, '0')}`,
      invoiceNumber: invNo,
      invoiceDate: invDate,
      dueDate: invDate,
      customerId: customer?.id || 'WALKIN',
      customerName: job.customerName,
      lines: [
        {
          id: '1',
          description: `${job.serviceType}: ${job.equipmentName} (S/N ${job.serialNumber})`,
          qty: 1,
          unit: 'Job',
          unitPrice: netAmount,
          discount: 0,
          vatRate,
          lineNet: netAmount,
          lineVat: vatAmount,
          lineGross: grossAmount,
        },
      ],
      netAmount,
      vatAmount,
      grossAmount,
      paidAmount: 0,
      tdsDeductedAmount: 0,
      vdsDeductedAmount: 0,
      creditNoteAmount: 0,
      outstandingAmount: grossAmount,
      cogsAmount: partsCost,
      revenueGlCode: '4010',
      arGlCode: '1120',
      vatGlCode: '2070',
      status: 'Posted',
      postedToGl: true,
      postedVoucherNo: voucherNo,
      notes: `Billed from Workshop Job Card ${job.jobNo}`,
      updatedAt: now,
    };
    state.salesInvoices.unshift(invoice);
    job.billedInvoiceNo = invNo;
    job.billedToGl = true;
    job.status = 'Completed & Handed Over';
    job.updatedAt = now;

    appendAuditLog(state, 'WORKSHOP', 'BILL_SERVICE_JOB', `Billed ${job.jobNo} → ${invNo} (Gross BDT ${grossAmount.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, job, invoice } as T;
  }

  if (path.startsWith('/api/sales-service/service-jobs/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/sales-service/service-jobs/', ''));
    const idx = state.serviceJobs.findIndex((j) => j.id === id);
    if (idx === -1) throw new Error('Service job not found.');
    const updated = { ...state.serviceJobs[idx], ...(body as Partial<ServiceJobCard>), updatedAt: new Date().toISOString() };
    state.serviceJobs[idx] = updated;
    saveState(state);
    return { state, job: updated } as T;
  }

  if (path.startsWith('/api/sales-service/service-jobs/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/sales-service/service-jobs/', ''));
    state.serviceJobs = state.serviceJobs.filter((j) => j.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/sales-service/spare-parts' && method === 'POST') {
    const part: SparePartItem = {
      ...(body as Omit<SparePartItem, 'id' | 'updatedAt'>),
      id: `SPR-${String(state.spareParts.length + 1).padStart(4, '0')}`,
      updatedAt: new Date().toISOString(),
    };
    state.spareParts.unshift(part);
    saveState(state);
    return { state, part } as T;
  }

  if (path.startsWith('/api/sales-service/spare-parts/') && method === 'PATCH') {
    const id = decodeURIComponent(path.replace('/api/sales-service/spare-parts/', ''));
    const idx = state.spareParts.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Spare part not found.');
    const updated = { ...state.spareParts[idx], ...(body as Partial<SparePartItem>), updatedAt: new Date().toISOString() };
    state.spareParts[idx] = updated;
    saveState(state);
    return { state, part: updated } as T;
  }

  if (path.startsWith('/api/sales-service/spare-parts/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/sales-service/spare-parts/', ''));
    state.spareParts = state.spareParts.filter((p) => p.id !== id);
    saveState(state);
    return { state } as T;
  }

  // Fixed Assets & Straight-Line Monthly Depreciation (GL 1010 / 1020 / 5340)
  if (path === '/api/assets/fixed-assets' && method === 'POST') {
    state.fixedAssets = state.fixedAssets || [];
    const now = new Date().toISOString();
    const assetCode = String(body.assetCode || '').trim().toUpperCase();
    const cost = round2(Number(body.cost) || 0);
    const salvage = round2(Math.max(0, Number(body.salvageValue) || 0));
    const accum = round2(Math.max(0, Number(body.accumulatedDepreciation) || 0));
    if (!assetCode || cost <= 0) throw new Error('Asset Code and positive Cost are required.');
    if (state.fixedAssets.some((a) => a.assetCode.toUpperCase() === assetCode)) {
      throw new Error(`Duplicate Fixed Asset Code '${assetCode}' already exists.`);
    }

    if (body.postToGl) {
      const creditGl = String(body.paymentGlCode || '1240');
      postViaCentralEngine(state, {
        sourceModule: 'FIXED_ASSET',
        idempotencyKey: `FACAP:${assetCode}`,
        voucherNo: `FACAP-${assetCode}`,
        date: String(body.acquisitionDate || now.slice(0, 10)),
        description: `Capitalize Fixed Asset ${assetCode} (${String(body.name || '')})`,
        reference: assetCode,
        counterparty: String(body.location || 'ATCL'),
        lines: [
          { glCode: String(body.assetGlCode || '1010'), debit: cost, credit: 0, memo: `Capitalize ${assetCode}` },
          { glCode: creditGl, debit: 0, credit: cost, memo: `Asset acquisition settlement` },
        ],
      });
    }

    const asset: FixedAssetRecord = {
      ...(body as Omit<FixedAssetRecord, 'id' | 'netBookValue' | 'updatedAt'>),
      id: `FA-${String(state.fixedAssets.length + 1).padStart(4, '0')}`,
      assetCode,
      cost,
      salvageValue: salvage,
      accumulatedDepreciation: accum,
      netBookValue: round2(Math.max(0, cost - accum)),
      assetGlCode: String(body.assetGlCode || '1010'),
      accumDeprGlCode: String(body.accumDeprGlCode || '1020'),
      deprExpenseGlCode: String(body.deprExpenseGlCode || '5340'),
      updatedAt: now,
    };
    state.fixedAssets.unshift(asset);
    appendAuditLog(state, 'FIXED_ASSETS', 'REGISTER_ASSET', `Registered Fixed Asset ${assetCode} (${asset.name}, BDT ${cost.toFixed(2)}).`, 'SUCCESS');
    saveState(state);
    return { state, asset } as T;
  }

  if (path === '/api/assets/fixed-assets/run-depreciation' && method === 'POST') {
    state.fixedAssets = state.fixedAssets || [];
    const monthKey = String(body.monthKey || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const postingDate = String(body.postingDate || `${monthKey}-28`);
    const now = new Date().toISOString();

    let totalDepr = 0;
    let assetsDepreciated = 0;
    for (const asset of state.fixedAssets) {
      if (asset.status !== 'Active' || asset.lastDeprMonth === monthKey) continue;
      const depreciableBase = round2(Math.max(0, asset.cost - asset.salvageValue - asset.accumulatedDepreciation));
      if (depreciableBase <= 0.01) continue;
      const monthlyRate = round2((asset.cost - asset.salvageValue) / Math.max(1, asset.usefulLifeMonths));
      const charge = round2(Math.min(depreciableBase, monthlyRate));
      if (charge <= 0) continue;
      asset.accumulatedDepreciation = round2(asset.accumulatedDepreciation + charge);
      asset.netBookValue = round2(Math.max(asset.salvageValue, asset.cost - asset.accumulatedDepreciation));
      asset.lastDeprMonth = monthKey;
      asset.updatedAt = now;
      totalDepr = round2(totalDepr + charge);
      assetsDepreciated += 1;
    }

    if (totalDepr <= 0) {
      throw new Error(`No depreciable active fixed assets pending for month ${monthKey}.`);
    }

    const voucherNo = `DEPR-${monthKey}`;
    postViaCentralEngine(state, {
      sourceModule: 'FIXED_ASSET',
      idempotencyKey: `DEPR:${monthKey}`,
      voucherNo,
      date: postingDate,
      description: `Monthly Straight-Line Depreciation Run (${monthKey}) across ${assetsDepreciated} asset(s)`,
      reference: monthKey,
      counterparty: 'ATCL Fixed Asset Schedule',
      lines: [
        { glCode: '5340', debit: totalDepr, credit: 0, memo: `Depreciation expense ${monthKey}` },
        { glCode: '1020', debit: 0, credit: totalDepr, memo: `Accumulated depreciation ${monthKey}` },
      ],
    });
    appendAuditLog(state, 'FIXED_ASSETS', 'RUN_DEPRECIATION', `Posted ${voucherNo} for BDT ${totalDepr.toFixed(2)} (${assetsDepreciated} assets).`, 'SUCCESS');
    saveState(state);
    return { state, assetsDepreciated, totalDepreciation: totalDepr, voucherNo } as T;
  }

  // Department Budgets & Month-End Closing
  if (path === '/api/finance/budgets' && method === 'POST') {
    state.departmentBudgets = state.departmentBudgets || [];
    const now = new Date().toISOString();
    const budget: DepartmentBudgetRecord = {
      ...(body as Omit<DepartmentBudgetRecord, 'id' | 'updatedAt'>),
      id: `BDG-${String(state.departmentBudgets.length + 1).padStart(4, '0')}`,
      annualBudget: round2(Number(body.annualBudget) || 0),
      updatedAt: now,
    };
    state.departmentBudgets.unshift(budget);
    saveState(state);
    return { state, budget } as T;
  }

  if (path.startsWith('/api/finance/budgets/') && method === 'DELETE') {
    const id = decodeURIComponent(path.replace('/api/finance/budgets/', ''));
    state.departmentBudgets = (state.departmentBudgets || []).filter((b) => b.id !== id);
    saveState(state);
    return { state } as T;
  }

  if (path === '/api/finance/month-end/close' && method === 'POST') {
    const monthKey = String(body.monthKey || '').slice(0, 7);
    if (!monthKey || monthKey.length !== 7) throw new Error('Valid YYYY-MM month key is required.');
    const reopen = Boolean(body.reopen);
    state.config.lockedMonths = state.config.lockedMonths || [];

    if (reopen) {
      state.config.lockedMonths = state.config.lockedMonths.filter((m) => m !== monthKey);
      appendAuditLog(state, 'FINANCE', 'REOPEN_MONTH', `Reopened accounting period ${monthKey}.`, 'WARNING');
      saveState(state);
      return { state, lockedMonths: state.config.lockedMonths } as T;
    }

    const tb = computeTrialBalance(state);
    if (!tb.isClosingBalanced) {
      throw new Error(`Month-End Close Blocked: Trial Balance is out of balance (Dr ${tb.totals.closingDr} vs Cr ${tb.totals.closingCr}).`);
    }
    const recon = reconcileAllRegisters(state);
    if (recon.discrepancies.length > 0) {
      throw new Error(`Month-End Close Blocked: ${recon.discrepancies.length} register discrepancy(ies) must be reconciled first.`);
    }
    if (!state.config.lockedMonths.includes(monthKey)) {
      state.config.lockedMonths.push(monthKey);
      state.config.lockedMonths.sort();
    }
    appendAuditLog(state, 'FINANCE', 'CLOSE_MONTH', `Verified Trial Balance & Registers and locked period ${monthKey}.`, 'SUCCESS');
    saveState(state);
    return { state, lockedMonths: state.config.lockedMonths } as T;
  }

  // Generic fallback for remaining master/sales/pos/procurement/service/templates reads & writes
  if (path.startsWith('/api/ai/')) {
    throw new Error('AI backend endpoints require the Node server (npm run dev).');
  }

  return { state } as T;
}

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  CURRENT_DATASET_VERSION,
  buildInitialCustomers,
  buildInitialImportLCs,
  buildInitialLocalPOs,
  buildInitialPosTransactions,
  buildInitialProducts,
  buildInitialSalesOrders,
  buildInitialSerialRegister,
  buildInitialServiceJobs,
  buildInitialSpareParts,
  buildInitialSuppliers,
  buildInitialTemplates,
  buildInitialVouchers,
  buildInitialWarrantyClaims,
  createInitialLedgerState,
  createSamplePopulatedLedgerState,
  hydrateCustomInstructions,
  hydrateSystemConfig,
} from './src/data/seedData.ts';
import {
  ALLOWED_AI_MODELS,
  AiServiceError,
  compileCustomInstructions,
  draftVoucherWithAi,
  generateReportInsights,
  generateTemplateWithAi,
  runInstructionSandboxTest,
  streamAssistantChat,
} from './server/aiService.ts';
import {
  EMBEDDING_MODEL,
  clearVectorStore,
  deleteDocumentVectors,
  extractDocumentText,
  getDocumentChunks,
  searchDocumentVectors,
  vectorizeAndStoreDocument,
} from './server/vectorStore.ts';
import {
  appendAuditLog,
  approveValidatedVouchers,
  createAllMissingRegisters,
  postApprovedVouchers,
  rebuildRegisterFromMaster,
  reconcileAllRegisters,
  reverseVoucher,
  round2,
  selfHealDiscrepancies,
  syncPostedTransactionsToRegisters,
  validateChartOfAccounts,
  validateJournalVouchers,
} from './src/engine/accountingEngine.ts';
import type {
  AccountCategory,
  AiWorkflowKey,
  CustomInstructionsConfig,
  CustomerRecord,
  DocumentInjectionScope,
  DocumentTemplateRecord,
  GLAccount,
  ImportLCFile,
  InventorySerialUnit,
  KnowledgeDocumentItem,
  LedgerState,
  LocalPurchaseOrder,
  PosLineItem,
  PosPaymentMethod,
  PosTransaction,
  ProductItem,
  SalesOrderRecord,
  ServiceJobCard,
  SparePartItem,
  SupplierRecord,
  SystemConfig,
  SystemRoleId,
  VoucherDoubleEntryLine,
  VoucherKind,
  VoucherRecord,
  WarrantyClaimRecord,
} from './src/types/accounting.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.resolve(DATA_DIR, 'atcl-ledger-db.json');
const ASSETS_DIR = path.resolve(__dirname, 'public/assets/aistudio');

function loadState(): LedgerState {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const seed = createInitialLedgerState();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as LedgerState;
    if (parsed.datasetVersion !== CURRENT_DATASET_VERSION) {
      const seed = createInitialLedgerState();
      fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
      return seed;
    }
    let hydrated = false;
    if (!Array.isArray(parsed.products)) {
      parsed.products = buildInitialProducts();
      hydrated = true;
    }
    if (!Array.isArray(parsed.customers)) {
      parsed.customers = buildInitialCustomers();
      hydrated = true;
    }
    if (!Array.isArray(parsed.suppliers)) {
      parsed.suppliers = buildInitialSuppliers();
      hydrated = true;
    }
    if (!Array.isArray(parsed.localPurchaseOrders)) {
      parsed.localPurchaseOrders = buildInitialLocalPOs();
      hydrated = true;
    }
    if (!Array.isArray(parsed.importLCs)) {
      parsed.importLCs = buildInitialImportLCs();
      hydrated = true;
    }
    if (!Array.isArray(parsed.inventorySerials)) {
      parsed.inventorySerials = buildInitialSerialRegister();
      hydrated = true;
    }
    if (!Array.isArray(parsed.salesOrders)) {
      parsed.salesOrders = buildInitialSalesOrders();
      hydrated = true;
    }
    if (!Array.isArray(parsed.posTransactions)) {
      parsed.posTransactions = buildInitialPosTransactions();
      hydrated = true;
    }
    if (!Array.isArray(parsed.warrantyClaims)) {
      parsed.warrantyClaims = buildInitialWarrantyClaims();
      hydrated = true;
    }
    if (!Array.isArray(parsed.serviceJobs)) {
      parsed.serviceJobs = buildInitialServiceJobs();
      hydrated = true;
    }
    if (!Array.isArray(parsed.spareParts)) {
      parsed.spareParts = buildInitialSpareParts();
      hydrated = true;
    }
    if (!Array.isArray(parsed.vouchers)) {
      parsed.vouchers = buildInitialVouchers();
      hydrated = true;
    } else {
      // Auto-migrate any legacy placeholder GL codes in persisted vouchers to valid ATCL COA codes
      const legacyCodeMap: Record<string, string> = {
        '2130': '2040',
        '2140': '2050',
        '2150': '2060',
        '2160': '2070',
      };
      const accLookup = new Map(parsed.accounts.map((a) => [a.code, a.name]));
      for (const v of parsed.vouchers) {
        if (!Array.isArray(v.doubleEntryLines)) continue;
        for (const line of v.doubleEntryLines) {
          const mapped = legacyCodeMap[line.glCode];
          if (mapped && accLookup.has(mapped)) {
            line.glCode = mapped;
            line.glName = accLookup.get(mapped) || line.glName;
            hydrated = true;
          }
        }
      }
    }
    if (!Array.isArray(parsed.templates)) {
      parsed.templates = buildInitialTemplates();
      hydrated = true;
    }
    const hydratedConfig = hydrateSystemConfig(parsed.config);
    if (JSON.stringify(hydratedConfig) !== JSON.stringify(parsed.config)) {
      parsed.config = hydratedConfig;
      hydrated = true;
    }
    if (hydrated) {
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    return parsed;
  } catch {
    const seed = createInitialLedgerState();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
}

function saveState(state: LedgerState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

let ledgerState: LedgerState = loadState();

function validatePostingDatePolicy(dateStr: string, config: SystemConfig): string | null {
  const cleanDate = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;

  if (config.globalLockDate && cleanDate <= config.globalLockDate) {
    return `Posting blocked: date ${cleanDate} is on or before the Global Posting Lock Date (${config.globalLockDate}).`;
  }
  const ym = cleanDate.slice(0, 7);
  if (Array.isArray(config.lockedMonths) && config.lockedMonths.includes(ym)) {
    return `Posting blocked: accounting period ${ym} is locked in Fiscal & Period Controls.`;
  }
  if (config.allowFutureDatedEntries === false) {
    const today = new Date().toISOString().slice(0, 10);
    if (cleanDate > today) {
      return `Posting blocked: future-dated entries (${cleanDate}) are disabled in System Configuration.`;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // GET full authoritative ledger state
  app.get('/api/state', (_req, res) => {
    res.json({ state: ledgerState });
  });

  // Add new GL Account to Chart of Accounts
  app.post('/api/accounts', (req, res) => {
    try {
      const { code, name, category, group, openingBalance, autoCreateRegister } = req.body as {
        code: string;
        name: string;
        category: AccountCategory;
        group: string;
        openingBalance: number;
        autoCreateRegister?: boolean;
      };

      const cleanCode = String(code || '').trim();
      const cleanName = String(name || '').trim();
      const cleanGroup = String(group || '').trim() || 'General';
      const numOpening = round2(Number(openingBalance) || 0);

      if (!cleanCode || !cleanName) {
        res.status(400).json({ error: 'GL Account Code and Account Name are required.' });
        return;
      }
      if (ledgerState.accounts.some((a) => a.code === cleanCode)) {
        res.status(409).json({ error: `GL Account Code '${cleanCode}' already exists.` });
        return;
      }

      const normalBalance = category === 'Asset' || category === 'Expense' ? 'Debit' : 'Credit';
      const now = new Date().toISOString();

      const newAcc: GLAccount = {
        code: cleanCode,
        name: cleanName,
        category,
        group: cleanGroup,
        openingBalance: numOpening,
        normalBalance,
        registerFileId: autoCreateRegister ? `REG-ATCL-${cleanCode}` : null,
        registerFileName: autoCreateRegister ? `${cleanCode} - ${cleanName} - Register Book` : null,
        status: 'Active',
        lastSyncedAt: autoCreateRegister ? now : null,
      };

      ledgerState.accounts.push(newAcc);
      ledgerState.accounts.sort((a, b) => a.code.localeCompare(b.code));

      if (autoCreateRegister) {
        ledgerState.registers[cleanCode] = {
          glCode: cleanCode,
          fileId: newAcc.registerFileId!,
          fileName: newAcc.registerFileName!,
          createdAt: now,
          lastSyncedAt: now,
          entries: [],
        };
      }

      appendAuditLog(
        ledgerState,
        'REGISTER_MGR',
        'ADD_ACCOUNT',
        `Added GL Account ${cleanCode} - ${cleanName} (${category} / ${cleanGroup}).`,
        'SUCCESS'
      );

      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, account: newAcc });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add account.' });
    }
  });

  // Toggle Account Status or update details
  app.patch('/api/accounts/:code', (req, res) => {
    const acc = ledgerState.accounts.find((a) => a.code === req.params.code);
    if (!acc) {
      res.status(404).json({ error: 'GL Account not found.' });
      return;
    }
    const { status, name, group } = req.body as Partial<GLAccount>;
    if (status === 'Active' || status === 'Inactive') acc.status = status;
    if (typeof name === 'string' && name.trim()) acc.name = name.trim();
    if (typeof group === 'string' && group.trim()) acc.group = group.trim();

    appendAuditLog(
      ledgerState,
      'REGISTER_MGR',
      'UPDATE_ACCOUNT',
      `Updated GL Account ${acc.code} (${acc.name}) — Status: ${acc.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, account: acc });
  });

  // Validate Chart of Accounts
  app.post('/api/coa/validate', (_req, res) => {
    const result = validateChartOfAccounts(ledgerState);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Create Missing Register Books
  app.post('/api/coa/create-registers', (_req, res) => {
    const result = createAllMissingRegisters(ledgerState);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Create new multi-line Journal Voucher
  app.post('/api/journal/voucher', (req, res) => {
    try {
      const { voucherNo, date, description, reference, counterparty, approvalStatus, lines } = req.body as {
        voucherNo: string;
        date: string;
        description: string;
        reference: string;
        counterparty: string;
        approvalStatus?: 'DRAFT' | 'PENDING_APPROVAL';
        lines: Array<{ glCode: string; debit: number; credit: number }>;
      };

      const cleanVoucher = String(voucherNo || '').trim();
      if (!cleanVoucher) {
        res.status(400).json({ error: 'Voucher number is required.' });
        return;
      }
      if (!Array.isArray(lines) || lines.length < 2) {
        res.status(400).json({ error: 'A double-entry journal voucher requires at least 2 lines.' });
        return;
      }
      if (ledgerState.journalLines.some((l) => l.voucherNo === cleanVoucher)) {
        res.status(409).json({ error: `Voucher '${cleanVoucher}' already exists in Master Journal.` });
        return;
      }

      const entryDate = date || new Date().toISOString().slice(0, 10);
      const lockError = validatePostingDatePolicy(entryDate, ledgerState.config);
      if (lockError) {
        res.status(400).json({ error: lockError });
        return;
      }

      const accMap = new Map(ledgerState.accounts.map((a) => [a.code, a]));
      const baseSeq = ledgerState.journalLines.length + 1;

      lines.forEach((line, idx) => {
        const acc = accMap.get(String(line.glCode).trim());
        ledgerState.journalLines.push({
          journalId: `JRN-${String(baseSeq + idx).padStart(4, '0')}`,
          date: date || new Date().toISOString().slice(0, 10),
          voucherNo: cleanVoucher,
          description: String(description || '').trim() || 'General Journal Entry',
          glCode: String(line.glCode).trim(),
          glName: acc ? acc.name : 'Unknown Account',
          debit: round2(Number(line.debit) || 0),
          credit: round2(Number(line.credit) || 0),
          reference: String(reference || '').trim(),
          counterparty: String(counterparty || '').trim() || 'General Client / Supplier',
          enteredBy: ledgerState.config.operatorEmail,
          approvalStatus: approvalStatus === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : 'DRAFT',
          postingStatus: 'UNPOSTED',
          validationRemarks: 'Pending validation',
        });
      });

      appendAuditLog(
        ledgerState,
        'JOURNAL_ENGINE',
        'CREATE_VOUCHER',
        `Recorded multi-line voucher ${cleanVoucher} (${lines.length} lines) in Master Journal.`,
        'SUCCESS'
      );

      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, voucherNo: cleanVoucher });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create voucher.' });
    }
  });

  // Delete an unposted voucher from Master Journal
  app.delete('/api/journal/:voucherNo', (req, res) => {
    const vNo = req.params.voucherNo;
    const matched = ledgerState.journalLines.filter((l) => l.voucherNo === vNo);
    if (matched.length === 0) {
      res.status(404).json({ error: 'Voucher not found.' });
      return;
    }
    if (matched.some((l) => l.postingStatus === 'POSTED')) {
      res.status(400).json({ error: 'Posted vouchers are immutable and cannot be deleted. Use Reversal instead.' });
      return;
    }
    ledgerState.journalLines = ledgerState.journalLines.filter((l) => l.voucherNo !== vNo);
    appendAuditLog(ledgerState, 'JOURNAL_ENGINE', 'DELETE_DRAFT', `Removed unposted draft voucher ${vNo}.`, 'SUCCESS');
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // Validate unposted vouchers
  app.post('/api/journal/validate', (_req, res) => {
    const result = validateJournalVouchers(ledgerState);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Approve validated vouchers
  app.post('/api/journal/approve', (_req, res) => {
    const result = approveValidatedVouchers(ledgerState);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Post approved vouchers to Posted_Journal_Store
  app.post('/api/journal/post', (_req, res) => {
    try {
      const approvedLines = ledgerState.journalLines.filter(
        (l) => l.approvalStatus === 'APPROVED' && l.postingStatus === 'UNPOSTED'
      );
      for (const line of approvedLines) {
        const lockError = validatePostingDatePolicy(line.date, ledgerState.config);
        if (lockError) {
          res.status(400).json({ error: `Voucher ${line.voucherNo}: ${lockError}` });
          return;
        }
      }
      const result = postApprovedVouchers(ledgerState);
      saveState(ledgerState);
      res.json({ state: ledgerState, result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Posting failed.' });
    }
  });

  // Reverse a posted voucher
  app.post('/api/journal/reverse', (req, res) => {
    try {
      const { voucherNo, reason } = req.body as { voucherNo: string; reason: string };
      if (!voucherNo || !reason?.trim()) {
        res.status(400).json({ error: 'Voucher number and reversal justification are required.' });
        return;
      }
      const result = reverseVoucher(ledgerState, voucherNo, reason.trim());
      saveState(ledgerState);
      res.json({ state: ledgerState, result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Reversal failed.' });
    }
  });

  // Batch sync all PENDING posted lines to individual Register Books
  app.post('/api/registers/sync', (_req, res) => {
    const result = syncPostedTransactionsToRegisters(ledgerState);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Rebuild a single GL Account Register Book from Master Posted Store
  app.post('/api/registers/:code/rebuild', (req, res) => {
    try {
      const result = rebuildRegisterFromMaster(ledgerState, req.params.code);
      saveState(ledgerState);
      res.json({ state: ledgerState, result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rebuild failed.' });
    }
  });

  // Run System Reconciliation Audit
  app.post('/api/audit/reconcile', (_req, res) => {
    const result = reconcileAllRegisters(ledgerState, true);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Self-Heal Discrepancies
  app.post('/api/audit/self-heal', (_req, res) => {
    const result = selfHealDiscrepancies(ledgerState);
    saveState(ledgerState);
    res.json({ state: ledgerState, result });
  });

  // Update System Configuration (all governance domains)
  app.patch('/api/config', (req, res) => {
    try {
      const body = req.body as Partial<SystemConfig>;
      const updatedSections: string[] = [];

      // 1. Company, Statutory Tax & Currency
      if (typeof body.organizationName === 'string' && body.organizationName.trim()) {
        ledgerState.config.organizationName = body.organizationName.trim();
        updatedSections.push('Company');
      }
      if (typeof body.legalEntityType === 'string') {
        ledgerState.config.legalEntityType = body.legalEntityType.trim();
      }
      if (typeof body.tinNumber === 'string') {
        ledgerState.config.tinNumber = body.tinNumber.trim();
      }
      if (typeof body.binVatNumber === 'string') {
        ledgerState.config.binVatNumber = body.binVatNumber.trim();
      }
      if (typeof body.tradeLicenseNo === 'string') {
        ledgerState.config.tradeLicenseNo = body.tradeLicenseNo.trim();
      }
      if (typeof body.registeredAddress === 'string') {
        ledgerState.config.registeredAddress = body.registeredAddress.trim();
      }
      if (typeof body.contactPhone === 'string') {
        ledgerState.config.contactPhone = body.contactPhone.trim();
      }
      if (typeof body.currencyCode === 'string' && body.currencyCode.trim()) {
        ledgerState.config.currencyCode = body.currencyCode.trim().toUpperCase().slice(0, 6);
      }
      if (typeof body.currencySymbol === 'string' && body.currencySymbol.trim()) {
        ledgerState.config.currencySymbol = body.currencySymbol.trim().slice(0, 4);
      }
      if (typeof body.defaultVatPct === 'number' && !Number.isNaN(body.defaultVatPct)) {
        ledgerState.config.defaultVatPct = Math.min(100, Math.max(0, round2(body.defaultVatPct)));
      }
      if (typeof body.defaultTdsPct === 'number' && !Number.isNaN(body.defaultTdsPct)) {
        ledgerState.config.defaultTdsPct = Math.min(100, Math.max(0, round2(body.defaultTdsPct)));
      }
      if (typeof body.defaultVdsPct === 'number' && !Number.isNaN(body.defaultVdsPct)) {
        ledgerState.config.defaultVdsPct = Math.min(100, Math.max(0, round2(body.defaultVdsPct)));
      }
      if (typeof body.decimalPlaces === 'number' && Number.isInteger(body.decimalPlaces)) {
        ledgerState.config.decimalPlaces = Math.min(4, Math.max(0, body.decimalPlaces));
      }

      // 2. Voucher Numbering & Approvals
      const nextAutoLimit =
        typeof body.autoApproveLimit === 'number' && !Number.isNaN(body.autoApproveLimit)
          ? Math.max(0, round2(body.autoApproveLimit))
          : (ledgerState.config.autoApproveLimit ?? 250000);
      const nextDualLimit =
        typeof body.dualApprovalThreshold === 'number' && !Number.isNaN(body.dualApprovalThreshold)
          ? Math.max(0, round2(body.dualApprovalThreshold))
          : (ledgerState.config.dualApprovalThreshold ?? 1000000);

      if (nextDualLimit < nextAutoLimit) {
        res.status(400).json({
          error: 'Dual-signoff approval threshold must be greater than or equal to the auto-approval ceiling.',
        });
        return;
      }

      if (body.voucherNumbering && typeof body.voucherNumbering === 'object') {
        const currentSeries = hydrateSystemConfig(ledgerState.config).voucherNumbering!;
        const keys = ['payment', 'receipt', 'journal', 'expense', 'reversal'] as const;
        for (const k of keys) {
          const incoming = body.voucherNumbering[k];
          if (incoming) {
            currentSeries[k] = {
              prefix: String(incoming.prefix || currentSeries[k].prefix).trim().toUpperCase().slice(0, 16),
              padding: Math.min(8, Math.max(2, Math.floor(Number(incoming.padding) || currentSeries[k].padding))),
              nextSequence: Math.max(1, Math.floor(Number(incoming.nextSequence) || currentSeries[k].nextSequence)),
            };
          }
        }
        ledgerState.config.voucherNumbering = currentSeries;
        updatedSections.push('Vouchers');
      }
      if (typeof body.autoApproveLimit === 'number') {
        ledgerState.config.autoApproveLimit = nextAutoLimit;
      }
      if (typeof body.dualApprovalThreshold === 'number') {
        ledgerState.config.dualApprovalThreshold = nextDualLimit;
      }
      if (typeof body.enforceLiquidityCheck === 'boolean') {
        ledgerState.config.enforceLiquidityCheck = body.enforceLiquidityCheck;
      }
      if (typeof body.enforceBudgetCheck === 'boolean') {
        ledgerState.config.enforceBudgetCheck = body.enforceBudgetCheck;
      }
      if (typeof body.requireVoucherNarration === 'boolean') {
        ledgerState.config.requireVoucherNarration = body.requireVoucherNarration;
      }

      // 3. Fiscal Calendar & Period Locks
      if (typeof body.fiscalPeriod === 'string' && body.fiscalPeriod.trim()) {
        ledgerState.config.fiscalPeriod = body.fiscalPeriod.trim();
        updatedSections.push('Fiscal');
      }
      if (typeof body.fiscalStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fiscalStartDate)) {
        ledgerState.config.fiscalStartDate = body.fiscalStartDate;
      }
      if (typeof body.fiscalEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fiscalEndDate)) {
        ledgerState.config.fiscalEndDate = body.fiscalEndDate;
      }
      if (body.globalLockDate === null || body.globalLockDate === '') {
        ledgerState.config.globalLockDate = null;
      } else if (typeof body.globalLockDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.globalLockDate)) {
        ledgerState.config.globalLockDate = body.globalLockDate;
        updatedSections.push('Period Locks');
      }
      if (Array.isArray(body.lockedMonths)) {
        const cleanMonths = Array.from(
          new Set(body.lockedMonths.filter((m) => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)))
        ).sort();
        ledgerState.config.lockedMonths = cleanMonths;
        updatedSections.push('Period Locks');
      }
      if (typeof body.allowBackdatedEntries === 'boolean') {
        ledgerState.config.allowBackdatedEntries = body.allowBackdatedEntries;
      }
      if (Array.isArray(body.productTypes)) {
        ledgerState.config.productTypes = Array.from(
          new Set(body.productTypes.map((v) => String(v).trim()).filter(Boolean))
        );
        updatedSections.push('Product Catalog');
      }
      if (Array.isArray(body.productCategories)) {
        ledgerState.config.productCategories = Array.from(
          new Set(body.productCategories.map((v) => String(v).trim()).filter(Boolean))
        );
        updatedSections.push('Product Catalog');
      }
      if (Array.isArray(body.productUnits)) {
        ledgerState.config.productUnits = Array.from(
          new Set(body.productUnits.map((v) => String(v).trim()).filter(Boolean))
        );
        updatedSections.push('Product Catalog');
      }
      if (Array.isArray(body.customerSegments)) {
        ledgerState.config.customerSegments = Array.from(
          new Set(body.customerSegments.map((v) => String(v).trim()).filter(Boolean))
        );
        updatedSections.push('Customer Accounts');
      }
      if (Array.isArray(body.customerStatuses)) {
        ledgerState.config.customerStatuses = Array.from(
          new Set(body.customerStatuses.map((v) => String(v).trim()).filter(Boolean))
        );
        updatedSections.push('Customer Accounts');
      }
      if (Array.isArray(body.supplierTypes)) {
        ledgerState.config.supplierTypes = Array.from(
          new Set(body.supplierTypes.map((v) => String(v).trim()).filter(Boolean))
        );
        updatedSections.push('Supplier Directory');
      }
      if (typeof body.allowFutureDatedEntries === 'boolean') {
        ledgerState.config.allowFutureDatedEntries = body.allowFutureDatedEntries;
      }

      // 4. Governance, Roles & Audit Retention
      if (typeof body.operatorEmail === 'string' && body.operatorEmail.trim()) {
        ledgerState.config.operatorEmail = body.operatorEmail.trim();
      }
      const validRoles: SystemRoleId[] = [
        'finance_controller',
        'senior_accountant',
        'voucher_clerk',
        'external_auditor',
      ];
      if (body.activeRole && validRoles.includes(body.activeRole)) {
        ledgerState.config.activeRole = body.activeRole;
        updatedSections.push('Roles');
      }
      if (body.rolePermissions && typeof body.rolePermissions === 'object') {
        const currentPerms = hydrateSystemConfig(ledgerState.config).rolePermissions!;
        for (const r of validRoles) {
          if (body.rolePermissions[r]) {
            currentPerms[r] = {
              ...currentPerms[r],
              ...body.rolePermissions[r],
            };
          }
        }
        ledgerState.config.rolePermissions = currentPerms;
        updatedSections.push('Roles');
      }
      if (typeof body.auditRetentionDays === 'number' && !Number.isNaN(body.auditRetentionDays)) {
        ledgerState.config.auditRetentionDays = Math.min(3650, Math.max(30, Math.floor(body.auditRetentionDays)));
      }
      if (typeof body.maxAuditEntries === 'number' && !Number.isNaN(body.maxAuditEntries)) {
        ledgerState.config.maxAuditEntries = Math.min(10000, Math.max(100, Math.floor(body.maxAuditEntries)));
      }

      // 5. Integrations & Register Sync Policy
      if (typeof body.driveFolderName === 'string' && body.driveFolderName.trim()) {
        ledgerState.config.driveFolderName = body.driveFolderName.trim();
      }
      if (typeof body.autoSyncOnPost === 'boolean') {
        ledgerState.config.autoSyncOnPost = body.autoSyncOnPost;
        updatedSections.push('Sync Policy');
      }

      // 6. Global Custom Instructions & AI Governance
      if (body.customInstructions && typeof body.customInstructions === 'object') {
        const nextCi = hydrateCustomInstructions(body.customInstructions);
        // Validate models & sanitize strings
        if (!ALLOWED_AI_MODELS.includes(nextCi.models.defaultModel)) {
          nextCi.models.defaultModel = 'gemini-4-hydrogen';
        }
        const wfKeys: AiWorkflowKey[] = ['assistant', 'voucherDrafting', 'reportInsights', 'templateStudio'];
        for (const k of wfKeys) {
          if (!ALLOWED_AI_MODELS.includes(nextCi.models.workflowOverrides[k].model)) {
            nextCi.models.workflowOverrides[k].model = nextCi.models.defaultModel;
          }
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(nextCi.style.accentHex)) {
          nextCi.style.accentHex = '#1F4E79';
        }
        nextCi.knowledge.rules = nextCi.knowledge.rules
          .filter((r) => r && r.title?.trim() && r.content?.trim())
          .slice(0, 100);
        nextCi.knowledge.glossary = nextCi.knowledge.glossary
          .filter((g) => g && g.term?.trim() && g.definition?.trim())
          .slice(0, 200);
        // Preserve existing uploaded documents unless explicitly toggled/removed
        const existingDocs = hydrateCustomInstructions(ledgerState.config.customInstructions).knowledge.documents;
        const incomingDocMap = new Map(
          (Array.isArray(nextCi.knowledge.documents) ? nextCi.knowledge.documents : []).map((d) => [d.id, d])
        );
        nextCi.knowledge.documents = existingDocs
          .filter((d) => incomingDocMap.has(d.id))
          .map((d) => ({
            ...d,
            enabled: incomingDocMap.get(d.id)!.enabled,
          }));
        ledgerState.config.customInstructions = nextCi;
        updatedSections.push('Custom Instructions');
      }

      ledgerState.config = hydrateSystemConfig(ledgerState.config);

      const sectionSummary =
        updatedSections.length > 0
          ? Array.from(new Set(updatedSections)).join(', ')
          : 'General Settings';
      appendAuditLog(
        ledgerState,
        'CONFIG',
        'UPDATE_CONFIG',
        `Updated system configuration (${sectionSummary}; Auto-Sync: ${ledgerState.config.autoSyncOnPost ? 'Enabled' : 'Manual'}; Locked Months: ${ledgerState.config.lockedMonths?.length || 0}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.json({ state: ledgerState });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update configuration.' });
    }
  });

  // ============================================================================
  // GLOBAL CUSTOM INSTRUCTIONS & SERVER-SIDE GEMINI AI WORKFLOWS
  // ============================================================================

  // Compile & inspect active custom instructions for any workflow
  app.post('/api/ai/preview', (req, res) => {
    try {
      const { workflow = 'assistant', draftCustomInstructions } = req.body as {
        workflow?: AiWorkflowKey;
        draftCustomInstructions?: CustomInstructionsConfig;
      };
      const effectiveState: LedgerState = draftCustomInstructions
        ? {
            ...ledgerState,
            config: {
              ...ledgerState.config,
              customInstructions: hydrateCustomInstructions(draftCustomInstructions),
            },
          }
        : ledgerState;

      const compiled = compileCustomInstructions(effectiveState, workflow, {
        includeChartOfAccounts: workflow === 'voucherDrafting',
      });

      res.json({
        ...compiled,
        compiledChars: compiled.systemInstruction.length,
        estimatedTokens: Math.ceil(compiled.systemInstruction.length / 4),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compile instructions.' });
    }
  });

  // Run sandbox test prompt using current or unsaved draft custom instructions
  app.post('/api/ai/test', async (req, res) => {
    try {
      const { prompt, workflow = 'assistant', draftCustomInstructions } = req.body as {
        prompt: string;
        workflow?: AiWorkflowKey;
        draftCustomInstructions?: CustomInstructionsConfig;
      };
      if (!prompt || !prompt.trim()) {
        res.status(400).json({ error: 'Test prompt cannot be empty.' });
        return;
      }
      const result = await runInstructionSandboxTest(
        ledgerState,
        prompt.trim(),
        workflow,
        draftCustomInstructions ? hydrateCustomInstructions(draftCustomInstructions) : undefined
      );
      res.json(result);
    } catch (err) {
      const status = err instanceof AiServiceError ? err.status : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'AI test failed.',
        isPaidModelError: err instanceof AiServiceError ? Boolean(err.isPaidModelError) : false,
      });
    }
  });

  // Upload, parse (PDF, CSV, MD, TXT, JSON), chunk & vectorize a Document Store file
  const handleDocumentUpload = async (req: express.Request, res: express.Response) => {
    try {
      const { filename, mimeType, textContent, base64Data, scope, chunkSizeTarget } = req.body as {
        filename: string;
        mimeType?: string;
        textContent?: string;
        base64Data?: string;
        scope?: DocumentInjectionScope;
        chunkSizeTarget?: number;
      };
      const cleanName = path.basename(String(filename || '').trim());
      if (!cleanName) {
        res.status(400).json({ error: 'Filename is required.' });
        return;
      }
      const ext = path.extname(cleanName).toLowerCase();
      if (!['.pdf', '.csv', '.md', '.markdown', '.txt', '.json', '.tsv', '.log'].includes(ext)) {
        res.status(400).json({
          error: 'Unsupported file type. Upload PDF, CSV, Markdown (.md), TXT, or JSON reference documents.',
        });
        return;
      }

      const ci = hydrateCustomInstructions(ledgerState.config.customInstructions);
      if (ci.knowledge.documents.length >= 25) {
        res.status(400).json({ error: 'Maximum of 25 Document Store files reached. Remove an older file first.' });
        return;
      }

      const extracted = await extractDocumentText({
        filename: cleanName,
        base64Data,
        textContent,
      });

      const resolvedScope: DocumentInjectionScope =
        scope === 'assistant' || scope === 'reporting' ? scope : 'global';
      const normalizedChunkSize = Math.min(1600, Math.max(400, Number(chunkSizeTarget) || 900));

      const docItem: KnowledgeDocumentItem = {
        id: `DOC-${Date.now().toString(36).toUpperCase()}`,
        filename: cleanName,
        fileType: extracted.fileType,
        mimeType: mimeType || (ext === '.pdf' ? 'application/pdf' : 'text/plain'),
        sizeBytes: extracted.sizeBytes,
        uploadedAt: new Date().toISOString(),
        extractedText: extracted.extractedText,
        charCount: extracted.extractedText.length,
        enabled: true,
        scope: resolvedScope,
        vectorStatus: 'pending',
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimensions: 0,
        chunkCount: 0,
        chunkSizeTarget: normalizedChunkSize,
        vectorizedAt: null,
        summaryPreview: extracted.extractedText.replace(/\s+/g, ' ').trim().slice(0, 180),
      };

      let vectorWarning: string | undefined;
      try {
        const vecResult = await vectorizeAndStoreDocument(docItem, normalizedChunkSize);
        docItem.vectorStatus = 'vectorized';
        docItem.chunkCount = vecResult.chunkCount;
        docItem.embeddingDimensions = vecResult.embeddingDimensions;
        docItem.embeddingModel = vecResult.embeddingModel;
        docItem.vectorizedAt = vecResult.vectorizedAt;
      } catch (vecErr) {
        docItem.vectorStatus = 'error';
        docItem.vectorError =
          vecErr instanceof Error ? vecErr.message : 'Failed to generate Gemini embeddings.';
        vectorWarning = docItem.vectorError;
      }

      ci.knowledge.documents.unshift(docItem);
      ledgerState.config.customInstructions = ci;
      ledgerState.config = hydrateSystemConfig(ledgerState.config);

      appendAuditLog(
        ledgerState,
        'DOCUMENT_STORE',
        'UPLOAD_VECTOR_DOC',
        `Uploaded ${docItem.fileType} document ${docItem.filename} (${docItem.charCount} chars, status=${docItem.vectorStatus}, chunks=${docItem.chunkCount}, scope=${docItem.scope}).`,
        docItem.vectorStatus === 'vectorized' ? 'SUCCESS' : 'ALERT'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, document: docItem, vectorWarning });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to ingest document.' });
    }
  };

  app.post('/api/ai/knowledge/upload', handleDocumentUpload);
  app.post('/api/ai/documents/upload', handleDocumentUpload);

  // Update Document Store item metadata (enabled toggle or context injection scope)
  app.patch('/api/ai/documents/:id', (req, res) => {
    const ci = hydrateCustomInstructions(ledgerState.config.customInstructions);
    const doc = ci.knowledge.documents.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found in Document Store.' });
      return;
    }
    const { enabled, scope } = req.body as {
      enabled?: boolean;
      scope?: DocumentInjectionScope;
    };
    if (typeof enabled === 'boolean') doc.enabled = enabled;
    if (scope === 'global' || scope === 'assistant' || scope === 'reporting') {
      doc.scope = scope;
    }
    ledgerState.config.customInstructions = ci;
    ledgerState.config = hydrateSystemConfig(ledgerState.config);
    appendAuditLog(
      ledgerState,
      'DOCUMENT_STORE',
      'UPDATE_VECTOR_DOC',
      `Updated Document Store entry ${doc.filename} (enabled=${doc.enabled}, scope=${doc.scope}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, document: doc });
  });

  // Vectorize or re-index an existing Document Store item with Gemini Embeddings
  app.post('/api/ai/documents/:id/vectorize', async (req, res) => {
    const ci = hydrateCustomInstructions(ledgerState.config.customInstructions);
    const doc = ci.knowledge.documents.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found in Document Store.' });
      return;
    }
    const { chunkSizeTarget } = (req.body || {}) as { chunkSizeTarget?: number };
    const targetSize = chunkSizeTarget
      ? Math.min(1600, Math.max(400, Number(chunkSizeTarget)))
      : doc.chunkSizeTarget || 900;

    try {
      const vecResult = await vectorizeAndStoreDocument(doc, targetSize);
      doc.chunkSizeTarget = targetSize;
      doc.vectorStatus = 'vectorized';
      doc.vectorError = undefined;
      doc.chunkCount = vecResult.chunkCount;
      doc.embeddingDimensions = vecResult.embeddingDimensions;
      doc.embeddingModel = vecResult.embeddingModel;
      doc.vectorizedAt = vecResult.vectorizedAt;

      ledgerState.config.customInstructions = ci;
      ledgerState.config = hydrateSystemConfig(ledgerState.config);
      appendAuditLog(
        ledgerState,
        'DOCUMENT_STORE',
        'VECTORIZE_DOC',
        `Vectorized ${doc.filename} into ${doc.chunkCount} chunks (${doc.embeddingDimensions} dims) using ${doc.embeddingModel}.`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.json({ state: ledgerState, document: doc });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Vectorization failed.';
      doc.vectorStatus = 'error';
      doc.vectorError = message;
      ledgerState.config.customInstructions = ci;
      ledgerState.config = hydrateSystemConfig(ledgerState.config);
      saveState(ledgerState);
      res.status(502).json({ error: message, state: ledgerState, document: doc });
    }
  });

  // Inspect chunks stored for a Document Store item
  app.get('/api/ai/documents/:id/chunks', (req, res) => {
    const ci = hydrateCustomInstructions(ledgerState.config.customInstructions);
    const doc = ci.knowledge.documents.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found in Document Store.' });
      return;
    }
    const chunks = getDocumentChunks(doc.id);
    res.json({ document: doc, chunks });
  });

  // Run semantic cosine similarity retrieval across Document Store vectors
  app.post('/api/ai/documents/search', async (req, res) => {
    try {
      const { query, targetScope = 'global', topK = 6 } = req.body as {
        query: string;
        targetScope?: DocumentInjectionScope;
        topK?: number;
      };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'Search query cannot be empty.' });
        return;
      }
      const ci = hydrateCustomInstructions(ledgerState.config.customInstructions);
      const hits = await searchDocumentVectors({
        query: query.trim(),
        documents: ci.knowledge.documents,
        targetScope,
        topK: Math.min(12, Math.max(1, Number(topK) || 6)),
      });
      res.json({ hits, embeddingModel: EMBEDDING_MODEL });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Vector similarity search failed.',
      });
    }
  });

  // Delete an uploaded knowledge/Document Store file and its vector chunks
  const handleDeleteDocument = (req: express.Request, res: express.Response) => {
    const ci = hydrateCustomInstructions(ledgerState.config.customInstructions);
    const idx = ci.knowledge.documents.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Knowledge document not found.' });
      return;
    }
    const [removed] = ci.knowledge.documents.splice(idx, 1);
    deleteDocumentVectors(removed.id);
    ledgerState.config.customInstructions = ci;
    ledgerState.config = hydrateSystemConfig(ledgerState.config);

    appendAuditLog(
      ledgerState,
      'DOCUMENT_STORE',
      'DELETE_KNOWLEDGE_DOC',
      `Removed Document Store file ${removed.filename} and purged vector chunks.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  };

  app.delete('/api/ai/knowledge/:id', handleDeleteDocument);
  app.delete('/api/ai/documents/:id', handleDeleteDocument);

  // Streaming Executive ERP Assistant (SSE)
  app.post('/api/ai/assistant', async (req, res) => {
    const { messages, activeRoute = 'dashboard' } = req.body as {
      messages: Array<{ role: 'user' | 'model'; text: string }>;
      activeRoute?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'At least one user message is required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const meta = await streamAssistantChat(ledgerState, messages, activeRoute, (chunkText) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ type: 'done', meta })}\n\n`);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Assistant request failed.';
      const isPaidModelError = err instanceof AiServiceError ? Boolean(err.isPaidModelError) : false;
      res.write(`data: ${JSON.stringify({ type: 'error', error: message, isPaidModelError })}\n\n`);
      res.end();
    }
  });

  // Smart Voucher & Journal Line Drafting
  app.post('/api/ai/draft-voucher', async (req, res) => {
    try {
      const { instruction, voucherType } = req.body as {
        instruction: string;
        voucherType?: VoucherKind | 'MasterJournal';
      };
      if (!instruction || !instruction.trim()) {
        res.status(400).json({ error: 'Please describe the transaction to draft.' });
        return;
      }
      const drafted = await draftVoucherWithAi(ledgerState, instruction, voucherType);
      res.json(drafted);
    } catch (err) {
      const status = err instanceof AiServiceError ? err.status : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Unable to draft voucher.',
        isPaidModelError: err instanceof AiServiceError ? Boolean(err.isPaidModelError) : false,
      });
    }
  });

  // Financial Report & Audit Commentary
  app.post('/api/ai/report-insights', async (req, res) => {
    try {
      const { reportScope = 'summary', focusQuestion } = req.body as {
        reportScope?: 'summary' | 'trial-balance' | 'income' | 'balance-sheet' | 'monthly' | 'audit';
        focusQuestion?: string;
      };
      const insights = await generateReportInsights(ledgerState, reportScope, focusQuestion);
      res.json(insights);
    } catch (err) {
      const status = err instanceof AiServiceError ? err.status : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Unable to generate report commentary.',
        isPaidModelError: err instanceof AiServiceError ? Boolean(err.isPaidModelError) : false,
      });
    }
  });

  // Template Studio AI HTML/CSS Generation
  app.post('/api/ai/generate-template', async (req, res) => {
    try {
      const { prompt, category, dataSource, paperSize, existingHtml, existingCss } = req.body as {
        prompt: string;
        category: string;
        dataSource: string;
        paperSize: string;
        existingHtml?: string;
        existingCss?: string;
      };
      if (!prompt || !prompt.trim()) {
        res.status(400).json({ error: 'Please describe the template layout to generate.' });
        return;
      }
      const generated = await generateTemplateWithAi(ledgerState, prompt, {
        category: category || 'Custom Page',
        dataSource: dataSource || 'financialSummary',
        paperSize: paperSize || 'A4',
        existingHtml,
        existingCss,
      });
      res.json(generated);
    } catch (err) {
      const status = err instanceof AiServiceError ? err.status : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Unable to generate template.',
        isPaidModelError: err instanceof AiServiceError ? Boolean(err.isPaidModelError) : false,
      });
    }
  });

  // Prune expired audit log entries based on retention policy
  app.post('/api/audit/prune', (_req, res) => {
    try {
      const cfg = hydrateSystemConfig(ledgerState.config);
      const retentionDays = cfg.auditRetentionDays ?? 365;
      const maxEntries = cfg.maxAuditEntries ?? 1000;
      const minKeep = 25;
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      const beforeCount = ledgerState.auditLogs.length;
      if (beforeCount <= minKeep) {
        res.json({
          state: ledgerState,
          result: { removedCount: 0, remainingCount: beforeCount },
        });
        return;
      }

      const preservedRecent = ledgerState.auditLogs.slice(0, minKeep);
      const olderPool = ledgerState.auditLogs.slice(minKeep);
      const retainedOlder = olderPool.filter((entry) => {
        const ts = Date.parse(entry.timestamp);
        return Number.isNaN(ts) || ts >= cutoffMs;
      });
      const combined = [...preservedRecent, ...retainedOlder].slice(0, maxEntries);
      const removedCount = Math.max(0, beforeCount - combined.length);
      ledgerState.auditLogs = combined;

      appendAuditLog(
        ledgerState,
        'CONFIG',
        'PRUNE_AUDIT_LOG',
        removedCount > 0
          ? `Pruned ${removedCount} expired audit log entry(ies) under retention policy (${retentionDays} days / max ${maxEntries}).`
          : `Audit retention sweep completed: 0 entries expired under policy (${retentionDays} days / max ${maxEntries}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.json({
        state: ledgerState,
        result: { removedCount, remainingCount: ledgerState.auditLogs.length },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to prune audit log.' });
    }
  });

  // Restore full workspace JSON backup snapshot with schema validation
  app.post('/api/backup/restore', (req, res) => {
    try {
      const incoming = (req.body as { snapshot?: Partial<LedgerState> })?.snapshot ?? (req.body as Partial<LedgerState>);
      if (!incoming || typeof incoming !== 'object') {
        res.status(400).json({ error: 'Invalid backup payload: expected a JSON ledger snapshot object.' });
        return;
      }
      if (!Array.isArray(incoming.accounts) || incoming.accounts.length === 0) {
        res.status(400).json({ error: 'Backup validation failed: missing or empty Chart of Accounts array.' });
        return;
      }
      if (!Array.isArray(incoming.postedTransactions) || !Array.isArray(incoming.journalLines)) {
        res.status(400).json({
          error: 'Backup validation failed: snapshot must contain journalLines and postedTransactions arrays.',
        });
        return;
      }
      if (!incoming.registers || typeof incoming.registers !== 'object') {
        res.status(400).json({ error: 'Backup validation failed: missing registers map.' });
        return;
      }
      if (!incoming.config || typeof incoming.config !== 'object') {
        res.status(400).json({ error: 'Backup validation failed: missing system config object.' });
        return;
      }

      const restored: LedgerState = {
        datasetVersion: incoming.datasetVersion || CURRENT_DATASET_VERSION,
        config: hydrateSystemConfig(incoming.config),
        accounts: incoming.accounts,
        journalLines: incoming.journalLines,
        postedTransactions: incoming.postedTransactions,
        registers: incoming.registers,
        auditLogs: Array.isArray(incoming.auditLogs) ? incoming.auditLogs : [],
        products: Array.isArray(incoming.products) ? incoming.products : buildInitialProducts(),
        customers: Array.isArray(incoming.customers) ? incoming.customers : buildInitialCustomers(),
        suppliers: Array.isArray(incoming.suppliers) ? incoming.suppliers : buildInitialSuppliers(),
        localPurchaseOrders: Array.isArray(incoming.localPurchaseOrders)
          ? incoming.localPurchaseOrders
          : buildInitialLocalPOs(),
        importLCs: Array.isArray(incoming.importLCs) ? incoming.importLCs : buildInitialImportLCs(),
        inventorySerials: Array.isArray(incoming.inventorySerials)
          ? incoming.inventorySerials
          : buildInitialSerialRegister(),
        salesOrders: Array.isArray(incoming.salesOrders) ? incoming.salesOrders : buildInitialSalesOrders(),
        posTransactions: Array.isArray(incoming.posTransactions)
          ? incoming.posTransactions
          : buildInitialPosTransactions(),
        warrantyClaims: Array.isArray(incoming.warrantyClaims)
          ? incoming.warrantyClaims
          : buildInitialWarrantyClaims(),
        serviceJobs: Array.isArray(incoming.serviceJobs) ? incoming.serviceJobs : buildInitialServiceJobs(),
        spareParts: Array.isArray(incoming.spareParts) ? incoming.spareParts : buildInitialSpareParts(),
        vouchers: Array.isArray(incoming.vouchers) ? incoming.vouchers : buildInitialVouchers(),
        templates: Array.isArray(incoming.templates) ? incoming.templates : buildInitialTemplates(),
      };

      ledgerState = restored;
      appendAuditLog(
        ledgerState,
        'CONFIG',
        'RESTORE_BACKUP',
        `Restored workspace backup snapshot (${ledgerState.accounts.length} accounts, ${ledgerState.postedTransactions.length} posted transactions, ${ledgerState.vouchers.length} vouchers).`,
        'ALERT'
      );
      saveState(ledgerState);
      res.json({
        state: ledgerState,
        summary: {
          accounts: ledgerState.accounts.length,
          postedTransactions: ledgerState.postedTransactions.length,
          vouchers: ledgerState.vouchers.length,
          templates: ledgerState.templates.length,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to restore backup snapshot.' });
    }
  });

  // Reset Ledger Workspace to initial ATCL 54-account opening baseline
  app.post('/api/reset', (_req, res) => {
    ledgerState = createInitialLedgerState();
    clearVectorStore();
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // Load optional FY 2024-25 sample posted transactions for demo/testing
  app.post('/api/load-sample', (_req, res) => {
    ledgerState = createSamplePopulatedLedgerState();
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // Import Chart of Accounts rows from CSV
  app.post('/api/import/coa', (req, res) => {
    try {
      const { accounts } = req.body as {
        accounts: Array<{
          code: string;
          name: string;
          category: AccountCategory;
          group: string;
          openingBalance: number;
        }>;
      };
      if (!Array.isArray(accounts) || accounts.length === 0) {
        res.status(400).json({ error: 'No valid account rows provided for import.' });
        return;
      }

      const now = new Date().toISOString();
      const validCats: AccountCategory[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
      const imported: GLAccount[] = [];
      const seen = new Set<string>();

      for (const row of accounts) {
        const code = String(row.code || '').trim();
        const name = String(row.name || '').trim();
        const cat = validCats.includes(row.category) ? row.category : 'Expense';
        if (!code || !name || seen.has(code)) continue;
        seen.add(code);
        imported.push({
          code,
          name,
          category: cat,
          group: String(row.group || '').trim() || 'General',
          openingBalance: round2(Number(row.openingBalance) || 0),
          normalBalance: cat === 'Asset' || cat === 'Expense' ? 'Debit' : 'Credit',
          registerFileId: `REG-ATCL-${code}`,
          registerFileName: `${code} - ${name} - Register Book`,
          status: 'Active',
          lastSyncedAt: now,
        });
      }

      if (imported.length === 0) {
        res.status(400).json({ error: 'Could not parse any valid GL accounts from the CSV.' });
        return;
      }

      ledgerState.accounts = imported.sort((a, b) => a.code.localeCompare(b.code));
      ledgerState.registers = {};
      for (const acc of ledgerState.accounts) {
        ledgerState.registers[acc.code] = {
          glCode: acc.code,
          fileId: acc.registerFileId!,
          fileName: acc.registerFileName!,
          createdAt: now,
          lastSyncedAt: now,
          entries: [],
        };
      }
      ledgerState.postedTransactions = [];
      ledgerState.journalLines = [];

      appendAuditLog(
        ledgerState,
        'REGISTER_MGR',
        'IMPORT_COA_CSV',
        `Imported ${imported.length} GL accounts from CSV and provisioned individual Register Books.`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.json({ state: ledgerState, importedCount: imported.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'COA CSV import failed.' });
    }
  });

  // Expose attached Apps Script (.gs) modules for inspection / download in System Config
  app.get('/api/scripts', (_req, res) => {
    try {
      if (!fs.existsSync(ASSETS_DIR)) {
        res.json({ scripts: [] });
        return;
      }
      const files = fs
        .readdirSync(ASSETS_DIR)
        .filter((f) => f.endsWith('.gs'))
        .sort();

      const scripts = files.map((filename) => {
        const cleanName = filename.replace(/_[a-f0-9]{8}\.gs$/, '.gs');
        const content = fs.readFileSync(path.join(ASSETS_DIR, filename), 'utf-8');
        return {
          filename: cleanName,
          rawFilename: filename,
          sizeBytes: Buffer.byteLength(content, 'utf-8'),
          content,
        };
      });
      res.json({ scripts });
    } catch {
      res.json({ scripts: [] });
    }
  });

  // ============================================================
  // MASTER DATA: PRODUCTS & ITEMS (Admin RBAC Enforced)
  // ============================================================
  let cachedCerts: { keys: Record<string, string>; expiresAt: number } | null = null;

  async function requireProductAdmin(
    req: express.Request,
    res: express.Response
  ): Promise<boolean> {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(403).json({
        error: 'Access Denied: Administrator authentication is required to modify or delete products.',
      });
      return false;
    }

    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Malformed token');
      }
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
        kid?: string;
        alg?: string;
      };
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        aud?: string;
        iss?: string;
        exp?: number;
        email?: string;
        email_verified?: boolean;
        sub?: string;
      };

      const nowSec = Math.floor(Date.now() / 1000);
      if (
        payload.aud !== 'erpatclbd' ||
        payload.iss !== 'https://securetoken.google.com/erpatclbd' ||
        !payload.exp ||
        payload.exp <= nowSec
      ) {
        throw new Error('Invalid or expired token claims');
      }

      if (!cachedCerts || Date.now() >= cachedCerts.expiresAt) {
        const certRes = await fetch(
          'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
        );
        if (!certRes.ok) throw new Error('Unable to fetch Firebase public keys');
        const keys = (await certRes.json()) as Record<string, string>;
        const cacheControl = certRes.headers.get('cache-control') || '';
        const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
        const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600_000;
        cachedCerts = { keys, expiresAt: Date.now() + maxAgeMs };
      }

      const cert = header.kid ? cachedCerts.keys[header.kid] : undefined;
      if (!cert) throw new Error('Unknown signing key');

      const { createVerify } = await import('node:crypto');
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${parts[0]}.${parts[1]}`);
      verifier.end();
      const signatureValid = verifier.verify(cert, Buffer.from(parts[2], 'base64url'));
      if (!signatureValid) throw new Error('Invalid token signature');

      const isRootAdmin =
        payload.email === 'erpatcl@gmail.com' && payload.email_verified === true;
      if (!isRootAdmin) {
        res.status(403).json({
          error: 'Access Denied: Only administrators can create, edit, or delete products.',
        });
        return false;
      }
      return true;
    } catch {
      res.status(403).json({
        error: 'Access Denied: Invalid or unauthorized administrator credentials.',
      });
      return false;
    }
  }

  app.post('/api/master/products', async (req, res) => {
    if (!(await requireProductAdmin(req, res))) return;
    try {
      const body = req.body as Omit<ProductItem, 'id' | 'updatedAt'>;
      const sku = String(body.sku || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      if (!sku || !name) {
        res.status(400).json({ error: 'SKU and Product Name are required.' });
        return;
      }
      if (ledgerState.products.some((p) => p.sku.toUpperCase() === sku)) {
        res.status(409).json({ error: `Product SKU '${sku}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.products.reduce((max, p) => {
          const m = /^PRD-(\d+)$/.exec(p.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 1000) + 1;
      const itemType = String(body.itemType || '').trim() || 'Inventory';
      const now = new Date().toISOString();
      const product: ProductItem = {
        id: `PRD-${nextNum}`,
        sku,
        name,
        itemType,
        category: String(body.category || '').trim() || 'General',
        unit: String(body.unit || '').trim() || 'Unit',
        hsnCode: String(body.hsnCode || '').trim(),
        unitCost: round2(Math.max(0, Number(body.unitCost) || 0)),
        sellingPrice: round2(Math.max(0, Number(body.sellingPrice) || 0)),
        stockQty: itemType === 'Inventory' ? Math.max(0, Number(body.stockQty) || 0) : 0,
        reorderLevel: itemType === 'Inventory' ? Math.max(0, Number(body.reorderLevel) || 0) : 0,
        inventoryGlCode: String(body.inventoryGlCode || (itemType === 'Inventory' ? '1110' : '')).trim(),
        revenueGlCode: String(body.revenueGlCode || '4010').trim(),
        cogsGlCode: String(body.cogsGlCode || '5010').trim(),
        modelReference: String(body.modelReference || '').trim(),
        manufacturer: String(body.manufacturer || '').trim(),
        brand: String(body.brand || '').trim(),
        originCountry: String(body.originCountry || '').trim(),
        shortDetails: String(body.shortDetails || '').trim(),
        status: body.status === 'Inactive' ? 'Inactive' : 'Active',
        updatedAt: now,
      };
      ledgerState.products.push(product);
      appendAuditLog(
        ledgerState,
        'MASTER_DATA',
        'CREATE_PRODUCT',
        `Added catalog item ${product.sku} — ${product.name} (${product.itemType}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, product });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create product.' });
    }
  });

  app.patch('/api/master/products/:id', async (req, res) => {
    if (!(await requireProductAdmin(req, res))) return;
    const product = ledgerState.products.find((p) => p.id === req.params.id);
    if (!product) {
      res.status(404).json({ error: 'Product item not found.' });
      return;
    }
    const body = req.body as Partial<Omit<ProductItem, 'id' | 'updatedAt'>>;
    if (typeof body.sku === 'string' && body.sku.trim()) {
      const nextSku = body.sku.trim().toUpperCase();
      if (ledgerState.products.some((p) => p.id !== product.id && p.sku.toUpperCase() === nextSku)) {
        res.status(409).json({ error: `Product SKU '${nextSku}' already exists.` });
        return;
      }
      product.sku = nextSku;
    }
    if (typeof body.name === 'string' && body.name.trim()) product.name = body.name.trim();
    if (typeof body.itemType === 'string' && body.itemType.trim()) {
      product.itemType = body.itemType.trim();
    }
    if (typeof body.category === 'string') product.category = body.category.trim() || 'General';
    if (typeof body.unit === 'string') product.unit = body.unit.trim() || 'Unit';
    if (typeof body.hsnCode === 'string') product.hsnCode = body.hsnCode.trim();
    if (body.unitCost !== undefined) product.unitCost = round2(Math.max(0, Number(body.unitCost) || 0));
    if (body.sellingPrice !== undefined) product.sellingPrice = round2(Math.max(0, Number(body.sellingPrice) || 0));
    if (body.stockQty !== undefined) {
      product.stockQty = product.itemType === 'Inventory' ? Math.max(0, Number(body.stockQty) || 0) : 0;
    }
    if (body.reorderLevel !== undefined) {
      product.reorderLevel = product.itemType === 'Inventory' ? Math.max(0, Number(body.reorderLevel) || 0) : 0;
    }
    if (typeof body.inventoryGlCode === 'string') {
      product.inventoryGlCode = body.inventoryGlCode.trim();
    }
    if (typeof body.revenueGlCode === 'string') product.revenueGlCode = body.revenueGlCode.trim();
    if (typeof body.cogsGlCode === 'string') product.cogsGlCode = body.cogsGlCode.trim();
    if (typeof body.modelReference === 'string') product.modelReference = body.modelReference.trim();
    if (typeof body.manufacturer === 'string') product.manufacturer = body.manufacturer.trim();
    if (typeof body.brand === 'string') product.brand = body.brand.trim();
    if (typeof body.originCountry === 'string') product.originCountry = body.originCountry.trim();
    if (typeof body.shortDetails === 'string') product.shortDetails = body.shortDetails.trim();
    if (body.status === 'Active' || body.status === 'Inactive') product.status = body.status;
    product.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'MASTER_DATA',
      'UPDATE_PRODUCT',
      `Updated catalog item ${product.sku} (${product.name}) — Status: ${product.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, product });
  });

  app.delete('/api/master/products/:id', async (req, res) => {
    if (!(await requireProductAdmin(req, res))) return;
    const idx = ledgerState.products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Product item not found.' });
      return;
    }
    const [removed] = ledgerState.products.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'MASTER_DATA',
      'DELETE_PRODUCT',
      `Removed catalog item ${removed.sku} — ${removed.name}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // MASTER DATA: CUSTOMERS 360°
  // ============================================================
  function normalizeServerBDPhone(raw: string): string {
    const trimmed = String(raw || '').trim();
    const digitsOnly = trimmed.replace(/[\s\-()]/g, '');
    if (digitsOnly.startsWith('+8801') && digitsOnly.length === 14) return digitsOnly.slice(3);
    if (digitsOnly.startsWith('8801') && digitsOnly.length === 13) return digitsOnly.slice(2);
    return digitsOnly;
  }

  function validateServerBDPhone(raw: string): { valid: boolean; normalized: string; error?: string } {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { valid: false, normalized: '', error: 'Phone number is required.' };
    if (!/^\d+$/.test(trimmed)) {
      return { valid: false, normalized: trimmed, error: 'Phone number must contain only digits (e.g., 01744883636).' };
    }
    if (trimmed.length < 11) return { valid: false, normalized: trimmed, error: 'Phone number must contain exactly 11 digits.' };
    if (trimmed.length > 11) return { valid: false, normalized: trimmed, error: 'Phone number cannot exceed 11 digits.' };
    if (!/^01[3-9]\d{8}$/.test(trimmed)) {
      return { valid: false, normalized: trimmed, error: 'Enter a valid Bangladesh mobile number starting with 01.' };
    }
    return { valid: true, normalized: trimmed };
  }

  app.get('/api/master/customers/check-phone', (req, res) => {
    const phone = normalizeServerBDPhone(String(req.query.phone || ''));
    const excludeId = String(req.query.excludeId || '');
    const match = phone
      ? ledgerState.customers.find(
          (c) => c.id !== excludeId && normalizeServerBDPhone(c.phone) === phone
        )
      : undefined;
    res.json({
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
    });
  });

  app.post('/api/master/customers', (req, res) => {
    try {
      const body = req.body as Omit<CustomerRecord, 'id' | 'updatedAt'>;
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      const phoneCheck = validateServerBDPhone(String(body.phone || ''));
      if (!code || !name) {
        res.status(400).json({ error: 'Customer Code and Legal Name are required.' });
        return;
      }
      if (!phoneCheck.valid) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      const existingByPhone = ledgerState.customers.find(
        (c) => normalizeServerBDPhone(c.phone) === phoneCheck.normalized
      );
      if (existingByPhone) {
        res.status(409).json({
          error: `Duplicate Customer Detected! This phone number is already registered under ${existingByPhone.code} (${existingByPhone.name}).`,
          existingCustomer: {
            id: existingByPhone.id,
            code: existingByPhone.code,
            name: existingByPhone.name,
            phone: existingByPhone.phone,
            status: existingByPhone.status,
          },
        });
        return;
      }
      if (ledgerState.customers.some((c) => c.code.toUpperCase() === code)) {
        res.status(409).json({ error: `Customer Code '${code}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.customers.reduce((max, c) => {
          const m = /^CUS-(\d+)$/.exec(c.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const aging = {
        current: round2(Math.max(0, Number(body.aging?.current) || 0)),
        days30: round2(Math.max(0, Number(body.aging?.days30) || 0)),
        days60: round2(Math.max(0, Number(body.aging?.days60) || 0)),
        days90Plus: round2(Math.max(0, Number(body.aging?.days90Plus) || 0)),
      };
      const agingSum = round2(aging.current + aging.days30 + aging.days60 + aging.days90Plus);
      const currentReceivable =
        agingSum > 0 ? agingSum : round2(Math.max(0, Number(body.currentReceivable) || 0));
      if (agingSum === 0 && currentReceivable > 0) {
        aging.current = currentReceivable;
      }

      const customerCodeMatch = /^CUST-(\d+)$/.exec(code);
      if (customerCodeMatch) {
        const num = parseInt(customerCodeMatch[1], 10);
        ledgerState.config.highestCustomerCodeNum = Math.max(
          ledgerState.config.highestCustomerCodeNum || 1000,
          num
        );
      }

      const now = new Date().toISOString();
      const customer: CustomerRecord = {
        id: `CUS-${String(nextNum).padStart(3, '0')}`,
        code,
        name,
        segment: String(body.segment || '').trim() || 'Enterprise',
        contactPerson: String(body.contactPerson || '').trim(),
        email: String(body.email || '').trim(),
        phone: String(body.phone || '').trim(),
        city: String(body.city || '').trim() || 'Dhaka',
        vat: String(body.vat || '').trim(),
        binNumber: String(body.binNumber || '').trim(),
        paymentTerms: String(body.paymentTerms || '').trim() || 'Net 30 Days',
        creditLimit: round2(Math.max(0, Number(body.creditLimit) || 0)),
        openingReceivable: round2(Math.max(0, Number(body.openingReceivable) || 0)),
        currentReceivable,
        ytdRevenue: round2(Math.max(0, Number(body.ytdRevenue) || 0)),
        aging,
        receivableGlCode: '1120',
        status: String(body.status || '').trim() || 'Active',
        notes: String(body.notes || '').trim(),
        createdBy: String(body.createdBy || 'system@atcl.com'),
        createdAt: now,
        updatedBy: String(body.updatedBy || body.createdBy || 'system@atcl.com'),
        updatedAt: now,
      };
      ledgerState.customers.push(customer);
      appendAuditLog(
        ledgerState,
        'MASTER_DATA',
        'CREATE_CUSTOMER',
        `Added customer ${customer.code} — ${customer.name} (${customer.segment}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, customer });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create customer.' });
    }
  });

  app.patch('/api/master/customers/:id', (req, res) => {
    const customer = ledgerState.customers.find((c) => c.id === req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'Customer record not found.' });
      return;
    }
    const body = req.body as Partial<Omit<CustomerRecord, 'id' | 'updatedAt'>>;
    if (typeof body.code === 'string' && body.code.trim()) {
      const nextCode = body.code.trim().toUpperCase();
      if (ledgerState.customers.some((c) => c.id !== customer.id && c.code.toUpperCase() === nextCode)) {
        res.status(409).json({ error: `Customer Code '${nextCode}' already exists.` });
        return;
      }
      customer.code = nextCode;
    }
    if (typeof body.name === 'string' && body.name.trim()) customer.name = body.name.trim();
    if (body.segment) customer.segment = body.segment;
    if (typeof body.contactPerson === 'string') customer.contactPerson = body.contactPerson.trim();
    if (typeof body.email === 'string') customer.email = body.email.trim();
    if (typeof body.phone === 'string') {
      const phoneCheck = validateServerBDPhone(body.phone);
      if (!phoneCheck.valid) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      const dupPhone = ledgerState.customers.find(
        (c) => c.id !== customer.id && normalizeServerBDPhone(c.phone) === phoneCheck.normalized
      );
      if (dupPhone) {
        res.status(409).json({
          error: `This phone number is already registered to another customer (${dupPhone.code} — ${dupPhone.name}).`,
        });
        return;
      }
      customer.phone = phoneCheck.normalized;
    }
    if (typeof body.city === 'string') customer.city = body.city.trim();
    if (typeof body.vat === 'string') customer.vat = body.vat.trim();
    if (typeof body.binNumber === 'string') customer.binNumber = body.binNumber.trim();
    if (typeof body.paymentTerms === 'string') customer.paymentTerms = body.paymentTerms.trim();
    if (body.creditLimit !== undefined) customer.creditLimit = round2(Math.max(0, Number(body.creditLimit) || 0));
    // Prevent duplicate/arbitrary modification of posted opening receivable
    customer.receivableGlCode = '1120';
    if (typeof body.status === 'string' && body.status.trim()) {
      customer.status = body.status.trim();
    }
    if (typeof body.notes === 'string') customer.notes = body.notes;
    if (typeof body.updatedBy === 'string') customer.updatedBy = body.updatedBy;
    customer.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'MASTER_DATA',
      'UPDATE_CUSTOMER',
      `Updated customer ${customer.code} (${customer.name}) — Status: ${customer.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, customer });
  });

  app.delete('/api/master/customers/:id', (req, res) => {
    const idx = ledgerState.customers.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Customer record not found.' });
      return;
    }
    const [removed] = ledgerState.customers.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'MASTER_DATA',
      'DELETE_CUSTOMER',
      `Removed customer ${removed.code} — ${removed.name}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // MASTER DATA: SUPPLIERS
  // ============================================================
  app.get('/api/master/suppliers/check-phone', (req, res) => {
    const phone = normalizeServerBDPhone(String(req.query.phone || ''));
    const excludeId = String(req.query.excludeId || '');
    const match = phone
      ? ledgerState.suppliers.find(
          (s) => s.id !== excludeId && normalizeServerBDPhone(s.phone) === phone
        )
      : undefined;
    res.json({
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
    });
  });

  app.post('/api/master/suppliers', (req, res) => {
    try {
      const body = req.body as Omit<SupplierRecord, 'id' | 'updatedAt'>;
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      const phoneCheck = validateServerBDPhone(String(body.phone || ''));
      if (!code || !name) {
        res.status(400).json({ error: 'Supplier Code and Legal Name are required.' });
        return;
      }
      if (!phoneCheck.valid) {
        res.status(400).json({
          error:
            phoneCheck.error === 'Phone number is required.'
              ? 'Supplier phone number is required.'
              : phoneCheck.error,
        });
        return;
      }
      const existingByPhone = ledgerState.suppliers.find(
        (s) => normalizeServerBDPhone(s.phone) === phoneCheck.normalized
      );
      if (existingByPhone) {
        res.status(409).json({
          error: `Duplicate Supplier Detected! This phone number is already registered under ${existingByPhone.code} (${existingByPhone.name}).`,
          existingSupplier: {
            id: existingByPhone.id,
            code: existingByPhone.code,
            name: existingByPhone.name,
            phone: existingByPhone.phone,
            status: existingByPhone.status,
          },
        });
        return;
      }
      if (ledgerState.suppliers.some((s) => s.code.toUpperCase() === code)) {
        res.status(409).json({ error: `Supplier Code '${code}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.suppliers.reduce((max, s) => {
          const m = /^SUP-(\d+)$/.exec(s.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const vendCodeMatch = /^VEND-(\d+)$/.exec(code);
      if (vendCodeMatch) {
        const num = parseInt(vendCodeMatch[1], 10);
        ledgerState.config.highestSupplierCodeNum = Math.max(
          ledgerState.config.highestSupplierCodeNum || 2000,
          num
        );
      }

      const supplier: SupplierRecord = {
        id: `SUP-${String(nextNum).padStart(3, '0')}`,
        code,
        name,
        supplierType: String(body.supplierType || '').trim() || 'Local Material',
        country: String(body.country || '').trim() || 'Bangladesh',
        contactPerson: String(body.contactPerson || '').trim(),
        email: String(body.email || '').trim(),
        phone: String(body.phone || '').trim(),
        taxNo: String(body.taxNo || '').trim(),
        binNumber: String(body.binNumber || '').trim(),
        paymentTerms: String(body.paymentTerms || '').trim() || 'Net 30 Days',
        bankName: String(body.bankName || '').trim() || 'Shahjalal Islami Bank PLC',
        advanceBalance: round2(Math.max(0, Number(body.advanceBalance) || 0)),
        payableBalance: round2(Math.max(0, Number(body.payableBalance) || 0)),
        ytdSpend: round2(Math.max(0, Number(body.ytdSpend) || 0)),
        expenseGlCode: String(body.expenseGlCode || '5010').trim(),
        status: String(body.status || '').trim() || 'Active',
        notes: String(body.notes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.suppliers.push(supplier);
      appendAuditLog(
        ledgerState,
        'MASTER_DATA',
        'CREATE_SUPPLIER',
        `Added supplier ${supplier.code} — ${supplier.name} (${supplier.supplierType}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, supplier });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create supplier.' });
    }
  });

  app.patch('/api/master/suppliers/:id', (req, res) => {
    const supplier = ledgerState.suppliers.find((s) => s.id === req.params.id);
    if (!supplier) {
      res.status(404).json({ error: 'Supplier record not found.' });
      return;
    }
    const body = req.body as Partial<Omit<SupplierRecord, 'id' | 'updatedAt'>>;
    if (typeof body.code === 'string' && body.code.trim()) {
      const nextCode = body.code.trim().toUpperCase();
      if (ledgerState.suppliers.some((s) => s.id !== supplier.id && s.code.toUpperCase() === nextCode)) {
        res.status(409).json({ error: `Supplier Code '${nextCode}' already exists.` });
        return;
      }
      supplier.code = nextCode;
    }
    if (typeof body.name === 'string' && body.name.trim()) supplier.name = body.name.trim();
    if (body.supplierType) supplier.supplierType = body.supplierType;
    if (typeof body.country === 'string') supplier.country = body.country.trim();
    if (typeof body.contactPerson === 'string') supplier.contactPerson = body.contactPerson.trim();
    if (typeof body.email === 'string') supplier.email = body.email.trim();
    if (typeof body.phone === 'string') {
      const phoneCheck = validateServerBDPhone(body.phone);
      if (!phoneCheck.valid) {
        res.status(400).json({
          error:
            phoneCheck.error === 'Phone number is required.'
              ? 'Supplier phone number is required.'
              : phoneCheck.error,
        });
        return;
      }
      const dupSup = ledgerState.suppliers.find(
        (s) => s.id !== supplier.id && normalizeServerBDPhone(s.phone) === phoneCheck.normalized
      );
      if (dupSup) {
        res.status(409).json({
          error: `This phone number is already registered to another supplier (${dupSup.code} — ${dupSup.name}).`,
        });
        return;
      }
      supplier.phone = phoneCheck.normalized;
    }
    if (typeof body.taxNo === 'string') supplier.taxNo = body.taxNo.trim();
    if (typeof body.binNumber === 'string') supplier.binNumber = body.binNumber.trim();
    if (typeof body.paymentTerms === 'string') supplier.paymentTerms = body.paymentTerms.trim();
    if (typeof body.bankName === 'string') supplier.bankName = body.bankName.trim();
    if (body.advanceBalance !== undefined) {
      supplier.advanceBalance = round2(Math.max(0, Number(body.advanceBalance) || 0));
    }
    if (body.payableBalance !== undefined) {
      supplier.payableBalance = round2(Math.max(0, Number(body.payableBalance) || 0));
    }
    if (body.ytdSpend !== undefined) supplier.ytdSpend = round2(Math.max(0, Number(body.ytdSpend) || 0));
    if (typeof body.expenseGlCode === 'string') supplier.expenseGlCode = body.expenseGlCode.trim();
    if (typeof body.status === 'string' && body.status.trim()) supplier.status = body.status.trim();
    if (typeof body.notes === 'string') supplier.notes = body.notes.trim();
    supplier.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'MASTER_DATA',
      'UPDATE_SUPPLIER',
      `Updated supplier ${supplier.code} (${supplier.name}) — Status: ${supplier.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, supplier });
  });

  app.delete('/api/master/suppliers/:id', (req, res) => {
    const idx = ledgerState.suppliers.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Supplier record not found.' });
      return;
    }
    const [removed] = ledgerState.suppliers.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'MASTER_DATA',
      'DELETE_SUPPLIER',
      `Removed supplier ${removed.code} — ${removed.name}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SUPPLY CHAIN: LOCAL PROCUREMENT (PURCHASE ORDERS)
  // ============================================================
  app.post('/api/supply-chain/local-pos', (req, res) => {
    try {
      const body = req.body as Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>;
      const poNumber = String(body.poNumber || '').trim().toUpperCase();
      const supplierName = String(body.supplierName || '').trim();
      if (!poNumber || !supplierName) {
        res.status(400).json({ error: 'PO Number and Supplier Name are required.' });
        return;
      }
      if (ledgerState.localPurchaseOrders.some((o) => o.poNumber.toUpperCase() === poNumber)) {
        res.status(409).json({ error: `PO Number '${poNumber}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.localPurchaseOrders.reduce((max, o) => {
          const m = /^LPO-(\d+)$/.exec(o.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const netAmount = round2(Math.max(0, Number(body.netAmount) || 0));
      const vatRate = Math.max(0, Number(body.vatRate) || 0);
      const aitRate = Math.max(0, Number(body.aitRate) || 0);
      const vatAmount = round2((netAmount * vatRate) / 100);
      const aitAmount = round2((netAmount * aitRate) / 100);
      const grossAmount = round2(netAmount + vatAmount);
      const paidAmount =
        body.status === 'Settled' && (body.paidAmount === undefined || Number(body.paidAmount) === 0)
          ? grossAmount
          : round2(Math.min(grossAmount, Math.max(0, Number(body.paidAmount) || 0)));

      const order: LocalPurchaseOrder = {
        id: `LPO-${String(nextNum).padStart(3, '0')}`,
        poNumber,
        poDate: body.poDate || new Date().toISOString().slice(0, 10),
        expectedDate: body.expectedDate || new Date().toISOString().slice(0, 10),
        supplierId: String(body.supplierId || '').trim(),
        supplierName,
        category: body.category || 'Local Material',
        description: String(body.description || '').trim() || 'Local Procurement Order',
        netAmount,
        vatRate,
        vatAmount,
        aitRate,
        aitAmount,
        grossAmount,
        paidAmount,
        paymentBank: String(body.paymentBank || 'Shahjalal Islami Bank PLC').trim(),
        expenseGlCode: String(body.expenseGlCode || '5010').trim(),
        status: body.status || 'Draft',
        grnNumber: String(body.grnNumber || '').trim(),
        notes: String(body.notes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.localPurchaseOrders.unshift(order);
      appendAuditLog(
        ledgerState,
        'SUPPLY_CHAIN',
        'CREATE_LOCAL_PO',
        `Created Local PO ${order.poNumber} for ${order.supplierName} (Gross BDT ${order.grossAmount.toLocaleString()}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, order });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create PO.' });
    }
  });

  app.patch('/api/supply-chain/local-pos/:id', (req, res) => {
    const order = ledgerState.localPurchaseOrders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Local Purchase Order not found.' });
      return;
    }
    const body = req.body as Partial<Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>>;
    if (typeof body.poNumber === 'string' && body.poNumber.trim()) {
      const nextPo = body.poNumber.trim().toUpperCase();
      if (
        ledgerState.localPurchaseOrders.some(
          (o) => o.id !== order.id && o.poNumber.toUpperCase() === nextPo
        )
      ) {
        res.status(409).json({ error: `PO Number '${nextPo}' already exists.` });
        return;
      }
      order.poNumber = nextPo;
    }
    if (typeof body.poDate === 'string' && body.poDate) order.poDate = body.poDate;
    if (typeof body.expectedDate === 'string' && body.expectedDate) order.expectedDate = body.expectedDate;
    if (typeof body.supplierId === 'string') order.supplierId = body.supplierId.trim();
    if (typeof body.supplierName === 'string' && body.supplierName.trim()) {
      order.supplierName = body.supplierName.trim();
    }
    if (body.category) order.category = body.category;
    if (typeof body.description === 'string') order.description = body.description.trim();
    if (body.netAmount !== undefined) order.netAmount = round2(Math.max(0, Number(body.netAmount) || 0));
    if (body.vatRate !== undefined) order.vatRate = Math.max(0, Number(body.vatRate) || 0);
    if (body.aitRate !== undefined) order.aitRate = Math.max(0, Number(body.aitRate) || 0);
    order.vatAmount = round2((order.netAmount * order.vatRate) / 100);
    order.aitAmount = round2((order.netAmount * order.aitRate) / 100);
    order.grossAmount = round2(order.netAmount + order.vatAmount);
    if (body.paidAmount !== undefined) {
      order.paidAmount = round2(Math.min(order.grossAmount, Math.max(0, Number(body.paidAmount) || 0)));
    } else {
      order.paidAmount = round2(Math.min(order.grossAmount, order.paidAmount));
    }
    if (typeof body.paymentBank === 'string') order.paymentBank = body.paymentBank.trim();
    if (typeof body.expenseGlCode === 'string') order.expenseGlCode = body.expenseGlCode.trim();
    if (body.status) {
      order.status = body.status;
      if (body.status === 'Settled' && body.paidAmount === undefined) {
        order.paidAmount = order.grossAmount;
      }
    }
    if (typeof body.grnNumber === 'string') order.grnNumber = body.grnNumber.trim();
    if (typeof body.notes === 'string') order.notes = body.notes.trim();
    order.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SUPPLY_CHAIN',
      'UPDATE_LOCAL_PO',
      `Updated Local PO ${order.poNumber} — Status: ${order.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, order });
  });

  app.delete('/api/supply-chain/local-pos/:id', (req, res) => {
    const idx = ledgerState.localPurchaseOrders.findIndex((o) => o.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Local Purchase Order not found.' });
      return;
    }
    const [removed] = ledgerState.localPurchaseOrders.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SUPPLY_CHAIN',
      'DELETE_LOCAL_PO',
      `Removed Local PO ${removed.poNumber} (${removed.supplierName}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SUPPLY CHAIN: IMPORT & LC MANAGEMENT
  // ============================================================
  app.post('/api/supply-chain/import-lcs', (req, res) => {
    try {
      const body = req.body as Omit<ImportLCFile, 'id' | 'updatedAt'>;
      const lcNumber = String(body.lcNumber || '').trim().toUpperCase();
      const supplierName = String(body.supplierName || '').trim();
      if (!lcNumber || !supplierName) {
        res.status(400).json({ error: 'LC Number and Overseas Supplier are required.' });
        return;
      }
      if (ledgerState.importLCs.some((l) => l.lcNumber.toUpperCase() === lcNumber)) {
        res.status(409).json({ error: `LC Number '${lcNumber}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.importLCs.reduce((max, l) => {
          const m = /^LC-(\d+)$/.exec(l.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const foreignAmount = round2(Math.max(0, Number(body.foreignAmount) || 0));
      const exchangeRate = Math.max(1, Number(body.exchangeRate) || 121);
      const bdtValue = round2(foreignAmount * exchangeRate);
      const marginPct = Math.min(100, Math.max(0, Number(body.marginPct) || 0));
      const marginDepositBdt = round2((bdtValue * marginPct) / 100);
      const customsDutyAndCnfBdt = round2(Math.max(0, Number(body.customsDutyAndCnfBdt) || 0));
      const bankChargesBdt = round2(Math.max(0, Number(body.bankChargesBdt) || 0));
      const totalLandedCostBdt = round2(bdtValue + customsDutyAndCnfBdt + bankChargesBdt);
      const issuingBank = body.issuingBank || 'Shahjalal Islami Bank PLC';
      const defaultLoanGl =
        issuingBank === 'IBBL' ? '2010' : issuingBank === 'Al-Arafah Islami Bank' ? '2030' : '2020';

      const lc: ImportLCFile = {
        id: `LC-${String(nextNum).padStart(3, '0')}`,
        lcNumber,
        openDate: body.openDate || new Date().toISOString().slice(0, 10),
        shipmentDate: body.shipmentDate || new Date().toISOString().slice(0, 10),
        maturityDate: body.maturityDate || new Date().toISOString().slice(0, 10),
        supplierName,
        originCountry: String(body.originCountry || '').trim() || 'Singapore',
        issuingBank,
        loanGlCode: String(body.loanGlCode || defaultLoanGl).trim(),
        lcType: body.lcType || 'UPAS 90D',
        currency: body.currency || 'USD',
        foreignAmount,
        exchangeRate,
        bdtValue,
        marginPct,
        marginDepositBdt,
        customsDutyAndCnfBdt,
        bankChargesBdt,
        totalLandedCostBdt,
        portOfDischarge: body.portOfDischarge || 'Chattogram Sea Port',
        cnfAgent: String(body.cnfAgent || 'Chattogram Port Express C&F Ltd.').trim(),
        billOfEntryNo: String(body.billOfEntryNo || '').trim(),
        goodsDescription: String(body.goodsDescription || '').trim() || 'Imported Industrial Equipment',
        status: body.status || 'Opened',
        notes: String(body.notes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.importLCs.unshift(lc);
      appendAuditLog(
        ledgerState,
        'SUPPLY_CHAIN',
        'CREATE_IMPORT_LC',
        `Opened Import LC ${lc.lcNumber} via ${lc.issuingBank} (${lc.currency} ${lc.foreignAmount.toLocaleString()}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, lc });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create LC.' });
    }
  });

  app.patch('/api/supply-chain/import-lcs/:id', (req, res) => {
    const lc = ledgerState.importLCs.find((l) => l.id === req.params.id);
    if (!lc) {
      res.status(404).json({ error: 'Import LC file not found.' });
      return;
    }
    const body = req.body as Partial<Omit<ImportLCFile, 'id' | 'updatedAt'>>;
    if (typeof body.lcNumber === 'string' && body.lcNumber.trim()) {
      const nextLc = body.lcNumber.trim().toUpperCase();
      if (
        ledgerState.importLCs.some((l) => l.id !== lc.id && l.lcNumber.toUpperCase() === nextLc)
      ) {
        res.status(409).json({ error: `LC Number '${nextLc}' already exists.` });
        return;
      }
      lc.lcNumber = nextLc;
    }
    if (typeof body.openDate === 'string' && body.openDate) lc.openDate = body.openDate;
    if (typeof body.shipmentDate === 'string' && body.shipmentDate) lc.shipmentDate = body.shipmentDate;
    if (typeof body.maturityDate === 'string' && body.maturityDate) lc.maturityDate = body.maturityDate;
    if (typeof body.supplierName === 'string' && body.supplierName.trim()) {
      lc.supplierName = body.supplierName.trim();
    }
    if (typeof body.originCountry === 'string') lc.originCountry = body.originCountry.trim();
    if (body.issuingBank) {
      lc.issuingBank = body.issuingBank;
      if (!body.loanGlCode) {
        lc.loanGlCode =
          body.issuingBank === 'IBBL'
            ? '2010'
            : body.issuingBank === 'Al-Arafah Islami Bank'
              ? '2030'
              : '2020';
      }
    }
    if (typeof body.loanGlCode === 'string' && body.loanGlCode.trim()) {
      lc.loanGlCode = body.loanGlCode.trim();
    }
    if (body.lcType) lc.lcType = body.lcType;
    if (body.currency) lc.currency = body.currency;
    if (body.foreignAmount !== undefined) lc.foreignAmount = round2(Math.max(0, Number(body.foreignAmount) || 0));
    if (body.exchangeRate !== undefined) lc.exchangeRate = Math.max(1, Number(body.exchangeRate) || 121);
    if (body.marginPct !== undefined) lc.marginPct = Math.min(100, Math.max(0, Number(body.marginPct) || 0));
    if (body.customsDutyAndCnfBdt !== undefined) {
      lc.customsDutyAndCnfBdt = round2(Math.max(0, Number(body.customsDutyAndCnfBdt) || 0));
    }
    if (body.bankChargesBdt !== undefined) {
      lc.bankChargesBdt = round2(Math.max(0, Number(body.bankChargesBdt) || 0));
    }
    lc.bdtValue = round2(lc.foreignAmount * lc.exchangeRate);
    lc.marginDepositBdt = round2((lc.bdtValue * lc.marginPct) / 100);
    lc.totalLandedCostBdt = round2(lc.bdtValue + lc.customsDutyAndCnfBdt + lc.bankChargesBdt);

    if (body.portOfDischarge) lc.portOfDischarge = body.portOfDischarge;
    if (typeof body.cnfAgent === 'string') lc.cnfAgent = body.cnfAgent.trim();
    if (typeof body.billOfEntryNo === 'string') lc.billOfEntryNo = body.billOfEntryNo.trim();
    if (typeof body.goodsDescription === 'string') lc.goodsDescription = body.goodsDescription.trim();
    if (body.status) lc.status = body.status;
    if (typeof body.notes === 'string') lc.notes = body.notes.trim();
    lc.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SUPPLY_CHAIN',
      'UPDATE_IMPORT_LC',
      `Updated Import LC ${lc.lcNumber} — Status: ${lc.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, lc });
  });

  app.delete('/api/supply-chain/import-lcs/:id', (req, res) => {
    const idx = ledgerState.importLCs.findIndex((l) => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Import LC file not found.' });
      return;
    }
    const [removed] = ledgerState.importLCs.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SUPPLY_CHAIN',
      'DELETE_IMPORT_LC',
      `Removed Import LC ${removed.lcNumber} (${removed.supplierName}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SUPPLY CHAIN: INVENTORY & SERIAL REGISTER
  // ============================================================
  app.post('/api/supply-chain/serials', (req, res) => {
    try {
      const body = req.body as Omit<InventorySerialUnit, 'id' | 'updatedAt'>;
      const serialNumber = String(body.serialNumber || '').trim().toUpperCase();
      const sku = String(body.sku || '').trim().toUpperCase();
      if (!serialNumber || !sku) {
        res.status(400).json({ error: 'Serial Number and Product SKU are required.' });
        return;
      }
      if (
        ledgerState.inventorySerials.some(
          (u) => u.serialNumber.toUpperCase() === serialNumber
        )
      ) {
        res.status(409).json({ error: `Serial Number '${serialNumber}' is already registered.` });
        return;
      }
      const nextNum =
        ledgerState.inventorySerials.reduce((max, u) => {
          const m = /^SER-(\d+)$/.exec(u.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const matchedProd = ledgerState.products.find((p) => p.sku.toUpperCase() === sku);
      const status = body.status || 'In Stock';
      const serial: InventorySerialUnit = {
        id: `SER-${String(nextNum).padStart(3, '0')}`,
        serialNumber,
        batchOrLcRef: String(body.batchOrLcRef || '').trim(),
        sku,
        productName: String(body.productName || matchedProd?.name || '').trim() || sku,
        category: String(body.category || matchedProd?.category || '').trim() || 'Hardware',
        warehouseLocation:
          status === 'Issued to Project'
            ? 'Client Site Deployed'
            : body.warehouseLocation || 'Dhaka Central Warehouse',
        unitCost: round2(Math.max(0, Number(body.unitCost) || matchedProd?.unitCost || 0)),
        receivedDate: body.receivedDate || new Date().toISOString().slice(0, 10),
        warrantyExpiry: body.warrantyExpiry || '',
        assignedCustomer: String(body.assignedCustomer || '').trim(),
        projectRef: String(body.projectRef || '').trim(),
        glCode: String(body.glCode || (status === 'Issued to Project' ? '5010' : '1110')).trim(),
        status,
        notes: String(body.notes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.inventorySerials.unshift(serial);
      appendAuditLog(
        ledgerState,
        'SUPPLY_CHAIN',
        'REGISTER_SERIAL',
        `Registered serialized unit ${serial.serialNumber} (${serial.sku}) at ${serial.warehouseLocation}.`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, serial });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to register serial.' });
    }
  });

  app.patch('/api/supply-chain/serials/:id', (req, res) => {
    const serial = ledgerState.inventorySerials.find((u) => u.id === req.params.id);
    if (!serial) {
      res.status(404).json({ error: 'Serialized unit not found.' });
      return;
    }
    const body = req.body as Partial<Omit<InventorySerialUnit, 'id' | 'updatedAt'>>;
    if (typeof body.serialNumber === 'string' && body.serialNumber.trim()) {
      const nextSn = body.serialNumber.trim().toUpperCase();
      if (
        ledgerState.inventorySerials.some(
          (u) => u.id !== serial.id && u.serialNumber.toUpperCase() === nextSn
        )
      ) {
        res.status(409).json({ error: `Serial Number '${nextSn}' already exists.` });
        return;
      }
      serial.serialNumber = nextSn;
    }
    if (typeof body.batchOrLcRef === 'string') serial.batchOrLcRef = body.batchOrLcRef.trim();
    if (typeof body.sku === 'string' && body.sku.trim()) serial.sku = body.sku.trim().toUpperCase();
    if (typeof body.productName === 'string' && body.productName.trim()) {
      serial.productName = body.productName.trim();
    }
    if (typeof body.category === 'string') serial.category = body.category.trim();
    if (body.warehouseLocation) serial.warehouseLocation = body.warehouseLocation;
    if (body.unitCost !== undefined) serial.unitCost = round2(Math.max(0, Number(body.unitCost) || 0));
    if (typeof body.receivedDate === 'string' && body.receivedDate) {
      serial.receivedDate = body.receivedDate;
    }
    if (typeof body.warrantyExpiry === 'string') serial.warrantyExpiry = body.warrantyExpiry;
    if (typeof body.assignedCustomer === 'string') serial.assignedCustomer = body.assignedCustomer.trim();
    if (typeof body.projectRef === 'string') serial.projectRef = body.projectRef.trim();
    if (body.status) {
      serial.status = body.status;
      if (!body.glCode) {
        serial.glCode = body.status === 'Issued to Project' ? '5010' : '1110';
      }
      if (body.status === 'Issued to Project' && !body.warehouseLocation) {
        serial.warehouseLocation = 'Client Site Deployed';
      }
    }
    if (typeof body.glCode === 'string' && body.glCode.trim()) serial.glCode = body.glCode.trim();
    if (typeof body.notes === 'string') serial.notes = body.notes.trim();
    serial.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SUPPLY_CHAIN',
      'UPDATE_SERIAL',
      `Updated serialized unit ${serial.serialNumber} — Status: ${serial.status} (${serial.warehouseLocation}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, serial });
  });

  app.delete('/api/supply-chain/serials/:id', (req, res) => {
    const idx = ledgerState.inventorySerials.findIndex((u) => u.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Serialized unit not found.' });
      return;
    }
    const [removed] = ledgerState.inventorySerials.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SUPPLY_CHAIN',
      'DELETE_SERIAL',
      `Removed serialized unit ${removed.serialNumber} (${removed.sku}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SALES & SERVICE: SALES & DISTRIBUTION ORDERS
  // ============================================================
  app.post('/api/sales-service/sales-orders', (req, res) => {
    try {
      const body = req.body as Omit<SalesOrderRecord, 'id' | 'updatedAt'>;
      const orderNo = String(body.orderNo || '').trim().toUpperCase();
      const customerName = String(body.customerName || '').trim();
      if (!orderNo || !customerName) {
        res.status(400).json({ error: 'Order Number and Customer Name are required.' });
        return;
      }
      if (ledgerState.salesOrders.some((o) => o.orderNo.toUpperCase() === orderNo)) {
        res.status(409).json({ error: `Sales Order '${orderNo}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.salesOrders.reduce((max, o) => {
          const m = /^SO-(\d+)$/.exec(o.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const netAmount = round2(Math.max(0, Number(body.netAmount) || 0));
      const vatRate = Math.max(0, Number(body.vatRate) || 0);
      const vatAmount = round2((netAmount * vatRate) / 100);
      const grossAmount = round2(netAmount + vatAmount);
      const collectedAmount = round2(
        Math.min(grossAmount, Math.max(0, Number(body.collectedAmount) || 0))
      );
      const commissionAmount = round2(Math.max(0, Number(body.commissionAmount) || 0));

      const order: SalesOrderRecord = {
        id: `SO-${String(nextNum).padStart(3, '0')}`,
        orderNo,
        orderDate: body.orderDate || new Date().toISOString().slice(0, 10),
        deliveryDate: body.deliveryDate || new Date().toISOString().slice(0, 10),
        customerId: String(body.customerId || '').trim(),
        customerName,
        channel: body.channel || 'Direct Project',
        salesRep: String(body.salesRep || '').trim() || 'Engr. Rafiqul Islam',
        description: String(body.description || '').trim() || 'Enterprise Equipment Supply',
        netAmount,
        vatRate,
        vatAmount,
        grossAmount,
        collectedAmount: body.status === 'Collected' ? grossAmount : collectedAmount,
        commissionAmount,
        revenueGlCode: String(body.revenueGlCode || '4010').trim(),
        challanNo: String(body.challanNo || '').trim(),
        status: body.status || 'Quotation',
        notes: String(body.notes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.salesOrders.unshift(order);
      appendAuditLog(
        ledgerState,
        'SALES_SERVICE',
        'CREATE_SALES_ORDER',
        `Created Sales Order ${order.orderNo} for ${order.customerName} (Gross BDT ${order.grossAmount.toLocaleString()}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, order });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create sales order.' });
    }
  });

  app.patch('/api/sales-service/sales-orders/:id', (req, res) => {
    const order = ledgerState.salesOrders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Sales Order not found.' });
      return;
    }
    const body = req.body as Partial<Omit<SalesOrderRecord, 'id' | 'updatedAt'>>;
    if (typeof body.orderNo === 'string' && body.orderNo.trim()) {
      const nextNo = body.orderNo.trim().toUpperCase();
      if (
        ledgerState.salesOrders.some(
          (o) => o.id !== order.id && o.orderNo.toUpperCase() === nextNo
        )
      ) {
        res.status(409).json({ error: `Sales Order '${nextNo}' already exists.` });
        return;
      }
      order.orderNo = nextNo;
    }
    if (typeof body.orderDate === 'string' && body.orderDate) order.orderDate = body.orderDate;
    if (typeof body.deliveryDate === 'string' && body.deliveryDate) order.deliveryDate = body.deliveryDate;
    if (typeof body.customerId === 'string') order.customerId = body.customerId.trim();
    if (typeof body.customerName === 'string' && body.customerName.trim()) {
      order.customerName = body.customerName.trim();
    }
    if (body.channel) order.channel = body.channel;
    if (typeof body.salesRep === 'string') order.salesRep = body.salesRep.trim();
    if (typeof body.description === 'string') order.description = body.description.trim();
    if (body.netAmount !== undefined) order.netAmount = round2(Math.max(0, Number(body.netAmount) || 0));
    if (body.vatRate !== undefined) order.vatRate = Math.max(0, Number(body.vatRate) || 0);
    order.vatAmount = round2((order.netAmount * order.vatRate) / 100);
    order.grossAmount = round2(order.netAmount + order.vatAmount);
    if (body.collectedAmount !== undefined) {
      order.collectedAmount = round2(
        Math.min(order.grossAmount, Math.max(0, Number(body.collectedAmount) || 0))
      );
    } else {
      order.collectedAmount = round2(Math.min(order.grossAmount, order.collectedAmount));
    }
    if (body.commissionAmount !== undefined) {
      order.commissionAmount = round2(Math.max(0, Number(body.commissionAmount) || 0));
    }
    if (typeof body.revenueGlCode === 'string' && body.revenueGlCode.trim()) {
      order.revenueGlCode = body.revenueGlCode.trim();
    }
    if (typeof body.challanNo === 'string') order.challanNo = body.challanNo.trim();
    if (body.status) {
      order.status = body.status;
      if (body.status === 'Collected' && body.collectedAmount === undefined) {
        order.collectedAmount = order.grossAmount;
      }
    }
    if (typeof body.notes === 'string') order.notes = body.notes.trim();
    order.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'UPDATE_SALES_ORDER',
      `Updated Sales Order ${order.orderNo} — Status: ${order.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, order });
  });

  app.delete('/api/sales-service/sales-orders/:id', (req, res) => {
    const idx = ledgerState.salesOrders.findIndex((o) => o.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Sales Order not found.' });
      return;
    }
    const [removed] = ledgerState.salesOrders.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'DELETE_SALES_ORDER',
      `Removed Sales Order ${removed.orderNo} (${removed.customerName}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SALES & SERVICE: RETAIL COUNTER POS
  // ============================================================
  app.post('/api/sales-service/pos-sales', (req, res) => {
    try {
      const body = req.body as Omit<PosTransaction, 'id' | 'receiptNo' | 'updatedAt'>;
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'Counter cart must contain at least one item.' });
        return;
      }

      const items: PosLineItem[] = rawItems
        .filter((it) => Number(it.qty) > 0)
        .map((it) => {
          const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
          const unitPrice = round2(Math.max(0, Number(it.unitPrice) || 0));
          return {
            sku: String(it.sku || '').trim().toUpperCase(),
            name: String(it.name || '').trim() || 'Counter Item',
            qty,
            unitPrice,
            lineTotal: round2(qty * unitPrice),
          };
        });

      if (items.length === 0) {
        res.status(400).json({ error: 'Counter cart must contain valid line items.' });
        return;
      }

      const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));
      const discountAmount = round2(Math.min(subtotal, Math.max(0, Number(body.discountAmount) || 0)));
      const taxable = round2(Math.max(0, subtotal - discountAmount));
      const vatRate = Math.max(0, Number(body.vatRate) || 0);
      const vatAmount = round2((taxable * vatRate) / 100);
      const grandTotal = round2(taxable + vatAmount);

      const paymentMethod: PosPaymentMethod =
        body.paymentMethod === 'Card / POS' ||
        body.paymentMethod === 'bKash / MFS' ||
        body.paymentMethod === 'Bank Transfer'
          ? body.paymentMethod
          : 'Cash';
      const settlementGlCode =
        paymentMethod === 'Cash' ? '1210' : paymentMethod === 'bKash / MFS' ? '1230' : '1240';

      const nextIdNum =
        ledgerState.posTransactions.reduce((max, t) => {
          const m = /^POS-(\d+)$/.exec(t.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const nextReceiptNum =
        ledgerState.posTransactions.reduce((max, t) => {
          const m = /^POS-25-(\d+)$/.exec(t.receiptNo);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 100) + 1;

      const transaction: PosTransaction = {
        id: `POS-${String(nextIdNum).padStart(3, '0')}`,
        receiptNo: `POS-25-${String(nextReceiptNum).padStart(3, '0')}`,
        saleDate: body.saleDate || new Date().toISOString().slice(0, 10),
        customerName: String(body.customerName || '').trim() || 'Walk-in Counter Customer',
        customerPhone: String(body.customerPhone || '').trim(),
        paymentMethod,
        settlementGlCode,
        items,
        subtotal,
        discountAmount,
        vatRate,
        vatAmount,
        grandTotal,
        cashier: String(body.cashier || '').trim() || 'Counter 01 (Dhaka)',
        status: 'Completed',
        updatedAt: new Date().toISOString(),
      };

      // Deduct matching spare part / product stock quantities cleanly
      for (const line of items) {
        const spare = ledgerState.spareParts.find(
          (p) => p.partCode.toUpperCase() === line.sku.toUpperCase()
        );
        if (spare) {
          spare.stockQty = Math.max(0, spare.stockQty - line.qty);
          spare.updatedAt = transaction.updatedAt;
          continue;
        }
        const prod = ledgerState.products.find(
          (p) => p.sku.toUpperCase() === line.sku.toUpperCase() && p.itemType === 'Inventory'
        );
        if (prod) {
          prod.stockQty = Math.max(0, prod.stockQty - line.qty);
          prod.updatedAt = transaction.updatedAt;
        }
      }

      ledgerState.posTransactions.unshift(transaction);
      appendAuditLog(
        ledgerState,
        'SALES_SERVICE',
        'CREATE_POS_SALE',
        `Issued POS Receipt ${transaction.receiptNo} (${paymentMethod} -> GL ${settlementGlCode}) for BDT ${transaction.grandTotal.toLocaleString()}.`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, transaction });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to complete POS sale.' });
    }
  });

  app.patch('/api/sales-service/pos-sales/:id/void', (req, res) => {
    const transaction = ledgerState.posTransactions.find((t) => t.id === req.params.id);
    if (!transaction) {
      res.status(404).json({ error: 'POS receipt not found.' });
      return;
    }
    if (transaction.status === 'Voided') {
      res.json({ state: ledgerState, transaction });
      return;
    }
    transaction.status = 'Voided';
    transaction.updatedAt = new Date().toISOString();

    // Restore stock quantities previously deducted when the POS sale was completed
    for (const line of transaction.items) {
      const spare = ledgerState.spareParts.find(
        (p) => p.partCode.toUpperCase() === line.sku.toUpperCase()
      );
      if (spare) {
        spare.stockQty = spare.stockQty + line.qty;
        spare.updatedAt = transaction.updatedAt;
        continue;
      }
      const prod = ledgerState.products.find(
        (p) => p.sku.toUpperCase() === line.sku.toUpperCase() && p.itemType === 'Inventory'
      );
      if (prod) {
        prod.stockQty = prod.stockQty + line.qty;
        prod.updatedAt = transaction.updatedAt;
      }
    }

    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'VOID_POS_SALE',
      `Voided Retail POS Receipt ${transaction.receiptNo} (BDT ${transaction.grandTotal.toLocaleString()}) and restored inventory stock.`,
      'ALERT'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, transaction });
  });

  app.delete('/api/sales-service/pos-sales/:id', (req, res) => {
    const idx = ledgerState.posTransactions.findIndex((t) => t.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'POS receipt not found.' });
      return;
    }
    const [removed] = ledgerState.posTransactions.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'DELETE_POS_SALE',
      `Deleted POS Receipt ${removed.receiptNo}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SALES & SERVICE: WARRANTY MANAGEMENT
  // ============================================================
  app.post('/api/sales-service/warranties', (req, res) => {
    try {
      const body = req.body as Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>;
      const claimNo = String(body.claimNo || '').trim().toUpperCase();
      const serialNumber = String(body.serialNumber || '').trim().toUpperCase();
      const customerName = String(body.customerName || '').trim();
      if (!claimNo || !serialNumber || !customerName) {
        res.status(400).json({ error: 'Claim Number, Serial Number, and Customer Name are required.' });
        return;
      }
      if (ledgerState.warrantyClaims.some((c) => c.claimNo.toUpperCase() === claimNo)) {
        res.status(409).json({ error: `Warranty Claim '${claimNo}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.warrantyClaims.reduce((max, c) => {
          const m = /^WRN-(\d+)$/.exec(c.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const claim: WarrantyClaimRecord = {
        id: `WRN-${String(nextNum).padStart(3, '0')}`,
        claimNo,
        claimDate: body.claimDate || new Date().toISOString().slice(0, 10),
        serialNumber,
        sku: String(body.sku || '').trim().toUpperCase(),
        productName: String(body.productName || '').trim() || 'Serialized Equipment',
        customerName,
        warrantyExpiry: body.warrantyExpiry || '',
        coverageType: body.coverageType || 'ATCL Standard 24M',
        issueSummary: String(body.issueSummary || '').trim() || 'Hardware fault reported',
        claimCostBdt: round2(Math.max(0, Number(body.claimCostBdt) || 0)),
        oemRecoveryBdt: round2(Math.max(0, Number(body.oemRecoveryBdt) || 0)),
        expenseGlCode: String(body.expenseGlCode || '5310').trim(),
        status: body.status || 'Logged',
        resolutionNotes: String(body.resolutionNotes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.warrantyClaims.unshift(claim);
      appendAuditLog(
        ledgerState,
        'SALES_SERVICE',
        'CREATE_WARRANTY_CLAIM',
        `Logged Warranty Claim ${claim.claimNo} for S/N ${claim.serialNumber} (${claim.customerName}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, claim });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to log warranty claim.' });
    }
  });

  app.patch('/api/sales-service/warranties/:id', (req, res) => {
    const claim = ledgerState.warrantyClaims.find((c) => c.id === req.params.id);
    if (!claim) {
      res.status(404).json({ error: 'Warranty Claim not found.' });
      return;
    }
    const body = req.body as Partial<Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>>;
    if (typeof body.claimNo === 'string' && body.claimNo.trim()) {
      const nextNo = body.claimNo.trim().toUpperCase();
      if (
        ledgerState.warrantyClaims.some(
          (c) => c.id !== claim.id && c.claimNo.toUpperCase() === nextNo
        )
      ) {
        res.status(409).json({ error: `Warranty Claim '${nextNo}' already exists.` });
        return;
      }
      claim.claimNo = nextNo;
    }
    if (typeof body.claimDate === 'string' && body.claimDate) claim.claimDate = body.claimDate;
    if (typeof body.serialNumber === 'string' && body.serialNumber.trim()) {
      claim.serialNumber = body.serialNumber.trim().toUpperCase();
    }
    if (typeof body.sku === 'string') claim.sku = body.sku.trim().toUpperCase();
    if (typeof body.productName === 'string' && body.productName.trim()) {
      claim.productName = body.productName.trim();
    }
    if (typeof body.customerName === 'string' && body.customerName.trim()) {
      claim.customerName = body.customerName.trim();
    }
    if (typeof body.warrantyExpiry === 'string') claim.warrantyExpiry = body.warrantyExpiry;
    if (body.coverageType) claim.coverageType = body.coverageType;
    if (typeof body.issueSummary === 'string') claim.issueSummary = body.issueSummary.trim();
    if (body.claimCostBdt !== undefined) {
      claim.claimCostBdt = round2(Math.max(0, Number(body.claimCostBdt) || 0));
    }
    if (body.oemRecoveryBdt !== undefined) {
      claim.oemRecoveryBdt = round2(Math.max(0, Number(body.oemRecoveryBdt) || 0));
    }
    if (typeof body.expenseGlCode === 'string' && body.expenseGlCode.trim()) {
      claim.expenseGlCode = body.expenseGlCode.trim();
    }
    if (body.status) claim.status = body.status;
    if (typeof body.resolutionNotes === 'string') claim.resolutionNotes = body.resolutionNotes.trim();
    claim.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'UPDATE_WARRANTY_CLAIM',
      `Updated Warranty Claim ${claim.claimNo} — Status: ${claim.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, claim });
  });

  app.delete('/api/sales-service/warranties/:id', (req, res) => {
    const idx = ledgerState.warrantyClaims.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Warranty Claim not found.' });
      return;
    }
    const [removed] = ledgerState.warrantyClaims.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'DELETE_WARRANTY_CLAIM',
      `Removed Warranty Claim ${removed.claimNo} (${removed.serialNumber}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SALES & SERVICE: SERVICE & REPAIR WORKSHOP
  // ============================================================
  app.post('/api/sales-service/service-jobs', (req, res) => {
    try {
      const body = req.body as Omit<ServiceJobCard, 'id' | 'updatedAt'>;
      const jobNo = String(body.jobNo || '').trim().toUpperCase();
      const customerName = String(body.customerName || '').trim();
      const equipmentName = String(body.equipmentName || '').trim();
      if (!jobNo || !customerName || !equipmentName) {
        res.status(400).json({ error: 'Job Card #, Customer Name, and Equipment Name are required.' });
        return;
      }
      if (ledgerState.serviceJobs.some((j) => j.jobNo.toUpperCase() === jobNo)) {
        res.status(409).json({ error: `Service Job '${jobNo}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.serviceJobs.reduce((max, j) => {
          const m = /^JOB-(\d+)$/.exec(j.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const partsCostBdt = round2(Math.max(0, Number(body.partsCostBdt) || 0));
      const laborCostBdt = round2(Math.max(0, Number(body.laborCostBdt) || 0));
      const totalCostBdt = round2(partsCostBdt + laborCostBdt);
      const billableAmountBdt = round2(Math.max(0, Number(body.billableAmountBdt) || 0));

      const job: ServiceJobCard = {
        id: `JOB-${String(nextNum).padStart(3, '0')}`,
        jobNo,
        intakeDate: body.intakeDate || new Date().toISOString().slice(0, 10),
        promisedDate: body.promisedDate || new Date().toISOString().slice(0, 10),
        customerName,
        equipmentName,
        serialNumber: String(body.serialNumber || '').trim().toUpperCase(),
        serviceType: body.serviceType || 'Bench Repair',
        technician: String(body.technician || '').trim() || 'Engr. Ashfaqur Rahman',
        priority: body.priority || 'Normal',
        partsCostBdt,
        laborCostBdt,
        totalCostBdt,
        billableAmountBdt,
        expenseGlCode: String(body.expenseGlCode || '5320').trim(),
        status: body.status || 'Intake',
        notes: String(body.notes || '').trim(),
        updatedAt: new Date().toISOString(),
      };
      ledgerState.serviceJobs.unshift(job);
      appendAuditLog(
        ledgerState,
        'SALES_SERVICE',
        'CREATE_SERVICE_JOB',
        `Opened Workshop Job Card ${job.jobNo} for ${job.customerName} (${job.equipmentName}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, job });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create service job.' });
    }
  });

  app.patch('/api/sales-service/service-jobs/:id', (req, res) => {
    const job = ledgerState.serviceJobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Service Job Card not found.' });
      return;
    }
    const body = req.body as Partial<Omit<ServiceJobCard, 'id' | 'updatedAt'>>;
    if (typeof body.jobNo === 'string' && body.jobNo.trim()) {
      const nextNo = body.jobNo.trim().toUpperCase();
      if (
        ledgerState.serviceJobs.some(
          (j) => j.id !== job.id && j.jobNo.toUpperCase() === nextNo
        )
      ) {
        res.status(409).json({ error: `Service Job '${nextNo}' already exists.` });
        return;
      }
      job.jobNo = nextNo;
    }
    if (typeof body.intakeDate === 'string' && body.intakeDate) job.intakeDate = body.intakeDate;
    if (typeof body.promisedDate === 'string' && body.promisedDate) job.promisedDate = body.promisedDate;
    if (typeof body.customerName === 'string' && body.customerName.trim()) {
      job.customerName = body.customerName.trim();
    }
    if (typeof body.equipmentName === 'string' && body.equipmentName.trim()) {
      job.equipmentName = body.equipmentName.trim();
    }
    if (typeof body.serialNumber === 'string') job.serialNumber = body.serialNumber.trim().toUpperCase();
    if (body.serviceType) job.serviceType = body.serviceType;
    if (typeof body.technician === 'string') job.technician = body.technician.trim();
    if (body.priority) job.priority = body.priority;
    if (body.partsCostBdt !== undefined) {
      job.partsCostBdt = round2(Math.max(0, Number(body.partsCostBdt) || 0));
    }
    if (body.laborCostBdt !== undefined) {
      job.laborCostBdt = round2(Math.max(0, Number(body.laborCostBdt) || 0));
    }
    job.totalCostBdt = round2(job.partsCostBdt + job.laborCostBdt);
    if (body.billableAmountBdt !== undefined) {
      job.billableAmountBdt = round2(Math.max(0, Number(body.billableAmountBdt) || 0));
    }
    if (typeof body.expenseGlCode === 'string' && body.expenseGlCode.trim()) {
      job.expenseGlCode = body.expenseGlCode.trim();
    }
    if (body.status) job.status = body.status;
    if (typeof body.notes === 'string') job.notes = body.notes.trim();
    job.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'UPDATE_SERVICE_JOB',
      `Updated Workshop Job Card ${job.jobNo} — Status: ${job.status}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, job });
  });

  app.delete('/api/sales-service/service-jobs/:id', (req, res) => {
    const idx = ledgerState.serviceJobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Service Job Card not found.' });
      return;
    }
    const [removed] = ledgerState.serviceJobs.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'DELETE_SERVICE_JOB',
      `Removed Workshop Job Card ${removed.jobNo} (${removed.customerName}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // SALES & SERVICE: SPARE PARTS INVENTORY
  // ============================================================
  app.post('/api/sales-service/spare-parts', (req, res) => {
    try {
      const body = req.body as Omit<SparePartItem, 'id' | 'updatedAt'>;
      const partCode = String(body.partCode || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      if (!partCode || !name) {
        res.status(400).json({ error: 'Part Code and Spare Part Name are required.' });
        return;
      }
      if (ledgerState.spareParts.some((p) => p.partCode.toUpperCase() === partCode)) {
        res.status(409).json({ error: `Spare Part Code '${partCode}' already exists.` });
        return;
      }
      const nextNum =
        ledgerState.spareParts.reduce((max, p) => {
          const m = /^SP-(\d+)$/.exec(p.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const part: SparePartItem = {
        id: `SP-${String(nextNum).padStart(3, '0')}`,
        partCode,
        name,
        category: body.category || 'Switchgear & Relays',
        compatibleSystem: String(body.compatibleSystem || '').trim() || 'General Equipment',
        binLocation: String(body.binLocation || '').trim() || 'Bin A-01',
        unit: String(body.unit || '').trim() || 'Unit',
        stockQty: Math.max(0, Math.floor(Number(body.stockQty) || 0)),
        minStockLevel: Math.max(0, Math.floor(Number(body.minStockLevel) || 0)),
        unitCost: round2(Math.max(0, Number(body.unitCost) || 0)),
        sellingPrice: round2(Math.max(0, Number(body.sellingPrice) || 0)),
        glCode: String(body.glCode || '1110').trim(),
        status: body.status === 'Inactive' ? 'Inactive' : 'Active',
        updatedAt: new Date().toISOString(),
      };
      ledgerState.spareParts.unshift(part);
      appendAuditLog(
        ledgerState,
        'SALES_SERVICE',
        'CREATE_SPARE_PART',
        `Added Spare Part ${part.partCode} — ${part.name} (${part.binLocation}, Qty ${part.stockQty}).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, part });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create spare part.' });
    }
  });

  app.patch('/api/sales-service/spare-parts/:id', (req, res) => {
    const part = ledgerState.spareParts.find((p) => p.id === req.params.id);
    if (!part) {
      res.status(404).json({ error: 'Spare Part not found.' });
      return;
    }
    const body = req.body as Partial<Omit<SparePartItem, 'id' | 'updatedAt'>>;
    if (typeof body.partCode === 'string' && body.partCode.trim()) {
      const nextCode = body.partCode.trim().toUpperCase();
      if (
        ledgerState.spareParts.some(
          (p) => p.id !== part.id && p.partCode.toUpperCase() === nextCode
        )
      ) {
        res.status(409).json({ error: `Spare Part Code '${nextCode}' already exists.` });
        return;
      }
      part.partCode = nextCode;
    }
    if (typeof body.name === 'string' && body.name.trim()) part.name = body.name.trim();
    if (body.category) part.category = body.category;
    if (typeof body.compatibleSystem === 'string') part.compatibleSystem = body.compatibleSystem.trim();
    if (typeof body.binLocation === 'string') part.binLocation = body.binLocation.trim();
    if (typeof body.unit === 'string') part.unit = body.unit.trim() || 'Unit';
    if (body.stockQty !== undefined) part.stockQty = Math.max(0, Math.floor(Number(body.stockQty) || 0));
    if (body.minStockLevel !== undefined) {
      part.minStockLevel = Math.max(0, Math.floor(Number(body.minStockLevel) || 0));
    }
    if (body.unitCost !== undefined) part.unitCost = round2(Math.max(0, Number(body.unitCost) || 0));
    if (body.sellingPrice !== undefined) {
      part.sellingPrice = round2(Math.max(0, Number(body.sellingPrice) || 0));
    }
    if (typeof body.glCode === 'string' && body.glCode.trim()) part.glCode = body.glCode.trim();
    if (body.status === 'Active' || body.status === 'Inactive') part.status = body.status;
    part.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'UPDATE_SPARE_PART',
      `Updated Spare Part ${part.partCode} — Bin ${part.binLocation}, Qty ${part.stockQty} (${part.status}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, part });
  });

  app.delete('/api/sales-service/spare-parts/:id', (req, res) => {
    const idx = ledgerState.spareParts.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Spare Part not found.' });
      return;
    }
    const [removed] = ledgerState.spareParts.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'SALES_SERVICE',
      'DELETE_SPARE_PART',
      `Removed Spare Part ${removed.partCode} — ${removed.name}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // VOUCHER MANAGEMENT (PAYMENT / RECEIPT / JOURNAL / EXPENSE)
  // ============================================================
  const postVoucherRecordToGL = (voucher: VoucherRecord): void => {
    if (voucher.postedToGl) return;
    if (!Array.isArray(voucher.doubleEntryLines) || voucher.doubleEntryLines.length < 2) {
      throw new Error('Voucher must contain at least 2 balanced double-entry lines to post to GL.');
    }
    const drSum = round2(voucher.doubleEntryLines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const crSum = round2(voucher.doubleEntryLines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    if (drSum <= 0 || Math.abs(drSum - crSum) > 0.01) {
      throw new Error(`Double-entry lines are unbalanced (Dr ${drSum} vs Cr ${crSum}).`);
    }

    const accMap = new Map(ledgerState.accounts.map((a) => [a.code, a]));
    for (const line of voucher.doubleEntryLines) {
      const acc = accMap.get(line.glCode);
      if (!acc) {
        throw new Error(`GL Account '${line.glCode}' does not exist in Chart of Accounts.`);
      }
      if (acc.status !== 'Active') {
        throw new Error(`GL Account '${line.glCode}' (${acc.name}) is INACTIVE.`);
      }
    }

    let targetVoucherNo = voucher.voucherRef;
    let suffix = 1;
    while (
      ledgerState.journalLines.some((l) => l.voucherNo === targetVoucherNo) ||
      ledgerState.postedTransactions.some((t) => t.voucherNo === targetVoucherNo)
    ) {
      targetVoucherNo = `${voucher.voucherRef}-${suffix++}`;
    }

    const baseSeq = ledgerState.journalLines.length + 1;
    const counterparty =
      voucher.supplierName ||
      voucher.customerName ||
      voucher.employeeName ||
      voucher.department ||
      'ATCL General Ledger';
    const refText =
      voucher.bankReferenceNo ||
      voucher.linkedSourceDocs.map((d) => d.docRef).join(', ') ||
      voucher.voucherRef;

    voucher.doubleEntryLines.forEach((line, idx) => {
      const acc = accMap.get(line.glCode)!;
      ledgerState.journalLines.push({
        journalId: `JRN-${String(baseSeq + idx).padStart(4, '0')}`,
        date: voucher.postingDate || voucher.voucherDate,
        voucherNo: targetVoucherNo,
        description: line.memo
          ? `${voucher.narration} (${line.memo})`
          : voucher.narration || `${voucher.voucherType} Voucher ${voucher.voucherRef}`,
        glCode: line.glCode,
        glName: acc.name,
        debit: round2(Number(line.debit) || 0),
        credit: round2(Number(line.credit) || 0),
        reference: refText,
        counterparty,
        enteredBy: ledgerState.config.operatorEmail,
        approvalStatus: 'PENDING_APPROVAL',
        postingStatus: 'UNPOSTED',
        validationRemarks: 'Auto-approved via Voucher Management',
      });
    });

    validateJournalVouchers(ledgerState);
    approveValidatedVouchers(ledgerState);
    postApprovedVouchers(ledgerState);

    const postedLines = ledgerState.postedTransactions.filter((t) => t.voucherNo === targetVoucherNo);
    if (postedLines.length !== voucher.doubleEntryLines.length) {
      // Roll back unposted lines if posting failed validation
      ledgerState.journalLines = ledgerState.journalLines.filter((l) => l.voucherNo !== targetVoucherNo);
      throw new Error(`Voucher ${voucher.voucherRef} failed General Ledger posting validation.`);
    }

    voucher.postedToGl = true;
    voucher.postedVoucherNo = targetVoucherNo;
    voucher.status = 'Posted to GL';
    voucher.updatedAt = new Date().toISOString();
  };

  app.post('/api/vouchers', (req, res) => {
    try {
      const body = req.body as Omit<
        VoucherRecord,
        'id' | 'updatedAt' | 'createdBy' | 'postedToGl'
      > & { postImmediately?: boolean };

      const validTypes: VoucherKind[] = ['Payment', 'Receipt', 'Journal', 'Expense'];
      const voucherType: VoucherKind = validTypes.includes(body.voucherType)
        ? body.voucherType
        : 'Journal';
      const voucherRef = String(body.voucherRef || '').trim().toUpperCase();
      if (!voucherRef) {
        res.status(400).json({ error: 'Voucher Reference is required.' });
        return;
      }
      if (ledgerState.vouchers.some((v) => v.voucherRef.toUpperCase() === voucherRef)) {
        res.status(409).json({ error: `Voucher Reference '${voucherRef}' already exists.` });
        return;
      }

      const accMap = new Map(ledgerState.accounts.map((a) => [a.code, a]));
      const cleanLines: VoucherDoubleEntryLine[] = (
        Array.isArray(body.doubleEntryLines) ? body.doubleEntryLines : []
      )
        .filter((l) => l.glCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => {
          const code = String(l.glCode).trim();
          const acc = accMap.get(code);
          return {
            glCode: code,
            glName: acc ? acc.name : String(l.glName || code),
            debit: round2(Math.max(0, Number(l.debit) || 0)),
            credit: round2(Math.max(0, Number(l.credit) || 0)),
            memo: l.memo ? String(l.memo).trim() : undefined,
          };
        });

      const drSum = round2(cleanLines.reduce((s, l) => s + l.debit, 0));
      const crSum = round2(cleanLines.reduce((s, l) => s + l.credit, 0));
      if (cleanLines.length < 2 || drSum <= 0 || Math.abs(drSum - crSum) > 0.01) {
        res.status(400).json({
          error: `Voucher accounting entries must be balanced and greater than zero (Dr ${drSum} vs Cr ${crSum}).`,
        });
        return;
      }
      const invalidGlLine = cleanLines.find((l) => {
        const acc = accMap.get(l.glCode);
        return !acc || acc.status !== 'Active';
      });
      if (invalidGlLine) {
        res.status(400).json({
          error: `GL Account '${invalidGlLine.glCode}' is missing or inactive in Chart of Accounts.`,
        });
        return;
      }

      const prefixMap: Record<VoucherKind, string> = {
        Payment: 'PV',
        Receipt: 'RV',
        Journal: 'JV',
        Expense: 'EV',
      };
      const pref = prefixMap[voucherType];
      const nextNum =
        ledgerState.vouchers.reduce((max, v) => {
          const m = new RegExp(`^VCH-${pref}-(\\d+)$`).exec(v.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const now = new Date().toISOString();
      const targetPostingDate = body.postingDate || body.voucherDate || now.slice(0, 10);
      const lockError = validatePostingDatePolicy(targetPostingDate, ledgerState.config);
      if (lockError) {
        res.status(400).json({ error: lockError });
        return;
      }

      const voucher: VoucherRecord = {
        id: `VCH-${pref}-${String(nextNum).padStart(3, '0')}`,
        voucherType,
        voucherRef,
        voucherDate: body.voucherDate || now.slice(0, 10),
        postingDate: targetPostingDate,
        status: 'Auto-Approved',
        totalAmount: drSum,
        narration:
          String(body.narration || '').trim() ||
          `${voucherType} Voucher ${voucherRef}`,
        supplierId: body.supplierId ? String(body.supplierId).trim() : undefined,
        supplierName: body.supplierName ? String(body.supplierName).trim() : undefined,
        baseAmount:
          body.baseAmount !== undefined ? round2(Math.max(0, Number(body.baseAmount) || 0)) : undefined,
        tdsRate: body.tdsRate !== undefined ? Number(body.tdsRate) || 0 : undefined,
        tdsAmount:
          body.tdsAmount !== undefined ? round2(Math.max(0, Number(body.tdsAmount) || 0)) : undefined,
        vdsRate: body.vdsRate !== undefined ? Number(body.vdsRate) || 0 : undefined,
        vdsAmount:
          body.vdsAmount !== undefined ? round2(Math.max(0, Number(body.vdsAmount) || 0)) : undefined,
        netPayableAmount:
          body.netPayableAmount !== undefined
            ? round2(Math.max(0, Number(body.netPayableAmount) || 0))
            : undefined,
        paymentMode: body.paymentMode ? String(body.paymentMode).trim() : undefined,
        paidFromGlCode: body.paidFromGlCode ? String(body.paidFromGlCode).trim() : undefined,
        bankReferenceNo: body.bankReferenceNo ? String(body.bankReferenceNo).trim() : undefined,
        customerId: body.customerId ? String(body.customerId).trim() : undefined,
        customerName: body.customerName ? String(body.customerName).trim() : undefined,
        collectionAmount:
          body.collectionAmount !== undefined
            ? round2(Math.max(0, Number(body.collectionAmount) || 0))
            : undefined,
        receiptMode: body.receiptMode ? String(body.receiptMode).trim() : undefined,
        depositToGlCode: body.depositToGlCode ? String(body.depositToGlCode).trim() : undefined,
        postingType: body.postingType ? String(body.postingType).trim() : undefined,
        autoReverseDate: body.autoReverseDate ? String(body.autoReverseDate).trim() : undefined,
        allocationMode: body.allocationMode,
        employeeName: body.employeeName ? String(body.employeeName).trim() : undefined,
        expenseSplits: Array.isArray(body.expenseSplits) ? body.expenseSplits : undefined,
        department: body.department ? String(body.department).trim() : undefined,
        costCenter: body.costCenter ? String(body.costCenter).trim() : undefined,
        linkedProject: body.linkedProject ? String(body.linkedProject).trim() : undefined,
        linkedSourceDocs: Array.isArray(body.linkedSourceDocs) ? body.linkedSourceDocs : [],
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        doubleEntryLines: cleanLines,
        postedToGl: false,
        createdBy: ledgerState.config.operatorEmail,
        updatedAt: now,
      };

      ledgerState.vouchers.unshift(voucher);

      if (body.postImmediately) {
        postVoucherRecordToGL(voucher);
      }

      appendAuditLog(
        ledgerState,
        'VOUCHER_MGMT',
        `CREATE_${pref}_VOUCHER`,
        `Created ${voucher.voucherType} Voucher ${voucher.voucherRef} (BDT ${voucher.totalAmount.toLocaleString()}) — Status: ${voucher.status}.`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, voucher });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create voucher.' });
    }
  });

  app.post('/api/vouchers/:id/post-gl', (req, res) => {
    try {
      const voucher = ledgerState.vouchers.find((v) => v.id === req.params.id);
      if (!voucher) {
        res.status(404).json({ error: 'Voucher record not found.' });
        return;
      }
      if (voucher.status === 'Voided') {
        res.status(400).json({ error: 'Voided vouchers cannot be posted to General Ledger.' });
        return;
      }
      if (voucher.postedToGl) {
        res.json({ state: ledgerState, voucher });
        return;
      }
      const lockError = validatePostingDatePolicy(voucher.postingDate, ledgerState.config);
      if (lockError) {
        res.status(400).json({ error: lockError });
        return;
      }
      postVoucherRecordToGL(voucher);
      appendAuditLog(
        ledgerState,
        'VOUCHER_MGMT',
        'POST_VOUCHER_GL',
        `Posted ${voucher.voucherType} Voucher ${voucher.voucherRef} to General Ledger & Register Books (${voucher.doubleEntryLines.length} lines).`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.json({ state: ledgerState, voucher });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to post voucher to GL.' });
    }
  });

  app.patch('/api/vouchers/:id/void', (req, res) => {
    const voucher = ledgerState.vouchers.find((v) => v.id === req.params.id);
    if (!voucher) {
      res.status(404).json({ error: 'Voucher record not found.' });
      return;
    }
    if (voucher.postedToGl) {
      res.status(400).json({
        error: 'Posted vouchers cannot be voided here. Use Reversal in Master Journal instead.',
      });
      return;
    }
    voucher.status = 'Voided';
    voucher.updatedAt = new Date().toISOString();
    appendAuditLog(
      ledgerState,
      'VOUCHER_MGMT',
      'VOID_VOUCHER',
      `Voided ${voucher.voucherType} Voucher ${voucher.voucherRef}.`,
      'ALERT'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, voucher });
  });

  app.delete('/api/vouchers/:id', (req, res) => {
    const idx = ledgerState.vouchers.findIndex((v) => v.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Voucher record not found.' });
      return;
    }
    const target = ledgerState.vouchers[idx];
    if (target.postedToGl) {
      res.status(400).json({
        error: 'Posted vouchers are immutable audit records and cannot be deleted.',
      });
      return;
    }
    ledgerState.vouchers.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'VOUCHER_MGMT',
      'DELETE_VOUCHER',
      `Deleted ${target.voucherType} Voucher ${target.voucherRef}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  // ============================================================
  // TEMPLATE STUDIO & IMPORTER (/api/templates)
  // ============================================================
  app.post('/api/templates', (req, res) => {
    try {
      const body = req.body as Partial<Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>>;
      const name = String(body.name || '').trim();
      if (!name) {
        res.status(400).json({ error: 'Template name is required.' });
        return;
      }

      const mode = body.mode === 'html' ? 'html' : 'structured';
      const htmlContent = String(body.htmlContent || '');
      if (mode === 'html' && !htmlContent.trim()) {
        res.status(400).json({ error: 'HTML template markup cannot be empty.' });
        return;
      }

      const nextIdNum =
        ledgerState.templates.reduce((max, t) => {
          const m = /^TPL-(\d+)$/.exec(t.id);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0) + 1;

      const rawCode = String(body.code || '').trim().toUpperCase();
      const code = rawCode || `TPL-CST-${String(nextIdNum).padStart(2, '0')}`;

      const category =
        body.category === 'Voucher' ||
        body.category === 'Financial Report' ||
        body.category === 'Commercial & LC' ||
        body.category === 'Custom Page'
          ? body.category
          : 'Custom Page';

      const dataSource =
        body.dataSource === 'voucher' ||
        body.dataSource === 'salesOrder' ||
        body.dataSource === 'importLC' ||
        body.dataSource === 'custom'
          ? body.dataSource
          : 'financialSummary';

      const isDefault = Boolean(body.isDefault);
      if (isDefault) {
        for (const existing of ledgerState.templates) {
          if (existing.category === category) existing.isDefault = false;
        }
      }

      const sections = body.sections ?? {
        headerTitle: name,
        headerSubtitle: '{{org.name}} · Fiscal Period {{org.fiscalPeriod}}',
        referenceLabel: 'Document Ref',
        showMetadataStrip: true,
        showKpiStrip: true,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Primary Amount', token: '{{record.amount}}' },
          { label: 'Counterparty', token: '{{record.party}}' },
          { label: 'Status', token: '{{record.status}}' },
        ],
        signatories: ['Prepared By', 'Checked By', 'Approved By'],
        footerNote: 'Generated by ATCL General Ledger Template Studio.',
      };

      const template: DocumentTemplateRecord = {
        id: `TPL-${String(nextIdNum).padStart(3, '0')}`,
        code,
        name,
        description: String(body.description || '').trim() || 'Custom template configured in ATCL Template Studio.',
        category,
        mode,
        dataSource,
        paperSize: body.paperSize === 'A4' ? 'A4' : 'Responsive',
        accentColor: /^#[0-9a-fA-F]{6}$/.test(String(body.accentColor || '')) ? String(body.accentColor) : '#1F4E79',
        status: body.status === 'Draft' ? 'Draft' : 'Published',
        isDefault,
        sourceOrigin: String(body.sourceOrigin || '').trim() || (mode === 'html' ? 'Imported HTML Markup' : 'Template Builder'),
        sections,
        htmlContent,
        cssContent: String(body.cssContent || ''),
        updatedAt: new Date().toISOString(),
      };

      ledgerState.templates.unshift(template);
      appendAuditLog(
        ledgerState,
        'TEMPLATE_STUDIO',
        'CREATE_TEMPLATE',
        `Created ${template.mode.toUpperCase()} template ${template.code} — ${template.name}.`,
        'SUCCESS'
      );
      saveState(ledgerState);
      res.status(201).json({ state: ledgerState, template });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create template.' });
    }
  });

  app.patch('/api/templates/:id', (req, res) => {
    const template = ledgerState.templates.find((t) => t.id === req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    const body = req.body as Partial<Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>>;
    if (typeof body.name === 'string' && body.name.trim()) template.name = body.name.trim();
    if (typeof body.code === 'string' && body.code.trim()) template.code = body.code.trim().toUpperCase();
    if (typeof body.description === 'string') template.description = body.description.trim();
    if (
      body.category === 'Voucher' ||
      body.category === 'Financial Report' ||
      body.category === 'Commercial & LC' ||
      body.category === 'Custom Page'
    ) {
      template.category = body.category;
    }
    if (body.mode === 'structured' || body.mode === 'html') template.mode = body.mode;
    if (
      body.dataSource === 'financialSummary' ||
      body.dataSource === 'voucher' ||
      body.dataSource === 'salesOrder' ||
      body.dataSource === 'importLC' ||
      body.dataSource === 'custom'
    ) {
      template.dataSource = body.dataSource;
    }
    if (body.paperSize === 'A4' || body.paperSize === 'Responsive') template.paperSize = body.paperSize;
    if (typeof body.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accentColor)) {
      template.accentColor = body.accentColor;
    }
    if (body.status === 'Published' || body.status === 'Draft') template.status = body.status;
    if (typeof body.isDefault === 'boolean') {
      if (body.isDefault) {
        for (const existing of ledgerState.templates) {
          if (existing.category === template.category && existing.id !== template.id) {
            existing.isDefault = false;
          }
        }
      }
      template.isDefault = body.isDefault;
    }
    if (typeof body.sourceOrigin === 'string') template.sourceOrigin = body.sourceOrigin.trim();
    if (body.sections) template.sections = body.sections;
    if (typeof body.htmlContent === 'string') template.htmlContent = body.htmlContent;
    if (typeof body.cssContent === 'string') template.cssContent = body.cssContent;
    template.updatedAt = new Date().toISOString();

    appendAuditLog(
      ledgerState,
      'TEMPLATE_STUDIO',
      'UPDATE_TEMPLATE',
      `Updated template ${template.code} — ${template.name} (${template.status}).`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState, template });
  });

  app.post('/api/templates/:id/duplicate', (req, res) => {
    const source = ledgerState.templates.find((t) => t.id === req.params.id);
    if (!source) {
      res.status(404).json({ error: 'Source template not found.' });
      return;
    }
    const nextIdNum =
      ledgerState.templates.reduce((max, t) => {
        const m = /^TPL-(\d+)$/.exec(t.id);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0) + 1;

    const clone: DocumentTemplateRecord = {
      ...structuredClone(source),
      id: `TPL-${String(nextIdNum).padStart(3, '0')}`,
      code: `${source.code}-COPY`,
      name: `${source.name} (Copy)`,
      status: 'Draft',
      isDefault: false,
      sourceOrigin: `Cloned from ${source.code}`,
      updatedAt: new Date().toISOString(),
    };
    ledgerState.templates.unshift(clone);
    appendAuditLog(
      ledgerState,
      'TEMPLATE_STUDIO',
      'DUPLICATE_TEMPLATE',
      `Cloned template ${source.code} into ${clone.code}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.status(201).json({ state: ledgerState, template: clone });
  });

  app.delete('/api/templates/:id', (req, res) => {
    const idx = ledgerState.templates.findIndex((t) => t.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    const [removed] = ledgerState.templates.splice(idx, 1);
    appendAuditLog(
      ledgerState,
      'TEMPLATE_STUDIO',
      'DELETE_TEMPLATE',
      `Deleted template ${removed.code} — ${removed.name}.`,
      'SUCCESS'
    );
    saveState(ledgerState);
    res.json({ state: ledgerState });
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ATCL General Ledger System listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

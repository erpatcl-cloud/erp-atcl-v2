import type {
  AccountCategory,
  AiModelId,
  AiThinkingLevel,
  AiWorkflowKey,
  AmcContractRecord,
  ApprovalRequestRecord,
  BankReconciliationEntry,
  COAValidationResult,
  ChequeRecord,
  CustomInstructionsConfig,
  CustomerAdvanceRecord,
  CustomerRecord,
  DeliveryOrderRecord,
  DepartmentBudgetRecord,
  DocumentChunkPreview,
  DocumentFileType,
  DocumentInjectionScope,
  DocumentTemplateRecord,
  FixedAssetRecord,
  FundTransferRecord,
  GoodsReceiptRecord,
  ImportLCFile,
  InventorySerialUnit,
  JournalValidationResult,
  KnowledgeDocumentItem,
  LandedCostAllocationLine,
  LCShipmentRecord,
  LedgerState,
  LocalPurchaseOrder,
  PosTransaction,
  ProductItem,
  PurchaseInvoiceRecord,
  PurchaseRequisitionRecord,
  PurchaseReturnRecord,
  ReconciliationResult,
  SalesCreditNoteRecord,
  SalesInvoiceRecord,
  SalesOrderRecord,
  SalesQuotationRecord,
  ServiceJobCard,
  SparePartItem,
  SupplierQuotationRecord,
  SupplierRecord,
  TaxRemittanceRecord,
  TaxWithholdingRule,
  TenderProjectRecord,
  VectorSearchHit,
  VoucherKind,
  VoucherRecord,
  WarrantyClaimRecord,
} from '../types/accounting.ts';

export interface RetrievedDocCitation {
  docId: string;
  filename: string;
  fileType: DocumentFileType;
  chunkIndex: number;
  sectionLabel?: string;
  similarity: number;
}

export interface CompiledInstructionsPreview {
  systemInstruction: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  activeRulesCount: number;
  activeGlossaryCount: number;
  activeDocumentsCount: number;
  vectorizedChunksCount?: number;
  compiledChars: number;
  estimatedTokens: number;
}

export interface InstructionTestResult {
  text: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  compiledChars: number;
  activeRulesCount: number;
  activeGlossaryCount: number;
  activeDocumentsCount: number;
  retrievedDocs?: RetrievedDocCitation[];
}

export interface DraftedVoucherResult {
  narration: string;
  counterparty: string;
  reference: string;
  date: string;
  reasoning: string;
  lines: Array<{
    glCode: string;
    glName: string;
    debit: number;
    credit: number;
    memo: string;
  }>;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
}

export interface ReportInsightsResult {
  headline: string;
  executiveSummary: string;
  keyObservations: string[];
  riskFlags: string[];
  recommendedActions: string[];
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  retrievedDocs?: RetrievedDocCitation[];
}

export interface GeneratedTemplateResult {
  name: string;
  code: string;
  description: string;
  htmlContent: string;
  cssContent: string;
  notes: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
}

import { auth } from './firebase.ts';
import { handleLocalApiRequest } from './localLedgerFallback.ts';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...((options?.headers as Record<string, string>) || {}),
    };
    const res = await fetch(url, {
      ...options,
      headers,
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return await handleLocalApiRequest<T>(url, options);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    }
    return data as T;
  } catch (err) {
    if (err instanceof TypeError) {
      return await handleLocalApiRequest<T>(url, options);
    }
    throw err;
  }
}

export const api = {
  getState: () => request<{ state: LedgerState }>('/api/state'),

  addAccount: (payload: {
    code: string;
    name: string;
    category: AccountCategory;
    group: string;
    openingBalance: number;
    autoCreateRegister: boolean;
  }) =>
    request<{ state: LedgerState }>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAccount: (code: string, payload: { status?: 'Active' | 'Inactive'; name?: string; group?: string }) =>
    request<{ state: LedgerState }>(`/api/accounts/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  validateCOA: () =>
    request<{ state: LedgerState; result: COAValidationResult }>('/api/coa/validate', {
      method: 'POST',
    }),

  createMissingRegisters: () =>
    request<{ state: LedgerState; result: { createdCount: number; createdCodes: string[] } }>(
      '/api/coa/create-registers',
      { method: 'POST' }
    ),

  createVoucher: (payload: {
    voucherNo: string;
    date: string;
    description: string;
    reference: string;
    counterparty: string;
    approvalStatus: 'DRAFT' | 'PENDING_APPROVAL';
    lines: Array<{ glCode: string; debit: number; credit: number }>;
  }) =>
    request<{ state: LedgerState; voucherNo: string }>('/api/journal/voucher', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteDraftVoucher: (voucherNo: string) =>
    request<{ state: LedgerState }>(`/api/journal/${encodeURIComponent(voucherNo)}`, {
      method: 'DELETE',
    }),

  validateJournal: () =>
    request<{ state: LedgerState; result: JournalValidationResult }>('/api/journal/validate', {
      method: 'POST',
    }),

  approveJournal: () =>
    request<{ state: LedgerState; result: { approvedVouchers: number; approvedLines: number } }>(
      '/api/journal/approve',
      { method: 'POST' }
    ),

  postJournal: () =>
    request<{
      state: LedgerState;
      result: { postedVouchers: number; postedLines: number; syncedLines: number; updatedRegisters: number };
    }>('/api/journal/post', { method: 'POST' }),

  reverseVoucher: (voucherNo: string, reason: string) =>
    request<{ state: LedgerState; result: { reversalVoucherNo: string; linesReversed: number } }>(
      '/api/journal/reverse',
      {
        method: 'POST',
        body: JSON.stringify({ voucherNo, reason }),
      }
    ),

  syncRegisters: () =>
    request<{ state: LedgerState; result: { syncedLines: number; updatedRegisters: number } }>(
      '/api/registers/sync',
      { method: 'POST' }
    ),

  rebuildRegister: (code: string) =>
    request<{ state: LedgerState; result: { transactionCount: number } }>(
      `/api/registers/${encodeURIComponent(code)}/rebuild`,
      { method: 'POST' }
    ),

  reconcileAll: () =>
    request<{ state: LedgerState; result: ReconciliationResult }>('/api/audit/reconcile', {
      method: 'POST',
    }),

  selfHeal: () =>
    request<{ state: LedgerState; result: { healedCount: number; healedCodes: string[] } }>(
      '/api/audit/self-heal',
      { method: 'POST' }
    ),

  updateConfig: (payload: Partial<LedgerState['config']>) =>
    request<{ state: LedgerState }>('/api/config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  pruneAuditLog: () =>
    request<{ state: LedgerState; result: { removedCount: number; remainingCount: number } }>(
      '/api/audit/prune',
      { method: 'POST' }
    ),

  restoreBackup: (snapshot: Partial<LedgerState>) =>
    request<{
      state: LedgerState;
      summary: { accounts: number; postedTransactions: number; vouchers: number; templates: number };
    }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    }),

  resetWorkspace: () =>
    request<{ state: LedgerState }>('/api/reset', {
      method: 'POST',
    }),

  loadSampleTransactions: () =>
    request<{ state: LedgerState }>('/api/load-sample', {
      method: 'POST',
    }),

  importCOA: (
    accounts: Array<{
      code: string;
      name: string;
      category: AccountCategory;
      group: string;
      openingBalance: number;
    }>
  ) =>
    request<{ state: LedgerState; importedCount: number }>('/api/import/coa', {
      method: 'POST',
      body: JSON.stringify({ accounts }),
    }),

  getAppsScripts: () =>
    request<{
      scripts: Array<{ filename: string; rawFilename: string; sizeBytes: number; content: string }>;
    }>('/api/scripts'),

  // Master Data: Products & Items
  createProduct: (payload: Omit<ProductItem, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; product: ProductItem }>('/api/master/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProduct: (id: string, payload: Partial<Omit<ProductItem, 'id' | 'updatedAt'>>) =>
    request<{ state: LedgerState; product: ProductItem }>(`/api/master/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProduct: (id: string) =>
    request<{ state: LedgerState }>(`/api/master/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Master Data: Customers 360°
  checkCustomerPhone: (phone: string, excludeId?: string) => {
    const params = new URLSearchParams({ phone });
    if (excludeId) params.set('excludeId', excludeId);
    return request<{
      duplicate: boolean;
      existingCustomer: {
        id: string;
        code: string;
        name: string;
        phone: string;
        status: string;
      } | null;
    }>(`/api/master/customers/check-phone?${params.toString()}`);
  },

  createCustomer: (payload: Omit<CustomerRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; customer: CustomerRecord }>('/api/master/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCustomer: (id: string, payload: Partial<Omit<CustomerRecord, 'id' | 'updatedAt'>>) =>
    request<{ state: LedgerState; customer: CustomerRecord }>(`/api/master/customers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteCustomer: (id: string) =>
    request<{ state: LedgerState }>(`/api/master/customers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Master Data: Suppliers
  checkSupplierPhone: (phone: string, excludeId?: string) => {
    const params = new URLSearchParams({ phone });
    if (excludeId) params.set('excludeId', excludeId);
    return request<{
      duplicate: boolean;
      existingSupplier: {
        id: string;
        code: string;
        name: string;
        phone: string;
        status: string;
      } | null;
    }>(`/api/master/suppliers/check-phone?${params.toString()}`);
  },

  createSupplier: (payload: Omit<SupplierRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; supplier: SupplierRecord }>('/api/master/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSupplier: (id: string, payload: Partial<Omit<SupplierRecord, 'id' | 'updatedAt'>>) =>
    request<{ state: LedgerState; supplier: SupplierRecord }>(`/api/master/suppliers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteSupplier: (id: string) =>
    request<{ state: LedgerState }>(`/api/master/suppliers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Supply Chain: Local Procurement
  createLocalPO: (payload: Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; order: LocalPurchaseOrder }>('/api/supply-chain/local-pos', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLocalPO: (
    id: string,
    payload: Partial<Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; order: LocalPurchaseOrder }>(
      `/api/supply-chain/local-pos/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteLocalPO: (id: string) =>
    request<{ state: LedgerState }>(`/api/supply-chain/local-pos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Supply Chain: Import & LC Management
  createImportLC: (payload: Omit<ImportLCFile, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; lc: ImportLCFile }>('/api/supply-chain/import-lcs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateImportLC: (id: string, payload: Partial<Omit<ImportLCFile, 'id' | 'updatedAt'>>) =>
    request<{ state: LedgerState; lc: ImportLCFile }>(
      `/api/supply-chain/import-lcs/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteImportLC: (id: string) =>
    request<{ state: LedgerState }>(`/api/supply-chain/import-lcs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Supply Chain: Goods Receipts (GRN) & Purchase Invoices (AP)
  createGoodsReceipt: (
    payload: Omit<GoodsReceiptRecord, 'id' | 'updatedAt' | 'postedToGl' | 'postedVoucherNo'> & {
      postToGl?: boolean;
    }
  ) =>
    request<{ state: LedgerState; grn: GoodsReceiptRecord }>('/api/supply-chain/grns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createPurchaseInvoice: (
    payload: Omit<
      PurchaseInvoiceRecord,
      'id' | 'updatedAt' | 'paidAmount' | 'outstandingAmount' | 'postedToGl' | 'postedVoucherNo'
    > & {
      postToGl?: boolean;
    }
  ) =>
    request<{ state: LedgerState; invoice: PurchaseInvoiceRecord }>(
      '/api/supply-chain/purchase-invoices',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createPurchaseRequisition: (payload: Omit<PurchaseRequisitionRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; requisition: PurchaseRequisitionRecord }>(
      '/api/supply-chain/requisitions',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updatePurchaseRequisition: (
    id: string,
    payload: Partial<Omit<PurchaseRequisitionRecord, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; requisition: PurchaseRequisitionRecord }>(
      `/api/supply-chain/requisitions/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  createSupplierQuotation: (payload: Omit<SupplierQuotationRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; quotation: SupplierQuotationRecord }>(
      '/api/supply-chain/quotations',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  awardSupplierQuotation: (id: string) =>
    request<{ state: LedgerState; quotation: SupplierQuotationRecord; order: LocalPurchaseOrder }>(
      `/api/supply-chain/quotations/${encodeURIComponent(id)}/award`,
      { method: 'POST' }
    ),

  createPurchaseReturn: (
    payload: Omit<PurchaseReturnRecord, 'id' | 'updatedAt' | 'postedToGl' | 'postedVoucherNo'>
  ) =>
    request<{ state: LedgerState; purchaseReturn: PurchaseReturnRecord }>(
      '/api/supply-chain/purchase-returns',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  saveLandedCostAllocation: (payload: {
    lcId: string;
    settlementExchangeRate?: number;
    fxDifferenceBdt?: number;
    shipments?: LCShipmentRecord[];
    landedAllocations?: LandedCostAllocationLine[];
  }) =>
    request<{ state: LedgerState; lc: ImportLCFile }>('/api/supply-chain/landed-cost', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createTaxRemittance: (
    payload: Omit<TaxRemittanceRecord, 'id' | 'updatedAt' | 'postedToGl' | 'postedVoucherNo'>
  ) =>
    request<{ state: LedgerState; remittance: TaxRemittanceRecord }>(
      '/api/supply-chain/tax-remittances',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Supply Chain: Inventory & Serial Register
  createSerialUnit: (payload: Omit<InventorySerialUnit, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; serial: InventorySerialUnit }>('/api/supply-chain/serials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSerialUnit: (
    id: string,
    payload: Partial<Omit<InventorySerialUnit, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; serial: InventorySerialUnit }>(
      `/api/supply-chain/serials/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteSerialUnit: (id: string) =>
    request<{ state: LedgerState }>(`/api/supply-chain/serials/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  createStockAdjustment: (payload: {
    sku: string;
    qtyDelta: number;
    warehouse: string;
    reason: string;
    adjustmentDate?: string;
    offsetGlCode?: string;
  }) =>
    request<{ state: LedgerState }>('/api/supply-chain/stock-adjustments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Sales & Service: Sales & Distribution
  createSalesOrder: (payload: Omit<SalesOrderRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; order: SalesOrderRecord }>('/api/sales-service/sales-orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSalesOrder: (
    id: string,
    payload: Partial<Omit<SalesOrderRecord, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; order: SalesOrderRecord }>(
      `/api/sales-service/sales-orders/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteSalesOrder: (id: string) =>
    request<{ state: LedgerState }>(`/api/sales-service/sales-orders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Sales & Service: Dedicated Sales Invoices (AR 1120) & Customer Advances (2110)
  createSalesInvoice: (
    payload: Omit<
      SalesInvoiceRecord,
      | 'id'
      | 'updatedAt'
      | 'paidAmount'
      | 'tdsDeductedAmount'
      | 'vdsDeductedAmount'
      | 'creditNoteAmount'
      | 'outstandingAmount'
      | 'postedToGl'
      | 'postedVoucherNo'
    > & { postToGl?: boolean }
  ) =>
    request<{ state: LedgerState; invoice: SalesInvoiceRecord }>(
      '/api/sales-service/sales-invoices',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  applyCustomerAdvanceToInvoice: (payload: {
    advanceId: string;
    invoiceId: string;
    amount: number;
  }) =>
    request<{ state: LedgerState; advance: CustomerAdvanceRecord; invoice: SalesInvoiceRecord }>(
      '/api/sales-service/customer-advances/apply',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  createSalesQuotation: (payload: Omit<SalesQuotationRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; quotation: SalesQuotationRecord }>(
      '/api/sales-service/quotations',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  convertSalesQuotation: (id: string) =>
    request<{ state: LedgerState; quotation: SalesQuotationRecord; order: SalesOrderRecord }>(
      `/api/sales-service/quotations/${encodeURIComponent(id)}/convert`,
      { method: 'POST' }
    ),

  createDeliveryOrder: (payload: Omit<DeliveryOrderRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; deliveryOrder: DeliveryOrderRecord }>(
      '/api/sales-service/delivery-orders',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  cancelDeliveryOrder: (id: string) =>
    request<{ state: LedgerState; deliveryOrder: DeliveryOrderRecord }>(
      `/api/sales-service/delivery-orders/${encodeURIComponent(id)}/cancel`,
      { method: 'PATCH' }
    ),

  createSalesCreditNote: (
    payload: Omit<SalesCreditNoteRecord, 'id' | 'updatedAt' | 'postedToGl' | 'postedVoucherNo'>
  ) =>
    request<{ state: LedgerState; creditNote: SalesCreditNoteRecord }>(
      '/api/sales-service/credit-notes',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  createAmcContract: (
    payload: Omit<AmcContractRecord, 'id' | 'updatedAt' | 'recognizedAmount' | 'deferredAmount'>
  ) =>
    request<{ state: LedgerState; contract: AmcContractRecord }>(
      '/api/sales-service/amc-contracts',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  recognizeAmcRevenue: (id: string, amount: number) =>
    request<{ state: LedgerState; contract: AmcContractRecord }>(
      `/api/sales-service/amc-contracts/${encodeURIComponent(id)}/recognize`,
      { method: 'POST', body: JSON.stringify({ amount }) }
    ),

  // Sales & Service: Retail Counter POS
  createPosSale: (payload: Omit<PosTransaction, 'id' | 'receiptNo' | 'updatedAt'>) =>
    request<{ state: LedgerState; transaction: PosTransaction }>('/api/sales-service/pos-sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  voidPosSale: (id: string) =>
    request<{ state: LedgerState; transaction: PosTransaction }>(
      `/api/sales-service/pos-sales/${encodeURIComponent(id)}/void`,
      { method: 'PATCH' }
    ),

  deletePosSale: (id: string) =>
    request<{ state: LedgerState }>(`/api/sales-service/pos-sales/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Sales & Service: Warranty Management
  createWarrantyClaim: (payload: Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; claim: WarrantyClaimRecord }>('/api/sales-service/warranties', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateWarrantyClaim: (
    id: string,
    payload: Partial<Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; claim: WarrantyClaimRecord }>(
      `/api/sales-service/warranties/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteWarrantyClaim: (id: string) =>
    request<{ state: LedgerState }>(`/api/sales-service/warranties/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Sales & Service: Service & Repair Workshop
  createServiceJob: (payload: Omit<ServiceJobCard, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; job: ServiceJobCard }>('/api/sales-service/service-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateServiceJob: (
    id: string,
    payload: Partial<Omit<ServiceJobCard, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; job: ServiceJobCard }>(
      `/api/sales-service/service-jobs/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteServiceJob: (id: string) =>
    request<{ state: LedgerState }>(`/api/sales-service/service-jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  billServiceJob: (id: string, payload?: { invoiceDate?: string; vatRate?: number }) =>
    request<{ state: LedgerState; job: ServiceJobCard; invoice: SalesInvoiceRecord }>(
      `/api/sales-service/service-jobs/${encodeURIComponent(id)}/bill`,
      { method: 'POST', body: JSON.stringify(payload || {}) }
    ),

  // Tenders & Turnkey Projects
  createTenderProject: (payload: Omit<TenderProjectRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; project: TenderProjectRecord }>('/api/projects/tenders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTenderProject: (
    id: string,
    payload: Partial<Omit<TenderProjectRecord, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; project: TenderProjectRecord }>(
      `/api/projects/tenders/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  holdProjectRetention: (id: string, payload: { amount: number; reference?: string; date?: string }) =>
    request<{ state: LedgerState; project: TenderProjectRecord }>(
      `/api/projects/tenders/${encodeURIComponent(id)}/retention-hold`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  releaseProjectRetention: (
    id: string,
    payload: { amount: number; bankGlCode?: string; reference?: string; date?: string }
  ) =>
    request<{ state: LedgerState; project: TenderProjectRecord }>(
      `/api/projects/tenders/${encodeURIComponent(id)}/retention-release`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Fixed Assets & Monthly Depreciation
  createFixedAsset: (
    payload: Omit<FixedAssetRecord, 'id' | 'netBookValue' | 'updatedAt'> & {
      postToGl?: boolean;
      paymentGlCode?: string;
    }
  ) =>
    request<{ state: LedgerState; asset: FixedAssetRecord }>('/api/assets/fixed-assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runMonthlyDepreciation: (payload: { monthKey: string; postingDate?: string }) =>
    request<{ state: LedgerState; assetsDepreciated: number; totalDepreciation: number; voucherNo?: string }>(
      '/api/assets/fixed-assets/run-depreciation',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Department Budgets & Month-End Closing
  saveDepartmentBudget: (payload: Omit<DepartmentBudgetRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; budget: DepartmentBudgetRecord }>('/api/finance/budgets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteDepartmentBudget: (id: string) =>
    request<{ state: LedgerState }>(`/api/finance/budgets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  closeAccountingMonth: (payload: { monthKey: string; reopen?: boolean }) =>
    request<{ state: LedgerState; lockedMonths: string[] }>('/api/finance/month-end/close', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Sales & Service: Spare Parts Inventory
  createSparePart: (payload: Omit<SparePartItem, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; part: SparePartItem }>('/api/sales-service/spare-parts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSparePart: (
    id: string,
    payload: Partial<Omit<SparePartItem, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; part: SparePartItem }>(
      `/api/sales-service/spare-parts/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteSparePart: (id: string) =>
    request<{ state: LedgerState }>(`/api/sales-service/spare-parts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Voucher Management (Payment / Receipt / Journal / Expense)
  createVoucherRecord: (
    payload: Omit<VoucherRecord, 'id' | 'updatedAt' | 'createdBy' | 'postedToGl'> & {
      postImmediately?: boolean;
    }
  ) =>
    request<{ state: LedgerState; voucher: VoucherRecord }>('/api/vouchers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  postVoucherToGL: (id: string) =>
    request<{ state: LedgerState; voucher: VoucherRecord }>(
      `/api/vouchers/${encodeURIComponent(id)}/post-gl`,
      { method: 'POST' }
    ),

  voidVoucherRecord: (id: string) =>
    request<{ state: LedgerState; voucher: VoucherRecord }>(
      `/api/vouchers/${encodeURIComponent(id)}/void`,
      { method: 'PATCH' }
    ),

  deleteVoucherRecord: (id: string) =>
    request<{ state: LedgerState }>(`/api/vouchers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Governance & Approval Workflow
  getApprovals: () =>
    request<{ approvals: ApprovalRequestRecord[] }>('/api/governance/approvals'),

  createApprovalRequest: (
    payload: Omit<ApprovalRequestRecord, 'id' | 'requestNo' | 'requestedAt' | 'requestedBy' | 'status'>
  ) =>
    request<{ state: LedgerState; approval: ApprovalRequestRecord }>('/api/governance/approvals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  decideApprovalRequest: (
    id: string,
    payload: { decision: 'Approved' | 'Rejected'; reviewNotes?: string }
  ) =>
    request<{ state: LedgerState; approval: ApprovalRequestRecord }>(
      `/api/governance/approvals/${encodeURIComponent(id)}/decide`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  // Bank, Cash & Treasury Management
  createCheque: (payload: Omit<ChequeRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; cheque: ChequeRecord }>('/api/treasury/cheques', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateChequeStatus: (
    id: string,
    payload: { status: ChequeRecord['status']; clearedDate?: string }
  ) =>
    request<{ state: LedgerState; cheque: ChequeRecord }>(
      `/api/treasury/cheques/${encodeURIComponent(id)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  createFundTransfer: (
    payload: Omit<FundTransferRecord, 'id' | 'postedVoucherNo' | 'updatedAt'>
  ) =>
    request<{ state: LedgerState; transfer: FundTransferRecord }>('/api/treasury/transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  addBankStatementLine: (
    payload: Omit<BankReconciliationEntry, 'id' | 'reconciled' | 'reconciledAt'>
  ) =>
    request<{ state: LedgerState; entry: BankReconciliationEntry }>('/api/treasury/bank-statements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  matchBankStatementLine: (id: string, matchedTxnId: string) =>
    request<{ state: LedgerState; entry: BankReconciliationEntry }>(
      `/api/treasury/bank-statements/${encodeURIComponent(id)}/match`,
      {
        method: 'PATCH',
        body: JSON.stringify({ matchedTxnId }),
      }
    ),

  // Bangladesh Tax & NBR Compliance
  createTaxRule: (payload: Omit<TaxWithholdingRule, 'id'>) =>
    request<{ state: LedgerState; rule: TaxWithholdingRule }>('/api/tax/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTaxRule: (id: string, payload: Partial<Omit<TaxWithholdingRule, 'id'>>) =>
    request<{ state: LedgerState; rule: TaxWithholdingRule }>(
      `/api/tax/rules/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteTaxRule: (id: string) =>
    request<{ state: LedgerState }>(`/api/tax/rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Template Studio & Importer
  createTemplate: (payload: Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>) =>
    request<{ state: LedgerState; template: DocumentTemplateRecord }>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTemplate: (
    id: string,
    payload: Partial<Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>>
  ) =>
    request<{ state: LedgerState; template: DocumentTemplateRecord }>(
      `/api/templates/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  duplicateTemplate: (id: string) =>
    request<{ state: LedgerState; template: DocumentTemplateRecord }>(
      `/api/templates/${encodeURIComponent(id)}/duplicate`,
      { method: 'POST' }
    ),

  deleteTemplate: (id: string) =>
    request<{ state: LedgerState }>(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Global Custom Instructions & Gemini AI Workflows
  previewAiInstructions: (
    workflow: AiWorkflowKey,
    draftCustomInstructions?: CustomInstructionsConfig
  ) =>
    request<CompiledInstructionsPreview>('/api/ai/preview', {
      method: 'POST',
      body: JSON.stringify({ workflow, draftCustomInstructions }),
    }),

  testAiInstruction: (
    prompt: string,
    workflow: AiWorkflowKey,
    draftCustomInstructions?: CustomInstructionsConfig
  ) =>
    request<InstructionTestResult>('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify({ prompt, workflow, draftCustomInstructions }),
    }),

  uploadKnowledgeDocument: (payload: {
    filename: string;
    mimeType?: string;
    textContent?: string;
    base64Data?: string;
    scope?: DocumentInjectionScope;
    chunkSizeTarget?: number;
  }) =>
    request<{ state: LedgerState; document: KnowledgeDocumentItem; vectorWarning?: string }>(
      '/api/ai/documents/upload',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateDocumentStoreItem: (
    id: string,
    payload: { enabled?: boolean; scope?: DocumentInjectionScope }
  ) =>
    request<{ state: LedgerState; document: KnowledgeDocumentItem }>(
      `/api/ai/documents/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  revectorizeDocument: (id: string, chunkSizeTarget?: number) =>
    request<{ state: LedgerState; document: KnowledgeDocumentItem }>(
      `/api/ai/documents/${encodeURIComponent(id)}/vectorize`,
      {
        method: 'POST',
        body: JSON.stringify({ chunkSizeTarget }),
      }
    ),

  getDocumentChunks: (id: string) =>
    request<{ document: KnowledgeDocumentItem; chunks: DocumentChunkPreview[] }>(
      `/api/ai/documents/${encodeURIComponent(id)}/chunks`
    ),

  searchDocumentStore: (payload: {
    query: string;
    targetScope?: DocumentInjectionScope;
    topK?: number;
  }) =>
    request<{ hits: VectorSearchHit[]; embeddingModel: string }>('/api/ai/documents/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteKnowledgeDocument: (id: string) =>
    request<{ state: LedgerState }>(`/api/ai/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  draftVoucherWithAi: (instruction: string, voucherType?: VoucherKind | 'MasterJournal') =>
    request<DraftedVoucherResult>('/api/ai/draft-voucher', {
      method: 'POST',
      body: JSON.stringify({ instruction, voucherType }),
    }),

  generateReportInsights: (
    reportScope: 'summary' | 'trial-balance' | 'income' | 'balance-sheet' | 'monthly' | 'audit',
    focusQuestion?: string
  ) =>
    request<ReportInsightsResult>('/api/ai/report-insights', {
      method: 'POST',
      body: JSON.stringify({ reportScope, focusQuestion }),
    }),

  generateTemplateWithAi: (payload: {
    prompt: string;
    category: string;
    dataSource: string;
    paperSize: string;
    existingHtml?: string;
    existingCss?: string;
  }) =>
    request<GeneratedTemplateResult>('/api/ai/generate-template', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  streamAssistantChat: async (
    messages: Array<{ role: 'user' | 'model'; text: string }>,
    activeRoute: string,
    onChunk: (chunk: string) => void
  ): Promise<{
    model: AiModelId;
    thinkingLevel: AiThinkingLevel;
    activeRulesCount: number;
    activeDocumentsCount: number;
    retrievedDocs?: RetrievedDocCitation[];
  }> => {
    const res = await fetch('/api/ai/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, activeRoute }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error((errData as { error?: string }).error || `Assistant failed (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Streaming response body unavailable.');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let finalMeta: {
      model: AiModelId;
      thinkingLevel: AiThinkingLevel;
      activeRulesCount: number;
      activeDocumentsCount: number;
      retrievedDocs?: RetrievedDocCitation[];
    } = {
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'MEDIUM',
      activeRulesCount: 0,
      activeDocumentsCount: 0,
      retrievedDocs: [],
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evt of events) {
        const line = evt
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6)) as {
          type: 'chunk' | 'done' | 'error';
          text?: string;
          error?: string;
          meta?: typeof finalMeta;
        };
        if (payload.type === 'chunk' && payload.text) {
          onChunk(payload.text);
        } else if (payload.type === 'error') {
          throw new Error(payload.error || 'Assistant generation failed.');
        } else if (payload.type === 'done' && payload.meta) {
          finalMeta = payload.meta;
        }
      }
    }
    return finalMeta;
  },
};

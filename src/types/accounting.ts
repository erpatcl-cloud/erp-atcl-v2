export type AccountCategory = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

export type NormalBalance = 'Debit' | 'Credit';

export type AccountStatus = 'Active' | 'Inactive';

export type ApprovalStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type PostingStatus = 'UNPOSTED' | 'POSTED' | 'FAILED' | 'REVERSED';

export type RegisterSyncStatus = 'PENDING' | 'SYNCED';

export type AuditStatus = 'SUCCESS' | 'FAILED' | 'ALERT' | 'DISCREPANCY' | 'WARNING';

export interface GLAccount {
  code: string;
  name: string;
  category: AccountCategory;
  group: string;
  accountType?: string;
  openingBalance: number;
  normalBalance: NormalBalance;
  priorYearDebit?: number;
  priorYearCredit?: number;
  registerFileId: string | null;
  registerFileName: string | null;
  status: AccountStatus;
  lastSyncedAt: string | null;
}

export interface JournalLine {
  journalId: string;
  date: string; // yyyy-MM-dd
  voucherNo: string;
  description: string;
  glCode: string;
  glName: string;
  debit: number;
  credit: number;
  reference: string;
  counterparty: string;
  enteredBy: string;
  approvalStatus: ApprovalStatus;
  postingStatus: PostingStatus;
  validationRemarks: string;
}

export interface PostedTransaction {
  postTimestamp: string;
  journalId: string;
  voucherNo: string;
  date: string;
  type: 'Debit Post' | 'Credit Post';
  description: string;
  reference: string;
  counterparty: string;
  glCode: string;
  glName: string;
  contraCode: string;
  contraName: string;
  debit: number;
  credit: number;
  enteredBy: string;
  transactionId: string;
  registerSynced: RegisterSyncStatus;
}

export interface RegisterEntry {
  date: string;
  voucherNo: string;
  type: 'Debit Post' | 'Credit Post';
  description: string;
  reference: string;
  counterparty: string;
  contraCode: string;
  contraName: string;
  debit: number;
  credit: number;
  runningBalance: number;
  balanceType: 'Dr' | 'Cr';
  enteredBy: string;
  entryTimestamp: string;
  transactionId: string;
}

export interface AccountRegisterBook {
  glCode: string;
  fileId: string;
  fileName: string;
  createdAt: string;
  lastSyncedAt: string;
  entries: RegisterEntry[];
}

export interface AuditLogEntry {
  timestamp: string;
  logId: string;
  userEmail: string;
  module: string;
  action: string;
  details: string;
  status: AuditStatus;
}

export interface VoucherSeriesRule {
  prefix: string;
  padding: number;
  nextSequence: number;
}

export type SystemRoleId =
  | 'finance_controller'
  | 'senior_accountant'
  | 'voucher_clerk'
  | 'external_auditor';

export interface RolePermissions {
  canCreateVouchers: boolean;
  canApproveVouchers: boolean;
  canPostToGL: boolean;
  canReverseVouchers: boolean;
  canManageCOA: boolean;
  canLockFiscalPeriods: boolean;
  canEditSystemConfig: boolean;
  canExportBackup: boolean;
}

export type AppThemePreset = 'atcl-navy' | 'warm-ivory' | 'slate-dark' | 'high-contrast';

export type UiDensityMode = 'standard' | 'compact';

export type AiModelId =
  | 'gemini-4-hydrogen'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-neon'
  | 'gemini-4-carbon'
  | 'gemini-4-argon';

export type AiThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';

export type AiResponseTone =
  | 'executive-concise'
  | 'audit-formal'
  | 'analytical-detailed'
  | 'plain-english';

export type AiWorkflowKey =
  | 'assistant'
  | 'voucherDrafting'
  | 'reportInsights'
  | 'templateStudio';

export type KnowledgeRuleCategory =
  | 'Accounting'
  | 'Tax & VAT'
  | 'Approval'
  | 'Reporting'
  | 'General';

export interface KnowledgeRuleItem {
  id: string;
  title: string;
  category: KnowledgeRuleCategory;
  content: string;
  enabled: boolean;
  updatedAt: string;
}

export interface KnowledgeGlossaryItem {
  id: string;
  term: string;
  definition: string;
  enabled: boolean;
}

export type DocumentFileType = 'PDF' | 'CSV' | 'MD' | 'TXT' | 'JSON';

export type DocumentInjectionScope = 'global' | 'assistant' | 'reporting';

export type DocumentVectorStatus = 'vectorized' | 'pending' | 'error';

export interface KnowledgeDocumentItem {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  extractedText: string;
  charCount: number;
  enabled: boolean;
  scope: DocumentInjectionScope;
  vectorStatus: DocumentVectorStatus;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkCount: number;
  chunkSizeTarget?: number;
  vectorizedAt: string | null;
  vectorError?: string;
  summaryPreview?: string;
}

export interface DocumentChunkPreview {
  id: string;
  docId: string;
  filename: string;
  chunkIndex: number;
  sectionLabel?: string;
  text: string;
  charCount: number;
  tokenEstimate: number;
  embeddingDimensions: number;
}

export interface VectorSearchHit {
  docId: string;
  filename: string;
  fileType: DocumentFileType;
  scope: DocumentInjectionScope;
  chunkIndex: number;
  sectionLabel?: string;
  text: string;
  similarity: number;
}

export interface WorkflowModelOverride {
  enabled: boolean;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
}

export interface CustomInstructionsStyle {
  themePreset: AppThemePreset;
  density: UiDensityMode;
  accentHex: string;
  tabularEmphasis: boolean;
  aiTone: AiResponseTone;
  responseFormattingRules: string;
}

export interface CustomInstructionsModels {
  defaultModel: AiModelId;
  defaultThinkingLevel: AiThinkingLevel;
  includeReasoningSummary: boolean;
  workflowOverrides: Record<AiWorkflowKey, WorkflowModelOverride>;
}

export interface CustomInstructionsKnowledge {
  rules: KnowledgeRuleItem[];
  glossary: KnowledgeGlossaryItem[];
  documents: KnowledgeDocumentItem[];
}

export interface CustomInstructionsPrompts {
  globalSystemPrompt: string;
  workflowPrompts: Record<AiWorkflowKey, string>;
  prohibitedBehaviors: string;
}

export interface CustomInstructionsConfig {
  enabled: boolean;
  style: CustomInstructionsStyle;
  models: CustomInstructionsModels;
  knowledge: CustomInstructionsKnowledge;
  prompts: CustomInstructionsPrompts;
}

export interface SystemConfig {
  systemName: string;
  organizationName: string;
  currencyCode: string;
  currencySymbol: string;
  fiscalPeriod: string;
  driveFolderName: string;
  autoSyncOnPost: boolean;
  operatorEmail: string;
  lastSyncTimestamp: string | null;
  // Company & Tax Profile
  legalEntityType?: string;
  tinNumber?: string;
  binVatNumber?: string;
  tradeLicenseNo?: string;
  registeredAddress?: string;
  contactPhone?: string;
  defaultVatPct?: number;
  defaultTdsPct?: number;
  defaultVdsPct?: number;
  decimalPlaces?: number;
  // Voucher Numbering & Approval Thresholds
  voucherNumbering?: {
    payment: VoucherSeriesRule;
    receipt: VoucherSeriesRule;
    journal: VoucherSeriesRule;
    expense: VoucherSeriesRule;
    reversal: VoucherSeriesRule;
  };
  autoApproveLimit?: number;
  dualApprovalThreshold?: number;
  enforceLiquidityCheck?: boolean;
  enforceBudgetCheck?: boolean;
  requireVoucherNarration?: boolean;
  // Fiscal Calendar & Period Locks
  fiscalStartDate?: string;
  fiscalEndDate?: string;
  globalLockDate?: string | null;
  lockedMonths?: string[]; // YYYY-MM keys e.g. '2024-07'
  allowBackdatedEntries?: boolean;
  allowFutureDatedEntries?: boolean;
  // Governance, Role Permissions & Audit Retention
  activeRole?: SystemRoleId;
  rolePermissions?: Record<SystemRoleId, RolePermissions>;
  auditRetentionDays?: number;
  maxAuditEntries?: number;
  // Global Custom Instructions & AI Governance
  customInstructions?: CustomInstructionsConfig;
  // Product Catalog Dynamic Dropdown Lists
  productTypes?: string[];
  productCategories?: string[];
  productUnits?: string[];
  // Customer Account Dynamic Dropdown Lists & Sequence Floor
  customerSegments?: string[];
  customerStatuses?: string[];
  highestCustomerCodeNum?: number;
  // Supplier / Vendor Dynamic Dropdown Lists & Sequence Floor
  supplierTypes?: string[];
  highestSupplierCodeNum?: number;
  // Live Google Drive & Master Ledger Bidirectional Sync
  googleLedgerSync?: GoogleLedgerSyncConfig;
  // 15-Tab Central Master Workbook Sync
  googleMasterSync?: GoogleMasterWorkbookConfig;
}

export type MasterWorkbookTabId =
  | 'coa'
  | 'postedTx'
  | 'registerSummary'
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'localPOs'
  | 'importLCs'
  | 'inventorySerials'
  | 'salesOrders'
  | 'posTransactions'
  | 'warrantyClaims'
  | 'serviceJobs'
  | 'spareParts'
  | 'vouchers';

export interface MasterTabSyncMeta {
  tabId: MasterWorkbookTabId;
  sheetName: string;
  sheetGid?: number;
  lastHash?: string;
  lastSyncedAt?: string | null;
  recordCount?: number;
  status: GoogleSyncStatus;
  lastError?: string | null;
}

export interface GoogleMasterWorkbookConfig {
  folderId?: string;
  folderUrl?: string;
  folderName?: string;
  workbookId?: string;
  workbookTitle?: string;
  workbookUrl?: string;
  connectedEmail?: string;
  status: GoogleSyncStatus;
  lastSyncAt?: string | null;
  lastReverseSyncAt?: string | null;
  lastDriveModifiedTime?: string | null;
  lastError?: string | null;
  tabs?: Partial<Record<MasterWorkbookTabId, MasterTabSyncMeta>>;
  pendingConflicts?: SyncConflictItem[];
  syncHistory?: SyncAuditRecord[];
}

export type GoogleSyncStatus = 'Synced' | 'Pending' | 'Failed' | 'Conflict';

export interface GoogleSheetRef {
  id: string;
  url: string;
  title: string;
  lastHash?: string;
  lastSyncedAt?: string;
}

export interface SyncConflictItem {
  id: string;
  sheet: string;
  recordKey: string;
  field: string;
  appValue: string;
  sheetValue: string;
  actionType: 'COA_CONFLICT' | 'REVERSAL_PROPOSAL' | 'REPORT_DISCREPANCY' | 'PROTECTED_RECORD';
  detectedAt: string;
  message: string;
  rawRow?: string[];
}

export interface SyncAuditRecord {
  id: string;
  timestamp: string;
  direction: 'SYSTEM_TO_SHEET' | 'SHEET_TO_SYSTEM' | 'CONFLICT_RESOLUTION';
  sheet: string;
  recordKey: string;
  originalValue: string;
  updatedValue: string;
  user: string;
  status: 'SUCCESS' | 'BLOCKED' | 'CONFLICT' | 'FAILED';
  summary: string;
}

export interface GoogleLedgerSyncConfig {
  folderId?: string;
  folderUrl?: string;
  folderName?: string;
  connectedEmail?: string;
  status: GoogleSyncStatus;
  lastSyncAt?: string | null;
  lastReverseSyncAt?: string | null;
  lastError?: string | null;
  sheets?: {
    coa?: GoogleSheetRef;
    postedTx?: GoogleSheetRef;
    registerSummary?: GoogleSheetRef;
  };
  pendingConflicts?: SyncConflictItem[];
  syncHistory?: SyncAuditRecord[];
}

export type ProductItemType = string;

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  itemType: ProductItemType;
  category: string;
  unit: string;
  hsnCode: string;
  unitCost: number;
  sellingPrice: number;
  stockQty: number;
  reorderLevel: number;
  inventoryGlCode: string;
  revenueGlCode: string;
  cogsGlCode: string;
  modelReference?: string;
  manufacturer?: string;
  brand?: string;
  originCountry?: string;
  shortDetails?: string;
  accountingType?: 'Stock' | 'Non-Stock' | 'Service' | 'Fixed Asset' | 'Consumable';
  minSellingPrice?: number;
  lastPurchasePrice?: number;
  serialTrackingEnabled?: boolean;
  warrantyPeriodMonths?: number;
  purchaseExpenseGlCode?: string;
  purchaseReturnGlCode?: string;
  salesReturnGlCode?: string;
  status: AccountStatus;
  updatedAt: string;
}

export type CustomerSegment = string;

export interface CustomerAging {
  current: number;
  days30: number;
  days60: number;
  days90Plus: number;
}

export interface CustomerRecord {
  id: string;
  code: string;
  name: string;
  segment: CustomerSegment;
  contactPerson: string;
  email: string;
  phone: string;
  city: string;
  vat?: string;
  tinNumber?: string;
  binNumber: string;
  vatRegistrationStatus?: 'Registered' | 'Exempt' | 'Unregistered';
  taxWithholdingCategory?: string;
  legalName?: string;
  tradingName?: string;
  customerType?: 'Institutional' | 'Corporate' | 'Government' | 'Distributor' | 'Individual';
  allowSharedPhone?: boolean;
  onHoldReason?: string;
  creditReviewDate?: string;
  paymentTerms: string;
  creditLimit: number;
  openingReceivable: number;
  currentReceivable: number;
  ytdRevenue: number;
  aging: CustomerAging;
  receivableGlCode: string;
  status: string;
  notes: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt: string;
}

export type SupplierType = string;

export interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  supplierType: SupplierType;
  country: string;
  contactPerson: string;
  email: string;
  phone: string;
  taxNo?: string;
  binNumber: string;
  paymentTerms: string;
  bankName: string;
  beneficiaryBankAccount?: string;
  beneficiaryRoutingNo?: string;
  beneficiarySwiftBic?: string;
  creditLimit?: number;
  taxClassification?: string;
  legalName?: string;
  tradingName?: string;
  complianceStatus?: 'Verified' | 'Pending Review' | 'Restricted';
  approvalStatus?: 'Approved' | 'Pending';
  advanceBalance: number;
  payableBalance: number;
  ytdSpend: number;
  expenseGlCode: string;
  status: string;
  notes: string;
  updatedAt: string;
}

export type LocalPOCategory =
  | 'Local Material'
  | 'C&F & Freight'
  | 'Engineering Subcontract'
  | 'Office & IT'
  | 'Maintenance & Spares';

export type LocalPOStatus =
  | 'Draft'
  | 'Approved'
  | 'Partially Received'
  | 'Received'
  | 'Settled';

export interface LocalPOLineItem {
  id: string;
  productId?: string;
  sku?: string;
  description: string;
  qty: number;
  receivedQty?: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
  warehouse?: string;
  glCode?: string;
}

export interface LocalPurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  expectedDate: string;
  supplierId: string;
  supplierName: string;
  category: LocalPOCategory;
  description: string;
  lines?: LocalPOLineItem[];
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  aitRate: number;
  aitAmount: number;
  grossAmount: number;
  paidAmount: number;
  paymentBank: string;
  expenseGlCode: string;
  status: LocalPOStatus;
  approvalStatus?: 'Draft' | 'Approved' | 'Rejected';
  receiptStatus?: 'Pending' | 'Partially Received' | 'Received' | 'Closed';
  invoiceStatus?: 'Unbilled' | 'Partially Billed' | 'Billed';
  paymentStatus?: 'Unpaid' | 'Partially Paid' | 'Paid';
  grnNumber: string;
  notes: string;
  updatedAt: string;
}

export type IssuingBankName =
  | 'Shahjalal Islami Bank PLC'
  | 'Al-Arafah Islami Bank'
  | 'IBBL';

export type LCType = 'Sight LC' | 'UPAS 90D' | 'Deferred 120D' | 'Back-to-Back';

export type LCStatus =
  | 'Opened'
  | 'In Transit'
  | 'Customs Clearance'
  | 'Released to Warehouse'
  | 'Retired / Settled';

export interface LCShipmentRecord {
  id: string;
  shipmentRef: string;
  vesselOrFlight: string;
  billOfLadingNo: string;
  etaDate: string;
  customsReleaseDate?: string;
  foreignAmount: number;
  dutyAndCnfBdt: number;
  status: 'In Transit' | 'Bonded' | 'Customs Cleared' | 'Released';
}

export interface LandedCostAllocationLine {
  id: string;
  sku: string;
  productName: string;
  qty: number;
  fobBdt: number;
  allocatedDutyCnfBdt: number;
  totalLandedBdt: number;
  unitLandedCostBdt: number;
}

export interface ImportLCFile {
  id: string;
  lcNumber: string;
  openDate: string;
  shipmentDate: string;
  maturityDate: string;
  supplierName: string;
  originCountry: string;
  issuingBank: IssuingBankName;
  loanGlCode: string;
  lcType: LCType;
  currency: 'USD' | 'EUR' | 'SGD';
  foreignAmount: number;
  exchangeRate: number;
  bdtValue: number;
  settlementExchangeRate?: number;
  fxDifferenceBdt?: number;
  marginPct: number;
  marginDepositBdt: number;
  customsDutyAndCnfBdt: number;
  bankChargesBdt: number;
  totalLandedCostBdt: number;
  portOfDischarge: 'Chattogram Sea Port' | 'HSIA Dhaka Air Cargo' | 'Benapole Land Port';
  cnfAgent: string;
  billOfEntryNo: string;
  goodsDescription: string;
  shipments?: LCShipmentRecord[];
  landedAllocations?: LandedCostAllocationLine[];
  status: LCStatus;
  notes: string;
  updatedAt: string;
}

export type SerialUnitStatus =
  | 'In Transit'
  | 'Bonded'
  | 'QC Hold'
  | 'In Stock'
  | 'Reserved'
  | 'Issued to Project'
  | 'Under Calibration'
  | 'RMA / Warranty';

export type WarehouseLocation =
  | 'Dhaka Central Warehouse'
  | 'Gazipur Staging Yard'
  | 'Chattogram Port Bonded'
  | 'Client Site Deployed';

export interface InventorySerialUnit {
  id: string;
  serialNumber: string;
  batchOrLcRef: string;
  sku: string;
  productName: string;
  category: string;
  warehouseLocation: WarehouseLocation;
  unitCost: number;
  receivedDate: string;
  warrantyExpiry: string;
  assignedCustomer: string;
  projectRef: string;
  glCode: string;
  status: SerialUnitStatus;
  notes: string;
  updatedAt: string;
}

export type SalesChannel =
  | 'Direct Project'
  | 'Utility Tender'
  | 'Distributor / Channel'
  | 'Enterprise AMC';

export type SalesOrderStatus =
  | 'Quotation'
  | 'Confirmed'
  | 'Dispatched'
  | 'Invoiced'
  | 'Collected';

export interface SalesOrderLineItem {
  id: string;
  sku?: string;
  description: string;
  qty: number;
  deliveredQty?: number;
  invoicedQty?: number;
  unit: string;
  unitPrice: number;
  discount: number;
  vatRate: number;
  lineNet: number;
}

export interface SalesOrderRecord {
  id: string;
  orderNo: string;
  orderDate: string;
  deliveryDate: string;
  customerId: string;
  customerName: string;
  channel: SalesChannel;
  salesRep: string;
  description: string;
  customerPoNo?: string;
  tenderRef?: string;
  projectCode?: string;
  warehouse?: string;
  lines?: SalesOrderLineItem[];
  retentionAmount?: number;
  creditOverrideBy?: string;
  creditOverrideReason?: string;
  orderStatus?: 'Draft' | 'Pending Approval' | 'Confirmed' | 'Fulfilled' | 'Cancelled';
  deliveryStatus?: 'Not Delivered' | 'Partially Delivered' | 'Fully Delivered';
  invoiceStatus?: 'Not Invoiced' | 'Partially Invoiced' | 'Fully Invoiced';
  paymentStatus?: 'Unpaid' | 'Partially Paid' | 'Paid';
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  grossAmount: number;
  collectedAmount: number;
  commissionAmount: number;
  revenueGlCode: string;
  challanNo: string;
  status: SalesOrderStatus;
  notes: string;
  updatedAt: string;
}

export interface SalesQuotationRecord {
  id: string;
  quoteNo: string;
  quoteDate: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  channel: SalesChannel;
  lines: SalesOrderLineItem[];
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  deliveryTerms: string;
  warrantyTerms: string;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Converted' | 'Expired';
  linkedOrderNo?: string;
  notes: string;
  updatedAt: string;
}

export interface DeliveryOrderLineItem {
  description: string;
  sku?: string;
  orderedQty: number;
  dispatchedQty: number;
  unit: string;
}

export interface DeliveryOrderRecord {
  id: string;
  challanNo: string;
  deliveryDate: string;
  salesOrderId: string;
  salesOrderNo: string;
  customerId: string;
  customerName: string;
  warehouse: string;
  transporter: string;
  lines: DeliveryOrderLineItem[];
  allocatedSerials: string[];
  status: 'Dispatched' | 'Delivered' | 'Cancelled';
  notes: string;
  updatedAt: string;
}

export type PosPaymentMethod = 'Cash' | 'Card / POS' | 'bKash / MFS' | 'Bank Transfer';

export interface PosLineItem {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PosTransaction {
  id: string;
  receiptNo: string;
  saleDate: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: PosPaymentMethod;
  settlementGlCode: string;
  items: PosLineItem[];
  subtotal: number;
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  grandTotal: number;
  cashier: string;
  status: 'Completed' | 'Voided';
  updatedAt: string;
}

export type WarrantyCoverageType =
  | 'OEM Replacement'
  | 'ATCL Standard 24M'
  | 'Extended SLA'
  | 'Out-of-Warranty';

export type WarrantyClaimStatus =
  | 'Logged'
  | 'Under Inspection'
  | 'OEM Approved'
  | 'Replaced / Resolved'
  | 'Rejected';

export interface WarrantyClaimRecord {
  id: string;
  claimNo: string;
  claimDate: string;
  serialNumber: string;
  sku: string;
  productName: string;
  customerName: string;
  warrantyExpiry: string;
  coverageType: WarrantyCoverageType;
  issueSummary: string;
  claimCostBdt: number;
  oemRecoveryBdt: number;
  expenseGlCode: string;
  status: WarrantyClaimStatus;
  resolutionNotes: string;
  updatedAt: string;
}

export type ServiceJobType =
  | 'Bench Repair'
  | 'Field Commissioning'
  | 'Preventive Calibration'
  | 'Emergency Breakdown';

export type ServiceJobStatus =
  | 'Intake'
  | 'Diagnostics'
  | 'Awaiting Parts'
  | 'In Repair'
  | 'QA Bench'
  | 'Completed & Handed Over';

export interface ServiceJobCard {
  id: string;
  jobNo: string;
  intakeDate: string;
  promisedDate: string;
  customerName: string;
  equipmentName: string;
  serialNumber: string;
  serviceType: ServiceJobType;
  technician: string;
  priority: 'Normal' | 'High' | 'Critical';
  partsCostBdt: number;
  laborCostBdt: number;
  totalCostBdt: number;
  billableAmountBdt: number;
  expenseGlCode: string;
  status: ServiceJobStatus;
  billedInvoiceNo?: string;
  billedToGl?: boolean;
  partsConsumed?: Array<{
    partId: string;
    partCode: string;
    name: string;
    qty: number;
    unitCost: number;
  }>;
  notes: string;
  updatedAt: string;
}

export type SparePartCategory =
  | 'Switchgear & Relays'
  | 'PLC & Modules'
  | 'UPS & Power'
  | 'Fiber & Connectors'
  | 'Calibration Tools';

export interface SparePartItem {
  id: string;
  partCode: string;
  name: string;
  category: SparePartCategory;
  compatibleSystem: string;
  binLocation: string;
  unit: string;
  stockQty: number;
  minStockLevel: number;
  unitCost: number;
  sellingPrice: number;
  glCode: string;
  status: AccountStatus;
  updatedAt: string;
}

export type VoucherKind = 'Payment' | 'Receipt' | 'Journal' | 'Expense';

export type VoucherRecordStatus = 'Auto-Approved' | 'Posted to GL' | 'Voided';

export interface VoucherAttachment {
  id: string;
  name: string;
  sizeLabel: string;
  uploadedAt: string;
}

export interface VoucherSourceDocLink {
  docType: 'PO' | 'LC' | 'SO' | 'JOB' | 'WRN';
  docId: string;
  docRef: string;
  label: string;
  amount: number;
}

export interface VoucherDoubleEntryLine {
  glCode: string;
  glName: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface ExpenseSplitItem {
  glCode: string;
  glName: string;
  memo: string;
  amount: number;
}

export interface VoucherRecord {
  id: string;
  voucherType: VoucherKind;
  voucherRef: string;
  voucherDate: string;
  postingDate: string;
  status: VoucherRecordStatus;
  totalAmount: number;
  narration: string;
  // Payment Voucher fields
  supplierId?: string;
  supplierName?: string;
  baseAmount?: number;
  tdsRate?: number;
  tdsAmount?: number;
  vdsRate?: number;
  vdsAmount?: number;
  netPayableAmount?: number;
  paymentMode?: string;
  paidFromGlCode?: string;
  bankReferenceNo?: string;
  // Receipt Voucher fields
  customerId?: string;
  customerName?: string;
  collectionAmount?: number;
  receiptMode?: string;
  depositToGlCode?: string;
  salesInvoiceAllocations?: SalesInvoiceAllocation[];
  isCustomerAdvance?: boolean;
  customerWithholding?: {
    tdsRate: number;
    tdsAmount: number;
    vdsRate: number;
    vdsAmount: number;
    certificateRef?: string;
  };
  // Journal Voucher fields
  postingType?: string;
  autoReverseDate?: string;
  // Expense Voucher fields
  allocationMode?: 'Simple Cost' | 'Split Multi-Item';
  employeeName?: string;
  expenseSplits?: ExpenseSplitItem[];
  department?: string;
  costCenter?: string;
  linkedProject?: string;
  // Shared Governance & GL Integration
  linkedSourceDocs: VoucherSourceDocLink[];
  invoiceAllocations?: InvoiceAllocation[];
  attachments: VoucherAttachment[];
  doubleEntryLines: VoucherDoubleEntryLine[];
  postedToGl: boolean;
  postedVoucherNo?: string;
  reversalOfVoucherId?: string;
  reversedByVoucherId?: string;
  createdBy: string;
  updatedAt: string;
}

export interface InvoiceAllocation {
  invoiceId: string;
  invoiceNo: string;
  allocatedAmount: number;
}

export interface SalesInvoiceAllocation {
  invoiceId: string;
  invoiceNo: string;
  allocatedAmount: number;
}

export interface SalesInvoiceLineItem {
  id: string;
  sku?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  vatRate: number;
  lineNet: number;
  lineVat: number;
  lineGross: number;
}

export type SalesInvoiceStatus =
  | 'Draft'
  | 'Posted'
  | 'Partially Paid'
  | 'Paid'
  | 'Voided';

export interface SalesInvoiceRecord {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  customerId: string;
  customerName: string;
  salesOrderId?: string;
  salesOrderNo?: string;
  deliveryOrderNo?: string;
  projectCode?: string;
  lines: SalesInvoiceLineItem[];
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  paidAmount: number;
  tdsDeductedAmount: number;
  vdsDeductedAmount: number;
  creditNoteAmount: number;
  outstandingAmount: number;
  cogsAmount: number;
  revenueGlCode: string;
  arGlCode: string;
  vatGlCode: string;
  mushak63Ref?: string;
  status: SalesInvoiceStatus;
  postedToGl: boolean;
  postedVoucherNo?: string;
  notes: string;
  updatedAt: string;
}

export interface SalesCreditNoteRecord {
  id: string;
  creditNoteNo: string;
  returnDate: string;
  salesInvoiceId: string;
  salesInvoiceNo: string;
  customerId: string;
  customerName: string;
  returnedSerial?: string;
  disposition: 'Restock' | 'Damaged';
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  cogsReversalAmount: number;
  reason: string;
  postedToGl: boolean;
  postedVoucherNo?: string;
  updatedAt: string;
}

export interface AmcContractRecord {
  id: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  annualValue: number;
  recognizedAmount: number;
  deferredAmount: number;
  deferredGlCode: string;
  revenueGlCode: string;
  status: 'Active' | 'Expired' | 'Renewed';
  updatedAt: string;
}

export interface CustomerAdvanceRecord {
  id: string;
  advanceNo: string;
  receiptDate: string;
  customerId: string;
  customerName: string;
  amount: number;
  appliedAmount: number;
  unappliedAmount: number;
  depositToGlCode: string;
  advanceGlCode: string;
  postedVoucherNo: string;
  status: 'Open' | 'Partially Applied' | 'Applied';
  updatedAt: string;
}

export type GoodsReceiptStatus = 'Received' | 'QC Hold' | 'Accepted' | 'Rejected';

export interface GoodsReceiptRecord {
  id: string;
  grnNumber: string;
  grnDate: string;
  sourceType: 'PO' | 'LC';
  sourceId: string;
  sourceRef: string;
  supplierId: string;
  supplierName: string;
  warehouse: string;
  inventoryGlCode: string;
  grniGlCode: string;
  totalAmount: number;
  status: GoodsReceiptStatus;
  postedToGl: boolean;
  postedVoucherNo?: string;
  notes: string;
  updatedAt: string;
}

export type PurchaseInvoiceStatus =
  | 'Draft'
  | 'Posted'
  | 'Partially Paid'
  | 'Paid'
  | 'Voided';

export interface PurchaseInvoiceRecord {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  supplierId: string;
  supplierName: string;
  sourceType: 'PO' | 'LC' | 'Direct';
  sourceId?: string;
  sourceRef?: string;
  grnId?: string;
  grnNumber?: string;
  debitGlCode: string;
  apGlCode: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  mushak63Ref?: string;
  status: PurchaseInvoiceStatus;
  postedToGl: boolean;
  postedVoucherNo?: string;
  notes: string;
  updatedAt: string;
}

export type TemplateCategory =
  | 'Voucher'
  | 'Financial Report'
  | 'Commercial & LC'
  | 'Custom Page';

export type TemplateMode = 'structured' | 'html';

export type TemplateDataSource =
  | 'financialSummary'
  | 'voucher'
  | 'salesOrder'
  | 'importLC'
  | 'custom';

export type TemplateStatus = 'Published' | 'Draft';

export type TemplatePaperSize = 'A4' | 'Responsive';

export interface TemplateKpiSlot {
  label: string;
  token: string;
}

export interface TemplateSectionConfig {
  headerTitle: string;
  headerSubtitle: string;
  referenceLabel: string;
  showMetadataStrip: boolean;
  showKpiStrip: boolean;
  showLineItemsTable: boolean;
  showSignatoryBlock: boolean;
  kpiSlots: TemplateKpiSlot[];
  signatories: string[];
  footerNote: string;
}

export interface DocumentTemplateRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  category: TemplateCategory;
  mode: TemplateMode;
  dataSource: TemplateDataSource;
  paperSize: TemplatePaperSize;
  accentColor: string;
  status: TemplateStatus;
  isDefault: boolean;
  sourceOrigin?: string;
  sections: TemplateSectionConfig;
  htmlContent: string;
  cssContent: string;
  updatedAt: string;
}

export interface LedgerState {
  datasetVersion?: string;
  config: SystemConfig;
  accounts: GLAccount[];
  journalLines: JournalLine[];
  postedTransactions: PostedTransaction[];
  registers: Record<string, AccountRegisterBook>;
  auditLogs: AuditLogEntry[];
  products: ProductItem[];
  customers: CustomerRecord[];
  suppliers: SupplierRecord[];
  localPurchaseOrders: LocalPurchaseOrder[];
  importLCs: ImportLCFile[];
  inventorySerials: InventorySerialUnit[];
  salesOrders: SalesOrderRecord[];
  posTransactions: PosTransaction[];
  warrantyClaims: WarrantyClaimRecord[];
  serviceJobs: ServiceJobCard[];
  spareParts: SparePartItem[];
  vouchers: VoucherRecord[];
  templates: DocumentTemplateRecord[];
  goodsReceipts?: GoodsReceiptRecord[];
  purchaseInvoices?: PurchaseInvoiceRecord[];
  purchaseRequisitions?: PurchaseRequisitionRecord[];
  supplierQuotations?: SupplierQuotationRecord[];
  purchaseReturns?: PurchaseReturnRecord[];
  taxRemittances?: TaxRemittanceRecord[];
  salesInvoices?: SalesInvoiceRecord[];
  customerAdvances?: CustomerAdvanceRecord[];
  salesQuotations?: SalesQuotationRecord[];
  deliveryOrders?: DeliveryOrderRecord[];
  salesCreditNotes?: SalesCreditNoteRecord[];
  amcContracts?: AmcContractRecord[];
  inventoryMovements?: InventoryMovementRecord[];
  postedIdempotencyKeys?: string[];
  approvalRequests?: ApprovalRequestRecord[];
  cheques?: ChequeRecord[];
  bankStatements?: BankReconciliationEntry[];
  fundTransfers?: FundTransferRecord[];
  taxRules?: TaxWithholdingRule[];
  tenderProjects?: TenderProjectRecord[];
  fixedAssets?: FixedAssetRecord[];
  departmentBudgets?: DepartmentBudgetRecord[];
}

export interface FixedAssetRecord {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  acquisitionDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  assetGlCode: string;
  accumDeprGlCode: string;
  deprExpenseGlCode: string;
  lastDeprMonth?: string;
  custodian?: string;
  location: string;
  status: 'Active' | 'Disposed';
  updatedAt: string;
}

export interface DepartmentBudgetRecord {
  id: string;
  fiscalPeriod: string;
  department: string;
  glCode: string;
  glName: string;
  annualBudget: number;
  notes: string;
  updatedAt: string;
}

export interface TenderProjectRecord {
  id: string;
  projectCode: string;
  tenderRef: string;
  title: string;
  customerId: string;
  customerName: string;
  contractValue: number;
  budgetedCost: number;
  retentionPct: number;
  retentionHeld: number;
  retentionReleased: number;
  billedAmount: number;
  collectedAmount: number;
  bgSecurityAmount: number;
  bgBankName?: string;
  bgExpiryDate?: string;
  startDate: string;
  completionDate: string;
  status: 'Bidding' | 'Awarded' | 'In Execution' | 'Defect Liability' | 'Completed' | 'Lost';
  linkedSoIds: string[];
  notes: string;
  updatedAt: string;
}

export interface ChequeRecord {
  id: string;
  chequeNo: string;
  direction: 'Issued' | 'Received';
  bankGlCode: string;
  bankName: string;
  partyName: string;
  issueDate: string;
  chequeDate: string;
  amount: number;
  voucherRef?: string;
  status: 'Issued' | 'Deposited' | 'Cleared' | 'Bounced' | 'Cancelled';
  clearedDate?: string;
  notes: string;
  updatedAt: string;
}

export interface BankReconciliationEntry {
  id: string;
  bankGlCode: string;
  statementDate: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  matchedTxnId?: string;
  reconciled: boolean;
  reconciledAt?: string;
}

export interface FundTransferRecord {
  id: string;
  transferNo: string;
  transferDate: string;
  fromGlCode: string;
  toGlCode: string;
  amount: number;
  bankChargeAmount: number;
  channel: 'BEFTN' | 'RTGS' | 'NPSB' | 'Cash Deposit' | 'Cash Withdrawal' | 'LC Margin';
  reference: string;
  postedVoucherNo: string;
  notes: string;
  updatedAt: string;
}

export type ApprovalRequestType =
  | 'PO'
  | 'VOUCHER'
  | 'PAYMENT'
  | 'CREDIT_OVERRIDE'
  | 'STOCK_ADJUSTMENT'
  | 'DISCOUNT'
  | 'JOURNAL';

export interface ApprovalRequestRecord {
  id: string;
  requestNo: string;
  requestType: ApprovalRequestType;
  module: string;
  referenceId: string;
  referenceNo: string;
  summary: string;
  amount: number;
  requestedBy: string;
  requestedAt: string;
  requiredRole: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  payloadSnapshot?: Record<string, unknown>;
}

export interface InventoryMovementRecord {
  id: string;
  movementDate: string;
  sku: string;
  productName: string;
  movementType:
    | 'Opening'
    | 'GRN'
    | 'LC Release'
    | 'Sales Dispatch'
    | 'POS Sale'
    | 'POS Void'
    | 'Purchase Return'
    | 'Sales Return'
    | 'Service Issue'
    | 'Warranty Replacement'
    | 'Adjustment';
  qtyDelta: number;
  qtyBefore?: number;
  qtyAfter?: number;
  unitCost: number;
  valuationBdt?: number;
  warehouse: string;
  sourceRef: string;
  referenceId?: string;
  createdBy: string;
}

export interface TaxWithholdingRule {
  id: string;
  category: string;
  vatRate?: number;
  tdsRate: number;
  vdsRate: number;
  effectiveFrom: string;
  nbrSectionRef: string;
  description?: string;
  active: boolean;
}

export interface TaxRemittanceRecord {
  id: string;
  challanNo: string;
  remittanceDate: string;
  taxType: 'TDS' | 'VDS';
  glCode: '2200' | '2210';
  paidFromGlCode: string;
  amount: number;
  mushak66Ref?: string;
  postedToGl: boolean;
  postedVoucherNo?: string;
  notes: string;
  updatedAt: string;
}

export type PurchaseRequisitionStatus = 'Draft' | 'Submitted' | 'Approved' | 'Converted to PO' | 'Rejected';

export interface PurchaseRequisitionLine {
  id: string;
  productId?: string;
  description: string;
  qty: number;
  unit: string;
  estimatedUnitCost: number;
}

export interface PurchaseRequisitionRecord {
  id: string;
  prNumber: string;
  prDate: string;
  requiredByDate: string;
  department: string;
  requestedBy: string;
  priority: 'Standard' | 'Urgent' | 'Critical';
  lines: PurchaseRequisitionLine[];
  estimatedTotal: number;
  status: PurchaseRequisitionStatus;
  linkedPoNumber?: string;
  justification: string;
  updatedAt: string;
}

export type SupplierQuotationStatus = 'Draft' | 'Received' | 'Awarded' | 'Declined';

export interface SupplierQuotationRecord {
  id: string;
  rfqNumber: string;
  prNumber?: string;
  quoteDate: string;
  validUntil: string;
  supplierId: string;
  supplierName: string;
  itemSummary: string;
  quotedNetAmount: number;
  vatRate: number;
  leadTimeDays: number;
  paymentTerms: string;
  status: SupplierQuotationStatus;
  linkedPoNumber?: string;
  notes: string;
  updatedAt: string;
}

export interface PurchaseReturnRecord {
  id: string;
  returnNumber: string;
  returnDate: string;
  supplierId: string;
  supplierName: string;
  grnNumber?: string;
  poNumber?: string;
  reason: string;
  returnAmount: number;
  inventoryGlCode: string;
  offsetGlCode: string;
  postedToGl: boolean;
  postedVoucherNo?: string;
  updatedAt: string;
}

export interface COAValidationResult {
  isValid: boolean;
  totalAccounts: number;
  errors: string[];
}

export interface JournalValidationResult {
  totalVouchers: number;
  validVouchers: number;
  invalidVouchers: number;
}

export interface RegisterDiscrepancy {
  code: string;
  name: string;
  expected: number;
  actual: number;
  diff: number;
  expectedCount: number;
  actualCount: number;
  fileId: string | null;
  error?: string;
}

export interface ReconciliationResult {
  totalChecked: number;
  reconciledCount: number;
  discrepancies: RegisterDiscrepancy[];
  checkedAt: string;
}

export interface GLSummaryRow {
  code: string;
  name: string;
  category: AccountCategory;
  group: string;
  accountType: string;
  normalBalance: NormalBalance;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  priorYearDebit: number;
  priorYearCredit: number;
  registerFileId: string | null;
  status: AccountStatus;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  category: AccountCategory;
  accountType: string;
  openingDr: number;
  openingCr: number;
  periodDr: number;
  periodCr: number;
  closingDr: number;
  closingCr: number;
  priorDr: number;
  priorCr: number;
}

export interface TrialBalanceReport {
  rows: TrialBalanceRow[];
  totals: {
    openingDr: number;
    openingCr: number;
    periodDr: number;
    periodCr: number;
    closingDr: number;
    closingCr: number;
    priorDr: number;
    priorCr: number;
  };
  openingDiff: number;
  closingDiff: number;
  priorDiff: number;
  isOpeningBalanced: boolean;
  isClosingBalanced: boolean;
}

export interface IncomeStatementGroup {
  group: string;
  accounts: { code: string; name: string; amount: number; priorAmount: number }[];
  subtotal: number;
  priorSubtotal: number;
}

export interface IncomeStatementReport {
  incomeGroups: IncomeStatementGroup[];
  directCostGroups: IncomeStatementGroup[];
  operatingExpenseGroups: IncomeStatementGroup[];
  financialExpenseGroups: IncomeStatementGroup[];
  taxExpenseGroups: IncomeStatementGroup[];
  totalIncome: number;
  totalDirectCosts: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  operatingProfit: number;
  totalFinancialExpenses: number;
  profitBeforeTax: number;
  totalTaxExpenses: number;
  netProfit: number;
  grossMarginPct: number;
  netMarginPct: number;
  priorYear: {
    totalIncome: number;
    totalDirectCosts: number;
    grossProfit: number;
    totalOperatingExpenses: number;
    operatingProfit: number;
    totalFinancialExpenses: number;
    profitBeforeTax: number;
    totalTaxExpenses: number;
    netProfit: number;
  };
}

export interface BalanceSheetLineItem {
  code: string;
  name: string;
  amount: number;
  priorAmount: number;
  isContra?: boolean;
}

export interface BalanceSheetReport {
  nonCurrentAssets: BalanceSheetLineItem[];
  currentAssets: BalanceSheetLineItem[];
  totalNonCurrentAssets: number;
  totalCurrentAssets: number;
  totalAssets: number;
  equityItems: BalanceSheetLineItem[];
  currentPeriodNetProfit: number;
  totalEquity: number;
  nonCurrentLiabilities: BalanceSheetLineItem[];
  currentLiabilities: BalanceSheetLineItem[];
  totalNonCurrentLiabilities: number;
  totalCurrentLiabilities: number;
  totalLiabilities: number;
  totalEquityAndLiabilities: number;
  variance: number;
  isBalanced: boolean;
  priorYear: {
    totalNonCurrentAssets: number;
    totalCurrentAssets: number;
    totalAssets: number;
    currentPeriodNetProfit: number;
    totalEquity: number;
    totalNonCurrentLiabilities: number;
    totalCurrentLiabilities: number;
    totalLiabilities: number;
    totalEquityAndLiabilities: number;
  };
}

export interface MonthlyMatrixRow {
  code: string;
  name: string;
  category: AccountCategory;
  months: Record<string, { debit: number; credit: number; net: number }>;
  totalDebit: number;
  totalCredit: number;
  totalNet: number;
}

export interface MonthlySummaryReport {
  monthKeys: string[];
  monthLabels: string[];
  rows: MonthlyMatrixRow[];
  monthlyTotals: Record<string, { debit: number; credit: number }>;
}

export interface FinancialRatiosSnapshot {
  currentAssets: number;
  inventories: number;
  prepaymentsAndAdvances: number;
  cashAndEquivalents: number;
  tradeReceivables: number;
  quickAssets: number;
  currentLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netWorkingCapital: number;
  revenue: number;
  grossProfit: number;
  operatingProfit: number;
  profitBeforeTax: number;
  taxExpense: number;
  netProfit: number;
  currentRatio: number;
  quickRatio: number;
  cashRatio: number;
  debtToEquity: number;
  debtToAssetsPct: number;
  grossMarginPct: number;
  operatingMarginPct: number;
  preTaxMarginPct: number;
  netProfitMarginPct: number;
  effectiveTaxRatePct: number;
  returnOnEquityPct: number;
  returnOnAssetsPct: number;
}

export interface FinancialRatiosReport {
  current: FinancialRatiosSnapshot;
  prior: FinancialRatiosSnapshot;
}

export interface CashFlowLineItem {
  code?: string;
  label: string;
  amount: number;
  note?: string;
}

export interface CashFlowStatementReport {
  netProfit: number;
  operatingItems: CashFlowLineItem[];
  netOperatingCash: number;
  investingItems: CashFlowLineItem[];
  netInvestingCash: number;
  financingItems: CashFlowLineItem[];
  netFinancingCash: number;
  netCashChange: number;
  openingCashBalance: number;
  closingCashBalance: number;
  computedClosingCash: number;
  variance: number;
  isReconciled: boolean;
  cashAccounts: Array<{
    code: string;
    name: string;
    opening: number;
    closing: number;
    netChange: number;
  }>;
}

export interface EquityChangeRow {
  code: string;
  name: string;
  openingBalance: number;
  additions: number;
  deductions: number;
  netProfitShare: number;
  closingBalance: number;
}

export interface EquityChangesReport {
  rows: EquityChangeRow[];
  totalOpening: number;
  totalAdditions: number;
  totalDeductions: number;
  totalNetProfit: number;
  totalClosing: number;
  balanceSheetEquity: number;
  isReconciled: boolean;
}

export type ActiveRoute =
  | 'dashboard'
  | 'master-products'
  | 'master-customers'
  | 'master-suppliers'
  | 'master-audit'
  | 'sc-purchase-requisition'
  | 'sc-supplier-quotation'
  | 'sc-local-procurement'
  | 'sc-goods-receipt'
  | 'sc-purchase-invoice'
  | 'sc-accounts-payable'
  | 'sc-purchase-returns'
  | 'sc-import-lc'
  | 'sc-landed-cost'
  | 'sc-inventory-serial'
  | 'sc-procurement-reports'
  | 'ss-sales-quotations'
  | 'ss-sales-distribution'
  | 'ss-delivery-orders'
  | 'ss-sales-invoices'
  | 'ss-sales-returns'
  | 'ss-sales-reports'
  | 'ss-retail-pos'
  | 'ss-warranty'
  | 'ss-service-workshop'
  | 'ss-spare-parts'
  | 'ss-tender-projects'
  | 'vm-payment'
  | 'vm-receipt'
  | 'vm-journal'
  | 'vm-expense'
  | 'coa'
  | 'registers'
  | 'journal'
  | 'posted-store'
  | 'fin-bank-treasury'
  | 'fin-tax-compliance'
  | 'fin-fixed-assets'
  | 'fin-month-end'
  | 'reports-summary'
  | 'reports-trial-balance'
  | 'reports-income'
  | 'reports-balance-sheet'
  | 'reports-cash-flow'
  | 'reports-equity-changes'
  | 'reports-monthly'
  | 'audit'
  | 'audit-log'
  | 'gov-approvals'
  | 'templates'
  | 'workspace'
  | 'config';

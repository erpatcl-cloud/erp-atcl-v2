import type { ActiveRoute } from '../types/accounting.ts';

export type ConfigTabId =
  | 'company'
  | 'vouchers'
  | 'fiscal'
  | 'roles'
  | 'custom-instructions'
  | 'document-store'
  | 'backup'
  | 'integrations';

export const VALID_CONFIG_TABS: readonly ConfigTabId[] = [
  'company',
  'vouchers',
  'fiscal',
  'roles',
  'custom-instructions',
  'document-store',
  'backup',
  'integrations',
] as const;

export interface RouteDefinition {
  route: ActiveRoute;
  path: string;
  aliases?: string[];
  title: string;
}

export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  {
    route: 'dashboard',
    path: '/dashboard',
    aliases: ['/', '/overview'],
    title: 'Control Dashboard',
  },
  {
    route: 'master-products',
    path: '/products',
    aliases: ['/master-products', '/master-data/products'],
    title: 'Products & Items',
  },
  {
    route: 'master-customers',
    path: '/customers',
    aliases: ['/master-customers', '/master-data/customers'],
    title: 'Customers 360°',
  },
  {
    route: 'master-suppliers',
    path: '/suppliers',
    aliases: ['/master-suppliers', '/master-data/suppliers'],
    title: 'Suppliers',
  },
  {
    route: 'master-audit',
    path: '/master-audit',
    aliases: ['/master-data/audit', '/master-reports'],
    title: 'Master Data Audit & Reports',
  },
  {
    route: 'sc-purchase-requisition',
    path: '/purchase-requisition',
    aliases: ['/sc-purchase-requisition', '/pr'],
    title: 'Purchase Requisitions (PR)',
  },
  {
    route: 'sc-supplier-quotation',
    path: '/supplier-quotation',
    aliases: ['/sc-supplier-quotation', '/rfq'],
    title: 'RFQ & Quotations',
  },
  {
    route: 'sc-local-procurement',
    path: '/local-procurement',
    aliases: ['/sc-local-procurement', '/supply-chain/local-procurement', '/procurement'],
    title: 'Local Procurement',
  },
  {
    route: 'sc-goods-receipt',
    path: '/goods-receipt',
    aliases: ['/sc-goods-receipt', '/grn'],
    title: 'Goods Receipt (GRN)',
  },
  {
    route: 'sc-purchase-invoice',
    path: '/purchase-invoice',
    aliases: ['/sc-purchase-invoice', '/ap-invoices'],
    title: 'Purchase Invoices (3-Way Match)',
  },
  {
    route: 'sc-accounts-payable',
    path: '/accounts-payable',
    aliases: ['/sc-accounts-payable', '/ap-aging'],
    title: 'Accounts Payable & Aging',
  },
  {
    route: 'sc-purchase-returns',
    path: '/purchase-returns',
    aliases: ['/sc-purchase-returns', '/rtv'],
    title: 'Purchase Returns (RTV)',
  },
  {
    route: 'sc-import-lc',
    path: '/import-lc',
    aliases: ['/sc-import-lc', '/supply-chain/import-lc'],
    title: 'Import & LC Management',
  },
  {
    route: 'sc-landed-cost',
    path: '/landed-cost',
    aliases: ['/sc-landed-cost', '/import-costing'],
    title: 'Landed Cost Allocation',
  },
  {
    route: 'sc-inventory-serial',
    path: '/inventory-serial',
    aliases: ['/sc-inventory-serial', '/supply-chain/inventory-serial', '/inventory'],
    title: 'Inventory & Serial Register',
  },
  {
    route: 'sc-procurement-reports',
    path: '/procurement-reports',
    aliases: ['/sc-procurement-reports', '/p2p-reports'],
    title: 'Procurement & Tax Reports',
  },
  {
    route: 'ss-sales-quotations',
    path: '/sales-quotations',
    aliases: ['/ss-sales-quotations', '/quotations'],
    title: 'Sales Quotations',
  },
  {
    route: 'ss-sales-distribution',
    path: '/sales-distribution',
    aliases: ['/ss-sales-distribution', '/sales'],
    title: 'Sales & Distribution',
  },
  {
    route: 'ss-delivery-orders',
    path: '/delivery-orders',
    aliases: ['/ss-delivery-orders', '/challans'],
    title: 'Delivery Orders & Challans',
  },
  {
    route: 'ss-sales-invoices',
    path: '/sales-invoices',
    aliases: ['/ss-sales-invoices', '/ar-invoices'],
    title: 'Sales Invoices (AR 1120)',
  },
  {
    route: 'ss-sales-returns',
    path: '/sales-returns',
    aliases: ['/ss-sales-returns', '/credit-notes'],
    title: 'Sales Returns & Credit Notes',
  },
  {
    route: 'ss-sales-reports',
    path: '/sales-reports',
    aliases: ['/ss-sales-reports', '/o2c-reports'],
    title: 'Sales, AR Aging & AMC Reports',
  },
  {
    route: 'ss-retail-pos',
    path: '/retail-pos',
    aliases: ['/ss-retail-pos', '/pos'],
    title: 'Retail Counter POS',
  },
  {
    route: 'ss-warranty',
    path: '/warranty',
    aliases: ['/ss-warranty'],
    title: 'Warranty Management',
  },
  {
    route: 'ss-service-workshop',
    path: '/service-workshop',
    aliases: ['/ss-service-workshop', '/workshop'],
    title: 'Service & Repair Workshop',
  },
  {
    route: 'ss-spare-parts',
    path: '/spare-parts',
    aliases: ['/ss-spare-parts'],
    title: 'Spare Parts Inventory',
  },
  {
    route: 'ss-tender-projects',
    path: '/tender-projects',
    aliases: ['/tenders', '/projects'],
    title: 'Tender & Turnkey Project Management',
  },
  {
    route: 'vm-payment',
    path: '/vouchers/payment',
    aliases: ['/vm-payment', '/payment-voucher'],
    title: 'Payment Voucher',
  },
  {
    route: 'vm-receipt',
    path: '/vouchers/receipt',
    aliases: ['/vm-receipt', '/receipt-voucher'],
    title: 'Receipt Voucher',
  },
  {
    route: 'vm-journal',
    path: '/vouchers/journal',
    aliases: ['/vm-journal', '/journal-voucher'],
    title: 'Journal Voucher',
  },
  {
    route: 'vm-expense',
    path: '/vouchers/expense',
    aliases: ['/vm-expense', '/expense-voucher'],
    title: 'Expense Voucher',
  },
  {
    route: 'coa',
    path: '/chart-of-accounts',
    aliases: ['/coa'],
    title: 'Chart of Accounts',
  },
  {
    route: 'registers',
    path: '/registers',
    aliases: ['/account-registers', '/gl-registers'],
    title: 'GL Account Register Books',
  },
  {
    route: 'journal',
    path: '/master-journal',
    aliases: ['/journal'],
    title: 'Master Journal Entry',
  },
  {
    route: 'posted-store',
    path: '/posted-store',
    aliases: ['/posted'],
    title: 'Posted Journal Store',
  },
  {
    route: 'fin-bank-treasury',
    path: '/bank-treasury',
    aliases: ['/treasury', '/bank-reconciliation'],
    title: 'Bank, Cash & Treasury Management',
  },
  {
    route: 'fin-tax-compliance',
    path: '/tax-compliance',
    aliases: ['/tax', '/mushak', '/vat-tds'],
    title: 'Bangladesh Tax & Mushak Compliance',
  },
  {
    route: 'fin-fixed-assets',
    path: '/fixed-assets',
    aliases: ['/assets', '/ppe'],
    title: 'Fixed Assets & Depreciation Register',
  },
  {
    route: 'fin-month-end',
    path: '/month-end-closing',
    aliases: ['/closing', '/budgets'],
    title: 'Month-End Closing & Department Budgets',
  },
  {
    route: 'reports-summary',
    path: '/reports/summary',
    aliases: ['/reports-summary', '/gl-summary', '/reports'],
    title: 'GL Summary Dashboard',
  },
  {
    route: 'reports-trial-balance',
    path: '/reports/trial-balance',
    aliases: ['/reports-trial-balance', '/trial-balance'],
    title: 'Trial Balance',
  },
  {
    route: 'reports-income',
    path: '/reports/income-statement',
    aliases: ['/reports-income', '/income-statement', '/pnl'],
    title: 'Income Statement (P&L)',
  },
  {
    route: 'reports-balance-sheet',
    path: '/reports/balance-sheet',
    aliases: ['/reports-balance-sheet', '/balance-sheet'],
    title: 'Balance Sheet',
  },
  {
    route: 'reports-cash-flow',
    path: '/reports/cash-flow',
    aliases: ['/reports-cash-flow', '/cash-flow'],
    title: 'Cash Flow Statement',
  },
  {
    route: 'reports-equity-changes',
    path: '/reports/equity-changes',
    aliases: ['/reports-equity-changes', '/equity-changes', '/changes-in-equity'],
    title: 'Statement of Changes in Equity',
  },
  {
    route: 'reports-monthly',
    path: '/reports/monthly-matrix',
    aliases: ['/reports-monthly', '/monthly-matrix'],
    title: 'Monthly Summary Matrix',
  },
  {
    route: 'audit',
    path: '/audit/reconciliation',
    aliases: ['/audit', '/reconciliation'],
    title: 'Audit & Reconciliation',
  },
  {
    route: 'audit-log',
    path: '/audit/log',
    aliases: ['/audit-log'],
    title: 'System Audit Log',
  },
  {
    route: 'gov-approvals',
    path: '/approvals',
    aliases: ['/audit/approvals', '/approvals-queue'],
    title: 'Approval Workflow & Queue',
  },
  {
    route: 'templates',
    path: '/templates',
    aliases: ['/template', '/template-studio'],
    title: 'Template Studio',
  },
  {
    route: 'workspace',
    path: '/workspace',
    aliases: ['/google-workspace', '/cloud-sync'],
    title: 'Workspace & Cloud Sync',
  },
  {
    route: 'config',
    path: '/system-config',
    aliases: ['/config', '/settings'],
    title: 'System Configuration',
  },
];

const ROUTE_BY_ID = new Map<ActiveRoute, RouteDefinition>(
  ROUTE_DEFINITIONS.map((def) => [def.route, def])
);

const PATH_TO_ROUTE = new Map<string, ActiveRoute>();
for (const def of ROUTE_DEFINITIONS) {
  PATH_TO_ROUTE.set(def.path, def.route);
  if (def.aliases) {
    for (const alias of def.aliases) {
      PATH_TO_ROUTE.set(alias, def.route);
    }
  }
}

export interface ParsedLocation {
  route: ActiveRoute;
  registerCode?: string;
  configTab?: ConfigTabId;
}

function normalizePathname(rawPathname: string): string {
  const trimmed = (rawPathname || '/').trim().toLowerCase();
  if (trimmed === '/' || trimmed === '') return '/';
  return trimmed.replace(/\/+$/, '');
}

export function parseLocationPath(rawPathname: string): ParsedLocation {
  const normalized = normalizePathname(rawPathname);

  // Dynamic GL Register Book route: /registers/:code
  const registerMatch = /^\/(?:registers|account-registers|gl-registers)\/([a-z0-9_-]+)$/i.exec(
    rawPathname.trim().replace(/\/+$/, '')
  );
  if (registerMatch) {
    return {
      route: 'registers',
      registerCode: decodeURIComponent(registerMatch[1]),
    };
  }

  // Dynamic System Config tab route: /system-config/:tab
  const configTabMatch = /^\/(?:system-config|config|settings)\/([a-z-]+)$/.exec(normalized);
  if (configTabMatch) {
    const candidate = configTabMatch[1] as ConfigTabId;
    if ((VALID_CONFIG_TABS as readonly string[]).includes(candidate)) {
      return {
        route: 'config',
        configTab: candidate,
      };
    }
    return { route: 'config', configTab: 'company' };
  }

  const exactRoute = PATH_TO_ROUTE.get(normalized);
  if (exactRoute) {
    return { route: exactRoute };
  }

  return { route: 'dashboard' };
}

export function getRoutePath(
  route: ActiveRoute,
  options?: { registerCode?: string; configTab?: ConfigTabId }
): string {
  if (route === 'registers' && options?.registerCode) {
    return `/registers/${encodeURIComponent(options.registerCode)}`;
  }
  if (route === 'config' && options?.configTab && options.configTab !== 'company') {
    return `/system-config/${options.configTab}`;
  }
  return ROUTE_BY_ID.get(route)?.path ?? '/dashboard';
}

export function getPageTitle(
  route: ActiveRoute,
  options?: { registerCode?: string }
): string {
  if (route === 'registers' && options?.registerCode) {
    return `GL ${options.registerCode} Register · ATCL ERP`;
  }
  const baseTitle = ROUTE_BY_ID.get(route)?.title;
  return baseTitle ? `${baseTitle} · ATCL ERP` : 'ATCL ERP';
}

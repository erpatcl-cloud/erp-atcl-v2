import React, { useState } from 'react';
import {
  BarChart3,
  Barcode,
  BookCheck,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cloud,
  Cog,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Landmark,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  Lock,
  Menu,
  MessageSquareText,
  Package,
  PenLine,
  Plus,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Ship,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Truck,
  Users,
  Wallet,
  Wrench,
  X,
  AlertCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { getRoutePath } from '../lib/routes.ts';
import type { ActiveRoute } from '../types/accounting.ts';
import { GoogleSignInButton, GoogleUserBadge } from './GoogleAuthControls.tsx';

interface LayoutProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  onOpenNewVoucher: () => void;
  onOpenCustomInstructions?: () => void;
  onOpenAssistant?: () => void;
  firebaseUser?: User | null;
  hasWorkspaceToken?: boolean;
  onGoogleSignIn?: () => void;
  onGoogleSignOut?: () => void;
  authBusy?: boolean;
  organizationName: string;
  fiscalPeriod: string;
  currencyCode: string;
  unpostedCount: number;
  pendingSyncCount: number;
  pendingApprovalCount?: number;
  syncStatus?: { mode: 'cloud' | 'local'; lastCloudSyncAt: string | null; lastSyncError: string | null };
  selectedRegisterCode: string | null;
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;
  onDismissToast: () => void;
  children: React.ReactNode;
}

interface NavItem {
  route: ActiveRoute;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface SidebarTooltipState {
  id: string;
  label: string;
  description: string;
  top: number;
  left: number;
}

const ROUTE_TITLES: Record<ActiveRoute, { section: string; title: string }> = {
  dashboard: { section: 'Overview', title: 'Control Dashboard' },
  'master-products': { section: 'Master Data', title: 'Products & Items' },
  'master-customers': { section: 'Master Data', title: 'Customers 360°' },
  'master-suppliers': { section: 'Master Data', title: 'Suppliers' },
  'master-audit': { section: 'Master Data', title: 'Master Data Audit & Reports' },
  'sc-purchase-requisition': { section: 'Supply Chain', title: 'Purchase Requisitions (PR)' },
  'sc-supplier-quotation': { section: 'Supply Chain', title: 'RFQ & Supplier Quotations' },
  'sc-local-procurement': { section: 'Supply Chain', title: 'Local Procurement' },
  'sc-goods-receipt': { section: 'Supply Chain', title: 'Goods Receipt (GRN)' },
  'sc-purchase-invoice': { section: 'Supply Chain', title: 'Purchase Invoices (3-Way Match)' },
  'sc-accounts-payable': { section: 'Supply Chain', title: 'Accounts Payable & Aging' },
  'sc-purchase-returns': { section: 'Supply Chain', title: 'Purchase Returns (RTV)' },
  'sc-import-lc': { section: 'Supply Chain', title: 'Import & LC Management' },
  'sc-landed-cost': { section: 'Supply Chain', title: 'Landed Cost Allocation' },
  'sc-inventory-serial': { section: 'Supply Chain', title: 'Inventory & Serial Register' },
  'sc-procurement-reports': { section: 'Supply Chain', title: 'Procurement & Tax Reports' },
  'ss-sales-quotations': { section: 'Sales & Service', title: 'Sales Quotations' },
  'ss-sales-distribution': { section: 'Sales & Service', title: 'Sales & Distribution' },
  'ss-delivery-orders': { section: 'Sales & Service', title: 'Delivery Orders & Challans' },
  'ss-sales-invoices': { section: 'Sales & Service', title: 'Sales Invoices (AR 1120)' },
  'ss-sales-returns': { section: 'Sales & Service', title: 'Sales Returns & Credit Notes' },
  'ss-sales-reports': { section: 'Sales & Service', title: 'Sales, AR Aging & AMC Reports' },
  'ss-retail-pos': { section: 'Sales & Service', title: 'Retail Counter POS' },
  'ss-warranty': { section: 'Sales & Service', title: 'Warranty Management' },
  'ss-service-workshop': { section: 'Sales & Service', title: 'Service & Repair Workshop' },
  'ss-spare-parts': { section: 'Sales & Service', title: 'Spare Parts Inventory' },
  'ss-tender-projects': { section: 'Sales & Service', title: 'Tender & Turnkey Project Management' },
  'vm-payment': { section: 'Voucher Management', title: 'Payment Voucher' },
  'vm-receipt': { section: 'Voucher Management', title: 'Receipt Voucher' },
  'vm-journal': { section: 'Voucher Management', title: 'Journal Voucher' },
  'vm-expense': { section: 'Voucher Management', title: 'Expense Voucher' },
  coa: { section: 'Ledgers', title: 'Chart of Accounts' },
  registers: { section: 'Ledgers', title: 'GL Account Register Books' },
  journal: { section: 'Ledgers', title: 'Master Journal Entry' },
  'posted-store': { section: 'Ledgers', title: 'Posted Journal Store' },
  'fin-bank-treasury': { section: 'Ledgers', title: 'Bank, Cash & Treasury Management' },
  'fin-tax-compliance': { section: 'Ledgers', title: 'Bangladesh Tax & Mushak Compliance' },
  'fin-fixed-assets': { section: 'Ledgers', title: 'Fixed Assets & Depreciation Register' },
  'fin-month-end': { section: 'Ledgers', title: 'Month-End Closing & Department Budgets' },
  'reports-summary': { section: 'Financial Statements', title: 'GL Summary Dashboard' },
  'reports-trial-balance': { section: 'Financial Statements', title: 'Trial Balance' },
  'reports-income': { section: 'Financial Statements', title: 'Income Statement (P&L)' },
  'reports-balance-sheet': { section: 'Financial Statements', title: 'Balance Sheet' },
  'reports-cash-flow': { section: 'Financial Statements', title: 'Cash Flow Statement' },
  'reports-equity-changes': { section: 'Financial Statements', title: 'Statement of Changes in Equity' },
  'reports-monthly': { section: 'Financial Statements', title: 'Monthly Summary Matrix' },
  audit: { section: 'Governance', title: 'Audit & Reconciliation' },
  'audit-log': { section: 'Governance', title: 'System Audit Log' },
  'gov-approvals': { section: 'Governance', title: 'Approval Workflow & Queue' },
  templates: { section: 'Governance', title: 'Template Studio' },
  workspace: { section: 'Governance', title: 'Workspace & Cloud Sync' },
  config: { section: 'Governance', title: 'System Configuration' },
};

export const Layout: React.FC<LayoutProps> = ({
  activeRoute,
  onNavigate,
  onOpenNewVoucher,
  onOpenCustomInstructions,
  onOpenAssistant,
  firebaseUser = null,
  hasWorkspaceToken = false,
  onGoogleSignIn,
  onGoogleSignOut,
  authBusy = false,
  organizationName,
  fiscalPeriod,
  currencyCode,
  unpostedCount,
  pendingSyncCount,
  pendingApprovalCount = 0,
  syncStatus,
  selectedRegisterCode,
  toast,
  onDismissToast,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Master Data': true,
    'Supply Chain': true,
    'Sales & Service': true,
    'Voucher Management': true,
    'General Ledger': true,
    'Financial Reports': true,
    'Audit & Governance': true,
  });
  const [hoveredTooltip, setHoveredTooltip] = useState<SidebarTooltipState | null>(null);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [label]: !(prev[label] ?? true),
    }));
  };

  const navGroups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        {
          route: 'dashboard',
          label: 'Control Dashboard',
          description: 'Executive KPIs, financial health ratios, cash position, and ledger status.',
          icon: LayoutDashboard,
        },
      ],
    },
    {
      label: 'Master Data',
      items: [
        {
          route: 'master-products',
          label: 'Products & Items',
          description: 'Manage SKU catalog, unit pricing, reorder thresholds, and stock valuation.',
          icon: Package,
        },
        {
          route: 'master-customers',
          label: 'Customers 360°',
          description: 'Track client profiles, credit limits, receivables aging, and sales history.',
          icon: Users,
        },
        {
          route: 'master-suppliers',
          label: 'Suppliers',
          description: 'Maintain vendor directory, payment terms, and accounts payable balances.',
          icon: Truck,
        },
        {
          route: 'master-audit',
          label: 'Master Data Audit',
          description: 'Reorder alerts, GL mapping checks, credit exposure & compliance reports.',
          icon: ShieldCheck,
        },
      ],
    },
    {
      label: 'Supply Chain',
      items: [
        {
          route: 'sc-purchase-requisition',
          label: 'Purchase Requisitions',
          description: 'Department purchase requests, budget justification, and approval.',
          icon: FileText,
        },
        {
          route: 'sc-supplier-quotation',
          label: 'RFQ & Quotations',
          description: 'Request and compare supplier quotations before issuing POs.',
          icon: Scale,
        },
        {
          route: 'sc-local-procurement',
          label: 'Local Procurement (PO)',
          description: 'Issue domestic purchase orders with line items, VAT & AIT.',
          icon: ClipboardList,
        },
        {
          route: 'sc-goods-receipt',
          label: 'Goods Receipt (GRN)',
          description: 'Record partial/full receipts, QC inspection, and Dr Inventory / Cr GRNI.',
          icon: Package,
        },
        {
          route: 'sc-purchase-invoice',
          label: 'Purchase Invoices',
          description: 'Three-way match (PO ↔ GRN ↔ Bill) and post to AP 2080.',
          icon: ReceiptText,
        },
        {
          route: 'sc-accounts-payable',
          label: 'Accounts Payable',
          description: 'Vendor outstanding balances, invoice aging, and payment settlements.',
          icon: Wallet,
        },
        {
          route: 'sc-purchase-returns',
          label: 'Purchase Returns (RTV)',
          description: 'Return rejected goods to vendors and reverse inventory / AP.',
          icon: ShieldAlert,
        },
        {
          route: 'sc-import-lc',
          label: 'Import & LC Management',
          description: 'Track Letters of Credit, customs duties, freight, and landed import costs.',
          icon: Ship,
        },
        {
          route: 'sc-landed-cost',
          label: 'Landed Cost Allocation',
          description: 'Allocate LC shipments, duties (5030), and FX to SKU unit costs (IAS 2).',
          icon: Landmark,
        },
        {
          route: 'sc-inventory-serial',
          label: 'Inventory & Serial Register',
          description: 'Monitor warehouse stock levels, batch movements, and unit serial numbers.',
          icon: Barcode,
        },
        {
          route: 'sc-procurement-reports',
          label: 'Procurement & Tax Reports',
          description: 'Open POs, GRNI/AP reconciliation, TDS/VDS challans & Mushak 6.3/6.6.',
          icon: BarChart3,
        },
      ],
    },
    {
      label: 'Sales & Service',
      items: [
        {
          route: 'ss-sales-quotations',
          label: 'Sales Quotations',
          description: 'Prepare B2B/tender quotations and convert accepted quotes into Sales Orders.',
          icon: FileText,
        },
        {
          route: 'ss-sales-distribution',
          label: 'Sales & Distribution',
          description: 'Process B2B orders, delivery challans, and wholesale customer invoicing.',
          icon: ShoppingBag,
        },
        {
          route: 'ss-delivery-orders',
          label: 'Delivery Orders / Challans',
          description: 'Partial deliveries, stock reservation & serialized unit dispatch.',
          icon: Truck,
        },
        {
          route: 'ss-sales-invoices',
          label: 'Sales Invoices (AR 1120)',
          description: 'Issue approved AR invoices, post Revenue/VAT/COGS, and apply advances.',
          icon: ReceiptText,
        },
        {
          route: 'ss-sales-returns',
          label: 'Sales Returns & Credit Notes',
          description: 'Process RMA returns, QC restock, and Credit Note GL reversals.',
          icon: ShieldAlert,
        },
        {
          route: 'ss-sales-reports',
          label: 'Sales, AR Aging & AMC',
          description: 'GL 1120 reconciliation, invoice aging, POS summary & AMC deferred revenue.',
          icon: BarChart3,
        },
        {
          route: 'ss-retail-pos',
          label: 'Retail Counter POS',
          description: 'Fast counter checkout, barcode billing, and instant cash or card settlement.',
          icon: Store,
        },
        {
          route: 'ss-warranty',
          label: 'Warranty Management',
          description: 'Register product warranties, validate serial coverage, and manage RMA claims.',
          icon: ShieldAlert,
        },
        {
          route: 'ss-service-workshop',
          label: 'Service & Repair Workshop',
          description: 'Track technician job cards, diagnostics, labor charges, and repair status.',
          icon: Wrench,
        },
        {
          route: 'ss-spare-parts',
          label: 'Spare Parts Inventory',
          description: 'Manage replacement components, workshop requisitions, and part consumption.',
          icon: Cog,
        },
        {
          route: 'ss-tender-projects',
          label: 'Tenders & Projects',
          description: 'Utility tender contracts, project P&L budgets, bank guarantees & Retention GL 1135.',
          icon: ClipboardList,
        },
      ],
    },
    {
      label: 'Voucher Management',
      items: [
        {
          route: 'vm-payment',
          label: 'Payment Voucher',
          description: 'Record vendor payouts with TDS/VDS deductions, liquidity checks, and bank refs.',
          icon: CreditCard,
        },
        {
          route: 'vm-receipt',
          label: 'Receipt Voucher',
          description: 'Log customer collections, link open invoices, and deposit into cash or bank.',
          icon: Wallet,
        },
        {
          route: 'vm-journal',
          label: 'Journal Voucher',
          description: 'Create balanced manual adjustment entries, accruals, and auto-reversing journals.',
          icon: BookCheck,
        },
        {
          route: 'vm-expense',
          label: 'Expense Voucher',
          description: 'Post departmental operating expenses with budget compliance and cost centers.',
          icon: ReceiptText,
        },
      ],
    },
    {
      label: 'General Ledger',
      items: [
        {
          route: 'coa',
          label: 'Chart of Accounts',
          description: 'Structured hierarchy of assets, liabilities, equity, revenue, and expense GL codes.',
          icon: ListChecks,
        },
        {
          route: 'registers',
          label: 'Account Registers',
          description: 'Inspect individual GL account ledgers, running balances, and line-item history.',
          icon: BookOpen,
        },
        {
          route: 'journal',
          label: 'Master Journal',
          description: 'Draft, validate double-entry balance, and post multi-line general journal vouchers.',
          icon: PenLine,
          count: unpostedCount > 0 ? unpostedCount : undefined,
        },
        {
          route: 'posted-store',
          label: 'Posted Store',
          description: 'Immutable archive of approved vouchers and pending register synchronization queue.',
          icon: Lock,
          count: pendingSyncCount > 0 ? pendingSyncCount : undefined,
        },
        {
          route: 'fin-bank-treasury',
          label: 'Bank, Cash & Treasury',
          description: 'Cash/bank positions vs loan liabilities, cheque register, BEFTN/RTGS transfers & bank rec.',
          icon: Landmark,
        },
        {
          route: 'fin-tax-compliance',
          label: 'Bangladesh Tax & Mushak',
          description: 'VAT GL 2070 ledger, Mushak 6.3/6.6/9.1 workings & TDS/VDS Treasury Challans.',
          icon: Scale,
        },
        {
          route: 'fin-fixed-assets',
          label: 'Fixed Assets & Depr',
          description: 'PPE asset schedule (GL 1010/1020) and monthly straight-line depreciation (GL 5340).',
          icon: Package,
        },
        {
          route: 'fin-month-end',
          label: 'Month-End & Budgets',
          description: 'Pre-close reconciliation checklist, period lock/unlock & expense GL budgets.',
          icon: CalendarRange,
        },
      ],
    },
    {
      label: 'Financial Reports',
      items: [
        {
          route: 'reports-summary',
          label: 'GL Summary',
          description: 'Consolidated account group totals, category mix, and period activity overview.',
          icon: BarChart3,
        },
        {
          route: 'reports-trial-balance',
          label: 'Trial Balance',
          description: 'Verify aggregate debit and credit equality across all active ledger accounts.',
          icon: Scale,
        },
        {
          route: 'reports-income',
          label: 'Income Statement',
          description: 'Period revenue, cost of goods sold, operating expenses, and net profit analysis.',
          icon: FileText,
        },
        {
          route: 'reports-balance-sheet',
          label: 'Balance Sheet',
          description: 'Financial position snapshot of total assets, liabilities, and equity verification.',
          icon: Landmark,
        },
        {
          route: 'reports-cash-flow',
          label: 'Cash Flow Statement',
          description: 'IAS 7 indirect cash flow statement across Operating, Investing, and Financing activities.',
          icon: Wallet,
        },
        {
          route: 'reports-equity-changes',
          label: 'Changes in Equity',
          description: 'IAS 1 reconciliation of opening equity, capital movements, net profit, and closing equity.',
          icon: BookOpen,
        },
        {
          route: 'reports-monthly',
          label: 'Monthly Matrix',
          description: 'Month-by-month comparative breakdown of revenue, expenses, and net surplus.',
          icon: CalendarRange,
        },
      ],
    },
    {
      label: 'Audit & Governance',
      items: [
        {
          route: 'audit',
          label: 'Reconciliation Audit',
          description: 'Automated integrity checks verifying register-to-trial-balance reconciliation.',
          icon: ShieldCheck,
        },
        {
          route: 'gov-approvals',
          label: 'Approval Queue',
          description: 'Dual-control authorization for high-value POs, credit overrides & vouchers.',
          icon: CheckCircle2,
          count: pendingApprovalCount > 0 ? pendingApprovalCount : undefined,
        },
        {
          route: 'audit-log',
          label: 'System Audit Log',
          description: 'Chronological trail of voucher postings, edits, and configuration events.',
          icon: ScrollText,
        },
        {
          route: 'templates',
          label: 'Template Studio',
          description: 'Design, preview, and import reusable page layouts and voucher templates.',
          icon: LayoutTemplate,
        },
        {
          route: 'workspace',
          label: 'Workspace & Cloud',
          description: 'Connect Google Drive, Sheets, Gmail, Docs, Tasks, Chat, Contacts, and Firestore.',
          icon: Cloud,
        },
        {
          route: 'config',
          label: 'System Config & Scripts',
          description: 'Configure fiscal periods, currency, organization metadata, and ledger resets.',
          icon: Settings,
        },
      ],
    },
  ];

  const routeMeta = ROUTE_TITLES[activeRoute];

  const handleSelect = (route: ActiveRoute) => {
    setHoveredTooltip(null);
    onNavigate(route);
    setMobileMenuOpen(false);
  };

  const handleShowTooltip = (item: NavItem, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const clampedTop = Math.min(Math.max(rect.top + rect.height / 2, 48), window.innerHeight - 48);
    setHoveredTooltip({
      id: `sidebar-tooltip-${item.route}`,
      label: item.label,
      description: item.description,
      top: clampedTop,
      left: rect.right + 12,
    });
  };

  const handleHideTooltip = (route: ActiveRoute) => {
    setHoveredTooltip((current) =>
      current?.id === `sidebar-tooltip-${route}` ? null : current
    );
  };

  const renderNavItem = (item: NavItem, inGroupedCard: boolean) => {
    const Icon = item.icon;
    const isActive = activeRoute === item.route;
    const tooltipId = `sidebar-tooltip-${item.route}`;
    const isTooltipActive = hoveredTooltip?.id === tooltipId;
    const href = getRoutePath(item.route);

    return (
      <li key={item.route}>
        <a
          href={href}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
              return;
            }
            e.preventDefault();
            handleSelect(item.route);
          }}
          onMouseEnter={(e) => handleShowTooltip(item, e.currentTarget)}
          onMouseLeave={() => handleHideTooltip(item.route)}
          onFocus={(e) => handleShowTooltip(item, e.currentTarget)}
          onBlur={() => handleHideTooltip(item.route)}
          aria-current={isActive ? 'page' : undefined}
          aria-describedby={isTooltipActive ? tooltipId : undefined}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer group ${
            isActive
              ? 'bg-blue-600 text-white shadow-sm font-semibold'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0 truncate">
            <Icon
              className={`w-4 h-4 shrink-0 transition-colors ${
                isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
              }`}
            />
            <span className="truncate">{item.label}</span>
          </span>
          {item.count !== undefined && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums shrink-0 font-medium ${
                isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {item.count}
            </span>
          )}
        </a>
      </li>
    );
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-200 border-r border-slate-800">
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-slate-800/80 flex items-center justify-between shrink-0">
        <a
          href={getRoutePath('dashboard')}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
              return;
            }
            e.preventDefault();
            handleSelect('dashboard');
          }}
          className="flex items-center gap-3 text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 font-extrabold text-base shrink-0">
            AT
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5 whitespace-nowrap truncate">
              ATCL ERP
            </div>
            <div className="text-[10px] text-slate-400 font-medium tracking-wider uppercase whitespace-nowrap truncate">
              Trading • Import • Service
            </div>
          </div>
        </a>
      </div>

      {/* Navigation */}
      <nav
        onScroll={() => setHoveredTooltip(null)}
        onMouseLeave={() => setHoveredTooltip(null)}
        className="flex-1 overflow-y-auto ledger-scroll px-3 py-4 space-y-4"
      >
        {navGroups.map((group) => {
          const isGroupedSection = group.label !== 'Overview';
          const isExpanded = expandedGroups[group.label] ?? true;
          const hasActiveItem = group.items.some((item) => item.route === activeRoute);

          if (isGroupedSection) {
            return (
              <div key={group.label} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={isExpanded}
                  className="w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 flex items-center justify-between transition-colors group cursor-pointer"
                >
                  <span className={!isExpanded && hasActiveItem ? 'text-blue-400' : ''}>
                    {group.label}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                  )}
                </button>
                {isExpanded && (
                  <ul className="space-y-0.5 pl-1">
                    {group.items.map((item) => renderNavItem(item, true))}
                  </ul>
                )}
              </div>
            );
          }

          return (
            <div key={group.label} className="space-y-1">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group.label}
              </div>
              <ul className="space-y-0.5 pl-1">
                {group.items.map((item) => renderNavItem(item, false))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Organization Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-400">
        <div className="flex items-center justify-between font-mono text-[10px] text-slate-300">
          <span className="truncate">{fiscalPeriod}</span>
          <span className="shrink-0">{currencyCode}</span>
        </div>
        <div className="mt-1 text-[10px] text-slate-400 truncate">
          {organizationName}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Floating Sidebar Navigation Tooltip (fixed outside overflow-y-auto nav to prevent clipping) */}
      {hoveredTooltip && (
        <div
          id={hoveredTooltip.id}
          role="tooltip"
          style={{ top: hoveredTooltip.top, left: hoveredTooltip.left }}
          className="hidden lg:block fixed z-50 -translate-y-1/2 pointer-events-none w-60 rounded-lg bg-slate-900 text-white border border-slate-700/80 shadow-lg px-3 py-2"
        >
          <span
            aria-hidden="true"
            className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-slate-900 border-l border-b border-slate-700/80"
          />
          <div className="text-xs font-semibold text-white tracking-tight">
            {hoveredTooltip.label}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-300 mt-0.5">
            {hoveredTooltip.description}
          </p>
        </div>
      )}

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] h-full z-10">
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-4 p-1.5 text-slate-500 hover:text-slate-900 rounded"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col erp-shell-bg">
        {/* Top Bar Contract: Breadcrumb Left + Action Cluster Right */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md dark:bg-slate-900/95 border-b border-slate-200/90 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 erp-shell-surface">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 truncate">
                <span>ATCL</span>
                <span className="text-slate-400">/</span>
                <span>{routeMeta.section}</span>
                {activeRoute === 'registers' && selectedRegisterCode && (
                  <>
                    <span className="text-slate-400">/</span>
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      GL {selectedRegisterCode}
                    </span>
                  </>
                )}
              </div>
              <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
                {routeMeta.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {syncStatus && (
              <span
                title={
                  syncStatus.lastSyncError
                    ? `Local cache active (${syncStatus.lastSyncError})`
                    : syncStatus.mode === 'cloud'
                      ? `Firestore Cloud Synced (${syncStatus.lastCloudSyncAt || 'Live'})`
                      : 'Browser Local Cache (Sign in to sync Firestore Cloud)'
                }
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                  syncStatus.mode === 'cloud'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <Cloud className="w-3 h-3" />
                <span>{syncStatus.mode === 'cloud' ? 'Cloud Synced' : 'Local Cache'}</span>
              </span>
            )}
            {firebaseUser && onGoogleSignIn && onGoogleSignOut ? (
              <GoogleUserBadge
                user={firebaseUser}
                hasWorkspaceToken={hasWorkspaceToken}
                onReconnectToken={onGoogleSignIn}
                onSignOut={onGoogleSignOut}
                busy={authBusy}
              />
            ) : (
              onGoogleSignIn && (
                <GoogleSignInButton onClick={onGoogleSignIn} disabled={authBusy} />
              )
            )}
            {onOpenCustomInstructions && (
              <button
                type="button"
                onClick={onOpenCustomInstructions}
                title="Custom Instructions: Style, Models & Knowledge"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:text-slate-900 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="hidden md:inline">Custom Instructions</span>
              </button>
            )}
            {onOpenAssistant && (
              <button
                type="button"
                onClick={onOpenAssistant}
                title="Open ATCL Executive ERP Assistant"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:text-slate-900 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageSquareText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="hidden sm:inline">ERP Assistant</span>
              </button>
            )}
            <button
              onClick={onOpenNewVoucher}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Journal Voucher</span>
            </button>
          </div>
        </header>

        {/* Floating Toast Notification */}
        {toast && (
          <div
            role="status"
            className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xl border no-print ${
              toast.type === 'error'
                ? 'bg-rose-950 text-rose-100 border-rose-800'
                : 'bg-slate-900 text-white border-slate-800'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="max-w-sm truncate">{toast.message}</span>
            <button
              onClick={onDismissToast}
              className="ml-1 text-[11px] text-slate-300 hover:text-white underline underline-offset-2 shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Viewport Workspace */}
        <main className="flex-1 p-4 sm:p-5 lg:p-6 max-w-[1600px] w-full mx-auto min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
};

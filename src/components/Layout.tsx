import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Barcode,
  BookCheck,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Cloud,
  Cog,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Home,
  Landmark,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  ReceiptText,
  Scale,
  ScrollText,
  Search,
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
  adminSession?: { email: string; displayName: string; role: string } | null;
  hasWorkspaceToken?: boolean;
  onGoogleSignIn?: () => void;
  onGoogleSignOut?: () => void;
  onAppSignOut?: () => void;
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
  adminSession = null,
  hasWorkspaceToken = false,
  onGoogleSignIn,
  onGoogleSignOut,
  onAppSignOut,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(true);
  const asideRef = useRef<HTMLElement | null>(null);
  const toggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [clockLabel, setClockLabel] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
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

  useEffect(() => {
    if (sidebarCollapsed) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (asideRef.current?.contains(target)) return;
      if (toggleBtnRef.current?.contains(target)) return;
      setSidebarCollapsed(true);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [sidebarCollapsed]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockLabel(
        new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      );
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    setSidebarCollapsed(true);
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

  const GROUP_ICON_TONES: Record<string, string> = {
    Overview: 'text-sky-400',
    'Master Data': 'text-cyan-400',
    'Supply Chain': 'text-amber-400',
    'Sales & Service': 'text-emerald-400',
    'Voucher Management': 'text-rose-400',
    'General Ledger': 'text-indigo-400',
    'Financial Reports': 'text-blue-400',
    'Audit & Governance': 'text-amber-300',
  };

  const allNavItems = useMemo(
    () =>
      navGroups.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          groupLabel: group.label,
        }))
      ),
    [unpostedCount, pendingSyncCount, pendingApprovalCount]
  );

  const filteredSearchItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allNavItems.slice(0, 12);
    return allNavItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.groupLabel.toLowerCase().includes(q)
      )
      .slice(0, 14);
  }, [allNavItems, searchQuery]);

  const userDisplayName =
    firebaseUser?.displayName ||
    adminSession?.displayName ||
    firebaseUser?.email?.split('@')[0] ||
    adminSession?.email?.split('@')[0] ||
    organizationName;
  const userAvatarInitial = (userDisplayName || 'A').trim().charAt(0).toUpperCase();

  const renderNavItem = (
    item: NavItem,
    iconToneClass: string,
    collapsed: boolean
  ) => {
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
          title={collapsed ? item.label : undefined}
          className={`flex items-center rounded-xl text-xs font-medium transition-all whitespace-nowrap cursor-pointer group ${
            collapsed
              ? 'justify-center w-11 h-10 mx-auto px-0'
              : 'w-full justify-between gap-2 px-3 py-2'
          } ${
            isActive
              ? 'bg-[#2563EB] text-white shadow-md shadow-blue-600/30 font-semibold'
              : 'text-slate-300/90 hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          <span
            className={`flex items-center min-w-0 ${
              collapsed ? 'justify-center relative' : 'gap-2.5 truncate'
            }`}
          >
            <Icon
              className={`w-4 h-4 shrink-0 transition-colors ${
                isActive ? 'text-white' : `${iconToneClass} group-hover:text-white`
              }`}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {collapsed && item.count !== undefined && (
              <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-rose-400 ring-2 ring-[#0E1525]" />
            )}
          </span>
          {!collapsed && item.count !== undefined && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums shrink-0 font-medium ${
                isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-200'
              }`}
            >
              {item.count}
            </span>
          )}
        </a>
      </li>
    );
  };

  const buildSidebarContent = (collapsed: boolean, isMobile = false) => (
    <div className="flex h-full flex-col bg-[#0E1525] text-slate-200 border-r border-slate-800/80 select-none">
      {/* Brand Header (Click logo to open / close sidebar) */}
      <div
        className={`h-14 border-b border-slate-800/80 flex items-center shrink-0 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setHoveredTooltip(null);
            if (isMobile) {
              setMobileMenuOpen(false);
            } else {
              setSidebarCollapsed((prev) => !prev);
            }
          }}
          aria-expanded={!collapsed}
          title={collapsed ? 'Click AT logo to open menu' : 'Click AT logo to close menu'}
          className={`flex items-center text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg cursor-pointer hover:opacity-95 transition-opacity ${
            collapsed ? 'justify-center' : 'gap-2.5 w-full'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#2563EB] to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-600/30 font-extrabold text-sm shrink-0">
            AT
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5 whitespace-nowrap truncate">
                ATCL ERP
              </div>
              <div className="text-[9px] text-slate-400 font-semibold tracking-[0.15em] uppercase whitespace-nowrap truncate">
                ENTERPRISE PLATFORM
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav
        onScroll={() => setHoveredTooltip(null)}
        onMouseLeave={() => setHoveredTooltip(null)}
        className={`flex-1 overflow-y-auto sidebar-scroll py-3 ${
          collapsed ? 'px-1.5 space-y-2.5' : 'px-3 space-y-4'
        }`}
      >
        {navGroups.map((group, groupIdx) => {
          const isGroupedSection = group.label !== 'Overview';
          const isExpanded = collapsed ? true : expandedGroups[group.label] ?? true;
          const hasActiveItem = group.items.some((item) => item.route === activeRoute);
          const iconToneClass = GROUP_ICON_TONES[group.label] || 'text-slate-400';

          if (collapsed) {
            return (
              <div
                key={group.label}
                className={groupIdx > 0 ? 'border-t border-slate-800/70 pt-2.5' : ''}
              >
                <ul className="space-y-1">
                  {group.items.map((item) => renderNavItem(item, iconToneClass, true))}
                </ul>
              </div>
            );
          }

          if (isGroupedSection) {
            return (
              <div key={group.label} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={isExpanded}
                  className="w-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-300 flex items-center justify-between transition-colors group cursor-pointer"
                >
                  <span className={!isExpanded && hasActiveItem ? 'text-blue-400' : ''}>
                    {group.label}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-300" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-300" />
                  )}
                </button>
                {isExpanded && (
                  <ul className="space-y-0.5">
                    {group.items.map((item) => renderNavItem(item, iconToneClass, false))}
                  </ul>
                )}
              </div>
            );
          }

          return (
            <div key={group.label} className="space-y-1">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                MAIN MENU
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => renderNavItem(item, iconToneClass, false))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Organization & User Footer */}
      <div
        className={`border-t border-slate-800/80 bg-[#0A101D] ${
          collapsed ? 'p-2.5 flex flex-col items-center gap-2' : 'p-3'
        }`}
      >
        {collapsed ? (
          <>
            <div
              title={`${userDisplayName} · ${organizationName} (${fiscalPeriod})`}
              className="w-8 h-8 rounded-full bg-[#2563EB] text-white font-bold text-xs flex items-center justify-center shadow-sm"
            >
              {userAvatarInitial}
            </div>
            {(onAppSignOut || onGoogleSignOut) && (
              <button
                type="button"
                onClick={onAppSignOut || onGoogleSignOut}
                disabled={authBusy}
                title="Log out"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-rose-300 hover:text-rose-200 hover:bg-rose-950/50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#2563EB] text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                {userAvatarInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate">
                  {userDisplayName}
                </div>
                <div className="text-[10px] font-mono text-slate-400 truncate">
                  {adminSession ? `${adminSession.role} · ${adminSession.email}` : `${fiscalPeriod} · ${currencyCode}`}
                </div>
              </div>
            </div>
            {(onAppSignOut || onGoogleSignOut) && (
              <button
                type="button"
                onClick={onAppSignOut || onGoogleSignOut}
                disabled={authBusy}
                className="mt-2.5 w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold text-rose-300 bg-rose-950/35 hover:bg-rose-950/60 border border-rose-500/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F4F6FB] text-slate-900">
      {/* Desktop Sidebar */}
      <aside
        ref={asideRef}
        className={`hidden lg:block shrink-0 sticky top-0 h-screen transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        {buildSidebarContent(sidebarCollapsed, false)}
      </aside>

      {/* Floating Sidebar Navigation Tooltip (fixed outside overflow-y-auto nav to prevent clipping) */}
      {hoveredTooltip && (
        <div
          id={hoveredTooltip.id}
          role="tooltip"
          style={{ top: hoveredTooltip.top, left: hoveredTooltip.left }}
          className="hidden lg:block fixed z-50 -translate-y-1/2 pointer-events-none w-60 rounded-xl bg-[#0E1525] text-white border border-slate-700/80 shadow-xl px-3 py-2"
        >
          <span
            aria-hidden="true"
            className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-[#0E1525] border-l border-b border-slate-700/80"
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
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[82vw] h-full z-10">
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation"
              className="absolute top-3.5 right-3 p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            {buildSidebarContent(false, true)}
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col erp-shell-bg">
        {/* Top Bar Contract: Collapse + Breadcrumb Left + Chips, Search, Clock, Auth Right */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md dark:bg-slate-900/95 border-b border-[#E5E9F2] dark:border-slate-800 px-3 sm:px-5 flex items-center justify-between gap-3 erp-shell-surface">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <button
              ref={toggleBtnRef}
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
              className="hidden lg:inline-flex p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
            <div className="flex items-center gap-1.5 text-xs min-w-0 truncate">
              <button
                type="button"
                onClick={() => handleSelect('dashboard')}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-[#2563EB] transition-colors cursor-pointer shrink-0"
              >
                <Home className="w-3.5 h-3.5" />
                <span className="hidden sm:inline font-medium">Home</span>
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="hidden md:inline text-slate-500 font-medium truncate">
                {routeMeta.section}
              </span>
              <ChevronRight className="hidden md:inline w-3.5 h-3.5 text-slate-300 shrink-0" />
              <h1 className="font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
                {routeMeta.title}
              </h1>
              {activeRoute === 'registers' && selectedRegisterCode && (
                <span className="ml-1 px-2 py-0.5 rounded-md bg-blue-50 text-[#2563EB] border border-blue-200/80 font-mono text-[11px] tabular-nums shrink-0">
                  GL {selectedRegisterCode}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {syncStatus && (
              <span
                title={
                  syncStatus.lastSyncError
                    ? `Local cache active (${syncStatus.lastSyncError})`
                    : syncStatus.mode === 'cloud'
                      ? `Firestore Cloud Synced (${syncStatus.lastCloudSyncAt || 'Live'})`
                      : 'Browser Local Cache (Sign in to sync Firestore Cloud)'
                }
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                  syncStatus.mode === 'cloud'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                    : 'bg-amber-50 text-amber-700 border-amber-200/80'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>{syncStatus.mode === 'cloud' ? 'Cloud Synced' : 'Local Cache'}</span>
              </span>
            )}
            {onOpenAssistant && (
              <button
                type="button"
                onClick={onOpenAssistant}
                title="Open ATCL Executive ERP Assistant"
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50/90 border border-indigo-200/80 hover:bg-indigo-100/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageSquareText className="w-3.5 h-3.5 text-indigo-600" />
                <span>ERP Assistant</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchOpen(true);
              }}
              title="Jump to any ERP module (Ctrl+K)"
              className="hidden xl:inline-flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/90 rounded-full transition-colors whitespace-nowrap cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>Global search...</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-500 bg-white border border-slate-200 rounded">
                Ctrl+K
              </kbd>
            </button>
            <div
              title="Current local system time"
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200/80 text-[11px] font-mono font-medium text-slate-600 tabular-nums shrink-0"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{clockLabel}</span>
            </div>
            {onOpenCustomInstructions && (
              <button
                type="button"
                onClick={onOpenCustomInstructions}
                title="Custom Instructions: Style, Models & Knowledge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:text-slate-900 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#2563EB] dark:text-blue-400" />
                <span className="hidden 2xl:inline">Preferences</span>
              </button>
            )}
            <button
              onClick={onOpenNewVoucher}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg shadow-xs transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Voucher</span>
            </button>
            {firebaseUser && onGoogleSignIn && (onAppSignOut || onGoogleSignOut) ? (
              <GoogleUserBadge
                user={firebaseUser}
                hasWorkspaceToken={hasWorkspaceToken}
                onReconnectToken={onGoogleSignIn}
                onSignOut={onAppSignOut || onGoogleSignOut!}
                busy={authBusy}
              />
            ) : adminSession ? (
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-xs shrink-0">
                <span className="w-6 h-6 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                  {adminSession.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div className="hidden xl:flex flex-col leading-tight min-w-0">
                  <span className="font-semibold text-slate-800 truncate max-w-[120px]">
                    {adminSession.displayName}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {adminSession.role}
                  </span>
                </div>
                {onAppSignOut && (
                  <button
                    type="button"
                    onClick={onAppSignOut}
                    disabled={authBusy}
                    title="Log out"
                    className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              onGoogleSignIn && (
                <GoogleSignInButton onClick={onGoogleSignIn} disabled={authBusy} />
              )
            )}
          </div>
        </header>

        {/* Global Quick-Jump Search Modal (Ctrl+K) */}
        {searchOpen && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-950/45 backdrop-blur-[2px] no-print"
            onClick={() => setSearchOpen(false)}
          >
            <div
              className="w-full max-w-lg bg-white rounded-2xl border border-[#E5E9F2] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200">
                <Search className="w-4 h-4 text-[#2563EB] shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredSearchItems[0]) {
                      handleSelect(filteredSearchItems[0].route);
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Jump to module, report, voucher, or ledger..."
                  className="flex-1 text-sm text-slate-900 placeholder-slate-400 focus:outline-none bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 cursor-pointer"
                >
                  ESC
                </button>
              </div>
              <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {filteredSearchItems.length === 0 ? (
                  <li className="px-4 py-6 text-center text-xs text-slate-500">
                    No matching ERP modules found.
                  </li>
                ) : (
                  filteredSearchItems.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <li key={item.route}>
                        <button
                          type="button"
                          onClick={() => {
                            handleSelect(item.route);
                            setSearchOpen(false);
                          }}
                          className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-blue-50/70 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                              <ItemIcon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {item.label}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {item.description}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                            {item.groupLabel}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        )}

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

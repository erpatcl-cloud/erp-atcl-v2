import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  Lock,
  LockOpen,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { hydrateCustomInstructions, hydrateSystemConfig } from '../data/seedData.ts';
import {
  computeBalanceSheet,
  computeTrialBalance,
  exportRowsToCSV,
  formatBDT,
  reconcileAllRegisters,
} from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import { auth, getAccessToken, googleSignIn } from '../lib/firebase.ts';
import {
  MASTER_WORKBOOK_TABS,
  MASTER_WORKBOOK_TITLE,
  ensureMasterWorkbook,
  pullMasterWorkbookChanges,
  pushMasterWorkbook,
  resolveMasterSyncConflict,
} from '../lib/googleMasterWorkbookSync.ts';
import { getRoutePath, type ConfigTabId } from '../lib/routes.ts';
import { applyCustomStyleToDocument } from '../lib/themeUtils.ts';
import { CustomInstructionsTab } from './CustomInstructionsTab.tsx';
import { DocumentStoreTab } from './DocumentStoreTab.tsx';
import type {
  ActiveRoute,
  LedgerState,
  RolePermissions,
  SystemConfig,
  SystemRoleId,
  VoucherSeriesRule,
} from '../types/accounting.ts';

interface SystemConfigViewProps {
  state: LedgerState;
  busyAction: string | null;
  activeTab?: ConfigTabId;
  onTabChange?: (tab: ConfigTabId) => void;
  onSaveConfig: (payload: Partial<SystemConfig>) => Promise<void>;
  onResetWorkspace: () => Promise<void>;
  onLoadSampleTransactions: () => Promise<void>;
  onRestoreBackup: (snapshot: Partial<LedgerState>) => Promise<void>;
  onPruneAuditLog: () => Promise<void>;
  onCustomInstructionsDocMutated?: (nextState: LedgerState, message: string) => void;
  onApplyLedgerSyncState?: (nextState: LedgerState, message: string) => Promise<void> | void;
  onNavigate: (route: ActiveRoute) => void;
}

interface ScriptFile {
  filename: string;
  rawFilename: string;
  sizeBytes: number;
  content: string;
}

interface ParsedBackupPreview {
  filename: string;
  sizeBytes: number;
  snapshot: Partial<LedgerState>;
  organizationName: string;
  fiscalPeriod: string;
  datasetVersion: string;
  accountsCount: number;
  postedCount: number;
  journalCount: number;
  vouchersCount: number;
  templatesCount: number;
}

type ArchiveExportScope = 'complete' | 'ledger-config' | 'config-only';

interface ExportedArchiveReceipt {
  filename: string;
  sizeKb: string;
  scopeLabel: string;
  exportedAt: string;
  sha256: string | null;
  includedManifest: boolean;
  prettyPrinted: boolean;
}

const ARCHIVE_SCOPE_OPTIONS: Array<{
  id: ArchiveExportScope;
  label: string;
  subtitle: string;
  tag: string;
}> = [
  {
    id: 'complete',
    label: 'Complete Archive (Ledger + Config)',
    subtitle:
      'All GL accounts, journals, posted store, registers, vouchers, operations, audit logs & configuration',
    tag: 'Directly Restorable',
  },
  {
    id: 'ledger-config',
    label: 'Core Ledger & Configuration',
    subtitle:
      'Statutory accounting books (COA, journals, posted ledger, registers, vouchers, audit) & configuration',
    tag: 'Directly Restorable',
  },
  {
    id: 'config-only',
    label: 'Configuration Settings Only',
    subtitle:
      'Company & tax profile, voucher numbering, approval limits, fiscal locks & role permissions',
    tag: 'Settings Portable',
  },
];

const CONFIG_TABS: Array<{
  id: ConfigTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'company', label: 'Company & Tax', icon: Building2 },
  { id: 'vouchers', label: 'Vouchers & Approvals', icon: ReceiptText },
  { id: 'fiscal', label: 'Fiscal & Period Locks', icon: CalendarClock },
  { id: 'roles', label: 'Roles & Audit', icon: ShieldCheck },
  { id: 'custom-instructions', label: 'Custom Instructions', icon: SlidersHorizontal },
  { id: 'document-store', label: 'Document Store', icon: FolderOpen },
  { id: 'backup', label: 'Backup & Diagnostics', icon: Database },
  { id: 'integrations', label: 'Integrations & Scripts', icon: Code2 },
];

const VOUCHER_SERIES_META: Array<{
  key: 'payment' | 'receipt' | 'journal' | 'expense' | 'reversal';
  label: string;
  module: string;
}> = [
  { key: 'payment', label: 'Payment Voucher', module: 'Vendor Payouts & TDS/VDS' },
  { key: 'receipt', label: 'Receipt Voucher', module: 'Customer Collections' },
  { key: 'journal', label: 'Journal Voucher', module: 'Adjustments & Accruals' },
  { key: 'expense', label: 'Expense Voucher', module: 'Departmental OpEx' },
  { key: 'reversal', label: 'Reversal Voucher', module: 'Immutable Ledger Reversals' },
];

const ROLE_META: Array<{ id: SystemRoleId; label: string; scope: string }> = [
  {
    id: 'finance_controller',
    label: 'Finance Controller',
    scope: 'Full statutory authority & period controls',
  },
  {
    id: 'senior_accountant',
    label: 'Senior Accountant',
    scope: 'Approvals, GL posting & chart management',
  },
  {
    id: 'voucher_clerk',
    label: 'Voucher Clerk',
    scope: 'Data entry & draft voucher preparation',
  },
  {
    id: 'external_auditor',
    label: 'External Auditor',
    scope: 'Read-only inspection & audit exports',
  },
];

const PERMISSION_ROWS: Array<{ key: keyof RolePermissions; label: string; desc: string }> = [
  { key: 'canCreateVouchers', label: 'Create Draft Vouchers', desc: 'Prepare multi-line entries and operational vouchers' },
  { key: 'canApproveVouchers', label: 'Approve Vouchers', desc: 'Sign off validated entries prior to GL posting' },
  { key: 'canPostToGL', label: 'Post to General Ledger', desc: 'Commit immutable entries to Posted Store & Registers' },
  { key: 'canReverseVouchers', label: 'Issue Reversal Entries', desc: 'Generate mirror offsetting entries for posted vouchers' },
  { key: 'canManageCOA', label: 'Manage Chart of Accounts', desc: 'Add, rename, or deactivate GL account codes' },
  { key: 'canLockFiscalPeriods', label: 'Lock / Reopen Periods', desc: 'Control posting cutoffs and closed fiscal months' },
  { key: 'canEditSystemConfig', label: 'Modify System Settings', desc: 'Change tax defaults, approval limits, and policies' },
  { key: 'canExportBackup', label: 'Export Data & Backups', desc: 'Download JSON snapshots and full audit trails' },
];

function buildFiscalMonths(startDateStr?: string): Array<{ key: string; label: string; shortYear: string }> {
  const match = /^(\d{4})-(\d{2})/.exec(startDateStr || '2024-07-01');
  const startYear = match ? parseInt(match[1], 10) : 2024;
  const startMonth = match ? parseInt(match[2], 10) : 7;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const months: Array<{ key: string; label: string; shortYear: string }> = [];
  for (let i = 0; i < 12; i++) {
    const totalMonth = startMonth - 1 + i;
    const y = startYear + Math.floor(totalMonth / 12);
    const m = (totalMonth % 12) + 1;
    months.push({
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: names[m - 1],
      shortYear: String(y),
    });
  }
  return months;
}

function formatSeriesPreview(rule: VoucherSeriesRule): string {
  return `${rule.prefix}${String(rule.nextSequence).padStart(rule.padding, '0')}`;
}

export const SystemConfigView: React.FC<SystemConfigViewProps> = ({
  state,
  busyAction,
  activeTab: controlledTab,
  onTabChange,
  onSaveConfig,
  onResetWorkspace,
  onLoadSampleTransactions,
  onRestoreBackup,
  onPruneAuditLog,
  onCustomInstructionsDocMutated,
  onApplyLedgerSyncState,
  onNavigate,
}) => {
  const persistedConfig = useMemo(() => hydrateSystemConfig(state.config), [state.config]);
  const [internalTab, setInternalTab] = useState<ConfigTabId>(controlledTab ?? 'company');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: ConfigTabId) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };
  const [draft, setDraft] = useState<SystemConfig>(persistedConfig);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Operational confirmations
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmLoadSample, setConfirmLoadSample] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);

  // Backup restore preview & external archive export options
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [backupPreview, setBackupPreview] = useState<ParsedBackupPreview | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [archiveScope, setArchiveScope] = useState<ArchiveExportScope>('complete');
  const [includeDiagnosticsManifest, setIncludeDiagnosticsManifest] = useState(true);
  const [prettyPrintJson, setPrettyPrintJson] = useState(true);
  const [isExportingArchive, setIsExportingArchive] = useState(false);
  const [lastArchiveReceipt, setLastArchiveReceipt] = useState<ExportedArchiveReceipt | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  // Apps Script archive viewer
  const [scripts, setScripts] = useState<ScriptFile[]>([]);
  const [scriptSearch, setScriptSearch] = useState('');
  const [selectedScript, setSelectedScript] = useState<string>('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDraft(persistedConfig);
    setValidationError(null);
  }, [persistedConfig]);

  useEffect(() => {
    api
      .getAppsScripts()
      .then((res) => {
        setScripts(res.scripts);
        if (res.scripts.length > 0) setSelectedScript(res.scripts[0].filename);
      })
      .catch(() => {});
  }, []);

  const modifiedSections = useMemo(() => {
    const sections: string[] = [];
    const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

    if (
      draft.organizationName !== persistedConfig.organizationName ||
      draft.legalEntityType !== persistedConfig.legalEntityType ||
      draft.tinNumber !== persistedConfig.tinNumber ||
      draft.binVatNumber !== persistedConfig.binVatNumber ||
      draft.tradeLicenseNo !== persistedConfig.tradeLicenseNo ||
      draft.registeredAddress !== persistedConfig.registeredAddress ||
      draft.contactPhone !== persistedConfig.contactPhone ||
      draft.currencyCode !== persistedConfig.currencyCode ||
      draft.currencySymbol !== persistedConfig.currencySymbol ||
      draft.defaultVatPct !== persistedConfig.defaultVatPct ||
      draft.defaultTdsPct !== persistedConfig.defaultTdsPct ||
      draft.defaultVdsPct !== persistedConfig.defaultVdsPct ||
      draft.decimalPlaces !== persistedConfig.decimalPlaces
    ) {
      sections.push('Company & Tax');
    }

    if (
      !eq(draft.voucherNumbering, persistedConfig.voucherNumbering) ||
      draft.autoApproveLimit !== persistedConfig.autoApproveLimit ||
      draft.dualApprovalThreshold !== persistedConfig.dualApprovalThreshold ||
      draft.enforceLiquidityCheck !== persistedConfig.enforceLiquidityCheck ||
      draft.enforceBudgetCheck !== persistedConfig.enforceBudgetCheck ||
      draft.requireVoucherNarration !== persistedConfig.requireVoucherNarration
    ) {
      sections.push('Vouchers & Approvals');
    }

    if (
      draft.fiscalPeriod !== persistedConfig.fiscalPeriod ||
      draft.fiscalStartDate !== persistedConfig.fiscalStartDate ||
      draft.fiscalEndDate !== persistedConfig.fiscalEndDate ||
      draft.globalLockDate !== persistedConfig.globalLockDate ||
      !eq(draft.lockedMonths, persistedConfig.lockedMonths) ||
      draft.allowBackdatedEntries !== persistedConfig.allowBackdatedEntries ||
      draft.allowFutureDatedEntries !== persistedConfig.allowFutureDatedEntries
    ) {
      sections.push('Fiscal & Period Locks');
    }

    if (
      draft.operatorEmail !== persistedConfig.operatorEmail ||
      draft.activeRole !== persistedConfig.activeRole ||
      !eq(draft.rolePermissions, persistedConfig.rolePermissions) ||
      draft.auditRetentionDays !== persistedConfig.auditRetentionDays ||
      draft.maxAuditEntries !== persistedConfig.maxAuditEntries
    ) {
      sections.push('Roles & Audit');
    }

    if (
      draft.driveFolderName !== persistedConfig.driveFolderName ||
      draft.autoSyncOnPost !== persistedConfig.autoSyncOnPost
    ) {
      sections.push('Integrations & Scripts');
    }

    if (!eq(draft.customInstructions, persistedConfig.customInstructions)) {
      sections.push('Custom Instructions');
    }

    return sections;
  }, [draft, persistedConfig]);

  const hasUnsavedChanges = modifiedSections.length > 0;

  // Live diagnostics computed from authoritative ledger state
  const diagnostics = useMemo(() => {
    const tb = computeTrialBalance(state);
    const bs = computeBalanceSheet(state);
    const recon = reconcileAllRegisters(state, false);
    const pendingSync = state.postedTransactions.filter((t) => t.registerSynced === 'PENDING').length;
    const unpostedLines = state.journalLines.filter((l) => l.postingStatus === 'UNPOSTED').length;
    const approxBytes = new Blob([JSON.stringify(state)]).size;
    return {
      tb,
      bs,
      recon,
      pendingSync,
      unpostedLines,
      approxKb: (approxBytes / 1024).toFixed(1),
    };
  }, [state]);

  // Monthly posted transaction density for the 12-month fiscal period lock grid
  const fiscalMonths = useMemo(
    () => buildFiscalMonths(draft.fiscalStartDate),
    [draft.fiscalStartDate]
  );

  const txCountByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of state.postedTransactions) {
      const ym = tx.date.slice(0, 7);
      map.set(ym, (map.get(ym) || 0) + 1);
    }
    return map;
  }, [state.postedTransactions]);

  const filteredScripts = useMemo(() => {
    const q = scriptSearch.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter(
      (s) => s.filename.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
    );
  }, [scripts, scriptSearch]);

  const activeScript =
    filteredScripts.find((s) => s.filename === selectedScript) || filteredScripts[0] || scripts[0];

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setValidationError(null);

    if (!draft.organizationName.trim()) {
      setValidationError('Organization Name cannot be empty.');
      setActiveTab('company');
      return;
    }
    if ((draft.dualApprovalThreshold ?? 0) < (draft.autoApproveLimit ?? 0)) {
      setValidationError(
        'Dual-signoff approval threshold must be greater than or equal to the auto-approval ceiling.'
      );
      setActiveTab('vouchers');
      return;
    }
    if (
      draft.fiscalStartDate &&
      draft.fiscalEndDate &&
      draft.fiscalEndDate <= draft.fiscalStartDate
    ) {
      setValidationError('Fiscal End Date must be after Fiscal Start Date.');
      setActiveTab('fiscal');
      return;
    }

    await onSaveConfig(draft);
  };

  const handleDiscard = () => {
    setDraft(persistedConfig);
    applyCustomStyleToDocument(persistedConfig.customInstructions?.style);
    setValidationError(null);
  };

  const updateVoucherSeries = (
    key: 'payment' | 'receipt' | 'journal' | 'expense' | 'reversal',
    patch: Partial<VoucherSeriesRule>
  ) => {
    setDraft((prev) => ({
      ...prev,
      voucherNumbering: {
        ...prev.voucherNumbering!,
        [key]: {
          ...prev.voucherNumbering![key],
          ...patch,
        },
      },
    }));
  };

  const toggleMonthLock = (monthKey: string) => {
    setDraft((prev) => {
      const set = new Set(prev.lockedMonths || []);
      if (set.has(monthKey)) {
        set.delete(monthKey);
      } else {
        set.add(monthKey);
      }
      return { ...prev, lockedMonths: Array.from(set).sort() };
    });
  };

  const lockThroughPriorMonth = () => {
    const currentYm = new Date().toISOString().slice(0, 7);
    const toLock = fiscalMonths.filter((m) => m.key < currentYm).map((m) => m.key);
    setDraft((prev) => ({
      ...prev,
      lockedMonths: toLock.length > 0 ? toLock : fiscalMonths.slice(0, 6).map((m) => m.key),
    }));
  };

  const toggleRolePermission = (roleId: SystemRoleId, permKey: keyof RolePermissions) => {
    setDraft((prev) => ({
      ...prev,
      rolePermissions: {
        ...prev.rolePermissions!,
        [roleId]: {
          ...prev.rolePermissions![roleId],
          [permKey]: !prev.rolePermissions![roleId][permKey],
        },
      },
    }));
  };

  const handleExportAuditCSV = () => {
    const dateTag = new Date().toISOString().slice(0, 10);
    exportRowsToCSV(
      `ATCL_Audit_Log_${dateTag}.csv`,
      ['Timestamp', 'Log ID', 'User', 'Module', 'Action', 'Details', 'Status'],
      state.auditLogs.map((e) => [
        e.timestamp,
        e.logId,
        e.userEmail,
        e.module,
        e.action,
        e.details,
        e.status,
      ])
    );
  };

  const buildArchivePayload = (exportedAtIso: string) => {
    const manifest = {
      format: 'ATCL-ERP-JSON-ARCHIVE-V1',
      archiveScope,
      exportedAt: exportedAtIso,
      exportedBy: persistedConfig.operatorEmail,
      organizationName: persistedConfig.organizationName,
      fiscalPeriod: persistedConfig.fiscalPeriod,
      diagnostics: {
        trialBalanceBalanced: diagnostics.tb.isClosingBalanced,
        trialBalanceDiff: diagnostics.tb.closingDiff,
        balanceSheetBalanced: diagnostics.bs.isBalanced,
        balanceSheetVariance: diagnostics.bs.variance,
        reconciledRegisters: diagnostics.recon.reconciledCount,
        totalRegisters: diagnostics.recon.totalChecked,
        pendingRegisterSync: diagnostics.pendingSync,
        unpostedDraftLines: diagnostics.unpostedLines,
      },
      recordCounts: {
        accounts: state.accounts.length,
        journalLines: state.journalLines.length,
        postedTransactions: state.postedTransactions.length,
        registerBooks: Object.keys(state.registers || {}).length,
        vouchers: state.vouchers.length,
        auditLogs: state.auditLogs.length,
      },
    };

    if (archiveScope === 'config-only') {
      return {
        archiveType: 'ATCL_SYSTEM_CONFIGURATION',
        datasetVersion: state.datasetVersion,
        config: persistedConfig,
        ...(includeDiagnosticsManifest ? { archiveMetadata: manifest } : {}),
      };
    }

    if (archiveScope === 'ledger-config') {
      return {
        datasetVersion: state.datasetVersion,
        config: persistedConfig,
        accounts: state.accounts,
        journalLines: state.journalLines,
        postedTransactions: state.postedTransactions,
        registers: state.registers,
        vouchers: state.vouchers,
        auditLogs: state.auditLogs,
        ...(includeDiagnosticsManifest ? { archiveMetadata: manifest } : {}),
      };
    }

    return {
      ...state,
      config: persistedConfig,
      ...(includeDiagnosticsManifest ? { archiveMetadata: manifest } : {}),
    };
  };

  const archiveSizeEstimateKb = useMemo(() => {
    if (activeTab !== 'backup') return null;
    const payload = buildArchivePayload('2025-01-01T00:00:00.000Z');
    const serialized = JSON.stringify(payload, null, prettyPrintJson ? 2 : 0);
    return (new Blob([serialized]).size / 1024).toFixed(1);
  }, [
    activeTab,
    archiveScope,
    includeDiagnosticsManifest,
    prettyPrintJson,
    state,
    persistedConfig,
    diagnostics,
  ]);

  const handleExportArchiveJson = async () => {
    setIsExportingArchive(true);
    try {
      const now = new Date();
      const exportedAtIso = now.toISOString();
      const dateTag = exportedAtIso.slice(0, 19).replace(/[:T]/g, '-');
      const fyTag = (persistedConfig.fiscalPeriod || 'FY')
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .replace(/-+/g, '-');

      const prefixMap: Record<ArchiveExportScope, string> = {
        complete: 'ATCL_Ledger_Config_Archive',
        'ledger-config': 'ATCL_Core_Ledger_Archive',
        'config-only': 'ATCL_Config_Archive',
      };
      const filename = `${prefixMap[archiveScope]}_${fyTag}_${dateTag}.json`;

      const payload = buildArchivePayload(exportedAtIso);
      const serialized = JSON.stringify(payload, null, prettyPrintJson ? 2 : 0);

      let sha256: string | null = null;
      try {
        if (typeof window !== 'undefined' && window.crypto?.subtle) {
          const encoded = new TextEncoder().encode(serialized);
          const digest = await window.crypto.subtle.digest('SHA-256', encoded);
          sha256 = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
      } catch {
        sha256 = null;
      }

      const blob = new Blob([serialized], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const scopeOption = ARCHIVE_SCOPE_OPTIONS.find((opt) => opt.id === archiveScope);
      setLastArchiveReceipt({
        filename,
        sizeKb: (blob.size / 1024).toFixed(1),
        scopeLabel: scopeOption?.label || 'Complete Archive',
        exportedAt: now.toLocaleString(),
        sha256,
        includedManifest: includeDiagnosticsManifest,
        prettyPrinted: prettyPrintJson,
      });
      setCopiedHash(false);
    } finally {
      setIsExportingArchive(false);
    }
  };

  const handleCopyArchiveHash = async () => {
    if (!lastArchiveReceipt?.sha256) return;
    await navigator.clipboard.writeText(lastArchiveReceipt.sha256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 1800);
  };

  const handleSelectBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setBackupError(null);
    setBackupPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<LedgerState> & { archiveType?: string };
      if (parsed?.archiveType === 'ATCL_SYSTEM_CONFIGURATION' && !Array.isArray(parsed.accounts)) {
        setBackupError(
          'This file is a Configuration-Only archive without ledger data. Select a Complete Archive or Core Ledger archive to restore the workspace.'
        );
        return;
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray(parsed.accounts) ||
        parsed.accounts.length === 0 ||
        !Array.isArray(parsed.postedTransactions) ||
        !Array.isArray(parsed.journalLines) ||
        !parsed.registers ||
        !parsed.config
      ) {
        setBackupError(
          'Invalid snapshot file: must include accounts, journalLines, postedTransactions, registers, and config.'
        );
        return;
      }

      setBackupPreview({
        filename: file.name,
        sizeBytes: file.size,
        snapshot: parsed,
        organizationName: parsed.config.organizationName || 'Unknown Organization',
        fiscalPeriod: parsed.config.fiscalPeriod || 'Unspecified',
        datasetVersion: parsed.datasetVersion || 'Legacy',
        accountsCount: parsed.accounts.length,
        postedCount: parsed.postedTransactions.length,
        journalCount: parsed.journalLines.length,
        vouchersCount: Array.isArray(parsed.vouchers) ? parsed.vouchers.length : 0,
        templatesCount: Array.isArray(parsed.templates) ? parsed.templates.length : 0,
      });
    } catch {
      setBackupError('Could not parse file as valid JSON. Please select an exported ATCL backup.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmRestore = async () => {
    if (!backupPreview) return;
    await onRestoreBackup(backupPreview.snapshot);
    setBackupPreview(null);
  };

  const handleCopyScript = async () => {
    if (!activeScript) return;
    await navigator.clipboard.writeText(activeScript.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadScript = () => {
    if (!activeScript) return;
    const blob = new Blob([activeScript.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeScript.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const ensureGoogleToken = async (): Promise<{ token: string; email: string }> => {
    const existing = await getAccessToken();
    if (existing) {
      return {
        token: existing,
        email: auth.currentUser?.email || persistedConfig.operatorEmail || 'erpatcl@gmail.com',
      };
    }
    const res = await googleSignIn();
    if (!res?.accessToken) {
      throw new Error('Google sign-in did not complete. Please allow Drive & Sheets permissions.');
    }
    return {
      token: res.accessToken,
      email: res.user.email || persistedConfig.operatorEmail || 'erpatcl@gmail.com',
    };
  };

  const applySyncState = async (nextState: LedgerState, message: string) => {
    if (onApplyLedgerSyncState) {
      await onApplyLedgerSyncState(nextState, message);
    } else if (nextState.config.googleLedgerSync) {
      await onSaveConfig({
        lastSyncTimestamp: nextState.config.lastSyncTimestamp,
        googleLedgerSync: nextState.config.googleLedgerSync,
      });
    }
  };

  const handleProvisionDriveFolder = async () => {
    setGoogleError(null);
    setGoogleNotice(null);
    setGoogleBusy(true);
    try {
      const { token, email } = await ensureGoogleToken();
      const wb = await ensureMasterWorkbook(token, {
        ...state,
        config: { ...state.config, driveFolderName: draft.driveFolderName },
      });
      const prevTabs = state.config.googleMasterSync?.tabs || {};
      const nextTabs: NonNullable<typeof state.config.googleMasterSync>['tabs'] = { ...prevTabs };
      MASTER_WORKBOOK_TABS.forEach((spec) => {
        nextTabs[spec.tabId] = {
          ...(nextTabs[spec.tabId] || { tabId: spec.tabId, sheetName: spec.sheetName, status: 'Pending' }),
          sheetGid: wb.tabGids[spec.sheetName],
        };
      });
      const nextState: LedgerState = {
        ...state,
        config: {
          ...state.config,
          driveFolderName: wb.folderName,
          googleMasterSync: {
            ...(state.config.googleMasterSync || { status: 'Pending' }),
            folderId: wb.folderId,
            folderUrl: wb.folderUrl,
            folderName: wb.folderName,
            workbookId: wb.workbookId,
            workbookTitle: MASTER_WORKBOOK_TITLE,
            workbookUrl: wb.workbookUrl,
            connectedEmail: email,
            tabs: nextTabs,
          },
        },
      };
      await applySyncState(nextState, `Provisioned "${MASTER_WORKBOOK_TITLE}" with 15 tabs.`);
      setGoogleNotice(`Provisioned "${MASTER_WORKBOOK_TITLE}" with all 15 worksheet tabs.`);
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Failed to provision Master Workbook.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleSyncLedgerToGoogle = async (tabId?: (typeof MASTER_WORKBOOK_TABS)[number]['tabId']) => {
    setGoogleError(null);
    setGoogleNotice(null);
    setGoogleBusy(true);
    try {
      const { token, email } = await ensureGoogleToken();
      const outcome = await pushMasterWorkbook(
        token,
        { ...state, config: { ...state.config, driveFolderName: draft.driveFolderName } },
        email,
        { tabIds: tabId ? [tabId] : undefined, force: true }
      );
      await applySyncState(outcome.nextState, outcome.summary);
      setGoogleNotice(outcome.summary);
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Failed to sync Master Workbook.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleImportSheetChanges = async (tabId?: (typeof MASTER_WORKBOOK_TABS)[number]['tabId']) => {
    setGoogleError(null);
    setGoogleNotice(null);
    setGoogleBusy(true);
    try {
      const { token, email } = await ensureGoogleToken();
      const outcome = await pullMasterWorkbookChanges(
        token,
        { ...state, config: { ...state.config, driveFolderName: draft.driveFolderName } },
        email,
        tabId ? [tabId] : undefined
      );
      await applySyncState(outcome.nextState, outcome.summary);
      setGoogleNotice(outcome.summary);
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Failed to import changes from Master Workbook.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleResolveConflictAction = async (
    conflictId: string,
    resolution: 'KEEP_SYSTEM' | 'APPLY_SHEET' | 'STAGE_REVERSAL'
  ) => {
    setGoogleError(null);
    const email = auth.currentUser?.email || persistedConfig.operatorEmail || 'erpatcl@gmail.com';
    const nextState = resolveMasterSyncConflict(state, conflictId, resolution, email);
    await applySyncState(nextState, `Resolved sync conflict (${resolution}).`);
    setGoogleNotice(`Conflict resolved (${resolution}).`);
  };

  const handleDownloadBundledScript = () => {
    const bundled = scripts.find((s) => s.filename.toLowerCase().includes('bundled'));
    if (!bundled) return;
    const blob = new Blob([bundled.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bundled.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page Title & Unified Save Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            System Configuration
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span>{persistedConfig.organizationName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">FY {persistedConfig.fiscalPeriod}</span>
            <span aria-hidden="true">·</span>
            <span>
              Locked Periods:{' '}
              <strong className="font-mono text-slate-700 tabular-nums">
                {persistedConfig.lockedMonths?.length || 0}/12
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Sync Policy:{' '}
              <strong className="text-slate-700">
                {persistedConfig.autoSyncOnPost ? 'Auto-Sync' : 'Manual Batch'}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasUnsavedChanges && (
            <button
              type="button"
              onClick={handleDiscard}
              disabled={busyAction !== null}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
            >
              Discard Changes
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={busyAction !== null || !hasUnsavedChanges}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{busyAction === 'save-config' ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>

      {/* Domain Tab Switcher */}
      <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
        {CONFIG_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const isModified = modifiedSections.includes(tab.label);
          return (
            <a
              key={tab.id}
              href={getRoutePath('config', { configTab: tab.id })}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                  return;
                }
                e.preventDefault();
                setActiveTab(tab.id);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#2563EB]' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
              {isModified && (
                <span className="text-[10px] font-semibold text-amber-600 ml-0.5">*</span>
              )}
            </a>
          );
        })}
      </div>

      {/* Unsaved Changes & Validation Notice */}
      {validationError && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {hasUnsavedChanges && !validationError && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Unsaved modifications in{' '}
              <strong>{modifiedSections.join(', ')}</strong>. Save configuration to enforce across
              the ledger.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleDiscard}
              className="font-medium underline underline-offset-2 hover:opacity-80 cursor-pointer"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={busyAction !== null}
              className="px-3 py-1 font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded cursor-pointer"
            >
              Save Now
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: COMPANY & TAX PROFILE */}
      {activeTab === 'company' && (
        <form
          onSubmit={handleSave}
          className="bg-white border border-[#001F60] rounded-lg overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
            <h2 className="text-sm font-semibold text-slate-900">
              Company Identity & Statutory Registrations
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Appears on statutory Financial Statements, printed vouchers, and CSV exports
            </p>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Organization Legal Name
                </label>
                <input
                  type="text"
                  value={draft.organizationName}
                  onChange={(e) => setDraft({ ...draft, organizationName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Entity Classification
                </label>
                <input
                  type="text"
                  value={draft.legalEntityType || ''}
                  onChange={(e) => setDraft({ ...draft, legalEntityType: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  BIN / VAT Registration No.
                </label>
                <input
                  type="text"
                  value={draft.binVatNumber || ''}
                  onChange={(e) => setDraft({ ...draft, binVatNumber: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  e-TIN Tax Identification No.
                </label>
                <input
                  type="text"
                  value={draft.tinNumber || ''}
                  onChange={(e) => setDraft({ ...draft, tinNumber: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trade License Reference
                </label>
                <input
                  type="text"
                  value={draft.tradeLicenseNo || ''}
                  onChange={(e) => setDraft({ ...draft, tradeLicenseNo: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Registered Office Address
                </label>
                <input
                  type="text"
                  value={draft.registeredAddress || ''}
                  onChange={(e) => setDraft({ ...draft, registeredAddress: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Finance Desk Telephone
                </label>
                <input
                  type="text"
                  value={draft.contactPhone || ''}
                  onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>
            </div>

            {/* Currency & Statutory Tax Defaults */}
            <div className="pt-6 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Reporting Currency & Statutory Tax Defaults
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Base currency formatting and default Bangladesh VAT, TDS, and VDS percentages applied to new vouchers
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Currency Code
                  </label>
                  <input
                    type="text"
                    value={draft.currencyCode}
                    onChange={(e) =>
                      setDraft({ ...draft, currencyCode: e.target.value.toUpperCase().slice(0, 6) })
                    }
                    className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Symbol
                  </label>
                  <input
                    type="text"
                    value={draft.currencySymbol}
                    onChange={(e) =>
                      setDraft({ ...draft, currencySymbol: e.target.value.slice(0, 4) })
                    }
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Decimals
                  </label>
                  <select
                    value={draft.decimalPlaces ?? 2}
                    onChange={(e) => setDraft({ ...draft, decimalPlaces: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  >
                    <option value={0}>0</option>
                    <option value={2}>2 (Standard)</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default VAT (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={draft.defaultVatPct ?? 15}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultVatPct: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default TDS (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={draft.defaultTdsPct ?? 5}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultTdsPct: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default VDS (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={draft.defaultVdsPct ?? 7.5}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultVdsPct: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: VOUCHERS & APPROVALS */}
      {activeTab === 'vouchers' && (
        <div className="space-y-6">
          {/* Voucher Numbering Series */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
              <h2 className="text-sm font-semibold text-slate-900">
                Document & Voucher Numbering Series
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure prefixes, zero-padding width, and next sequence numbers with live format preview
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-[#2563EB] text-white text-xs font-medium">
                    <th className="py-2.5 px-6">Voucher Type</th>
                    <th className="py-2.5 px-4">Prefix</th>
                    <th className="py-2.5 px-4 w-32">Zero Padding</th>
                    <th className="py-2.5 px-4 w-36">Next Sequence</th>
                    <th className="py-2.5 px-6 text-right">Live Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {VOUCHER_SERIES_META.map((meta) => {
                    const rule = draft.voucherNumbering![meta.key];
                    return (
                      <tr key={meta.key} className="hover:bg-slate-50/70">
                        <td className="py-3 px-6">
                          <div className="font-medium text-slate-900">{meta.label}</div>
                          <div className="text-[11px] text-slate-500">{meta.module}</div>
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="text"
                            value={rule.prefix}
                            onChange={(e) =>
                              updateVoucherSeries(meta.key, {
                                prefix: e.target.value.toUpperCase().slice(0, 16),
                              })
                            }
                            className="w-36 px-2.5 py-1.5 text-xs font-mono uppercase border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={rule.padding}
                            onChange={(e) =>
                              updateVoucherSeries(meta.key, { padding: Number(e.target.value) })
                            }
                            className="w-24 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                          >
                            {[3, 4, 5, 6].map((p) => (
                              <option key={p} value={p}>
                                {p} digits
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            min={1}
                            value={rule.nextSequence}
                            onChange={(e) =>
                              updateVoucherSeries(meta.key, {
                                nextSequence: Math.max(1, parseInt(e.target.value, 10) || 1),
                              })
                            }
                            className="w-28 px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                          />
                        </td>
                        <td className="py-3 px-6 text-right font-mono font-semibold text-[#2563EB] tabular-nums">
                          {formatSeriesPreview(rule)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Approval Thresholds & Posting Controls */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
              <h2 className="text-sm font-semibold text-slate-900">
                Approval Thresholds & Real-Time Compliance Guardrails
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Monetary limits governing auto-approval vs. dual-controller signoff and pre-posting checks
              </p>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Auto-Approval Ceiling ({draft.currencyCode})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1000"
                    value={draft.autoApproveLimit ?? 250000}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        autoApproveLimit: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Vouchers up to{' '}
                    <span className="font-mono font-medium text-slate-700">
                      {formatBDT(draft.autoApproveLimit ?? 0)}
                    </span>{' '}
                    qualify for single-step auto-approval.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dual-Signoff Controller Threshold ({draft.currencyCode})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1000"
                    value={draft.dualApprovalThreshold ?? 1000000}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        dualApprovalThreshold: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Disbursements above{' '}
                    <span className="font-mono font-medium text-slate-700">
                      {formatBDT(draft.dualApprovalThreshold ?? 0)}
                    </span>{' '}
                    flag mandatory Finance Controller countersignature.
                  </p>
                </div>
              </div>

              <div className="pt-5 border-t border-slate-200 space-y-3.5">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enforceLiquidityCheck ?? true}
                    onChange={(e) => setDraft({ ...draft, enforceLiquidityCheck: e.target.checked })}
                    className="mt-1 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Enforce Cash & Bank Liquidity Verification
                    </div>
                    <div className="text-xs text-slate-500">
                      Verify paid-from bank or cash accounts hold sufficient balance prior to posting Payment and Expense Vouchers.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enforceBudgetCheck ?? true}
                    onChange={(e) => setDraft({ ...draft, enforceBudgetCheck: e.target.checked })}
                    className="mt-1 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Enforce Departmental Corporate Budget Guardrails
                    </div>
                    <div className="text-xs text-slate-500">
                      Validate departmental cost-center allocations on Expense Vouchers against remaining fiscal budget.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.requireVoucherNarration ?? true}
                    onChange={(e) => setDraft({ ...draft, requireVoucherNarration: e.target.checked })}
                    className="mt-1 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Require Mandatory Voucher Narration
                    </div>
                    <div className="text-xs text-slate-500">
                      Ensure every manual journal and payment entry carries an auditable transaction explanation.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: FISCAL & PERIOD LOCKS */}
      {activeTab === 'fiscal' && (
        <div className="space-y-6">
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
              <h2 className="text-sm font-semibold text-slate-900">
                Fiscal Year Calendar & Global Posting Cutoff
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Server-enforced date guardrails block new journal and voucher postings inside locked periods
              </p>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Active Fiscal Period Label
                  </label>
                  <input
                    type="text"
                    value={draft.fiscalPeriod}
                    onChange={(e) => setDraft({ ...draft, fiscalPeriod: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fiscal Start Date
                  </label>
                  <input
                    type="date"
                    value={draft.fiscalStartDate || '2024-07-01'}
                    onChange={(e) => setDraft({ ...draft, fiscalStartDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fiscal End Date
                  </label>
                  <input
                    type="date"
                    value={draft.fiscalEndDate || '2025-06-30'}
                    onChange={(e) => setDraft({ ...draft, fiscalEndDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Global Posting Lock Date
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={draft.globalLockDate || ''}
                      onChange={(e) =>
                        setDraft({ ...draft, globalLockDate: e.target.value || null })
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                    />
                    {draft.globalLockDate && (
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, globalLockDate: null })}
                        className="px-2.5 py-2 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowBackdatedEntries ?? true}
                    onChange={(e) => setDraft({ ...draft, allowBackdatedEntries: e.target.checked })}
                    className="mt-1 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Allow Backdated Entries in Open Periods
                    </div>
                    <div className="text-xs text-slate-500">
                      Permits recording adjustment entries on prior dates as long as the target month is unlocked and after the Global Lock Date.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowFutureDatedEntries ?? false}
                    onChange={(e) =>
                      setDraft({ ...draft, allowFutureDatedEntries: e.target.checked })
                    }
                    className="mt-1 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Allow Future-Dated Journal Postings
                    </div>
                    <div className="text-xs text-slate-500">
                      When disabled, the posting engine rejects vouchers dated beyond today&apos;s system calendar date.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </section>

          {/* Interactive 12-Month Period Lock Matrix */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  12-Month Accounting Period Lock Matrix
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any month to lock or reopen postings ·{' '}
                  <span className="font-mono text-slate-700">
                    {draft.lockedMonths?.length || 0} of 12 periods locked
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={lockThroughPriorMonth}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                >
                  Lock Prior Months
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, lockedMonths: [] })}
                  disabled={(draft.lockedMonths?.length || 0) === 0}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md disabled:opacity-45 whitespace-nowrap cursor-pointer"
                >
                  Unlock All
                </button>
              </div>
            </div>

            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {fiscalMonths.map((m) => {
                const isLocked = (draft.lockedMonths || []).includes(m.key);
                const count = txCountByMonth.get(m.key) || 0;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleMonthLock(m.key)}
                    className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      isLocked
                        ? 'bg-red-50/70 border-red-200 hover:bg-red-50'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {m.label} {m.shortYear}
                      </span>
                      {isLocked ? (
                        <Lock className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      ) : (
                        <LockOpen className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-slate-500 tabular-nums">{count} entries</span>
                      <span
                        className={`font-semibold ${
                          isLocked ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {isLocked ? 'Locked' : 'Open'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: ROLES & AUDIT RETENTION */}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          {/* Operator Identity & Role Selector */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
              <h2 className="text-sm font-semibold text-slate-900">
                Operator Identity & Active Role Governance
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Assign the default operator email recorded on journal postings and configure role-based capabilities
              </p>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Operator / Approver Email
                </label>
                <input
                  type="email"
                  value={draft.operatorEmail}
                  onChange={(e) => setDraft({ ...draft, operatorEmail: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Active Workspace Role Profile
                </label>
                <select
                  value={draft.activeRole || 'finance_controller'}
                  onChange={(e) =>
                    setDraft({ ...draft, activeRole: e.target.value as SystemRoleId })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                >
                  {ROLE_META.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} — {r.scope}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Role Permission Matrix */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
              <h2 className="text-sm font-semibold text-slate-900">
                Role-Based Access Control (RBAC) Matrix
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure segregation-of-duties permissions across finance personas
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[740px]">
                <thead>
                  <tr className="bg-[#2563EB] text-white text-xs font-medium">
                    <th className="py-2.5 px-6">Accounting Capability</th>
                    {ROLE_META.map((role) => (
                      <th key={role.id} className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div>{role.label}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {PERMISSION_ROWS.map((perm) => (
                    <tr key={perm.key} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-6">
                        <div className="font-medium text-slate-900">{perm.label}</div>
                        <div className="text-[11px] text-slate-500">{perm.desc}</div>
                      </td>
                      {ROLE_META.map((role) => {
                        const checked = draft.rolePermissions![role.id][perm.key];
                        const isControllerConfigLock =
                          role.id === 'finance_controller' && perm.key === 'canEditSystemConfig';
                        return (
                          <td key={role.id} className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isControllerConfigLock}
                              onChange={() => toggleRolePermission(role.id, perm.key)}
                              aria-label={`${role.label} - ${perm.label}`}
                              className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer disabled:opacity-50"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Audit Log Retention & Maintenance */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Audit Trail Retention & Export Controls
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Currently storing{' '}
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    {state.auditLogs.length}
                  </span>{' '}
                  immutable audit events (minimum 25 recent records are always protected)
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportAuditCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export Full Audit CSV</span>
              </button>
            </div>

            <div className="p-6 flex flex-col md:flex-row md:items-end justify-between gap-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 max-w-lg">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Retention Window (Days)
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={3650}
                    value={draft.auditRetentionDays ?? 365}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        auditRetentionDays: Math.max(30, parseInt(e.target.value, 10) || 365),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Maximum Retained Entries
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    step={50}
                    value={draft.maxAuditEntries ?? 1000}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        maxAuditEntries: Math.max(100, parseInt(e.target.value, 10) || 1000),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div className="shrink-0">
                {!confirmPrune ? (
                  <button
                    type="button"
                    onClick={() => setConfirmPrune(true)}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Run Retention Cleanup</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-700 font-medium">Prune expired logs?</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await onPruneAuditLog();
                        setConfirmPrune(false);
                      }}
                      disabled={busyAction !== null}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPrune(false)}
                      className="px-2 py-1.5 text-xs text-slate-600 hover:underline cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 5: BACKUP, RESTORE & DIAGNOSTICS */}
      {activeTab === 'backup' && (
        <div className="space-y-6">
          {/* Live Ledger Diagnostics */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Live Ledger Health & Storage Diagnostics
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time mathematical verification computed directly from authoritative workspace state
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('audit')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Open Reconciliation Audit</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              <div className="p-5">
                <div className="text-xs text-slate-500">Trial Balance Parity</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold">
                  {diagnostics.tb.isClosingBalanced ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-emerald-700">Balanced</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span className="text-red-700">Variance Detected</span>
                    </>
                  )}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                  Diff: {formatBDT(diagnostics.tb.closingDiff)}
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-slate-500">Balance Sheet Equation</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold">
                  {diagnostics.bs.isBalanced ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-emerald-700">Verified</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span className="text-red-700">Out of Balance</span>
                    </>
                  )}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                  Variance: {formatBDT(Math.abs(diagnostics.bs.variance))}
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-slate-500">Register Books Sync</div>
                <div className="mt-1.5 font-mono tabular-nums text-sm font-semibold text-slate-900">
                  {diagnostics.recon.reconciledCount} / {diagnostics.recon.totalChecked} Reconciled
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                  Pending Queue: {diagnostics.pendingSync} · Drafts: {diagnostics.unpostedLines}
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-slate-500">Workspace Footprint</div>
                <div className="mt-1.5 font-mono tabular-nums text-sm font-semibold text-slate-900">
                  {diagnostics.approxKb} KB
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                  {state.accounts.length} GL · {state.postedTransactions.length} Posted ·{' '}
                  {state.vouchers.length} Vouchers
                </div>
              </div>
            </div>
          </section>

          {/* External JSON Archive Export & Validated Restore */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  External JSON Archiving & Validated Restore
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Export ledger data and configuration settings as a downloadable JSON archive for off-system retention, or restore a verified backup
                </p>
              </div>
              {archiveSizeEstimateKb !== null && (
                <div className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                  Est. Size:{' '}
                  <span className="font-semibold text-slate-900">{archiveSizeEstimateKb} KB</span>
                </div>
              )}
            </div>

            <div className="p-6 space-y-5">
              {/* Archive Scope Selection */}
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-slate-700">Export Archive Scope</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {ARCHIVE_SCOPE_OPTIONS.map((opt) => {
                    const selected = archiveScope === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setArchiveScope(opt.id)}
                        className={`text-left p-3.5 rounded-md border transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#2563EB] bg-[#F8FAFC] ring-1 ring-[#2563EB]'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-xs font-semibold ${
                              selected ? 'text-[#2563EB]' : 'text-slate-900'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span
                            className={`w-3.5 h-3.5 rounded-full border shrink-0 mt-0.5 flex items-center justify-center ${
                              selected ? 'border-[#2563EB] bg-[#2563EB]' : 'border-slate-300'
                            }`}
                          >
                            {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                          {opt.subtitle}
                        </p>
                        <div className="mt-2 text-[11px] font-medium text-slate-600">
                          {opt.tag}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Serialization & Manifest Controls */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeDiagnosticsManifest}
                      onChange={(e) => setIncludeDiagnosticsManifest(e.target.checked)}
                      className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span>Include diagnostics & integrity manifest</span>
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={prettyPrintJson}
                      onChange={(e) => setPrettyPrintJson(e.target.checked)}
                      className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span>Pretty-print JSON (2-space indent)</span>
                  </label>
                </div>

                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                  FY {persistedConfig.fiscalPeriod} · {state.accounts.length} GL ·{' '}
                  {state.postedTransactions.length} Posted · {state.auditLogs.length} Audit
                </div>
              </div>

              {hasUnsavedChanges && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span>
                    Pending edits in {modifiedSections.join(', ')} are not saved yet. Exports capture the last saved configuration.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSave()}
                    disabled={busyAction !== null}
                    className="font-semibold text-amber-900 underline hover:text-amber-700 whitespace-nowrap cursor-pointer"
                  >
                    Save Changes First
                  </button>
                </div>
              )}

              {/* Primary Export & Restore Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportArchiveJson}
                  disabled={isExportingArchive}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  <span>{isExportingArchive ? 'Generating Archive...' : 'Export Archive JSON'}</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleSelectBackupFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busyAction !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  <span>Upload JSON Backup to Restore</span>
                </button>
              </div>

              {/* Last Exported Archive Receipt */}
              {lastArchiveReceipt && (
                <div className="pt-4 border-t border-slate-200 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-semibold text-slate-900">Archive Downloaded:</span>
                      <span className="font-mono text-[#2563EB] break-all">
                        {lastArchiveReceipt.filename}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500">
                      {lastArchiveReceipt.sizeKb} KB · {lastArchiveReceipt.scopeLabel} ·{' '}
                      {lastArchiveReceipt.exportedAt}
                    </div>
                  </div>

                  {lastArchiveReceipt.sha256 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pl-6 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-500 shrink-0">SHA-256:</span>
                        <code className="font-mono text-slate-700 truncate max-w-md lg:max-w-xl">
                          {lastArchiveReceipt.sha256}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyArchiveHash}
                        className="inline-flex items-center gap-1 text-[#2563EB] hover:underline font-medium shrink-0 cursor-pointer"
                      >
                        {copiedHash ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Checksum</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {backupError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{backupError}</span>
                </div>
              )}

              {backupPreview && (
                <div className="p-4 rounded-lg bg-[#F8FAFC] border border-slate-200 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Pre-Restore Snapshot Verification ·{' '}
                        <span className="font-mono text-[#2563EB]">{backupPreview.filename}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {backupPreview.organizationName} · FY {backupPreview.fiscalPeriod} ·{' '}
                        <span className="font-mono">
                          {(backupPreview.sizeBytes / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-700 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Schema Validated
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs pt-2 border-t border-slate-200">
                    <div>
                      <div className="text-slate-500">GL Accounts</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {backupPreview.accountsCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Posted Lines</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {backupPreview.postedCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Journal Lines</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {backupPreview.journalCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Vouchers</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {backupPreview.vouchersCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Templates</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {backupPreview.templatesCount}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-amber-800">
                      Confirming will replace all live workspace data with this snapshot.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBackupPreview(null)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmRestore}
                        disabled={busyAction !== null}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md cursor-pointer"
                      >
                        {busyAction === 'restore-backup' ? 'Restoring...' : 'Confirm Restore'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Workspace Baseline & Sample Data Reset Controls */}
              <div className="pt-5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Workspace Reset & Reference Dataset Controls
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Reload the ATCL 54-account opening baseline or seed sample FY 2024–25 transactions for testing
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  {!confirmLoadSample ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmLoadSample(true);
                        setConfirmReset(false);
                      }}
                      className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                    >
                      Load Sample Dataset
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-700">Load sample FY data?</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await onLoadSampleTransactions();
                          setConfirmLoadSample(false);
                        }}
                        disabled={busyAction !== null}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmLoadSample(false)}
                        className="px-2 py-1.5 text-xs text-slate-600 hover:underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {!confirmReset ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmReset(true);
                        setConfirmLoadSample(false);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md whitespace-nowrap cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset to ATCL Baseline</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-700 font-medium">Confirm full reset?</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await onResetWorkspace();
                          setConfirmReset(false);
                        }}
                        disabled={busyAction !== null}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                      >
                        Confirm Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReset(false)}
                        className="px-2 py-1.5 text-xs text-slate-600 hover:underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 6: INTEGRATIONS & APPS SCRIPT ARCHIVE */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          {/* Register Sync Policy */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC]">
              <h2 className="text-sm font-semibold text-slate-900">
                GL Register Synchronization Policy
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Control how Posted Journal Store entries synchronize to individual 15-column GL Register Books
              </p>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    GL Registers Folder Designation
                  </label>
                  <input
                    type="text"
                    value={draft.driveFolderName}
                    onChange={(e) => setDraft({ ...draft, driveFolderName: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Last Register Sync Timestamp
                  </label>
                  <div className="px-3 py-2 text-sm font-mono tabular-nums text-slate-600 bg-slate-50 border border-slate-200 rounded-md">
                    {persistedConfig.lastSyncTimestamp
                      ? persistedConfig.lastSyncTimestamp.replace('T', ' ').slice(0, 19) + ' UTC'
                      : 'Not synced yet'}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.autoSyncOnPost}
                    onChange={(e) => setDraft({ ...draft, autoSyncOnPost: e.target.checked })}
                    className="mt-1 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Auto-Synchronize Register Books Immediately on Voucher Post
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      When enabled, posting approved vouchers immediately appends entries to each individual 15-column GL Register Book. Disable to queue posted entries as PENDING so you can test manual Batch Sync and Reconciliation Discrepancy Self-Healing.
                    </div>
                  </div>
                </label>
              </div>

              {/* Google Sheets Sync Manager (15-Tab Central Master Workbook) */}
              {(() => {
                const syncMeta = persistedConfig.googleMasterSync;
                const syncStatus = syncMeta?.status || 'Pending';
                const statusStyles: Record<string, string> = {
                  Synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
                  Failed: 'bg-rose-50 text-rose-700 border-rose-200',
                  Conflict: 'bg-orange-50 text-orange-700 border-orange-200',
                };
                const conflicts = syncMeta?.pendingConflicts || [];
                const history = syncMeta?.syncHistory || [];
                const tabMap = syncMeta?.tabs || {};
                const syncedTabCount = MASTER_WORKBOOK_TABS.filter((t) => tabMap[t.tabId]?.status === 'Synced').length;

                return (
                  <div className="pt-4 border-t border-slate-200 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            Google Sheets Sync Manager — {MASTER_WORKBOOK_TITLE}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${
                              statusStyles[syncStatus] || statusStyles.Pending
                            }`}
                          >
                            {syncStatus}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Account: <strong>{syncMeta?.connectedEmail || auth.currentUser?.email || 'Not connected'}</strong>
                          {' · '}Tabs Synced: <strong>{syncedTabCount}/15</strong>
                          {' · '}Conflicts: <strong>{conflicts.length}</strong>
                          {' · '}Last Push:{' '}
                          <span className="font-mono">
                            {syncMeta?.lastSyncAt ? syncMeta.lastSyncAt.replace('T', ' ').slice(0, 19) : 'Never'}
                          </span>
                          {' · '}Last Reverse:{' '}
                          <span className="font-mono">
                            {syncMeta?.lastReverseSyncAt
                              ? syncMeta.lastReverseSyncAt.replace('T', ' ').slice(0, 19)
                              : 'Never'}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={googleBusy}
                          onClick={handleProvisionDriveFolder}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-60"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                          <span>Provision Workbook &amp; 15 Tabs</span>
                        </button>
                        <button
                          type="button"
                          disabled={googleBusy}
                          onClick={() => handleSyncLedgerToGoogle()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#173B5C] rounded-md cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${googleBusy ? 'animate-spin' : ''}`} />
                          <span>{googleBusy ? 'Syncing...' : 'Sync All'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={googleBusy}
                          onClick={() => handleImportSheetChanges()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-md cursor-pointer disabled:opacity-60"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Import Sheet Changes</span>
                        </button>
                      </div>
                    </div>

                    {googleError && (
                      <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">
                        {googleError}
                      </div>
                    )}

                    {googleNotice && (
                      <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                        {googleNotice}
                      </div>
                    )}

                    {(syncMeta?.folderUrl || syncMeta?.workbookUrl) && (
                      <div className="flex flex-wrap items-center gap-3">
                        {syncMeta?.folderUrl && (
                          <a
                            href={syncMeta.folderUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center gap-2 text-xs font-medium text-slate-800"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                            <span>Drive Folder: {syncMeta.folderName}</span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </a>
                        )}
                        {syncMeta?.workbookUrl && (
                          <a
                            href={syncMeta.workbookUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 inline-flex items-center gap-2 text-xs font-semibold text-emerald-800"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Open Master Workbook ({MASTER_WORKBOOK_TITLE})</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}

                    {/* 15 Worksheet Tabs Matrix */}
                    <div className="border border-slate-200 rounded-md overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                        <span>15 Live ERP Worksheet Tabs</span>
                        <span className="text-[11px] font-normal text-slate-500">
                          Click Open Tab, Sync Tab (ERP → Sheet), or Import Tab (Sheet → ERP)
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-left text-[11px] border-collapse">
                          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                            <tr>
                              <th className="px-3 py-2">#</th>
                              <th className="px-3 py-2">Worksheet Tab</th>
                              <th className="px-3 py-2">ERP Module</th>
                              <th className="px-3 py-2">Rows</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Last Synced</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {MASTER_WORKBOOK_TABS.map((spec) => {
                              const meta = tabMap[spec.tabId];
                              const tStatus = meta?.status || 'Pending';
                              const tabUrl =
                                syncMeta?.workbookUrl && meta?.sheetGid !== undefined
                                  ? `${syncMeta.workbookUrl}#gid=${meta.sheetGid}`
                                  : syncMeta?.workbookUrl;
                              return (
                                <tr key={spec.tabId} className="hover:bg-slate-50/70">
                                  <td className="px-3 py-2 font-mono text-slate-500">{spec.no}</td>
                                  <td className="px-3 py-2 font-semibold text-slate-900">
                                    <div>{spec.sheetName}</div>
                                    <div className="text-[10px] font-normal text-slate-400">
                                      {spec.reversePolicy}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-slate-600">{spec.moduleLabel}</td>
                                  <td className="px-3 py-2 font-mono tabular-nums">
                                    {meta?.recordCount ?? '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                                        statusStyles[tStatus] || statusStyles.Pending
                                      }`}
                                    >
                                      {tStatus}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                                    {meta?.lastSyncedAt ? meta.lastSyncedAt.replace('T', ' ').slice(0, 19) : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-1.5">
                                    {tabUrl && (
                                      <a
                                        href={tabUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                                      >
                                        <span>Open</span>
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    )}
                                    <button
                                      type="button"
                                      disabled={googleBusy}
                                      onClick={() => handleSyncLedgerToGoogle(spec.tabId)}
                                      className="px-2 py-1 rounded bg-[#2563EB] text-white hover:bg-[#173B5C] cursor-pointer disabled:opacity-50"
                                    >
                                      Sync Tab
                                    </button>
                                    <button
                                      type="button"
                                      disabled={googleBusy}
                                      onClick={() => handleImportSheetChanges(spec.tabId)}
                                      className="px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer disabled:opacity-50"
                                    >
                                      Import
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Conflicts & Controlled Approval Queue */}
                    {conflicts.length > 0 && (
                      <div className="border border-orange-200 rounded-md bg-orange-50/50 p-3 space-y-2">
                        <div className="text-xs font-semibold text-orange-900">
                          Conflicts &amp; Protected Edits Queue ({conflicts.length})
                        </div>
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {conflicts.map((c) => (
                            <div
                              key={c.id}
                              className="p-2.5 rounded bg-white border border-orange-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                            >
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-900">
                                  [{c.sheet}] {c.recordKey} — {c.field}
                                </div>
                                <div className="text-slate-600">{c.message}</div>
                                <div className="text-[11px] font-mono text-slate-500">
                                  System: {c.appValue} | Sheet: {c.sheetValue}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleResolveConflictAction(c.id, 'KEEP_SYSTEM')}
                                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 font-medium cursor-pointer"
                                >
                                  Keep System
                                </button>
                                {c.actionType === 'COA_CONFLICT' && c.rawRow && (
                                  <button
                                    type="button"
                                    onClick={() => handleResolveConflictAction(c.id, 'APPLY_SHEET')}
                                    className="px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 font-medium cursor-pointer"
                                  >
                                    Apply Sheet
                                  </button>
                                )}
                                {c.actionType === 'REVERSAL_PROPOSAL' && (
                                  <button
                                    type="button"
                                    onClick={() => handleResolveConflictAction(c.id, 'STAGE_REVERSAL')}
                                    className="px-2.5 py-1 rounded bg-amber-600 text-white hover:bg-amber-500 font-medium cursor-pointer"
                                  >
                                    Stage Reversal
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Synchronization History */}
                    {history.length > 0 && (
                      <div className="border border-slate-200 rounded-md overflow-hidden">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                          Synchronization Audit History (Latest {Math.min(history.length, 15)})
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          <table className="w-full text-left text-[11px] border-collapse">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                              <tr>
                                <th className="px-3 py-1.5">Time</th>
                                <th className="px-3 py-1.5">Direction</th>
                                <th className="px-3 py-1.5">Tab / Key</th>
                                <th className="px-3 py-1.5">Summary</th>
                                <th className="px-3 py-1.5">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {history.slice(0, 15).map((h) => (
                                <tr key={h.id}>
                                  <td className="px-3 py-1.5 font-mono text-slate-500 whitespace-nowrap">
                                    {h.timestamp.replace('T', ' ').slice(0, 19)}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono">{h.direction}</td>
                                  <td className="px-3 py-1.5">
                                    {h.sheet} ({h.recordKey})
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-700">{h.summary}</td>
                                  <td className="px-3 py-1.5 font-semibold">{h.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </section>

          {/* Google Apps Script Companion Modules Archive */}
          <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Google Apps Script Companion Modules (.gs)
                  </h2>
                  <p className="text-xs text-slate-500">
                    {scripts.length} spreadsheet automation source module{scripts.length === 1 ? '' : 's'} included in the ATCL accounting package
                  </p>
                </div>
              </div>

              {activeScript && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyScript}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copied ? 'Copied' : 'Copy Code'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadScript}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .gs</span>
                  </button>
                  {scripts.some((s) => s.filename.toLowerCase().includes('bundled')) && (
                    <button
                      type="button"
                      onClick={handleDownloadBundledScript}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#2563EB] bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Bundled_Code.gs</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {scripts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No Google Apps Script companion modules found in the workspace archive.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12">
                <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 p-3 space-y-2 bg-slate-50/50">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={scriptSearch}
                      onChange={(e) => setScriptSearch(e.target.value)}
                      placeholder="Filter modules..."
                      className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                    />
                  </div>
                  <div className="space-y-1 max-h-[410px] overflow-y-auto ledger-scroll">
                    {filteredScripts.map((s) => (
                      <button
                        key={s.filename}
                        type="button"
                        onClick={() => setSelectedScript(s.filename)}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-mono transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                          activeScript?.filename === s.filename
                            ? 'bg-[#2563EB] text-white font-medium'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="truncate">{s.filename}</span>
                        <span
                          className={`text-[10px] tabular-nums shrink-0 ${
                            activeScript?.filename === s.filename ? 'text-white/75' : 'text-slate-400'
                          }`}
                        >
                          {(s.sizeBytes / 1024).toFixed(1)} KB
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-9 bg-[#0F172A] text-slate-200 p-4 overflow-x-auto max-h-[460px] ledger-scroll">
                  <pre className="text-xs font-mono leading-relaxed whitespace-pre">
                    <code>{activeScript?.content}</code>
                  </pre>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 7: CUSTOM INSTRUCTIONS & AI GOVERNANCE */}
      {activeTab === 'custom-instructions' && (
        <CustomInstructionsTab
          value={hydrateCustomInstructions(draft.customInstructions)}
          busyAction={busyAction}
          onChange={(nextCi) => setDraft({ ...draft, customInstructions: nextCi })}
          onDocumentMutated={(nextState, message) => {
            onCustomInstructionsDocMutated?.(nextState, message);
          }}
        />
      )}

      {/* TAB 8: VECTORIZED DOCUMENT STORE */}
      {activeTab === 'document-store' && (
        <DocumentStoreTab
          documents={hydrateCustomInstructions(draft.customInstructions).knowledge.documents}
          onDocumentsUpdated={(nextState, message) => {
            onCustomInstructionsDocMutated?.(nextState, message);
          }}
        />
      )}
    </div>
  );
};

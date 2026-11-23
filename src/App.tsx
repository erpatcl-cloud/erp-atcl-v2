import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from './components/Layout.tsx';
import { ControlDashboard } from './components/ControlDashboard.tsx';
import { ChartOfAccounts } from './components/ChartOfAccounts.tsx';
import { RegisterBookView } from './components/RegisterBookView.tsx';
import { MasterJournal, VoucherComposerModal } from './components/MasterJournal.tsx';
import { PostedStoreView } from './components/PostedStoreView.tsx';
import { BankTreasuryPage } from './components/BankTreasuryPage.tsx';
import { TaxCompliancePage } from './components/TaxCompliancePage.tsx';
import { FixedAssetsPage } from './components/FixedAssetsPage.tsx';
import { MonthEndClosingPage } from './components/MonthEndClosingPage.tsx';
import { FinancialReports } from './components/FinancialReports.tsx';
import { AuditReconciliation } from './components/AuditReconciliation.tsx';
import { ApprovalQueuePage } from './components/ApprovalQueuePage.tsx';
import { SystemConfigView } from './components/SystemConfigView.tsx';
import { ProductsItemsPage } from './components/ProductsItemsPage.tsx';
import { Customers360Page } from './components/Customers360Page.tsx';
import { SuppliersPage } from './components/SuppliersPage.tsx';
import { MasterDataAuditPage } from './components/MasterDataAuditPage.tsx';
import { LocalProcurementPage } from './components/LocalProcurementPage.tsx';
import { PurchaseRequisitionPage } from './components/PurchaseRequisitionPage.tsx';
import { SupplierQuotationPage } from './components/SupplierQuotationPage.tsx';
import { GoodsReceiptPage } from './components/GoodsReceiptPage.tsx';
import { PurchaseInvoicePage } from './components/PurchaseInvoicePage.tsx';
import { AccountsPayablePage } from './components/AccountsPayablePage.tsx';
import { PurchaseReturnsPage } from './components/PurchaseReturnsPage.tsx';
import { ImportLCManagementPage } from './components/ImportLCManagementPage.tsx';
import { LandedCostAllocationPage } from './components/LandedCostAllocationPage.tsx';
import { InventorySerialRegisterPage } from './components/InventorySerialRegisterPage.tsx';
import { ProcurementReportsPage } from './components/ProcurementReportsPage.tsx';
import { SalesDistributionPage } from './components/SalesDistributionPage.tsx';
import { SalesQuotationPage } from './components/SalesQuotationPage.tsx';
import { DeliveryOrdersPage } from './components/DeliveryOrdersPage.tsx';
import { SalesInvoicePage } from './components/SalesInvoicePage.tsx';
import { SalesReturnsPage } from './components/SalesReturnsPage.tsx';
import { SalesReportsPage } from './components/SalesReportsPage.tsx';
import { RetailCounterPosPage } from './components/RetailCounterPosPage.tsx';
import { WarrantyManagementPage } from './components/WarrantyManagementPage.tsx';
import { ServiceWorkshopPage } from './components/ServiceWorkshopPage.tsx';
import { SparePartsInventoryPage } from './components/SparePartsInventoryPage.tsx';
import { TenderProjectsPage } from './components/TenderProjectsPage.tsx';
import { VoucherManagementPage } from './components/VoucherManagementPage.tsx';
import type { User } from 'firebase/auth';
import { TemplateStudioPage } from './components/TemplateStudioPage.tsx';
import { WorkspaceHubPage } from './components/WorkspaceHubPage.tsx';
import { CustomInstructionsDrawer } from './components/CustomInstructionsDrawer.tsx';
import { ErpAssistantDrawer } from './components/ErpAssistantDrawer.tsx';
import { api } from './lib/api.ts';
import { auth, getAccessToken } from './lib/firebase.ts';
import { pushMasterWorkbook } from './lib/googleMasterWorkbookSync.ts';
import { googleSignIn, initAuth, logout } from './lib/firebase.ts';
import {
  getUserRole,
  loadLedgerStateFromFirestore,
  syncUserProfile,
  type ErpUserRole,
} from './lib/firestoreSync.ts';
import {
  getPersistenceSyncStatus,
  hydrateLocalLedgerFromCloud,
  type PersistenceSyncStatus,
} from './lib/localLedgerFallback.ts';
import { applyCustomStyleToDocument } from './lib/themeUtils.ts';
import {
  getPageTitle,
  getRoutePath,
  parseLocationPath,
  type ConfigTabId,
} from './lib/routes.ts';
import type {
  AccountCategory,
  ActiveRoute,
  CustomerRecord,
  DocumentTemplateRecord,
  ImportLCFile,
  InventorySerialUnit,
  LedgerState,
  LocalPurchaseOrder,
  PosTransaction,
  ProductItem,
  ReconciliationResult,
  SalesOrderRecord,
  ServiceJobCard,
  SparePartItem,
  SupplierRecord,
  VoucherRecord,
  WarrantyClaimRecord,
} from './types/accounting.ts';

export default function App() {
  const initialLocation = useMemo(() => parseLocationPath(window.location.pathname), []);
  const [state, setState] = useState<LedgerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>(initialLocation.route);
  const [selectedRegisterCode, setSelectedRegisterCode] = useState<string>(
    initialLocation.registerCode || '1240'
  );
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTabId>(
    initialLocation.configTab || 'company'
  );
  const [showVoucherComposer, setShowVoucherComposer] = useState(false);
  const [showCustomInstructionsDrawer, setShowCustomInstructionsDrawer] = useState(false);
  const [showAssistantDrawer, setShowAssistantDrawer] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastAuditResult, setLastAuditResult] = useState<ReconciliationResult | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<ErpUserRole>('viewer');
  const [syncStatus, setSyncStatus] = useState<PersistenceSyncStatus>(() =>
    getPersistenceSyncStatus()
  );
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );

  const notify = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setFirebaseUser(user);
        setWorkspaceToken(token);
        setAuthReady(true);
        void getUserRole(user).then(setUserRole);
        if (user.emailVerified) {
          void loadLedgerStateFromFirestore()
            .then((cloud) => {
              if (cloud) {
                const next = hydrateLocalLedgerFromCloud(cloud.state, cloud.version);
                setState(next);
              }
              setSyncStatus(getPersistenceSyncStatus());
            })
            .catch(() => {
              setSyncStatus(getPersistenceSyncStatus());
            });
        }
      },
      () => {
        setFirebaseUser(null);
        setUserRole('viewer');
        setWorkspaceToken(null);
        setAuthReady(true);
        setSyncStatus(getPersistenceSyncStatus());
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSyncStatus(getPersistenceSyncStatus());
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthBusy(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setFirebaseUser(result.user);
        setWorkspaceToken(result.accessToken);
        await syncUserProfile(
          result.user,
          true,
          state?.config.organizationName || 'Advance Technology Consortium Ltd.'
        );
        notify('success', `Connected Google account (${result.user.email || result.user.displayName}).`);
      }
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Google Sign-In did not complete.'
      );
    } finally {
      setAuthBusy(false);
    }
  }, [notify, state?.config.organizationName]);

  const handleGoogleSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      await logout();
      setFirebaseUser(null);
      setWorkspaceToken(null);
      notify('info', 'Signed out of Google Workspace & Firebase.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Sign-out failed.');
    } finally {
      setAuthBusy(false);
    }
  }, [notify]);

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await api.getState();
      setState(res.state);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load ledger state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Keep document theme, density, and accent color synced with persisted Custom Instructions
  useEffect(() => {
    if (state?.config?.customInstructions?.style) {
      applyCustomStyleToDocument(state.config.customInstructions.style);
    }
  }, [state?.config?.customInstructions?.style]);

  const unpostedVoucherCount = useMemo(() => {
    if (!state) return 0;
    return new Set(
      state.journalLines.filter((l) => l.postingStatus !== 'POSTED').map((l) => l.voucherNo)
    ).size;
  }, [state]);

  const pendingSyncCount = useMemo(() => {
    if (!state) return 0;
    return state.postedTransactions.filter((t) => t.registerSynced === 'PENDING').length;
  }, [state]);

  const suggestedVoucherNo = useMemo(() => {
    if (!state) return 'JV-25-007';
    const existingNums = state.journalLines
      .map((l) => {
        const m = /^JV-25-(\d+)$/.exec(l.voucherNo);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const next = (existingNums.length > 0 ? Math.max(...existingNums) : 6) + 1;
    return `JV-25-${String(next).padStart(3, '0')}`;
  }, [state]);

  const navigateTo = useCallback(
    (
      route: ActiveRoute,
      options?: { registerCode?: string; configTab?: ConfigTabId; replace?: boolean }
    ) => {
      const nextRegisterCode = options?.registerCode ?? selectedRegisterCode;
      const nextConfigTab = options?.configTab ?? (route === 'config' ? activeConfigTab : 'company');

      setActiveRoute(route);
      if (options?.registerCode) {
        setSelectedRegisterCode(options.registerCode);
      }
      if (options?.configTab) {
        setActiveConfigTab(options.configTab);
      }

      const targetPath = getRoutePath(route, {
        registerCode: route === 'registers' ? nextRegisterCode : undefined,
        configTab: route === 'config' ? nextConfigTab : undefined,
      });

      if (window.location.pathname !== targetPath) {
        if (options?.replace) {
          window.history.replaceState({ route }, '', targetPath);
        } else {
          window.history.pushState({ route }, '', targetPath);
        }
      }
      window.scrollTo({ top: 0 });
    },
    [selectedRegisterCode, activeConfigTab]
  );

  // Normalize initial alias/root path to canonical URL and sync browser Back/Forward navigation
  useEffect(() => {
    const canonicalInitial = getRoutePath(initialLocation.route, {
      registerCode:
        initialLocation.route === 'registers' ? initialLocation.registerCode || '1240' : undefined,
      configTab:
        initialLocation.route === 'config' ? initialLocation.configTab || 'company' : undefined,
    });
    if (window.location.pathname !== canonicalInitial) {
      window.history.replaceState({ route: initialLocation.route }, '', canonicalInitial);
    }

    const handlePopState = () => {
      const parsed = parseLocationPath(window.location.pathname);
      setActiveRoute(parsed.route);
      if (parsed.registerCode) {
        setSelectedRegisterCode(parsed.registerCode);
      }
      if (parsed.configTab) {
        setActiveConfigTab(parsed.configTab);
      } else if (parsed.route === 'config') {
        setActiveConfigTab('company');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [initialLocation]);

  // Keep browser tab title synchronized with active page
  useEffect(() => {
    document.title = getPageTitle(activeRoute, {
      registerCode: activeRoute === 'registers' ? selectedRegisterCode : undefined,
    });
  }, [activeRoute, selectedRegisterCode]);

  const handleOpenRegister = useCallback(
    (code: string) => {
      navigateTo('registers', { registerCode: code });
    },
    [navigateTo]
  );

  const handleSelectRegister = useCallback(
    (code: string) => {
      navigateTo('registers', { registerCode: code });
    },
    [navigateTo]
  );

  const handleConfigTabChange = useCallback(
    (tab: ConfigTabId) => {
      navigateTo('config', { configTab: tab });
    },
    [navigateTo]
  );

  const runAction = useCallback(
    async <T,>(actionKey: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        setBusyAction(actionKey);
        return await fn();
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Operation failed.');
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [notify]
  );

  const handleAddAccount = async (payload: {
    code: string;
    name: string;
    category: AccountCategory;
    group: string;
    openingBalance: number;
    autoCreateRegister: boolean;
  }) => {
    const res = await api.addAccount(payload);
    setState(res.state);
    notify('success', `Added GL Account ${payload.code} — ${payload.name}.`);
  };

  const handleToggleAccountStatus = async (code: string, nextStatus: 'Active' | 'Inactive') => {
    await runAction('toggle-status', async () => {
      const res = await api.updateAccount(code, { status: nextStatus });
      setState(res.state);
      notify('info', `GL Account ${code} marked ${nextStatus}.`);
    });
  };

  const handleValidateCOA = async () => {
    const res = await runAction('validate-coa', () => api.validateCOA());
    if (!res) return null;
    setState(res.state);
    if (res.result.isValid) {
      notify('success', `Chart of Accounts validated: ${res.result.totalAccounts} accounts verified, 0 duplicates.`);
    } else {
      notify('error', `COA Validation detected ${res.result.errors.length} issue(s).`);
    }
    return res.result;
  };

  const handleCreateMissingRegisters = async () => {
    const res = await runAction('create-registers', () => api.createMissingRegisters());
    if (!res) return;
    setState(res.state);
    if (res.result.createdCount > 0) {
      notify('success', `Provisioned and linked ${res.result.createdCount} new GL Register Book(s).`);
    } else {
      notify('info', 'All active GL accounts already have provisioned Register Books.');
    }
  };

  const handleCreateVoucher = async (payload: {
    voucherNo: string;
    date: string;
    description: string;
    reference: string;
    counterparty: string;
    approvalStatus: 'DRAFT' | 'PENDING_APPROVAL';
    lines: Array<{ glCode: string; debit: number; credit: number }>;
  }) => {
    const res = await api.createVoucher(payload);
    setState(res.state);
    navigateTo('journal');
    notify('success', `Voucher ${res.voucherNo} recorded in Master Journal (${payload.lines.length} lines).`);
  };

  const handleDeleteDraft = async (voucherNo: string) => {
    const res = await runAction('delete-draft', () => api.deleteDraftVoucher(voucherNo));
    if (!res) return;
    setState(res.state);
    notify('info', `Removed unposted draft voucher ${voucherNo}.`);
  };

  const handleValidateJournal = async () => {
    const res = await runAction('validate-journal', () => api.validateJournal());
    if (!res) return;
    setState(res.state);
    if (res.result.totalVouchers === 0) {
      notify('info', 'No unposted vouchers found to validate.');
    } else if (res.result.invalidVouchers === 0) {
      notify('success', `Validated ${res.result.validVouchers} voucher(s) — all balanced and ready for approval.`);
    } else {
      notify(
        'error',
        `Validated ${res.result.totalVouchers} voucher(s): ${res.result.validVouchers} valid, ${res.result.invalidVouchers} with errors.`
      );
    }
  };

  const handleApproveJournal = async () => {
    const res = await runAction('approve-journal', () => api.approveJournal());
    if (!res) return;
    setState(res.state);
    if (res.result.approvedVouchers > 0) {
      notify(
        'success',
        `Approved ${res.result.approvedVouchers} voucher(s) (${res.result.approvedLines} lines) ready for posting.`
      );
    } else {
      notify('info', 'No validated unapproved vouchers available. Run Validate Entries first.');
    }
  };

  const handlePostJournal = async () => {
    const res = await runAction('post-journal', () => api.postJournal());
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    if (res.result.postedVouchers > 0) {
      const syncMsg =
        res.result.syncedLines > 0
          ? ` and synchronized ${res.result.syncedLines} lines across ${res.result.updatedRegisters} Register Book(s).`
          : ' (queued as PENDING for manual Register Sync).';
      notify(
        'success',
        `Posted ${res.result.postedVouchers} voucher(s) (${res.result.postedLines} lines) to Master Store${syncMsg}`
      );
    } else {
      notify('info', 'No approved unposted vouchers ready to post.');
    }
  };

  const handleReverseVoucher = async (voucherNo: string, reason: string) => {
    const res = await api.reverseVoucher(voucherNo, reason);
    setState(res.state);
    setLastAuditResult(null);
    notify(
      'success',
      `Reversal voucher ${res.result.reversalVoucherNo} created and posted (${res.result.linesReversed} inverted lines).`
    );
  };

  const handleSyncRegisters = async () => {
    const res = await runAction('sync-registers', () => api.syncRegisters());
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    if (res.result.syncedLines > 0) {
      notify(
        'success',
        `Synchronized ${res.result.syncedLines} posted line(s) across ${res.result.updatedRegisters} GL Register Book(s).`
      );
    } else {
      notify('info', 'All posted transactions are already synchronized to individual Register Books.');
    }
  };

  const handleRebuildRegister = async (code: string) => {
    const res = await runAction('rebuild-register', () => api.rebuildRegister(code));
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    notify(
      'success',
      `Rebuilt Register Book for GL ${code} with ${res.result.transactionCount} transaction(s). Running balance verified.`
    );
  };

  const handleRunReconciliation = async () => {
    const res = await runAction('reconcile', () => api.reconcileAll());
    if (!res) return;
    setState(res.state);
    setLastAuditResult(res.result);
    if (res.result.discrepancies.length === 0) {
      notify(
        'success',
        `Reconciliation Audit Passed: all ${res.result.totalChecked} active GL Register Books match Master Store with ৳0.00 variance.`
      );
    } else {
      notify(
        'error',
        `Reconciliation detected ${res.result.discrepancies.length} mismatched GL Register Book(s).`
      );
      navigateTo('audit');
    }
  };

  const handleSelfHeal = async () => {
    const res = await runAction('self-heal', () => api.selfHeal());
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    notify(
      'success',
      `Self-Healing complete: repaired and resynchronized ${res.result.healedCount} Register Book(s).`
    );
  };

  const handleSaveConfig = async (payload: Partial<LedgerState['config']>) => {
    const res = await runAction('save-config', () => api.updateConfig(payload));
    if (!res) return;
    setState(res.state);
    notify('success', 'System configuration updated.');
  };

  const handleApplyLedgerSyncState = async (nextState: LedgerState, message: string) => {
    const res = await runAction('apply-sync', () => api.restoreBackup(nextState));
    if (res?.state) {
      setState(res.state);
    } else {
      setState(nextState);
    }
    notify('success', message);
  };

  useEffect(() => {
    if (!state?.config?.autoSyncOnPost) return;
    if (!state.config.googleMasterSync?.workbookId) return;
    if (state.config.googleMasterSync?.status === 'Conflict') return;

    const timer = window.setTimeout(async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const email = auth.currentUser?.email || state.config.operatorEmail || 'erpatcl@gmail.com';
        const outcome = await pushMasterWorkbook(token, state, email, { force: false });
        if (outcome.tabsUpdated > 0) {
          const res = await api.restoreBackup(outcome.nextState);
          if (res?.state) setState(res.state);
        }
      } catch {
        // Keep silent on background auto-sync; manual Sync All surfaces full errors
      }
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [
    state?.accounts,
    state?.postedTransactions,
    state?.registers,
    state?.products,
    state?.customers,
    state?.suppliers,
    state?.localPurchaseOrders,
    state?.importLCs,
    state?.inventorySerials,
    state?.salesOrders,
    state?.posTransactions,
    state?.warrantyClaims,
    state?.serviceJobs,
    state?.spareParts,
    state?.vouchers,
    state?.config?.autoSyncOnPost,
    state?.config?.googleMasterSync?.workbookId,
  ]);

  const handleResetWorkspace = async () => {
    const res = await runAction('reset', () => api.resetWorkspace());
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    navigateTo('dashboard');
    notify('info', 'Ledger workspace reset to ATCL 54-account opening baseline.');
  };

  const handleLoadSampleTransactions = async () => {
    const res = await runAction('load-sample', () => api.loadSampleTransactions());
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    notify('success', 'Loaded sample FY 2024-2025 posted vouchers across GL Register Books and Financial Statements.');
  };

  const handleRestoreBackup = async (snapshot: Partial<LedgerState>) => {
    const res = await runAction('restore-backup', () => api.restoreBackup(snapshot));
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    notify(
      'success',
      `Backup restored: ${res.summary.accounts} accounts, ${res.summary.postedTransactions} posted transactions, and ${res.summary.vouchers} vouchers.`
    );
  };

  const handlePruneAuditLog = async () => {
    const res = await runAction('prune-audit', () => api.pruneAuditLog());
    if (!res) return;
    setState(res.state);
    notify(
      'info',
      res.result.removedCount > 0
        ? `Audit retention cleanup removed ${res.result.removedCount} expired entry(ies); ${res.result.remainingCount} retained.`
        : `Audit retention sweep complete: 0 expired entries removed (${res.result.remainingCount} retained).`
    );
  };

  const handleImportCOA = async (
    accounts: Array<{
      code: string;
      name: string;
      category: AccountCategory;
      group: string;
      openingBalance: number;
    }>
  ) => {
    const res = await api.importCOA(accounts);
    setState(res.state);
    setLastAuditResult(null);
    notify('success', `Imported ${res.importedCount} GL accounts from CSV and provisioned Register Books.`);
  };

  // Master Data: Products & Items handlers
  const handleCreateProduct = async (payload: Omit<ProductItem, 'id' | 'updatedAt'>) => {
    try {
      const res = await api.createProduct(payload);
      setState(res.state);
      notify('success', `Added catalog item ${res.product.sku} — ${res.product.name}.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Access Denied.');
      throw err;
    }
  };

  const handleUpdateProduct = async (
    id: string,
    payload: Partial<Omit<ProductItem, 'id' | 'updatedAt'>>
  ) => {
    try {
      const res = await api.updateProduct(id, payload);
      setState(res.state);
      notify('success', `Updated catalog item ${res.product.sku}.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Access Denied.');
      throw err;
    }
  };

  const handleDeleteProduct = async (id: string) => {
    const res = await runAction('delete-product', () => api.deleteProduct(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed catalog item from Products & Items.');
  };

  // Master Data: Customers 360° handlers
  const handleCreateCustomer = async (payload: Omit<CustomerRecord, 'id' | 'updatedAt'>) => {
    const res = await api.createCustomer(payload);
    setState(res.state);
    notify('success', `Added customer ${res.customer.code} — ${res.customer.name}.`);
  };

  const handleUpdateCustomer = async (
    id: string,
    payload: Partial<Omit<CustomerRecord, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateCustomer(id, payload);
    setState(res.state);
    notify('success', `Updated customer ${res.customer.code}.`);
  };

  const handleDeleteCustomer = async (id: string) => {
    const res = await runAction('delete-customer', () => api.deleteCustomer(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed customer record from Customers 360°.');
  };

  // Master Data: Suppliers handlers
  const handleCreateSupplier = async (payload: Omit<SupplierRecord, 'id' | 'updatedAt'>) => {
    const res = await api.createSupplier(payload);
    setState(res.state);
    notify('success', `Registered supplier ${res.supplier.code} — ${res.supplier.name}.`);
  };

  const handleUpdateSupplier = async (
    id: string,
    payload: Partial<Omit<SupplierRecord, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateSupplier(id, payload);
    setState(res.state);
    notify('success', `Updated supplier ${res.supplier.code}.`);
  };

  const handleDeleteSupplier = async (id: string) => {
    const res = await runAction('delete-supplier', () => api.deleteSupplier(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed supplier record from Suppliers directory.');
  };

  // Supply Chain: Local Procurement handlers
  const handleCreateLocalPO = async (payload: Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>) => {
    const res = await api.createLocalPO(payload);
    setState(res.state);
    notify('success', `Issued Local PO ${res.order.poNumber} for ${res.order.supplierName}.`);
  };

  const handleUpdateLocalPO = async (
    id: string,
    payload: Partial<Omit<LocalPurchaseOrder, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateLocalPO(id, payload);
    setState(res.state);
    notify('success', `Updated Local PO ${res.order.poNumber} (${res.order.status}).`);
  };

  const handleDeleteLocalPO = async (id: string) => {
    const res = await runAction('delete-local-po', () => api.deleteLocalPO(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed Local Purchase Order.');
  };

  // Supply Chain: Import & LC Management handlers
  const handleCreateImportLC = async (payload: Omit<ImportLCFile, 'id' | 'updatedAt'>) => {
    const res = await api.createImportLC(payload);
    setState(res.state);
    notify('success', `Opened Import LC ${res.lc.lcNumber} (${res.lc.issuingBank}).`);
  };

  const handleUpdateImportLC = async (
    id: string,
    payload: Partial<Omit<ImportLCFile, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateImportLC(id, payload);
    setState(res.state);
    notify('success', `Updated Import LC ${res.lc.lcNumber} (${res.lc.status}).`);
  };

  const handleDeleteImportLC = async (id: string) => {
    const res = await runAction('delete-import-lc', () => api.deleteImportLC(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed Import LC file.');
  };

  // Supply Chain: Inventory & Serial Register handlers
  const handleCreateSerialUnit = async (
    payload: Omit<InventorySerialUnit, 'id' | 'updatedAt'>
  ) => {
    const res = await api.createSerialUnit(payload);
    setState(res.state);
    notify('success', `Registered serialized unit ${res.serial.serialNumber}.`);
  };

  const handleUpdateSerialUnit = async (
    id: string,
    payload: Partial<Omit<InventorySerialUnit, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateSerialUnit(id, payload);
    setState(res.state);
    notify('success', `Updated serial unit ${res.serial.serialNumber} (${res.serial.status}).`);
  };

  const handleDeleteSerialUnit = async (id: string) => {
    const res = await runAction('delete-serial', () => api.deleteSerialUnit(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed serialized unit from Inventory Register.');
  };

  // Sales & Service: Sales & Distribution handlers
  const handleCreateSalesOrder = async (payload: Omit<SalesOrderRecord, 'id' | 'updatedAt'>) => {
    const res = await api.createSalesOrder(payload);
    setState(res.state);
    notify('success', `Created Sales Order ${res.order.orderNo} for ${res.order.customerName}.`);
  };

  const handleUpdateSalesOrder = async (
    id: string,
    payload: Partial<Omit<SalesOrderRecord, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateSalesOrder(id, payload);
    setState(res.state);
    notify('success', `Updated Sales Order ${res.order.orderNo} (${res.order.status}).`);
  };

  const handleDeleteSalesOrder = async (id: string) => {
    const res = await runAction('delete-sales-order', () => api.deleteSalesOrder(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed Sales Order from Sales & Distribution.');
  };

  // Sales & Service: Retail Counter POS handlers
  const handleCreatePosSale = async (
    payload: Omit<PosTransaction, 'id' | 'receiptNo' | 'updatedAt'>
  ) => {
    const res = await api.createPosSale(payload);
    setState(res.state);
    notify(
      'success',
      `Issued POS Receipt ${res.transaction.receiptNo} (${res.transaction.paymentMethod} → GL ${res.transaction.settlementGlCode}).`
    );
  };

  const handleVoidPosSale = async (id: string) => {
    const res = await runAction('void-pos', () => api.voidPosSale(id));
    if (!res) return;
    setState(res.state);
    notify('info', `Voided Counter Receipt ${res.transaction.receiptNo}.`);
  };

  const handleDeletePosSale = async (id: string) => {
    const res = await runAction('delete-pos', () => api.deletePosSale(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Deleted POS counter receipt.');
  };

  // Sales & Service: Warranty Management handlers
  const handleCreateWarrantyClaim = async (
    payload: Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>
  ) => {
    const res = await api.createWarrantyClaim(payload);
    setState(res.state);
    notify('success', `Logged Warranty Claim ${res.claim.claimNo} for S/N ${res.claim.serialNumber}.`);
  };

  const handleUpdateWarrantyClaim = async (
    id: string,
    payload: Partial<Omit<WarrantyClaimRecord, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateWarrantyClaim(id, payload);
    setState(res.state);
    notify('success', `Updated Warranty Claim ${res.claim.claimNo} (${res.claim.status}).`);
  };

  const handleDeleteWarrantyClaim = async (id: string) => {
    const res = await runAction('delete-warranty', () => api.deleteWarrantyClaim(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed Warranty Claim record.');
  };

  // Sales & Service: Service & Repair Workshop handlers
  const handleCreateServiceJob = async (payload: Omit<ServiceJobCard, 'id' | 'updatedAt'>) => {
    const res = await api.createServiceJob(payload);
    setState(res.state);
    notify('success', `Opened Job Card ${res.job.jobNo} (${res.job.equipmentName}).`);
  };

  const handleUpdateServiceJob = async (
    id: string,
    payload: Partial<Omit<ServiceJobCard, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateServiceJob(id, payload);
    setState(res.state);
    notify('success', `Updated Job Card ${res.job.jobNo} (${res.job.status}).`);
  };

  const handleDeleteServiceJob = async (id: string) => {
    const res = await runAction('delete-service-job', () => api.deleteServiceJob(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed Workshop Job Card.');
  };

  // Sales & Service: Spare Parts Inventory handlers
  const handleCreateSparePart = async (payload: Omit<SparePartItem, 'id' | 'updatedAt'>) => {
    const res = await api.createSparePart(payload);
    setState(res.state);
    notify('success', `Added Spare Part ${res.part.partCode} — ${res.part.name}.`);
  };

  const handleUpdateSparePart = async (
    id: string,
    payload: Partial<Omit<SparePartItem, 'id' | 'updatedAt'>>
  ) => {
    const res = await api.updateSparePart(id, payload);
    setState(res.state);
    notify('success', `Updated Spare Part ${res.part.partCode} (Qty ${res.part.stockQty}).`);
  };

  const handleDeleteSparePart = async (id: string) => {
    const res = await runAction('delete-spare-part', () => api.deleteSparePart(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Removed Spare Part from workshop bins.');
  };

  // Voucher Management handlers
  const handleCreateVoucherRecord = async (
    payload: Omit<VoucherRecord, 'id' | 'updatedAt' | 'createdBy' | 'postedToGl'> & {
      postImmediately?: boolean;
    }
  ) => {
    const res = await api.createVoucherRecord(payload);
    setState(res.state);
    setLastAuditResult(null);
    notify(
      'success',
      res.voucher.postedToGl
        ? `Created & posted ${res.voucher.voucherType} Voucher ${res.voucher.voucherRef} to General Ledger & Register Books.`
        : `Created ${res.voucher.voucherType} Voucher ${res.voucher.voucherRef} (Auto-Approved).`
    );
  };

  const handlePostVoucherToGL = async (id: string) => {
    const res = await runAction('post-voucher-gl', () => api.postVoucherToGL(id));
    if (!res) return;
    setState(res.state);
    setLastAuditResult(null);
    notify(
      'success',
      `Posted ${res.voucher.voucherType} Voucher ${res.voucher.voucherRef} to General Ledger & synced Register Books.`
    );
  };

  const handleVoidVoucherRecord = async (id: string) => {
    const res = await runAction('void-voucher', () => api.voidVoucherRecord(id));
    if (!res) return;
    setState(res.state);
    notify('info', `Voided ${res.voucher.voucherType} Voucher ${res.voucher.voucherRef}.`);
  };

  const handleDeleteVoucherRecord = async (id: string) => {
    const res = await runAction('delete-voucher', () => api.deleteVoucherRecord(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Deleted unposted voucher record.');
  };

  // Template Studio handlers
  const handleCreateTemplate = async (
    payload: Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>
  ) => {
    const res = await runAction('create-template', () => api.createTemplate(payload));
    if (!res) return null;
    setState(res.state);
    notify('success', `Saved template ${res.template.code} — ${res.template.name}.`);
    return res.template;
  };

  const handleUpdateTemplate = async (
    id: string,
    payload: Partial<Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>>
  ) => {
    const res = await runAction('update-template', () => api.updateTemplate(id, payload));
    if (!res) return null;
    setState(res.state);
    notify('success', `Updated template ${res.template.code}.`);
    return res.template;
  };

  const handleDuplicateTemplate = async (id: string) => {
    const res = await runAction('duplicate-template', () => api.duplicateTemplate(id));
    if (!res) return null;
    setState(res.state);
    notify('success', `Cloned template into ${res.template.code}.`);
    return res.template;
  };

  const handleDeleteTemplate = async (id: string) => {
    const res = await runAction('delete-template', () => api.deleteTemplate(id));
    if (!res) return;
    setState(res.state);
    notify('info', 'Deleted template from Template Studio.');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="w-full max-w-md px-6 space-y-4">
          <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          <div className="h-40 bg-white border border-slate-200 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-md w-full space-y-3">
          <h1 className="text-lg font-bold text-slate-900">Unable to load ledger database</h1>
          <p className="text-sm text-slate-600">{loadError || 'Unexpected server error.'}</p>
          <button
            onClick={fetchState}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Layout
        activeRoute={activeRoute}
        onNavigate={navigateTo}
        onOpenNewVoucher={() => setShowVoucherComposer(true)}
        onOpenCustomInstructions={() => setShowCustomInstructionsDrawer(true)}
        onOpenAssistant={() => setShowAssistantDrawer(true)}
        firebaseUser={firebaseUser}
        hasWorkspaceToken={Boolean(workspaceToken)}
        onGoogleSignIn={() => void handleGoogleSignIn()}
        onGoogleSignOut={() => void handleGoogleSignOut()}
        authBusy={authBusy}
        organizationName={state.config.organizationName}
        fiscalPeriod={state.config.fiscalPeriod}
        currencyCode={state.config.currencyCode}
        unpostedCount={unpostedVoucherCount}
        pendingSyncCount={pendingSyncCount}
        pendingApprovalCount={(state.approvalRequests || []).filter((a) => a.status === 'Pending').length}
        syncStatus={syncStatus}
        selectedRegisterCode={activeRoute === 'registers' ? selectedRegisterCode : null}
        toast={toast}
        onDismissToast={() => setToast(null)}
      >
        {activeRoute === 'dashboard' && (
          <ControlDashboard
            state={state}
            busyAction={busyAction}
            onNavigate={navigateTo}
            onCreateMissingRegisters={handleCreateMissingRegisters}
            onValidateJournal={handleValidateJournal}
            onSyncRegisters={handleSyncRegisters}
            onRunReconciliation={handleRunReconciliation}
            onLoadSampleTransactions={handleLoadSampleTransactions}
          />
        )}

        {activeRoute === 'master-products' && (
          <ProductsItemsPage
            state={state}
            busyAction={busyAction}
            isAdmin={userRole === 'admin'}
            onOpenRegister={handleOpenRegister}
            onCreateProduct={handleCreateProduct}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            onUpdateConfig={handleSaveConfig}
          />
        )}

        {activeRoute === 'master-customers' && (
          <Customers360Page
            state={state}
            busyAction={busyAction}
            currentUserEmail={firebaseUser?.email || 'system@atcl.com'}
            onOpenRegister={handleOpenRegister}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
            onCreateCustomer={handleCreateCustomer}
            onUpdateCustomer={handleUpdateCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            onUpdateConfig={handleSaveConfig}
          />
        )}

        {activeRoute === 'master-suppliers' && (
          <SuppliersPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
            onCreateSupplier={handleCreateSupplier}
            onUpdateSupplier={handleUpdateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            onUpdateConfig={handleSaveConfig}
          />
        )}

        {activeRoute === 'master-audit' && <MasterDataAuditPage state={state} />}

        {activeRoute === 'sc-purchase-requisition' && (
          <PurchaseRequisitionPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onNavigatePO={() => navigateTo('sc-local-procurement')}
          />
        )}

        {activeRoute === 'sc-supplier-quotation' && (
          <SupplierQuotationPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'sc-local-procurement' && (
          <LocalProcurementPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
            onCreatePO={handleCreateLocalPO}
            onUpdatePO={handleUpdateLocalPO}
            onDeletePO={handleDeleteLocalPO}
          />
        )}

        {activeRoute === 'sc-goods-receipt' && (
          <GoodsReceiptPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'sc-purchase-invoice' && (
          <PurchaseInvoicePage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'sc-accounts-payable' && (
          <AccountsPayablePage
            state={state}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
          />
        )}

        {activeRoute === 'sc-purchase-returns' && (
          <PurchaseReturnsPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'sc-import-lc' && (
          <ImportLCManagementPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
            onCreateLC={handleCreateImportLC}
            onUpdateLC={handleUpdateImportLC}
            onDeleteLC={handleDeleteImportLC}
          />
        )}

        {activeRoute === 'sc-landed-cost' && (
          <LandedCostAllocationPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'sc-procurement-reports' && (
          <ProcurementReportsPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'sc-inventory-serial' && (
          <InventorySerialRegisterPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onCreateSerial={handleCreateSerialUnit}
            onUpdateSerial={handleUpdateSerialUnit}
            onDeleteSerial={handleDeleteSerialUnit}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'ss-sales-quotations' && (
          <SalesQuotationPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onNavigateSO={() => navigateTo('ss-sales-distribution')}
          />
        )}

        {activeRoute === 'ss-sales-distribution' && (
          <SalesDistributionPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
            onCreateSalesOrder={handleCreateSalesOrder}
            onUpdateSalesOrder={handleUpdateSalesOrder}
            onDeleteSalesOrder={handleDeleteSalesOrder}
          />
        )}

        {activeRoute === 'ss-delivery-orders' && (
          <DeliveryOrdersPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'ss-sales-invoices' && (
          <SalesInvoicePage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
          />
        )}

        {activeRoute === 'ss-sales-returns' && (
          <SalesReturnsPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'ss-sales-reports' && (
          <SalesReportsPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'ss-retail-pos' && (
          <RetailCounterPosPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onCreatePosSale={handleCreatePosSale}
            onVoidPosSale={handleVoidPosSale}
            onDeletePosSale={handleDeletePosSale}
          />
        )}

        {activeRoute === 'ss-warranty' && (
          <WarrantyManagementPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onCreateWarrantyClaim={handleCreateWarrantyClaim}
            onUpdateWarrantyClaim={handleUpdateWarrantyClaim}
            onDeleteWarrantyClaim={handleDeleteWarrantyClaim}
          />
        )}

        {activeRoute === 'ss-service-workshop' && (
          <ServiceWorkshopPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onCreateServiceJob={handleCreateServiceJob}
            onUpdateServiceJob={handleUpdateServiceJob}
            onDeleteServiceJob={handleDeleteServiceJob}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'ss-spare-parts' && (
          <SparePartsInventoryPage
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onCreateSparePart={handleCreateSparePart}
            onUpdateSparePart={handleUpdateSparePart}
            onDeleteSparePart={handleDeleteSparePart}
          />
        )}

        {activeRoute === 'ss-tender-projects' && (
          <TenderProjectsPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {(activeRoute === 'vm-payment' ||
          activeRoute === 'vm-receipt' ||
          activeRoute === 'vm-journal' ||
          activeRoute === 'vm-expense') && (
          <VoucherManagementPage
            voucherType={
              activeRoute === 'vm-payment'
                ? 'Payment'
                : activeRoute === 'vm-receipt'
                  ? 'Receipt'
                  : activeRoute === 'vm-journal'
                    ? 'Journal'
                    : 'Expense'
            }
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onCreateVoucherRecord={handleCreateVoucherRecord}
            onPostVoucherToGL={handlePostVoucherToGL}
            onVoidVoucherRecord={handleVoidVoucherRecord}
            onDeleteVoucherRecord={handleDeleteVoucherRecord}
          />
        )}

        {activeRoute === 'coa' && (
          <ChartOfAccounts
            state={state}
            busyAction={busyAction}
            onOpenRegister={handleOpenRegister}
            onAddAccount={handleAddAccount}
            onToggleStatus={handleToggleAccountStatus}
            onValidateCOA={handleValidateCOA}
            onCreateMissingRegisters={handleCreateMissingRegisters}
            onImportCOA={handleImportCOA}
          />
        )}

        {activeRoute === 'registers' && (
          <RegisterBookView
            state={state}
            selectedCode={selectedRegisterCode}
            busyAction={busyAction}
            onSelectAccount={handleSelectRegister}
            onRebuildRegister={handleRebuildRegister}
          />
        )}

        {activeRoute === 'journal' && (
          <MasterJournal
            state={state}
            busyAction={busyAction}
            onOpenNewVoucher={() => setShowVoucherComposer(true)}
            onValidateJournal={handleValidateJournal}
            onApproveJournal={handleApproveJournal}
            onPostJournal={handlePostJournal}
            onReverseVoucher={handleReverseVoucher}
            onDeleteDraft={handleDeleteDraft}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {activeRoute === 'posted-store' && (
          <PostedStoreView
            state={state}
            busyAction={busyAction}
            onSyncRegisters={handleSyncRegisters}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {activeRoute === 'fin-bank-treasury' && (
          <BankTreasuryPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {activeRoute === 'fin-tax-compliance' && (
          <TaxCompliancePage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {activeRoute === 'fin-fixed-assets' && (
          <FixedAssetsPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {activeRoute === 'fin-month-end' && (
          <MonthEndClosingPage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {(activeRoute === 'reports-summary' ||
          activeRoute === 'reports-trial-balance' ||
          activeRoute === 'reports-income' ||
          activeRoute === 'reports-balance-sheet' ||
          activeRoute === 'reports-cash-flow' ||
          activeRoute === 'reports-equity-changes' ||
          activeRoute === 'reports-monthly') && (
          <FinancialReports
            state={state}
            activeRoute={activeRoute}
            onNavigate={navigateTo}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {(activeRoute === 'audit' || activeRoute === 'audit-log') && (
          <AuditReconciliation
            state={state}
            mode={activeRoute}
            busyAction={busyAction}
            lastAuditResult={lastAuditResult}
            onRunReconciliation={handleRunReconciliation}
            onSelfHeal={handleSelfHeal}
            onRebuildSingle={handleRebuildRegister}
            onOpenRegister={handleOpenRegister}
          />
        )}

        {activeRoute === 'gov-approvals' && (
          <ApprovalQueuePage
            state={state}
            onStateChange={setState}
            onNotify={notify}
          />
        )}

        {activeRoute === 'templates' && (
          <TemplateStudioPage
            state={state}
            busyAction={busyAction}
            onCreateTemplate={handleCreateTemplate}
            onUpdateTemplate={handleUpdateTemplate}
            onDuplicateTemplate={handleDuplicateTemplate}
            onDeleteTemplate={handleDeleteTemplate}
          />
        )}

        {activeRoute === 'workspace' && (
          <WorkspaceHubPage
            state={state}
            user={firebaseUser}
            accessToken={workspaceToken}
            authReady={authReady}
            onGoogleSignIn={handleGoogleSignIn}
            onSignOut={handleGoogleSignOut}
            onNotify={notify}
          />
        )}

        {activeRoute === 'config' && (
          <SystemConfigView
            state={state}
            busyAction={busyAction}
            activeTab={activeConfigTab}
            onTabChange={handleConfigTabChange}
            onSaveConfig={handleSaveConfig}
            onResetWorkspace={handleResetWorkspace}
            onLoadSampleTransactions={handleLoadSampleTransactions}
            onRestoreBackup={handleRestoreBackup}
            onPruneAuditLog={handlePruneAuditLog}
            onCustomInstructionsDocMutated={(nextState, msg) => {
              setState(nextState);
              notify('success', msg);
            }}
            onApplyLedgerSyncState={handleApplyLedgerSyncState}
            onNavigate={navigateTo}
          />
        )}
      </Layout>

      {showVoucherComposer && (
        <VoucherComposerModal
          accounts={state.accounts}
          suggestedVoucherNo={suggestedVoucherNo}
          busy={busyAction !== null}
          onClose={() => setShowVoucherComposer(false)}
          onSubmit={handleCreateVoucher}
        />
      )}

      <CustomInstructionsDrawer
        open={showCustomInstructionsDrawer}
        config={state.config}
        busyAction={busyAction}
        onClose={() => setShowCustomInstructionsDrawer(false)}
        onSaveConfig={handleSaveConfig}
        onOpenFullStudio={() => {
          setShowCustomInstructionsDrawer(false);
          navigateTo('config', { configTab: 'custom-instructions' });
        }}
      />

      <ErpAssistantDrawer
        open={showAssistantDrawer}
        activeRoute={activeRoute}
        state={state}
        onClose={() => setShowAssistantDrawer(false)}
        onOpenCustomInstructions={() => setShowCustomInstructionsDrawer(true)}
      />
    </>
  );
}

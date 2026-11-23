import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from './firebase.ts';
import type { LedgerState } from '../types/accounting.ts';
import { computeBalanceSheet, computeIncomeStatement } from '../engine/accountingEngine.ts';

export type WorkspaceAppName =
  | 'drive'
  | 'sheets'
  | 'gmail'
  | 'docs'
  | 'tasks'
  | 'chat'
  | 'contacts'
  | 'firestore';

export interface ErpSnapshotRecord {
  id: string;
  ownerId: string;
  label: string;
  fiscalPeriod: string;
  currencyCode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  metrics: {
    accountCount: number;
    postedTransactionCount: number;
    voucherCount: number;
    totalAssets: number;
    netProfit: number;
  };
  ledgerData: {
    accounts: unknown[];
    journalLines: unknown[];
    postedTransactions: unknown[];
    vouchers?: unknown[];
    config?: Record<string, unknown>;
  };
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
}

export interface WorkspaceActivityRecord {
  id: string;
  ownerId: string;
  workspaceApp: WorkspaceAppName;
  action: string;
  targetTitle: string;
  targetId?: string;
  status: 'success' | 'error';
  createdAt?: { seconds: number; nanoseconds: number } | null;
}

function sanitizeFirestoreMap(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFirestoreMap(item));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = sanitizeFirestoreMap(v);
    }
  }
  return out;
}

export type ErpUserRole =
  | 'admin'
  | 'finance_manager'
  | 'accountant'
  | 'procurement'
  | 'sales'
  | 'warehouse'
  | 'viewer';

const VALID_ROLES: readonly ErpUserRole[] = [
  'admin',
  'finance_manager',
  'accountant',
  'procurement',
  'sales',
  'warehouse',
  'viewer',
];

export async function getUserRole(user: User | null): Promise<ErpUserRole> {
  if (!user) return 'viewer';
  if (user.email === 'erpatcl@gmail.com' && user.emailVerified) {
    return 'admin';
  }
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const role = snap.data()?.role;
      if (VALID_ROLES.includes(role)) {
        return role as ErpUserRole;
      }
    }
  } catch {
    // Fall back to least-privilege viewer role if profile lookup fails
  }
  return 'viewer';
}

export async function syncUserProfile(
  user: User,
  workspaceConnected: boolean,
  organizationName: string
): Promise<void> {
  const publicPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/profile`;

  try {
    const publicRef = doc(db, 'users', user.uid);
    const existing = await getDoc(publicRef);
    const displayName = (user.displayName || user.email?.split('@')[0] || 'ATCL User').slice(0, 120);
    const photoURL = (user.photoURL || '').slice(0, 500);
    const organization = (organizationName || 'Advance Technology Consortium Ltd.').slice(0, 160);

    if (!existing.exists()) {
      const assignedRole =
        user.email === 'erpatcl@gmail.com' && user.emailVerified ? 'admin' : 'viewer';
      await setDoc(publicRef, {
        uid: user.uid,
        displayName,
        photoURL,
        role: assignedRole,
        organization,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(publicRef, {
        displayName,
        photoURL,
        organization,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, publicPath);
  }

  try {
    const privateRef = doc(db, 'users', user.uid, 'private', 'profile');
    await setDoc(privateRef, {
      uid: user.uid,
      email: (user.email || 'unknown@example.com').slice(0, 254),
      workspaceConnected,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export async function saveErpSnapshotToFirestore(
  user: User,
  state: LedgerState,
  label: string
): Promise<string> {
  const path = 'erpSnapshots';
  try {
    const balanceSheet = computeBalanceSheet(state);
    const incomeStatement = computeIncomeStatement(state);
    const boundedAccounts = state.accounts.slice(0, 500).map((a) => sanitizeFirestoreMap(a));
    const boundedJournal = state.journalLines.slice(0, 1500).map((j) => sanitizeFirestoreMap(j));
    const boundedPosted = state.postedTransactions
      .slice(0, 1500)
      .map((p) => sanitizeFirestoreMap(p));
    const boundedVouchers = (state.vouchers || [])
      .slice(0, 1000)
      .map((v) => sanitizeFirestoreMap(v));

    const safeConfig = sanitizeFirestoreMap({
      organizationName: state.config.organizationName,
      fiscalPeriod: state.config.fiscalPeriod,
      currencyCode: state.config.currencyCode,
      systemName: state.config.systemName,
      autoSyncOnPost: state.config.autoSyncOnPost,
    }) as Record<string, unknown>;

    const docRef = await addDoc(collection(db, path), {
      ownerId: user.uid,
      label: label.trim().slice(0, 140) || `ATCL Snapshot ${state.config.fiscalPeriod}`,
      fiscalPeriod: state.config.fiscalPeriod.slice(0, 40),
      currencyCode: state.config.currencyCode.slice(0, 10),
      status: 'ACTIVE',
      metrics: {
        accountCount: state.accounts.length,
        postedTransactionCount: state.postedTransactions.length,
        voucherCount: (state.vouchers || []).length,
        totalAssets: Number(balanceSheet.totalAssets) || 0,
        netProfit: Number(incomeStatement.netProfit) || 0,
      },
      ledgerData: {
        accounts: boundedAccounts,
        journalLines: boundedJournal,
        postedTransactions: boundedPosted,
        vouchers: boundedVouchers,
        config: safeConfig,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function archiveErpSnapshot(snapshotId: string): Promise<void> {
  const path = `erpSnapshots/${snapshotId}`;
  try {
    await updateDoc(doc(db, 'erpSnapshots', snapshotId), {
      status: 'ARCHIVED',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteErpSnapshot(snapshotId: string): Promise<void> {
  const path = `erpSnapshots/${snapshotId}`;
  try {
    await deleteDoc(doc(db, 'erpSnapshots', snapshotId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeErpSnapshots(
  userId: string,
  onData: (rows: ErpSnapshotRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'erpSnapshots';
  const q = query(
    collection(db, path),
    where('ownerId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ErpSnapshotRecord, 'id'>),
      }));
      onData(rows);
    },
      (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function logWorkspaceActivity(
  ownerId: string,
  entry: {
    workspaceApp: WorkspaceAppName;
    action: string;
    targetTitle: string;
    targetId?: string;
    status: 'success' | 'error';
  }
): Promise<void> {
  const path = 'workspaceActivity';
  try {
    const payload: Record<string, unknown> = {
      ownerId,
      workspaceApp: entry.workspaceApp,
      action: entry.action.slice(0, 80),
      targetTitle: entry.targetTitle.slice(0, 200),
      status: entry.status,
      createdAt: serverTimestamp(),
    };
    if (entry.targetId) {
      payload.targetId = entry.targetId.slice(0, 200);
    }
    await addDoc(collection(db, path), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteWorkspaceActivity(activityId: string): Promise<void> {
  const path = `workspaceActivity/${activityId}`;
  try {
    await deleteDoc(doc(db, 'workspaceActivity', activityId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeWorkspaceActivity(
  userId: string,
  onData: (rows: WorkspaceActivityRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'workspaceActivity';
  const q = query(
    collection(db, path),
    where('ownerId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<WorkspaceActivityRecord, 'id'>),
      }));
      onData(rows);
    },
      (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

const MAIN_LEDGER_ID = 'atcl_main';

function splitStateIntoDomains(state: LedgerState): Record<string, Record<string, unknown>> {
  const anyState = state as unknown as Record<string, unknown>;
  return {
    core: {
      datasetVersion: state.datasetVersion || 'atcl-v2',
      config: state.config,
      accounts: state.accounts,
      auditLogs: state.auditLogs.slice(-400),
    },
    journal: {
      journalLines: state.journalLines.slice(-1500),
      postedTransactions: state.postedTransactions.slice(-1500),
      vouchers: (state.vouchers || []).slice(0, 800),
      postedIdempotencyKeys: anyState.postedIdempotencyKeys || [],
    },
    master: {
      products: state.products,
      customers: state.customers,
      suppliers: state.suppliers,
      templates: state.templates,
    },
    procurement: {
      localPurchaseOrders: state.localPurchaseOrders,
      importLCs: state.importLCs,
      goodsReceipts: state.goodsReceipts || [],
      purchaseInvoices: state.purchaseInvoices || [],
      purchaseRequisitions: state.purchaseRequisitions || [],
      supplierQuotations: state.supplierQuotations || [],
      purchaseReturns: state.purchaseReturns || [],
      taxRemittances: state.taxRemittances || [],
    },
    sales: {
      salesOrders: state.salesOrders,
      posTransactions: state.posTransactions,
      warrantyClaims: state.warrantyClaims,
      serviceJobs: state.serviceJobs,
      spareParts: state.spareParts,
      salesInvoices: state.salesInvoices || [],
      customerAdvances: state.customerAdvances || [],
      salesQuotations: state.salesQuotations || [],
      deliveryOrders: state.deliveryOrders || [],
      salesCreditNotes: state.salesCreditNotes || [],
      amcContracts: state.amcContracts || [],
      inventorySerials: state.inventorySerials,
      inventoryMovements: (state.inventoryMovements || []).slice(0, 1000),
    },
    extensions: {
      approvalRequests: anyState.approvalRequests || [],
      cheques: anyState.cheques || [],
      bankStatements: anyState.bankStatements || [],
      fundTransfers: anyState.fundTransfers || [],
      taxRules: anyState.taxRules || [],
      tenderProjects: anyState.tenderProjects || [],
      fixedAssets: anyState.fixedAssets || [],
      departmentBudgets: anyState.departmentBudgets || [],
    },
  };
}

export async function saveLedgerStateToFirestore(
  user: User,
  state: LedgerState
): Promise<number> {
  const metaRef = doc(db, 'erpLedgers', MAIN_LEDGER_ID);
  const domains = splitStateIntoDomains(state);
  const orgName = (state.config?.organizationName || 'Advance Technology Consortium Ltd.').slice(0, 160);

  return await runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaRef);
    const prevVersion = metaSnap.exists() ? Number(metaSnap.data()?.version) || 0 : 0;
    const nextVersion = prevVersion + 1;

    const metaPayload: Record<string, unknown> = {
      version: nextVersion,
      organizationName: orgName,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
      createdAt: metaSnap.exists() ? metaSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
    };
    tx.set(metaRef, metaPayload);

    for (const [domainKey, payload] of Object.entries(domains)) {
      const domRef = doc(db, 'erpLedgers', MAIN_LEDGER_ID, 'domains', domainKey);
      tx.set(domRef, {
        domainKey,
        version: nextVersion,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
        payload: sanitizeFirestoreMap(payload),
      });
    }

    return nextVersion;
  });
}

export async function loadLedgerStateFromFirestore(): Promise<{
  state: Partial<LedgerState>;
  version: number;
} | null> {
  const metaRef = doc(db, 'erpLedgers', MAIN_LEDGER_ID);
  const metaSnap = await getDoc(metaRef);
  if (!metaSnap.exists()) return null;

  const version = Number(metaSnap.data()?.version) || 1;
  const domSnap = await getDocs(collection(db, 'erpLedgers', MAIN_LEDGER_ID, 'domains'));
  const merged: Record<string, unknown> = {};
  domSnap.forEach((d) => {
    const data = d.data();
    if (data?.payload && typeof data.payload === 'object') {
      Object.assign(merged, data.payload);
    }
  });
  return { state: merged as Partial<LedgerState>, version };
}

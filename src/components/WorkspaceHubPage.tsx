import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  HardDrive,
  ListTodo,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LedgerState } from '../types/accounting.ts';
import {
  computeBalanceSheet,
  computeIncomeStatement,
  computeTrialBalance,
} from '../engine/accountingEngine.ts';
import {
  GoogleSignInButton,
  WorkspaceConfirmModal,
  type PendingConfirmation,
} from './GoogleAuthControls.tsx';
import {
  archiveErpSnapshot,
  deleteErpSnapshot,
  deleteWorkspaceActivity,
  logWorkspaceActivity,
  saveErpSnapshotToFirestore,
  subscribeErpSnapshots,
  subscribeWorkspaceActivity,
  type ErpSnapshotRecord,
  type WorkspaceActivityRecord,
  type WorkspaceAppName,
} from '../lib/firestoreSync.ts';
import {
  appendRowsToSheetTab,
  createContact,
  createDriveFolder,
  createErpSpreadsheet,
  createGoogleDocWithContent,
  createTask,
  deleteContact,
  deleteDriveFilePermanently,
  deleteTask,
  GOOGLE_CHAT_CONSOLE_URL,
  listChatMessages,
  listChatSpaces,
  listContacts,
  listDriveFiles,
  listDriveGoogleDocs,
  listDriveSpreadsheets,
  listGmailMessages,
  listTaskLists,
  listTasks,
  readGoogleDoc,
  readSheetFirstTabPreview,
  sendChatMessage,
  sendGmailMessage,
  trashDriveFile,
  trashGmailMessage,
  updateTaskStatus,
  uploadDriveTextFile,
  WorkspaceApiError,
  type DriveFileItem,
  type GmailMessageSummary,
  type GoogleChatMessage,
  type GoogleChatSpace,
  type GoogleContactItem,
  type GoogleDocSummary,
  type GoogleTaskItem,
  type GoogleTaskList,
} from '../lib/workspaceApi.ts';

type WorkspaceTab =
  | 'cloud'
  | 'drive'
  | 'sheets'
  | 'gmail'
  | 'docs'
  | 'tasks'
  | 'chat'
  | 'contacts';

interface WorkspaceHubPageProps {
  state: LedgerState;
  user: User | null;
  accessToken: string | null;
  authReady: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const TABS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'cloud', label: 'Firestore Cloud', icon: Database },
  { id: 'drive', label: 'Google Drive', icon: HardDrive },
  { id: 'sheets', label: 'Google Sheets', icon: FileSpreadsheet },
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'docs', label: 'Google Docs', icon: FileText },
  { id: 'tasks', label: 'Google Tasks', icon: ListTodo },
  { id: 'chat', label: 'Google Chat', icon: MessageSquare },
  { id: 'contacts', label: 'Contacts', icon: Users },
];

export const WorkspaceHubPage: React.FC<WorkspaceHubPageProps> = ({
  state,
  user,
  accessToken,
  authReady,
  onGoogleSignIn,
  onSignOut,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('cloud');
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Firestore Cloud Sync state
  const [snapshots, setSnapshots] = useState<ErpSnapshotRecord[]>([]);
  const [activities, setActivities] = useState<WorkspaceActivityRecord[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState(
    `ATCL Close Snapshot · FY ${state.config.fiscalPeriod}`
  );
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  // Drive state
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveQuery, setDriveQuery] = useState('');
  const [newFolderName, setNewFolderName] = useState(`ATCL_ERP_${state.config.fiscalPeriod}`);

  // Sheets state
  const [spreadsheets, setSpreadsheets] = useState<DriveFileItem[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState('');
  const [sheetPreview, setSheetPreview] = useState<{
    title: string;
    tabTitle: string;
    allTabs: string[];
    rows: string[][];
  } | null>(null);
  const [newSheetTitle, setNewSheetTitle] = useState(
    `ATCL Financial Pack · FY ${state.config.fiscalPeriod}`
  );

  // Gmail state
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [gmailQuery, setGmailQuery] = useState('');
  const [mailTo, setMailTo] = useState('');
  const [mailSubject, setMailSubject] = useState(
    `ATCL Financial Summary — FY ${state.config.fiscalPeriod}`
  );
  const [mailBody, setMailBody] = useState('');

  // Docs state
  const [googleDocsList, setGoogleDocsList] = useState<DriveFileItem[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<GoogleDocSummary | null>(null);
  const [newDocTitle, setNewDocTitle] = useState(
    `ATCL Executive Financial Brief · FY ${state.config.fiscalPeriod}`
  );

  // Tasks state
  const [taskLists, setTaskLists] = useState<GoogleTaskList[]>([]);
  const [activeTaskListId, setActiveTaskListId] = useState('');
  const [tasks, setTasks] = useState<GoogleTaskItem[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskNotes, setNewTaskNotes] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');

  // Chat state
  const [chatSpaces, setChatSpaces] = useState<GoogleChatSpace[]>([]);
  const [activeSpaceName, setActiveSpaceName] = useState('');
  const [chatMessages, setChatMessages] = useState<GoogleChatMessage[]>([]);
  const [newChatText, setNewChatText] = useState('');
  const [chatPrerequisiteNote, setChatPrerequisiteNote] = useState<string | null>(null);

  // Contacts state
  const [contacts, setContacts] = useState<GoogleContactItem[]>([]);
  const [contactQuery, setContactQuery] = useState('');
  const [contactGivenName, setContactGivenName] = useState('');
  const [contactFamilyName, setContactFamilyName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactOrg, setContactOrg] = useState('');

  const reports = useMemo(
    () => ({
      trialBalance: computeTrialBalance(state),
      incomeStatement: computeIncomeStatement(state),
      balanceSheet: computeBalanceSheet(state),
    }),
    [state]
  );

  // Subscribe to Firestore user-owned collections when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setSnapshots([]);
      setActivities([]);
      return;
    }
    setFirestoreError(null);

    const unsubSnapshots = subscribeErpSnapshots(
      user.uid,
      (rows) => setSnapshots(rows),
      (err) => {
        setFirestoreError(err.message);
      }
    );

    const unsubActivity = subscribeWorkspaceActivity(
      user.uid,
      (rows) => setActivities(rows),
      (err) => {
        setFirestoreError(err.message);
      }
    );

    return () => {
      unsubSnapshots();
      unsubActivity();
    };
  }, [authReady, user]);

  // Pre-fill executive financial email body
  useEffect(() => {
    if (!mailBody) {
      setMailBody(
        [
          `Dear Stakeholder,`,
          ``,
          `Please find the latest ATCL ERP financial summary for FY ${state.config.fiscalPeriod}:`,
          `- Total Assets: ${state.config.currencyCode} ${reports.balanceSheet.totalAssets.toLocaleString()}`,
          `- Total Liabilities: ${state.config.currencyCode} ${reports.balanceSheet.totalLiabilities.toLocaleString()}`,
          `- Total Equity: ${state.config.currencyCode} ${reports.balanceSheet.totalEquity.toLocaleString()}`,
          `- Net Profit: ${state.config.currencyCode} ${reports.incomeStatement.netProfit.toLocaleString()}`,
          ``,
          `Regards,`,
          `${state.config.organizationName}`,
        ].join('\n')
      );
    }
  }, [mailBody, reports, state.config.currencyCode, state.config.fiscalPeriod, state.config.organizationName]);

  const recordAudit = useCallback(
    async (
      workspaceApp: WorkspaceAppName,
      action: string,
      targetTitle: string,
      status: 'success' | 'error',
      targetId?: string
    ) => {
      if (!user) return;
      try {
        await logWorkspaceActivity(user.uid, {
          workspaceApp,
          action,
          targetTitle,
          targetId,
          status,
        });
      } catch {
        // Activity logging should not mask primary operation result
      }
    },
    [user]
  );

  const handleConfirmExecute = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.onConfirm();
      setPendingConfirm(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Operation failed.';
      onNotify('error', msg);
    } finally {
      setConfirmBusy(false);
    }
  };

  // ==================== LOADERS ====================

  const loadDrive = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const files = await listDriveFiles(accessToken, driveQuery);
      setDriveFiles(files);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to load Drive files.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, driveQuery, onNotify]);

  const loadSheetsList = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const list = await listDriveSpreadsheets(accessToken);
      setSpreadsheets(list);
      if (list.length > 0 && !selectedSheetId) {
        setSelectedSheetId(list[0].id);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to list spreadsheets.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, onNotify, selectedSheetId]);

  const loadSelectedSheetPreview = useCallback(
    async (sheetId: string) => {
      if (!accessToken || !sheetId) return;
      setBusy(true);
      try {
        const preview = await readSheetFirstTabPreview(accessToken, sheetId);
        setSheetPreview(preview);
      } catch (err) {
        onNotify('error', err instanceof Error ? err.message : 'Unable to read spreadsheet.');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, onNotify]
  );

  const loadGmail = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const msgs = await listGmailMessages(accessToken, gmailQuery);
      setGmailMessages(msgs);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to load Gmail messages.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, gmailQuery, onNotify]);

  const loadDocsList = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const docs = await listDriveGoogleDocs(accessToken);
      setGoogleDocsList(docs);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to load Google Docs.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, onNotify]);

  const loadTasksData = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const lists = await listTaskLists(accessToken);
      setTaskLists(lists);
      const targetListId = activeTaskListId || lists[0]?.id || '';
      if (targetListId) {
        setActiveTaskListId(targetListId);
        const listItems = await listTasks(accessToken, targetListId);
        setTasks(listItems);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to load Google Tasks.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, activeTaskListId, onNotify]);

  const loadChatData = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    setChatPrerequisiteNote(null);
    try {
      const spaces = await listChatSpaces(accessToken);
      setChatSpaces(spaces);
      const target = activeSpaceName || spaces[0]?.name || '';
      if (target) {
        setActiveSpaceName(target);
        const msgs = await listChatMessages(accessToken, target);
        setChatMessages(msgs);
      } else {
        setChatMessages([]);
      }
    } catch (err) {
      if (err instanceof WorkspaceApiError && err.isChatSetupRequired) {
        setChatPrerequisiteNote(err.message);
      } else {
        onNotify('error', err instanceof Error ? err.message : 'Unable to load Google Chat.');
      }
    } finally {
      setBusy(false);
    }
  }, [accessToken, activeSpaceName, onNotify]);

  const loadContactsData = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const rows = await listContacts(accessToken, contactQuery);
      setContacts(rows);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to load Google Contacts.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, contactQuery, onNotify]);

  useEffect(() => {
    if (!accessToken) return;
    if (activeTab === 'drive' && driveFiles.length === 0) void loadDrive();
    if (activeTab === 'sheets' && spreadsheets.length === 0) void loadSheetsList();
    if (activeTab === 'gmail' && gmailMessages.length === 0) void loadGmail();
    if (activeTab === 'docs' && googleDocsList.length === 0) void loadDocsList();
    if (activeTab === 'tasks' && taskLists.length === 0) void loadTasksData();
    if (activeTab === 'chat' && chatSpaces.length === 0 && !chatPrerequisiteNote) void loadChatData();
    if (activeTab === 'contacts' && contacts.length === 0) void loadContactsData();
  }, [
    accessToken,
    activeTab,
    chatPrerequisiteNote,
    chatSpaces.length,
    contacts.length,
    driveFiles.length,
    gmailMessages.length,
    googleDocsList.length,
    loadChatData,
    loadContactsData,
    loadDocsList,
    loadDrive,
    loadGmail,
    loadSheetsList,
    loadTasksData,
    spreadsheets.length,
    taskLists.length,
  ]);

  // ==================== WORKSPACE AUTH GUARD ====================

  const renderWorkspaceAuthGate = (serviceName: string) => (
    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-4">
      <div className="w-11 h-11 rounded-lg bg-[#DBEAFE] text-[#2563EB] flex items-center justify-center mx-auto">
        <Cloud className="w-5 h-5" />
      </div>
      <div className="max-w-md mx-auto space-y-1.5">
        <h3 className="text-sm font-bold text-slate-900">
          Connect Google Account for {serviceName}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          {user
            ? 'Your Firebase session is active, and OAuth tokens are stored securely in memory only. Click below to authorize Google Workspace permissions for this session.'
            : 'Sign in with your Google account to access Drive, Sheets, Gmail, Docs, Tasks, Chat, Contacts, and Firestore Cloud Sync.'}
        </p>
      </div>
      <div className="flex justify-center">
        <GoogleSignInButton
          onClick={() => void onGoogleSignIn()}
          label={user ? 'Authorize Workspace Session' : 'Sign in with Google'}
        />
      </div>
    </div>
  );

  // ==================== MUTATION REQUESTERS (ALL GATED BY MODAL) ====================

  const requestSaveFirestoreSnapshot = () => {
    if (!user) return;
    setPendingConfirm({
      title: 'Save ERP Ledger Snapshot to Cloud Firestore?',
      serviceLabel: 'Cloud Firestore',
      description:
        'This will write a structured financial snapshot of your Chart of Accounts, Journal Lines, Posted Transactions, and Balance Sheet metrics to your private Firestore vault.',
      affectedItems: [
        `Label: ${snapshotLabel}`,
        `Accounts: ${state.accounts.length}`,
        `Posted Transactions: ${state.postedTransactions.length}`,
      ],
      confirmLabel: 'Save Snapshot',
      onConfirm: async () => {
        const id = await saveErpSnapshotToFirestore(user, state, snapshotLabel);
        await recordAudit('firestore', 'save_snapshot', snapshotLabel, 'success', id);
        onNotify('success', `Saved Cloud Snapshot (${id}) to Firestore.`);
      },
    });
  };

  const requestUploadTrialBalanceCsvToDrive = () => {
    if (!accessToken) return;
    const filename = `ATCL_Trial_Balance_${state.config.fiscalPeriod.replace(/\s+/g, '_')}.csv`;
    setPendingConfirm({
      title: `Upload "${filename}" to Google Drive?`,
      serviceLabel: 'Google Drive',
      description:
        'Exports the live ATCL Trial Balance CSV directly into your Google Drive root folder.',
      affectedItems: [filename, `${reports.trialBalance.rows.length} active GL accounts`],
      confirmLabel: 'Upload to Drive',
      onConfirm: async () => {
        const csvLines = [
          'GL Code,Account Name,Category,Opening Dr,Opening Cr,Period Debit,Period Credit,Closing Dr,Closing Cr',
          ...reports.trialBalance.rows.map(
            (r) =>
              `"${r.code}","${r.name.replace(/"/g, '""')}","${r.category}",${r.openingDr},${r.openingCr},${r.periodDr},${r.periodCr},${r.closingDr},${r.closingCr}`
          ),
        ];
        const file = await uploadDriveTextFile(accessToken, {
          name: filename,
          content: csvLines.join('\n'),
          mimeType: 'text/csv',
        });
        await recordAudit('drive', 'upload_csv', file.name, 'success', file.id);
        onNotify('success', `Uploaded ${file.name} to Google Drive.`);
        await loadDrive();
      },
    });
  };

  const requestCreateDriveFolder = () => {
    if (!accessToken || !newFolderName.trim()) return;
    setPendingConfirm({
      title: `Create Drive Folder "${newFolderName.trim()}"?`,
      serviceLabel: 'Google Drive',
      description: 'Creates a new folder in your Google Drive workspace.',
      affectedItems: [newFolderName.trim()],
      confirmLabel: 'Create Folder',
      onConfirm: async () => {
        const folder = await createDriveFolder(accessToken, newFolderName.trim());
        await recordAudit('drive', 'create_folder', folder.name, 'success', folder.id);
        onNotify('success', `Created Google Drive folder "${folder.name}".`);
        await loadDrive();
      },
    });
  };

  const requestTrashDriveFile = (file: DriveFileItem, permanent: boolean) => {
    if (!accessToken) return;
    setPendingConfirm({
      title: permanent
        ? `Permanently delete "${file.name}"?`
        : `Move "${file.name}" to Google Drive Trash?`,
      serviceLabel: 'Google Drive',
      description: permanent
        ? 'This permanently deletes the file from Google Drive and cannot be undone.'
        : 'Moves the selected file to your Google Drive Trash.',
      affectedItems: [`${file.name} (${file.id})`],
      confirmLabel: permanent ? 'Delete Permanently' : 'Move to Trash',
      destructive: true,
      onConfirm: async () => {
        if (permanent) {
          await deleteDriveFilePermanently(accessToken, file.id);
          await recordAudit('drive', 'delete_file', file.name, 'success', file.id);
          onNotify('info', `Permanently deleted "${file.name}".`);
        } else {
          await trashDriveFile(accessToken, file.id);
          await recordAudit('drive', 'trash_file', file.name, 'success', file.id);
          onNotify('info', `Moved "${file.name}" to Trash.`);
        }
        await loadDrive();
      },
    });
  };

  const requestExportFinancialSpreadsheet = () => {
    if (!accessToken || !newSheetTitle.trim()) return;
    const title = newSheetTitle.trim();
    setPendingConfirm({
      title: `Create Google Spreadsheet "${title}"?`,
      serviceLabel: 'Google Sheets',
      description:
        'Creates a multi-tab Google Sheet populated with Trial Balance, Chart of Accounts, and Income Statement lines from ATCL ERP.',
      affectedItems: [
        title,
        'Tab 1: Trial Balance',
        'Tab 2: Chart of Accounts',
        'Tab 3: Income Statement',
      ],
      confirmLabel: 'Create & Export Sheet',
      onConfirm: async () => {
        const tbRows: Array<Array<string | number>> = [
          ['GL Code', 'Account Name', 'Category', 'Opening Dr', 'Opening Cr', 'Period Debit', 'Period Credit', 'Closing Dr', 'Closing Cr'],
          ...reports.trialBalance.rows.map((r) => [
            r.code,
            r.name,
            r.category,
            r.openingDr,
            r.openingCr,
            r.periodDr,
            r.periodCr,
            r.closingDr,
            r.closingCr,
          ]),
        ];
        const coaRows: Array<Array<string | number>> = [
          ['GL Code', 'Account Name', 'Category', 'Group', 'Normal Balance', 'Status'],
          ...state.accounts.map((a) => [a.code, a.name, a.category, a.group, a.normalBalance, a.status]),
        ];
        const pnlRows: Array<Array<string | number>> = [
          ['Metric', 'Amount (' + state.config.currencyCode + ')'],
          ['Total Revenue', reports.incomeStatement.totalIncome],
          ['Direct Costs', reports.incomeStatement.totalDirectCosts],
          ['Gross Profit', reports.incomeStatement.grossProfit],
          ['Operating Expenses', reports.incomeStatement.totalOperatingExpenses],
          ['Net Profit', reports.incomeStatement.netProfit],
        ];
        const created = await createErpSpreadsheet(accessToken, title, [
          { tabTitle: 'Trial Balance', rows: tbRows },
          { tabTitle: 'Chart of Accounts', rows: coaRows },
          { tabTitle: 'Income Statement', rows: pnlRows },
        ]);
        await recordAudit('sheets', 'create_erp_sheet', created.title, 'success', created.spreadsheetId);
        onNotify('success', `Exported "${created.title}" to Google Sheets.`);
        setSelectedSheetId(created.spreadsheetId);
        await loadSheetsList();
        await loadSelectedSheetPreview(created.spreadsheetId);
      },
    });
  };

  const requestAppendKpiSummaryToSheet = () => {
    if (!accessToken || !selectedSheetId || !sheetPreview?.tabTitle) return;
    setPendingConfirm({
      title: `Append Financial KPI Summary Row to "${sheetPreview.title}"?`,
      serviceLabel: 'Google Sheets',
      description: `Appends today's ATCL ERP closing snapshot row into tab "${sheetPreview.tabTitle}".`,
      affectedItems: [`Spreadsheet: ${sheetPreview.title}`, `Tab: ${sheetPreview.tabTitle}`],
      confirmLabel: 'Append Row',
      onConfirm: async () => {
        await appendRowsToSheetTab(accessToken, selectedSheetId, sheetPreview.tabTitle, [
          [
            new Date().toISOString().slice(0, 10),
            `ATCL KPI Snapshot (${state.config.fiscalPeriod})`,
            `Assets: ${reports.balanceSheet.totalAssets}`,
            `Net Profit: ${reports.incomeStatement.netProfit}`,
          ],
        ]);
        await recordAudit('sheets', 'append_rows', sheetPreview.title, 'success', selectedSheetId);
        onNotify('success', `Appended KPI row to "${sheetPreview.tabTitle}".`);
        await loadSelectedSheetPreview(selectedSheetId);
      },
    });
  };

  const requestSendEmail = () => {
    if (!accessToken || !mailTo.trim() || !mailSubject.trim()) return;
    setPendingConfirm({
      title: `Send Email via Gmail to "${mailTo.trim()}"?`,
      serviceLabel: 'Gmail',
      description:
        'This will send an email directly from your connected Gmail account with the drafted ATCL financial report summary.',
      affectedItems: [`To: ${mailTo.trim()}`, `Subject: ${mailSubject.trim()}`],
      confirmLabel: 'Send Email',
      onConfirm: async () => {
        const sent = await sendGmailMessage(accessToken, {
          to: mailTo,
          subject: mailSubject,
          bodyText: mailBody,
        });
        await recordAudit('gmail', 'send_email', `${mailTo.trim()} · ${mailSubject.trim()}`, 'success', sent.id);
        onNotify('success', `Email dispatched via Gmail to ${mailTo.trim()}.`);
        setMailTo('');
        await loadGmail();
      },
    });
  };

  const requestTrashGmail = (msg: GmailMessageSummary) => {
    if (!accessToken) return;
    setPendingConfirm({
      title: `Move email "${msg.subject}" to Trash?`,
      serviceLabel: 'Gmail',
      description: 'Moves this Gmail message to your Trash folder.',
      affectedItems: [`Subject: ${msg.subject}`, `From: ${msg.from}`],
      confirmLabel: 'Move to Trash',
      destructive: true,
      onConfirm: async () => {
        await trashGmailMessage(accessToken, msg.id);
        await recordAudit('gmail', 'trash_email', msg.subject, 'success', msg.id);
        onNotify('info', `Moved "${msg.subject}" to Gmail Trash.`);
        await loadGmail();
      },
    });
  };

  const requestCreateBriefDoc = () => {
    if (!accessToken || !newDocTitle.trim()) return;
    const title = newDocTitle.trim();
    setPendingConfirm({
      title: `Create Google Doc "${title}"?`,
      serviceLabel: 'Google Docs',
      description:
        'Creates a formatted Google Doc containing live Balance Sheet, Income Statement, and Ledger Integrity numbers from ATCL ERP.',
      affectedItems: [title],
      confirmLabel: 'Create Google Doc',
      onConfirm: async () => {
        const bodyText = [
          `${state.config.organizationName} — Executive Financial Brief`,
          `Fiscal Period: ${state.config.fiscalPeriod} | Currency: ${state.config.currencyCode}`,
          `Generated: ${new Date().toISOString()}`,
          ``,
          `1. Balance Sheet Position`,
          `   - Total Assets: ${reports.balanceSheet.totalAssets.toLocaleString()}`,
          `   - Total Liabilities: ${reports.balanceSheet.totalLiabilities.toLocaleString()}`,
          `   - Total Equity: ${reports.balanceSheet.totalEquity.toLocaleString()}`,
          ``,
          `2. Income Statement Performance`,
          `   - Total Revenue: ${reports.incomeStatement.totalIncome.toLocaleString()}`,
          `   - Gross Profit: ${reports.incomeStatement.grossProfit.toLocaleString()}`,
          `   - Net Profit: ${reports.incomeStatement.netProfit.toLocaleString()}`,
          ``,
          `3. Ledger Governance`,
          `   - Active GL Accounts: ${state.accounts.length}`,
          `   - Posted Transactions: ${state.postedTransactions.length}`,
        ].join('\n');
        const docRes = await createGoogleDocWithContent(accessToken, title, bodyText);
        await recordAudit('docs', 'create_doc', docRes.title, 'success', docRes.documentId);
        onNotify('success', `Created Google Doc "${docRes.title}".`);
        await loadDocsList();
        const loaded = await readGoogleDoc(accessToken, docRes.documentId);
        setSelectedDoc(loaded);
      },
    });
  };

  const requestCreateTask = () => {
    if (!accessToken || !activeTaskListId || !newTaskTitle.trim()) return;
    const title = newTaskTitle.trim();
    setPendingConfirm({
      title: `Create Google Task "${title}"?`,
      serviceLabel: 'Google Tasks',
      description: 'Adds a new accounting/audit action item to your selected Google Tasks list.',
      affectedItems: [title, newTaskDue ? `Due: ${newTaskDue}` : 'No due date'],
      confirmLabel: 'Create Task',
      onConfirm: async () => {
        const created = await createTask(accessToken, activeTaskListId, {
          title,
          notes: newTaskNotes,
          due: newTaskDue,
        });
        await recordAudit('tasks', 'create_task', created.title, 'success', created.id);
        onNotify('success', `Added task "${created.title}".`);
        setNewTaskTitle('');
        setNewTaskNotes('');
        setNewTaskDue('');
        await loadTasksData();
      },
    });
  };

  const requestToggleTask = (task: GoogleTaskItem) => {
    if (!accessToken || !activeTaskListId) return;
    const nextStatus = task.status === 'completed' ? 'needsAction' : 'completed';
    setPendingConfirm({
      title:
        nextStatus === 'completed'
          ? `Mark task "${task.title}" completed?`
          : `Reopen task "${task.title}"?`,
      serviceLabel: 'Google Tasks',
      description: 'Updates task completion status in Google Tasks.',
      affectedItems: [task.title],
      confirmLabel: nextStatus === 'completed' ? 'Mark Complete' : 'Reopen Task',
      onConfirm: async () => {
        await updateTaskStatus(accessToken, activeTaskListId, task.id, nextStatus);
        await recordAudit('tasks', 'update_task', task.title, 'success', task.id);
        onNotify('success', `Updated task "${task.title}".`);
        await loadTasksData();
      },
    });
  };

  const requestDeleteTask = (task: GoogleTaskItem) => {
    if (!accessToken || !activeTaskListId) return;
    setPendingConfirm({
      title: `Delete task "${task.title}"?`,
      serviceLabel: 'Google Tasks',
      description: 'Permanently removes this task from Google Tasks.',
      affectedItems: [task.title],
      confirmLabel: 'Delete Task',
      destructive: true,
      onConfirm: async () => {
        await deleteTask(accessToken, activeTaskListId, task.id);
        await recordAudit('tasks', 'delete_task', task.title, 'success', task.id);
        onNotify('info', `Deleted task "${task.title}".`);
        await loadTasksData();
      },
    });
  };

  const requestSendChatMessage = () => {
    if (!accessToken || !activeSpaceName || !newChatText.trim()) return;
    const spaceLabel =
      chatSpaces.find((s) => s.name === activeSpaceName)?.displayName || activeSpaceName;
    setPendingConfirm({
      title: `Post message to Google Chat space "${spaceLabel}"?`,
      serviceLabel: 'Google Chat',
      description: 'Sends this message into the selected Google Chat space on your behalf.',
      affectedItems: [`Space: ${spaceLabel}`, `Message: ${newChatText.trim().slice(0, 80)}`],
      confirmLabel: 'Send Message',
      onConfirm: async () => {
        const msg = await sendChatMessage(accessToken, activeSpaceName, newChatText);
        await recordAudit('chat', 'send_message', spaceLabel, 'success', msg.name);
        onNotify('success', `Posted message to ${spaceLabel}.`);
        setNewChatText('');
        await loadChatData();
      },
    });
  };

  const requestCreateContact = () => {
    if (!accessToken || !contactGivenName.trim()) return;
    const fullName = `${contactGivenName.trim()} ${contactFamilyName.trim()}`.trim();
    setPendingConfirm({
      title: `Create Google Contact "${fullName}"?`,
      serviceLabel: 'Google Contacts',
      description: 'Saves a new contact record in your Google Contacts directory.',
      affectedItems: [fullName, contactEmail || 'No email', contactOrg || 'No organization'],
      confirmLabel: 'Save Contact',
      onConfirm: async () => {
        const created = await createContact(accessToken, {
          givenName: contactGivenName,
          familyName: contactFamilyName,
          email: contactEmail,
          phone: contactPhone,
          organization: contactOrg,
        });
        await recordAudit('contacts', 'create_contact', created.displayName, 'success', created.resourceName);
        onNotify('success', `Saved "${created.displayName}" to Google Contacts.`);
        setContactGivenName('');
        setContactFamilyName('');
        setContactEmail('');
        setContactPhone('');
        setContactOrg('');
        await loadContactsData();
      },
    });
  };

  const requestDeleteContact = (contact: GoogleContactItem) => {
    if (!accessToken) return;
    setPendingConfirm({
      title: `Delete contact "${contact.displayName}"?`,
      serviceLabel: 'Google Contacts',
      description: 'Permanently removes this contact from your Google Contacts.',
      affectedItems: [contact.displayName, contact.email || contact.resourceName],
      confirmLabel: 'Delete Contact',
      destructive: true,
      onConfirm: async () => {
        await deleteContact(accessToken, contact.resourceName);
        await recordAudit('contacts', 'delete_contact', contact.displayName, 'success', contact.resourceName);
        onNotify('info', `Deleted contact "${contact.displayName}".`);
        await loadContactsData();
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">
            Google Workspace &amp; Cloud Firestore Hub
          </h1>
          <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
            Connect your Google account for encrypted cloud snapshots in Firestore and live operational workflows across Drive, Sheets, Gmail, Docs, Tasks, Chat, and Contacts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {user ? (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="leading-tight">
                <div className="font-semibold text-slate-900">
                  {user.displayName || user.email}
                </div>
                <div className="text-[11px] text-slate-500">
                  {accessToken
                    ? 'Firebase & Workspace OAuth Active'
                    : 'Firebase Authenticated · Re-authorize for Workspace APIs'}
                </div>
              </div>
              {!accessToken && (
                <button
                  type="button"
                  onClick={() => void onGoogleSignIn()}
                  className="ml-2 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded cursor-pointer"
                >
                  Authorize Workspace
                </button>
              )}
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="ml-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-red-700 border border-slate-200 bg-white rounded cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <GoogleSignInButton onClick={() => void onGoogleSignIn()} />
          )}
        </div>
      </section>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'border-[#2563EB] text-[#2563EB] bg-white font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: CLOUD FIRESTORE SYNC */}
      {activeTab === 'cloud' && (
        <div className="space-y-6">
          {!user ? (
            renderWorkspaceAuthGate('Cloud Firestore Sync')
          ) : (
            <>
              {firestoreError && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="break-words">{firestoreError}</div>
                </div>
              )}

              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Save Live ERP Snapshot to Firestore
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Persists Chart of Accounts, Journal Lines, Posted Transactions, and IFRS KPI metrics under your private user ownership.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={snapshotLabel}
                    onChange={(e) => setSnapshotLabel(e.target.value)}
                    placeholder="Snapshot label..."
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <button
                    type="button"
                    onClick={requestSaveFirestoreSnapshot}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer shrink-0"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>Save Cloud Snapshot</span>
                  </button>
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Snapshots List */}
                <section className="lg:col-span-7 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Saved Cloud Snapshots ({snapshots.length})
                    </h3>
                  </div>
                  {snapshots.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No Firestore snapshots saved yet for your account.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {snapshots.map((snap) => (
                        <div key={snap.id} className="p-4 flex items-start justify-between gap-4">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-900 truncate">
                                {snap.label}
                              </span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                  snap.status === 'ARCHIVED'
                                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}
                              >
                                {snap.status}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                              <span>FY {snap.fiscalPeriod}</span>
                              <span>{snap.metrics.accountCount} Accts</span>
                              <span>{snap.metrics.postedTransactionCount} Posted</span>
                              <span>
                                Assets {snap.currencyCode}{' '}
                                {snap.metrics.totalAssets.toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {snap.status !== 'ARCHIVED' && (
                              <button
                                type="button"
                                title="Archive Snapshot (Lock)"
                                onClick={() =>
                                  setPendingConfirm({
                                    title: `Archive Snapshot "${snap.label}"?`,
                                    serviceLabel: 'Cloud Firestore',
                                    description:
                                      'Locks the snapshot status to ARCHIVED so it becomes read-only.',
                                    affectedItems: [snap.label],
                                    confirmLabel: 'Archive Snapshot',
                                    onConfirm: async () => {
                                      await archiveErpSnapshot(snap.id);
                                      await recordAudit('firestore', 'archive_snapshot', snap.label, 'success', snap.id);
                                      onNotify('info', `Archived snapshot "${snap.label}".`);
                                    },
                                  })
                                }
                                className="p-1.5 text-slate-500 hover:text-amber-700 border border-slate-200 rounded cursor-pointer"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Delete Snapshot"
                              onClick={() =>
                                setPendingConfirm({
                                  title: `Delete Snapshot "${snap.label}"?`,
                                  serviceLabel: 'Cloud Firestore',
                                  description:
                                    'Permanently deletes this cloud snapshot document from Firestore.',
                                  affectedItems: [snap.label],
                                  confirmLabel: 'Delete Snapshot',
                                  destructive: true,
                                  onConfirm: async () => {
                                    await deleteErpSnapshot(snap.id);
                                    await recordAudit('firestore', 'delete_snapshot', snap.label, 'success', snap.id);
                                    onNotify('info', `Deleted snapshot "${snap.label}".`);
                                  },
                                })
                              }
                              className="p-1.5 text-slate-500 hover:text-red-600 border border-slate-200 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Workspace Activity Log */}
                <section className="lg:col-span-5 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 bg-[#F8FAFC]">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Cloud &amp; Workspace Sync Feed ({activities.length})
                    </h3>
                  </div>
                  {activities.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Workspace actions you authorize will appear here in real time.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto ledger-scroll">
                      {activities.slice(0, 20).map((act) => (
                        <div key={act.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-800 truncate">
                              <span className="font-mono uppercase text-[10px] text-[#2563EB] mr-1.5">
                                [{act.workspaceApp}]
                              </span>
                              {act.targetTitle}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400">{act.action}</div>
                          </div>
                          <button
                            type="button"
                            title="Remove Log Entry"
                            onClick={() => void deleteWorkspaceActivity(act.id)}
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: GOOGLE DRIVE */}
      {activeTab === 'drive' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Google Drive')
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-900">Create ERP Drive Folder</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                      placeholder="Folder name..."
                    />
                    <button
                      type="button"
                      onClick={requestCreateDriveFolder}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Create</span>
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Export Live Trial Balance CSV to Drive
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Uploads {reports.trialBalance.rows.length} active GL accounts in CSV format directly to your Google Drive.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={requestUploadTrialBalanceCsvToDrive}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Trial Balance CSV</span>
                  </button>
                </div>
              </div>

              <section className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Recent Google Drive Files ({driveFiles.length})
                  </h2>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={driveQuery}
                        onChange={(e) => setDriveQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void loadDrive()}
                        placeholder="Filter by file name..."
                        className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadDrive()}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">File Name</th>
                        <th className="px-4 py-2.5 font-semibold">Type</th>
                        <th className="px-4 py-2.5 font-semibold">Modified</th>
                        <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {driveFiles.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                            {busy ? 'Loading Drive files...' : 'No files matched your filter.'}
                          </td>
                        </tr>
                      ) : (
                        driveFiles.map((file) => (
                          <tr key={file.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5 font-medium text-slate-900">
                              {file.webViewLink ? (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 hover:text-[#2563EB] hover:underline"
                                >
                                  <span>{file.name}</span>
                                  <ExternalLink className="w-3 h-3 text-slate-400" />
                                </a>
                              ) : (
                                file.name
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                              {file.mimeType.replace('application/vnd.google-apps.', 'g-')}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                              {file.modifiedTime ? file.modifiedTime.slice(0, 16).replace('T', ' ') : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => requestTrashDriveFile(file, false)}
                                className="px-2 py-1 text-[11px] text-slate-600 hover:text-amber-700 border border-slate-200 rounded cursor-pointer"
                              >
                                Trash
                              </button>
                              <button
                                type="button"
                                onClick={() => requestTrashDriveFile(file, true)}
                                className="px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 border border-red-200 rounded cursor-pointer"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* TAB 3: GOOGLE SHEETS */}
      {activeTab === 'sheets' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Google Sheets')
          ) : (
            <>
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Create Live Multi-Tab ATCL Financial Spreadsheet
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Creates a Google Sheet with Trial Balance, Chart of Accounts, and Income Statement tabs.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={newSheetTitle}
                    onChange={(e) => setNewSheetTitle(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md"
                    placeholder="Spreadsheet title..."
                  />
                  <button
                    type="button"
                    onClick={requestExportFinancialSpreadsheet}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Export ERP Financial Pack</span>
                  </button>
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <section className="lg:col-span-4 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Your Spreadsheets</span>
                    <button
                      type="button"
                      onClick={() => void loadSheetsList()}
                      className="text-xs text-[#2563EB] hover:underline cursor-pointer"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto ledger-scroll">
                    {spreadsheets.length === 0 ? (
                      <div className="p-6 text-xs text-slate-500 text-center">
                        No spreadsheets found.
                      </div>
                    ) : (
                      spreadsheets.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedSheetId(s.id);
                            void loadSelectedSheetPreview(s.id);
                          }}
                          className={`w-full text-left px-4 py-3 text-xs hover:bg-slate-50 cursor-pointer ${
                            selectedSheetId === s.id ? 'bg-[#DBEAFE]/60 font-semibold text-[#2563EB]' : 'text-slate-700'
                          }`}
                        >
                          <div className="truncate">{s.name}</div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
                            {s.id}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="lg:col-span-8 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {sheetPreview ? `${sheetPreview.title} — [${sheetPreview.tabTitle}]` : 'Spreadsheet Preview'}
                      </div>
                      {sheetPreview && sheetPreview.allTabs.length > 0 && (
                        <div className="text-[11px] text-slate-500">
                          Tabs detected: {sheetPreview.allTabs.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedSheetId && (
                        <button
                          type="button"
                          onClick={() => void loadSelectedSheetPreview(selectedSheetId)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          Inspect Sheet
                        </button>
                      )}
                      {sheetPreview?.tabTitle && (
                        <button
                          type="button"
                          onClick={requestAppendKpiSummaryToSheet}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded cursor-pointer"
                        >
                          Append KPI Row
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[380px] ledger-scroll">
                    {!sheetPreview ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        Select a spreadsheet on the left and click Inspect Sheet to preview its actual tab structure and rows.
                      </div>
                    ) : sheetPreview.rows.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        Tab "{sheetPreview.tabTitle}" has no populated rows yet.
                      </div>
                    ) : (
                      <table className="w-full text-left text-xs border-collapse">
                        <tbody>
                          {sheetPreview.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={rIdx === 0 ? 'bg-slate-100 font-semibold text-slate-900' : 'border-t border-slate-100'}
                            >
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: GMAIL */}
      {activeTab === 'gmail' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Gmail')
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Compose & Dispatch ERP Summary */}
              <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">
                  Dispatch Financial Report via Gmail
                </h2>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Recipient Email
                    </label>
                    <input
                      type="email"
                      value={mailTo}
                      onChange={(e) => setMailTo(e.target.value)}
                      placeholder="cfo@company.com"
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={mailSubject}
                      onChange={(e) => setMailSubject(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Message Body
                    </label>
                    <textarea
                      rows={8}
                      value={mailBody}
                      onChange={(e) => setMailBody(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={requestSendEmail}
                    disabled={!mailTo.trim() || !mailSubject.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Review &amp; Send Email</span>
                  </button>
                </div>
              </section>

              {/* Recent Gmail Messages */}
              <section className="lg:col-span-7 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Recent Gmail Messages ({gmailMessages.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={gmailQuery}
                      onChange={(e) => setGmailQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void loadGmail()}
                      placeholder="Search Gmail (e.g. invoice)..."
                      className="px-2.5 py-1 text-xs border border-slate-300 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={() => void loadGmail()}
                      className="px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      Search
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 max-h-[430px] overflow-y-auto ledger-scroll">
                  {gmailMessages.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      {busy ? 'Loading Gmail inbox...' : 'No Gmail messages found.'}
                    </div>
                  ) : (
                    gmailMessages.map((m) => (
                      <div key={m.id} className="p-4 flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {m.subject}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">{m.from}</div>
                          <p className="text-xs text-slate-600 line-clamp-2">{m.snippet}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => requestTrashGmail(m)}
                          className="p-1.5 text-slate-400 hover:text-red-600 border border-slate-200 rounded shrink-0 cursor-pointer"
                          title="Move to Gmail Trash"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: GOOGLE DOCS */}
      {activeTab === 'docs' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Google Docs')
          ) : (
            <>
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">
                  Generate ATCL Executive Financial Brief (Google Doc)
                </h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={requestCreateBriefDoc}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Create Financial Brief Doc</span>
                  </button>
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <section className="lg:col-span-4 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Your Google Docs</span>
                    <button
                      type="button"
                      onClick={() => void loadDocsList()}
                      className="text-xs text-[#2563EB] hover:underline cursor-pointer"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto ledger-scroll">
                    {googleDocsList.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const loaded = await readGoogleDoc(accessToken, d.id);
                            setSelectedDoc(loaded);
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className={`w-full text-left px-4 py-3 text-xs hover:bg-slate-50 cursor-pointer ${
                          selectedDoc?.documentId === d.id
                            ? 'bg-[#DBEAFE]/60 font-semibold text-[#2563EB]'
                            : 'text-slate-700'
                        }`}
                      >
                        <div className="truncate">{d.name}</div>
                      </button>
                    ))}
                    {googleDocsList.length === 0 && (
                      <div className="p-6 text-xs text-slate-500 text-center">
                        No Google Docs found.
                      </div>
                    )}
                  </div>
                </section>

                <section className="lg:col-span-8 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">
                      {selectedDoc ? selectedDoc.title : 'Document Reader'}
                    </span>
                    {selectedDoc && (
                      <a
                        href={`https://docs.google.com/document/d/${selectedDoc.documentId}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
                      >
                        <span>Open in Google Docs</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="p-5">
                    {selectedDoc ? (
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 max-h-[340px] overflow-y-auto ledger-scroll">
                        {selectedDoc.bodyText || '(Empty document)'}
                      </pre>
                    ) : (
                      <div className="py-10 text-center text-xs text-slate-500">
                        Select a Google Doc on the left to inspect its contents.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 6: GOOGLE TASKS */}
      {activeTab === 'tasks' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Google Tasks')
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <section className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Add Accounting / Audit Task</h2>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Task List
                    </label>
                    <select
                      value={activeTaskListId}
                      onChange={async (e) => {
                        const id = e.target.value;
                        setActiveTaskListId(id);
                        const rows = await listTasks(accessToken, id);
                        setTasks(rows);
                      }}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                    >
                      {taskLists.map((tl) => (
                        <option key={tl.id} value={tl.id}>
                          {tl.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Task Title
                    </label>
                    <input
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="e.g. Month-end VAT & TDS Reconciliation"
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Due Date (optional)
                    </label>
                    <input
                      type="date"
                      value={newTaskDue}
                      onChange={(e) => setNewTaskDue(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Notes
                    </label>
                    <textarea
                      rows={3}
                      value={newTaskNotes}
                      onChange={(e) => setNewTaskNotes(e.target.value)}
                      placeholder="GL verification details..."
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={requestCreateTask}
                    disabled={!newTaskTitle.trim() || !activeTaskListId}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>
              </section>

              <section className="lg:col-span-8 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Tasks ({tasks.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadTasksData()}
                    className="text-xs text-[#2563EB] hover:underline cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>
                <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto ledger-scroll">
                  {tasks.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No tasks in this list yet.
                    </div>
                  ) : (
                    tasks.map((t) => (
                      <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={t.status === 'completed'}
                            onChange={() => requestToggleTask(t)}
                            className="mt-0.5 rounded border-slate-300 text-[#2563EB] cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div
                              className={`text-xs font-medium ${
                                t.status === 'completed'
                                  ? 'line-through text-slate-400'
                                  : 'text-slate-900'
                              }`}
                            >
                              {t.title}
                            </div>
                            {t.notes && (
                              <div className="text-[11px] text-slate-500 mt-0.5">{t.notes}</div>
                            )}
                            {t.due && (
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                                Due {t.due.slice(0, 10)}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => requestDeleteTask(t)}
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* TAB 7: GOOGLE CHAT */}
      {activeTab === 'chat' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Google Chat')
          ) : chatPrerequisiteNote ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-amber-900">
                    Google Chat API Prerequisites &amp; Workspace Setup Required
                  </h3>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    {chatPrerequisiteNote}
                  </p>
                  <p className="text-xs text-amber-800">
                    Google Chat spaces and messaging APIs require a Business/Enterprise Google Workspace account and an enabled Chat app configuration in Google Cloud Console.
                  </p>
                  <div className="pt-1 flex flex-wrap items-center gap-3">
                    <a
                      href={GOOGLE_CHAT_CONSOLE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-md"
                    >
                      <span>Open Google Chat Console Config</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void loadChatData()}
                      className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-md hover:bg-amber-100 cursor-pointer"
                    >
                      Retry Chat Connection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <section className="lg:col-span-4 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Chat Spaces</span>
                  <button
                    type="button"
                    onClick={() => void loadChatData()}
                    className="text-xs text-[#2563EB] hover:underline cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>
                <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto ledger-scroll">
                  {chatSpaces.length === 0 ? (
                    <div className="p-6 text-xs text-slate-500 text-center">
                      No Chat spaces found.
                    </div>
                  ) : (
                    chatSpaces.map((sp) => (
                      <button
                        key={sp.name}
                        type="button"
                        onClick={async () => {
                          setActiveSpaceName(sp.name);
                          const msgs = await listChatMessages(accessToken, sp.name);
                          setChatMessages(msgs);
                        }}
                        className={`w-full text-left px-4 py-3 text-xs hover:bg-slate-50 cursor-pointer ${
                          activeSpaceName === sp.name
                            ? 'bg-[#DBEAFE]/60 font-semibold text-[#2563EB]'
                            : 'text-slate-700'
                        }`}
                      >
                        <div className="truncate">{sp.displayName || sp.name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{sp.spaceType || sp.type}</div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="lg:col-span-8 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC]">
                  <span className="text-xs font-bold text-slate-900">Space Messages</span>
                </div>
                <div className="flex-1 p-4 space-y-2.5 max-h-[290px] overflow-y-auto ledger-scroll">
                  {chatMessages.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      Select a space or send an ERP status update below.
                    </div>
                  ) : (
                    chatMessages.map((msg) => (
                      <div key={msg.name} className="p-3 rounded-md border border-slate-100 bg-slate-50">
                        <div className="text-[11px] font-semibold text-slate-700">
                          {msg.sender?.displayName || msg.sender?.name || 'Member'}
                          {msg.createTime && (
                            <span className="ml-2 font-mono text-[10px] text-slate-400">
                              {msg.createTime.slice(0, 16).replace('T', ' ')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-800 mt-1">{msg.text}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-3 border-t border-slate-200 flex gap-2">
                  <input
                    type="text"
                    value={newChatText}
                    onChange={(e) => setNewChatText(e.target.value)}
                    placeholder="Post ERP update to space..."
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={requestSendChatMessage}
                    disabled={!activeSpaceName || !newChatText.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* TAB 8: CONTACTS (PEOPLE API) */}
      {activeTab === 'contacts' && (
        <div className="space-y-5">
          {!accessToken ? (
            renderWorkspaceAuthGate('Google Contacts')
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <section className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Add Google Contact</h2>
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={contactGivenName}
                    onChange={(e) => setContactGivenName(e.target.value)}
                    placeholder="First / Given Name *"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    value={contactFamilyName}
                    onChange={(e) => setContactFamilyName(e.target.value)}
                    placeholder="Last Name"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="Email Address"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Phone Number"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    value={contactOrg}
                    onChange={(e) => setContactOrg(e.target.value)}
                    placeholder="Organization / Vendor"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={requestCreateContact}
                    disabled={!contactGivenName.trim()}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-50"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Save to Google Contacts</span>
                  </button>
                </div>
              </section>

              <section className="lg:col-span-8 bg-white border border-[#001F60] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Directory Contacts ({contacts.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void loadContactsData()}
                      placeholder="Search contacts..."
                      className="px-2.5 py-1 text-xs border border-slate-300 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={() => void loadContactsData()}
                      className="px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      Search
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto max-h-[420px] ledger-scroll">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Name</th>
                        <th className="px-4 py-2.5 font-semibold">Email</th>
                        <th className="px-4 py-2.5 font-semibold">Phone</th>
                        <th className="px-4 py-2.5 font-semibold">Org</th>
                        <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {contacts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                            {busy ? 'Loading contacts...' : 'No contacts found.'}
                          </td>
                        </tr>
                      ) : (
                        contacts.map((c) => (
                          <tr key={c.resourceName} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5 font-medium text-slate-900">
                              {c.displayName}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">
                              {c.email || '—'}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">
                              {c.phone || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">{c.organization || '—'}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => requestDeleteContact(c)}
                                className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                                title="Delete Contact"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* Mandatory User Confirmation Dialog for All Workspace & Cloud Mutations */}
      <WorkspaceConfirmModal
        pending={pendingConfirm}
        busy={confirmBusy}
        onCancel={() => !confirmBusy && setPendingConfirm(null)}
        onConfirm={() => void handleConfirmExecute()}
      />
    </div>
  );
};

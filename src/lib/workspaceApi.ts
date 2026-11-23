import { FIREBASE_PROJECT_ID } from './firebase.ts';

export class WorkspaceApiError extends Error {
  status: number;
  service: string;
  isChatSetupRequired?: boolean;
  setupUrl?: string;

  constructor(
    message: string,
    status: number,
    service: string,
    options?: { isChatSetupRequired?: boolean; setupUrl?: string }
  ) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.status = status;
    this.service = service;
    this.isChatSetupRequired = options?.isChatSetupRequired;
    this.setupUrl = options?.setupUrl;
  }
}

export const GOOGLE_CHAT_CONSOLE_URL = `https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=${FIREBASE_PROJECT_ID}`;

async function wsFetch<T>(
  url: string,
  token: string,
  service: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (res.status === 204) {
    return {} as T;
  }

  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const errObj = parsed?.error as { message?: string; status?: string } | undefined;
    const rawMessage =
      errObj?.message || text || `Google ${service} request failed (HTTP ${res.status})`;

    if (
      service === 'chat' &&
      (res.status === 404 ||
        res.status === 403 ||
        rawMessage.toLowerCase().includes('chat app not found') ||
        rawMessage.toLowerCase().includes('hangouts'))
    ) {
      throw new WorkspaceApiError(
        `Google Chat requires a Business/Enterprise Google Workspace account and an enabled Chat app configuration in Cloud Console. (${rawMessage})`,
        res.status,
        service,
        {
          isChatSetupRequired: true,
          setupUrl: GOOGLE_CHAT_CONSOLE_URL,
        }
      );
    }

    throw new WorkspaceApiError(rawMessage, res.status, service);
  }

  return (parsed ?? {}) as T;
}

// ============================================================================
// 1. GOOGLE DRIVE API (v3)
// ============================================================================

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

export async function listDriveFiles(
  token: string,
  searchQuery?: string
): Promise<DriveFileItem[]> {
  const qParts = ['trashed = false'];
  if (searchQuery && searchQuery.trim()) {
    const escaped = searchQuery.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${escaped}'`);
  }
  const params = new URLSearchParams({
    pageSize: '25',
    q: qParts.join(' and '),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  const data = await wsFetch<{ files?: DriveFileItem[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    token,
    'drive'
  );
  return data.files || [];
}

export async function createDriveFolder(token: string, name: string): Promise<DriveFileItem> {
  return wsFetch<DriveFileItem>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink',
    token,
    'drive',
    {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );
}

export async function uploadDriveTextFile(
  token: string,
  payload: { name: string; content: string; mimeType?: string }
): Promise<DriveFileItem> {
  const boundary = `atcl_erp_${Date.now()}`;
  const metadata = {
    name: payload.name.trim(),
    mimeType: payload.mimeType || 'text/plain',
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${payload.mimeType || 'text/plain'}\r\n\r\n` +
    `${payload.content}\r\n` +
    `--${boundary}--`;

  return wsFetch<DriveFileItem>(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink',
    token,
    'drive',
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
}

export async function trashDriveFile(token: string, fileId: string): Promise<DriveFileItem> {
  return wsFetch<DriveFileItem>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name`,
    token,
    'drive',
    {
      method: 'PATCH',
      body: JSON.stringify({ trashed: true }),
    }
  );
}

export async function deleteDriveFilePermanently(token: string, fileId: string): Promise<void> {
  await wsFetch<Record<string, never>>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    token,
    'drive',
    { method: 'DELETE' }
  );
}

// ============================================================================
// 2. GOOGLE SHEETS API (v4)
// ============================================================================

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  properties: { title: string };
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      index: number;
      gridProperties?: { rowCount: number; columnCount: number };
    };
  }>;
}

export async function listDriveSpreadsheets(token: string): Promise<DriveFileItem[]> {
  const params = new URLSearchParams({
    pageSize: '20',
    q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  const data = await wsFetch<{ files?: DriveFileItem[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    token,
    'sheets'
  );
  return data.files || [];
}

export async function getSpreadsheetMetadata(
  token: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  return wsFetch<SpreadsheetMetadata>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties`,
    token,
    'sheets'
  );
}

export async function readSheetFirstTabPreview(
  token: string,
  spreadsheetId: string
): Promise<{
  title: string;
  tabTitle: string;
  allTabs: string[];
  rows: string[][];
}> {
  const meta = await getSpreadsheetMetadata(token, spreadsheetId);
  const allTabs = (meta.sheets || []).map((s) => s.properties.title);
  const firstTab = allTabs[0];
  if (!firstTab) {
    return {
      title: meta.properties?.title || 'Untitled Spreadsheet',
      tabTitle: '',
      allTabs: [],
      rows: [],
    };
  }
  const safeTab = `'${firstTab.replace(/'/g, "''")}'!A1:Z30`;
  const valuesRes = await wsFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(safeTab)}`,
    token,
    'sheets'
  );
  return {
    title: meta.properties?.title || 'Spreadsheet',
    tabTitle: firstTab,
    allTabs,
    rows: valuesRes.values || [],
  };
}

export async function createErpSpreadsheet(
  token: string,
  title: string,
  tabs: Array<{ tabTitle: string; rows: Array<Array<string | number>> }>
): Promise<{ spreadsheetId: string; spreadsheetUrl: string; title: string }> {
  const created = await wsFetch<SpreadsheetMetadata>(
    'https://sheets.googleapis.com/v4/spreadsheets',
    token,
    'sheets',
    {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: title.trim() },
        sheets: tabs.map((t, index) => ({
          properties: {
            title: t.tabTitle,
            index,
          },
        })),
      }),
    }
  );

  if (tabs.length > 0) {
    await wsFetch<Record<string, unknown>>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values:batchUpdate`,
      token,
      'sheets',
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: tabs.map((t) => ({
            range: `'${t.tabTitle.replace(/'/g, "''")}'!A1`,
            values: t.rows,
          })),
        }),
      }
    );
  }

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}`,
    title: created.properties?.title || title,
  };
}

export async function appendRowsToSheetTab(
  token: string,
  spreadsheetId: string,
  tabTitle: string,
  rows: Array<Array<string | number>>
): Promise<void> {
  const range = `'${tabTitle.replace(/'/g, "''")}'!A1`;
  await wsFetch<Record<string, unknown>>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    token,
    'sheets',
    {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    }
  );
}

// ============================================================================
// 3. GMAIL API (v1)
// ============================================================================

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  labelIds: string[];
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
  );
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function listGmailMessages(
  token: string,
  queryStr?: string
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({ maxResults: '12' });
  if (queryStr && queryStr.trim()) {
    params.set('q', queryStr.trim());
  }
  const listRes = await wsFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    token,
    'gmail'
  );

  const ids = (listRes.messages || []).slice(0, 12);
  const details = await Promise.all(
    ids.map(async (item) => {
      const msg = await wsFetch<{
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: Array<{ name: string; value: string }> };
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        token,
        'gmail'
      );
      const headers = msg.payload?.headers;
      return {
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet || '',
        subject: getHeader(headers, 'Subject') || '(No Subject)',
        from: getHeader(headers, 'From') || 'Unknown Sender',
        date: getHeader(headers, 'Date') || '',
        labelIds: msg.labelIds || [],
      };
    })
  );
  return details;
}

export async function sendGmailMessage(
  token: string,
  payload: { to: string; subject: string; bodyText: string }
): Promise<{ id: string; threadId: string }> {
  const rawMessage = [
    `To: ${payload.to.trim()}`,
    `Subject: ${payload.subject.trim()}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    payload.bodyText,
  ].join('\r\n');

  return wsFetch<{ id: string; threadId: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    token,
    'gmail',
    {
      method: 'POST',
      body: JSON.stringify({
        raw: encodeBase64Url(rawMessage),
      }),
    }
  );
}

export async function trashGmailMessage(token: string, messageId: string): Promise<void> {
  await wsFetch<Record<string, unknown>>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    token,
    'gmail',
    { method: 'POST' }
  );
}

// ============================================================================
// 4. GOOGLE DOCS API (v1)
// ============================================================================

export interface GoogleDocSummary {
  documentId: string;
  title: string;
  bodyText: string;
}

export async function listDriveGoogleDocs(token: string): Promise<DriveFileItem[]> {
  const params = new URLSearchParams({
    pageSize: '20',
    q: "mimeType = 'application/vnd.google-apps.document' and trashed = false",
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  const data = await wsFetch<{ files?: DriveFileItem[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    token,
    'docs'
  );
  return data.files || [];
}

export async function readGoogleDoc(
  token: string,
  documentId: string
): Promise<GoogleDocSummary> {
  const docData = await wsFetch<{
    documentId: string;
    title?: string;
    body?: {
      content?: Array<{
        paragraph?: {
          elements?: Array<{ textRun?: { content?: string } }>;
        };
      }>;
    };
  }>(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`, token, 'docs');

  const paragraphs = (docData.body?.content || [])
    .map((block) =>
      (block.paragraph?.elements || [])
        .map((el) => el.textRun?.content || '')
        .join('')
    )
    .filter(Boolean);

  return {
    documentId: docData.documentId,
    title: docData.title || 'Untitled Document',
    bodyText: paragraphs.join(''),
  };
}

export async function createGoogleDocWithContent(
  token: string,
  title: string,
  bodyText: string
): Promise<{ documentId: string; title: string; url: string }> {
  const created = await wsFetch<{ documentId: string; title: string }>(
    'https://docs.googleapis.com/v1/documents',
    token,
    'docs',
    {
      method: 'POST',
      body: JSON.stringify({ title: title.trim() }),
    }
  );

  if (bodyText.trim()) {
    await wsFetch<Record<string, unknown>>(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(created.documentId)}:batchUpdate`,
      token,
      'docs',
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: bodyText,
              },
            },
          ],
        }),
      }
    );
  }

  return {
    documentId: created.documentId,
    title: created.title,
    url: `https://docs.google.com/document/d/${created.documentId}/edit`,
  };
}

export async function appendGoogleDocText(
  token: string,
  documentId: string,
  textToAppend: string
): Promise<void> {
  await wsFetch<Record<string, unknown>>(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    'docs',
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              endOfSegmentLocation: { segmentId: '' },
              text: `\n${textToAppend}`,
            },
          },
        ],
      }),
    }
  );
}

// ============================================================================
// 5. GOOGLE TASKS API (v1)
// ============================================================================

export interface GoogleTaskList {
  id: string;
  title: string;
}

export interface GoogleTaskItem {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  updated?: string;
}

export async function listTaskLists(token: string): Promise<GoogleTaskList[]> {
  const data = await wsFetch<{ items?: GoogleTaskList[] }>(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
    token,
    'tasks'
  );
  return data.items || [];
}

export async function listTasks(
  token: string,
  taskListId: string
): Promise<GoogleTaskItem[]> {
  const params = new URLSearchParams({
    showCompleted: 'true',
    showHidden: 'false',
    maxResults: '50',
  });
  const data = await wsFetch<{ items?: GoogleTaskItem[] }>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks?${params.toString()}`,
    token,
    'tasks'
  );
  return data.items || [];
}

export async function createTask(
  token: string,
  taskListId: string,
  payload: { title: string; notes?: string; due?: string }
): Promise<GoogleTaskItem> {
  const body: Record<string, string> = { title: payload.title.trim() };
  if (payload.notes?.trim()) body.notes = payload.notes.trim();
  if (payload.due?.trim()) {
    body.due = payload.due.includes('T') ? payload.due : `${payload.due}T00:00:00.000Z`;
  }
  return wsFetch<GoogleTaskItem>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`,
    token,
    'tasks',
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
}

export async function updateTaskStatus(
  token: string,
  taskListId: string,
  taskId: string,
  status: 'needsAction' | 'completed'
): Promise<GoogleTaskItem> {
  return wsFetch<GoogleTaskItem>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    token,
    'tasks',
    {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        completed: status === 'completed' ? new Date().toISOString() : null,
      }),
    }
  );
}

export async function deleteTask(
  token: string,
  taskListId: string,
  taskId: string
): Promise<void> {
  await wsFetch<Record<string, never>>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    token,
    'tasks',
    { method: 'DELETE' }
  );
}

// ============================================================================
// 6. GOOGLE CHAT API (v1)
// ============================================================================

export interface GoogleChatSpace {
  name: string;
  displayName?: string;
  spaceType?: string;
  type?: string;
}

export interface GoogleChatMessage {
  name: string;
  text?: string;
  createTime?: string;
  sender?: { name?: string; displayName?: string; type?: string };
}

export async function listChatSpaces(token: string): Promise<GoogleChatSpace[]> {
  const data = await wsFetch<{ spaces?: GoogleChatSpace[] }>(
    'https://chat.googleapis.com/v1/spaces?pageSize=25',
    token,
    'chat'
  );
  return data.spaces || [];
}

export async function listChatMessages(
  token: string,
  spaceName: string
): Promise<GoogleChatMessage[]> {
  const data = await wsFetch<{ messages?: GoogleChatMessage[] }>(
    `https://chat.googleapis.com/v1/${spaceName}/messages?pageSize=25&orderBy=createTime desc`,
    token,
    'chat'
  );
  return data.messages || [];
}

export async function sendChatMessage(
  token: string,
  spaceName: string,
  text: string
): Promise<GoogleChatMessage> {
  return wsFetch<GoogleChatMessage>(
    `https://chat.googleapis.com/v1/${spaceName}/messages`,
    token,
    'chat',
    {
      method: 'POST',
      body: JSON.stringify({ text: text.trim() }),
    }
  );
}

// ============================================================================
// 7. GOOGLE CONTACTS / PEOPLE API (v1)
// ============================================================================

export interface GoogleContactItem {
  resourceName: string;
  etag?: string;
  displayName: string;
  email: string;
  phone: string;
  organization: string;
}

interface RawPerson {
  resourceName: string;
  etag?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

function mapPerson(p: RawPerson): GoogleContactItem {
  return {
    resourceName: p.resourceName,
    etag: p.etag,
    displayName: p.names?.[0]?.displayName || p.emailAddresses?.[0]?.value || 'Unnamed Contact',
    email: p.emailAddresses?.[0]?.value || '',
    phone: p.phoneNumbers?.[0]?.value || '',
    organization: p.organizations?.[0]?.name || '',
  };
}

export async function listContacts(
  token: string,
  searchQuery?: string
): Promise<GoogleContactItem[]> {
  if (searchQuery && searchQuery.trim()) {
    const params = new URLSearchParams({
      query: searchQuery.trim(),
      readMask: 'names,emailAddresses,phoneNumbers,organizations',
      pageSize: '25',
    });
    const data = await wsFetch<{ results?: Array<{ person?: RawPerson }> }>(
      `https://people.googleapis.com/v1/people:searchContacts?${params.toString()}`,
      token,
      'contacts'
    );
    return (data.results || [])
      .map((r) => r.person)
      .filter((p): p is RawPerson => Boolean(p))
      .map(mapPerson);
  }

  const params = new URLSearchParams({
    personFields: 'names,emailAddresses,phoneNumbers,organizations',
    pageSize: '30',
    sortOrder: 'FIRST_NAME_ASCENDING',
  });
  const data = await wsFetch<{ connections?: RawPerson[] }>(
    `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`,
    token,
    'contacts'
  );
  return (data.connections || []).map(mapPerson);
}

export async function createContact(
  token: string,
  payload: {
    givenName: string;
    familyName?: string;
    email?: string;
    phone?: string;
    organization?: string;
  }
): Promise<GoogleContactItem> {
  const body: Record<string, unknown> = {
    names: [
      {
        givenName: payload.givenName.trim(),
        familyName: payload.familyName?.trim() || '',
      },
    ],
  };
  if (payload.email?.trim()) {
    body.emailAddresses = [{ value: payload.email.trim(), type: 'work' }];
  }
  if (payload.phone?.trim()) {
    body.phoneNumbers = [{ value: payload.phone.trim(), type: 'work' }];
  }
  if (payload.organization?.trim()) {
    body.organizations = [{ name: payload.organization.trim() }];
  }
  const person = await wsFetch<RawPerson>(
    'https://people.googleapis.com/v1/people:createContact',
    token,
    'contacts',
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
  return mapPerson(person);
}

export async function deleteContact(token: string, resourceName: string): Promise<void> {
  await wsFetch<Record<string, never>>(
    `https://people.googleapis.com/v1/${resourceName}:deleteContact`,
    token,
    'contacts',
    { method: 'DELETE' }
  );
}

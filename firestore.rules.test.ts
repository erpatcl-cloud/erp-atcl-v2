/**
 * Security Rules Verification Suite (Phase 0 TDD Reference)
 * Covers the "Dirty Dozen" adversarial payloads against firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload?: Record<string, unknown>;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Email spoof with email_verified=false claiming admin email',
    collectionPath: 'users/attackerUid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'attackerUid', displayName: 'Spoof', role: 'admin' },
  },
  {
    id: 2,
    name: 'Privilege escalation on user signup (role=admin from non-admin)',
    collectionPath: 'users/user123',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'user123', displayName: 'User', role: 'admin' },
  },
  {
    id: 3,
    name: 'Shadow field injection (isVerified) on user update',
    collectionPath: 'users/user123',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { displayName: 'User', isVerified: true },
  },
  {
    id: 4,
    name: 'Self role escalation via update',
    collectionPath: 'users/user123',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { role: 'admin' },
  },
  {
    id: 5,
    name: 'Cross-user PII read on users/{otherId}/private/profile',
    collectionPath: 'users/victimUid/private/profile',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Non-admin enumeration list on users collection',
    collectionPath: 'users',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Unfiltered list query on erpSnapshots by non-owner',
    collectionPath: 'erpSnapshots',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Identity spoofing: create erpSnapshot with victim ownerId',
    collectionPath: 'erpSnapshots/snap1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { ownerId: 'victimUid', label: 'Spoofed' },
  },
  {
    id: 9,
    name: 'ID poisoning: >128 char or invalid chars in document ID',
    collectionPath: `erpSnapshots/${'a'.repeat(140)}`,
    operation: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Timestamp spoofing: createdAt != request.time',
    collectionPath: 'workspaceActivity/act1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { ownerId: 'user123', workspaceApp: 'drive', action: 'upload', status: 'success', createdAt: '2020-01-01T00:00:00Z' },
  },
  {
    id: 11,
    name: 'Terminal state violation: non-admin updating ARCHIVED snapshot',
    collectionPath: 'erpSnapshots/archivedSnap',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { label: 'Mutated after archive' },
  },
  {
    id: 12,
    name: 'Mutating immutable workspaceActivity log',
    collectionPath: 'workspaceActivity/act1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { status: 'error' },
  },
];

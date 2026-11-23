# ATCL ERP Firestore Security Specification

## 1. Data Invariants
1. **Default Deny**: Unmatched paths are globally denied at the root catch-all (`match /{document=**} { allow read, write: if false; }`).
2. **Verified Identity**: All authenticated mutations and protected reads require `request.auth != null && request.auth.token.email_verified == true`.
3. **PII Split Collection**: `users/{userId}` stores only public-safe attributes (`uid`, `displayName`, `photoURL`, `role`, `organization`, `createdAt`, `updatedAt`). Sensitive PII (`email`, `workspaceConnected`, `lastLoginAt`) is isolated inside `users/{userId}/private/{docId}` with strict `isOwner(userId)` isolation.
4. **Role Escalation Prevention**: Users creating their own `/users/{userId}` document can only set `role: 'viewer'` (unless `request.auth.token.email == 'erpatcl@gmail.com'` with `email_verified == true`). Self-updates cannot touch `uid`, `role`, or `createdAt`.
5. **Owner-Scoped Snapshots & Activity**: `erpSnapshots/{snapshotId}` and `workspaceActivity/{activityId}` enforce `incoming().ownerId == request.auth.uid` on creation, immutable `ownerId` and `createdAt`, server-verified timestamps (`request.time`), and explicit `existing().ownerId == request.auth.uid || isAdmin()` on `get` and `list`.
6. **Terminal State Locking**: Once an `erpSnapshots/{snapshotId}` record transitions to `status: 'ARCHIVED'`, non-admin updates are blocked.
7. **Native Maps & Lists**: Snapshot payloads store native Firestore Maps (`metrics`, `ledgerData`) rather than raw JSON strings.

## 2. The "Dirty Dozen" Adversarial Payloads
1. Unverified email spoof claiming `erpatcl@gmail.com` attempting admin creation or read.
2. Self-signup payload setting `role: 'admin'` from a non-admin email.
3. Shadow update injecting `isVerified: true` onto `/users/{userId}`.
4. User updating own `/users/{userId}` document to escalate `role` from `'viewer'` to `'admin'`.
5. Non-owner attempting `get` on `/users/{otherUid}/private/profile` (PII read leak).
6. Non-admin attempting `list` on `/users` (user enumeration).
7. Unauthenticated or non-owner `list` query on `/erpSnapshots` without matching `ownerId`.
8. Forged `ownerId` in `/erpSnapshots/{id}` creation (`ownerId: 'victim-uid'`).
9. Poisoned 1.5KB document ID (`id.size() > 128` or special chars) on `/erpSnapshots/{badId}`.
10. Client-forged `createdAt` or `updatedAt` timestamp differing from `request.time`.
11. Mutating an `'ARCHIVED'` snapshot as a non-admin owner.
12. Mutating an immutable `/workspaceActivity/{id}` log entry via `update`.

# Enhanced System Configuration Hub

Transform the current single-form System Configuration view into a structured, six-tab governance and administration hub for the ATCL General Ledger platform. Finance controllers and administrators gain real, enforced controls over statutory company metadata, voucher numbering and approval thresholds, fiscal period locking, role-based access governance, full JSON ledger backup/restore with live health diagnostics, and a dedicated Integrations & Scripts workspace.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core scope and layout decisions from your Phase 1 answers are locked into this plan below. Please confirm or request any adjustments before implementation begins.

- **Confirmed Scope**: Implement all five requested configuration domains—Company Profile & Tax/Currency, Voucher Numbering & Approval Thresholds, Fiscal Period Locking & Posting Date Controls, JSON Backup/Restore & Live Diagnostics, and Role Permissions & Audit Retention Controls.
- **Confirmed Layout**: Tabbed configuration hub organized cleanly by domain with unsaved-change indicators and per-tab or unified Save controls.
- **Confirmed Apps Script Placement**: Move the Google Apps Script companion modules viewer into a dedicated **Integrations & Scripts** tab alongside register folder and auto-sync policies.
- **Recommended Default — Server-Enforced Period Lock**: When a posting lock date or closed fiscal month is active, the backend will reject new journal or voucher postings dated on or before the lock date (with an explicit validation message) unless the lock is lifted by an administrator.
- **Recommended Default — Safe Restore Validation**: Importing a JSON ledger backup validates schema structure, required collections, and double-entry integrity before replacing live state, and records a permanent audit log entry on restore.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces the minimal 5-field configuration form with an enterprise-grade administration center split into six focused domain tabs:
  1. **Company & Tax** — Legal entity identity, BIN/VAT Registration, TIN, Trade License, registered office address, reporting currency code/symbol, default VAT/TDS/VDS rates, and decimal rounding precision.
  2. **Vouchers & Approvals** — Custom numbering series prefixes and zero-padding for Payment, Receipt, Journal, Expense, and Reversal vouchers with live formatted preview; configurable auto-approval ceiling, dual-signoff threshold, and liquidity/budget enforcement toggles.
  3. **Fiscal & Period Locks** — Fiscal year calendar range, interactive 12-month Bangladesh FY (Jul–Jun) period lock matrix allowing individual months to be locked or reopened, a hard Global Posting Lock Date, and backdating/future-dating guardrails.
  4. **Roles & Audit** — Role-based permission matrix across four organizational personas (*Finance Controller*, *Senior Accountant*, *Voucher Clerk*, *External Auditor*) covering posting, approvals, reversals, COA edits, period locks, and config changes; active operator role selector; audit log retention policy (days/max entries) and one-click audit trail export or pruning of expired records.
  5. **Backup & Diagnostics** — Full workspace JSON snapshot export with timestamped filename, validated JSON backup restore with preview diff (counts of accounts, posted transactions, vouchers, and templates before confirming), live ledger integrity diagnostics (Trial Balance parity, Balance Sheet variance, Register sync status, DB size), plus guarded Sample Data loader and ATCL Baseline reset.
  6. **Integrations & Scripts** — Register synchronization policy (Auto-Sync on Post, target GL Registers folder designation, last sync timestamp) and the full Google Apps Script (`.gs`) companion modules archive viewer with search, copy, and download controls.
- **Target Audience / Persona**: Finance Controllers, Chief Accountants, and System Administrators managing statutory compliance, internal posting controls, and data resilience for ATCL.
- **Key Value**: Moves System Configuration from static display fields into active, auditable accounting controls that protect posted periods, standardize voucher numbering, and ensure zero-loss backup and recovery.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. *Configure Organization & Tax Defaults*: Open **System Configuration** → stay on **Company & Tax** tab → update legal metadata, BIN/TIN, or default VAT/TDS percentages → review unsaved-changes notice → click **Save Changes** → header, reports, and audit log reflect updates immediately.
  2. *Lock a Closed Accounting Period*: Switch to **Fiscal & Period Locks** → toggle July–December FY months to **Locked** or set a Global Lock Date → save → any subsequent attempt to post a voucher inside a locked period displays a clear server-enforced warning explaining the lock boundary.
  3. *Customize Voucher Numbering & Thresholds*: Switch to **Vouchers & Approvals** → adjust prefixes (e.g., `ERP-PV-`, `JV-`), next sequence digits, or dual-approval threshold in BDT → observe live formatted voucher previews → save to apply across new vouchers.
  4. *Manage Role Permissions & Audit Retention*: Switch to **Roles & Audit** → inspect or adjust capability checkboxes per role → configure retention window (e.g., 365 days / 1,000 entries) → export full Audit Log CSV or run retention cleanup with confirmation.
  5. *Back Up, Diagnose, or Restore State*: Switch to **Backup & Diagnostics** → view live reconciliation and storage diagnostics → click **Download JSON Snapshot** for instant backup, or upload a `.json` backup file to inspect a pre-restore summary (record counts & dataset version) before confirming restore.
  6. *Manage Sync Policy & Apps Script Modules*: Switch to **Integrations & Scripts** → toggle Auto-Sync on Post or folder designation → browse, copy, or download any `.gs` companion script.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Crisp institutional accounting console matching the existing ATCL General Ledger aesthetic—utilitarian clarity, high information density without clutter, and zero decorative fluff.
  - *Color Palette & Mood*: Dominant cool-slate neutral canvas (`#F7F9FC`), single-elevation crisp white form containers (`#FFFFFF`) with `1px` slate borders (`#E2E8F0`), authoritative institutional navy primary accent (`#1F4E79`) reserved strictly for active tab emphasis, primary CTAs, and table headers. Semantic hues paired with explicit text/icons: emerald (`#16A34A`) for Open/Balanced/Synced states, amber (`#D97706`) for Unsaved/Pending warnings, and crimson (`#DC2626`) for Locked/Destructive actions.
  - *Typography & Hierarchy*: Existing display/body sans hierarchy paired with strict monospace tabular figures (`font-mono tabular-nums`) for all tax IDs, monetary thresholds, sequence previews, dates, file sizes, and diagnostic counters.
  - *Component Styling & Layout*: Full desktop viewport presence (`max-w-6xl`), single-row horizontal domain tab bar (`whitespace-nowrap shrink-0`) cleanly matching the existing Financial Reports segmented switcher, hairline section dividers instead of nested cards-within-cards, zero static pill badges (inline text with `·` separators for metadata), and two-step inline confirmation for destructive actions (Reset, Restore, Prune).

- **Interactive Feedback & Motion**:
  - Immediate unsaved-changes banner with **Discard** and **Save Changes** actions whenever editable settings diverge from persisted state.
  - Fast state transitions (`<= 200ms`), disabled button feedback during async saves/restores, clear inline validation messages on invalid dates/JSON files, and completion toast notifications via the root shell.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Backward-Compatible Config Hydration**
  - *Chosen Approach*: Extend the persisted system configuration object with optional, strongly-typed sub-objects (company tax profile, voucher numbering/approvals, fiscal lock matrix, role permissions, audit retention) and auto-hydrate defaults on server boot for existing saved databases.
  - *Why*: Preserves all live user transactions, vouchers, and custom templates without triggering a destructive database reset.
  - *Alternatives Considered*: Bumping the dataset version to wipe and re-seed—rejected because it would discard active ledger data.

- **Decision 2 — Real Enforcement of Fiscal Locks & Approval Thresholds**
  - *Chosen Approach*: Wire the saved fiscal lock date and locked-months list directly into the backend journal and voucher posting validators, while surfacing active voucher numbering defaults in Voucher Management.
  - *Why*: Configuration controls should govern real accounting behavior rather than acting as inert cosmetic settings.
  - *Alternatives Considered*: Storing settings purely for display—rejected because accounting administrators expect period locks to actually prevent backdated postings.

- **Decision 3 — Validated Pre-Restore Inspection**
  - *Chosen Approach*: Parse uploaded JSON backups client-side first to preview entity counts (accounts, posted lines, vouchers, templates, fiscal period), then submit to a dedicated backend restore endpoint that validates structure and atomically writes the database file.
  - *Why*: Prevents accidental corruption from malformed JSON files while providing full confidence before overwriting live state.
  - *Alternatives Considered*: Direct blind file upload—rejected due to data-loss risk.

- **Decision 4 — Tabbed Domain Separation with Shared Save Lifecycle**
  - *Chosen Approach*: Organize the six configuration domains into horizontal tabs inside a cohesive workspace header, displaying an explicit unsaved-change bar across settings tabs while keeping read-only/operational tools (Diagnostics, Restore, Apps Script viewer) independently actionable.
  - *Why*: Keeps each domain scannable without endless vertical scrolling and matches the familiar tab interaction model used in Financial Reports.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        System Configuration Hub                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Domain Tab Bar: [Company & Tax] [Vouchers & Approvals]              │  │
│  │                  [Fiscal & Locks] [Roles & Audit]                    │  │
│  │                  [Backup & Diagnostics] [Integrations & Scripts]     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                      │
│        ┌────────────────────────────┴────────────────────────────┐         │
│        ▼                                                         ▼         │
│  ┌──────────────────────────────┐                 ┌─────────────────────┐  │
│  │   Declarative Settings Tabs  │                 │ Operational Consoles│  │
│  │  • Company & Tax Profile     │                 │ • Live Diagnostics  │  │
│  │  • Voucher Series & Rules    │                 │ • JSON Backup/Import│  │
│  │  • 12-Month Period Lock Grid │                 │ • Audit Export/Prune│  │
│  │  • RBAC Matrix & Retention   │                 │ • Apps Script Viewer│  │
│  │  • Sync Policy Controls      │                 │ • Baseline Reset    │  │
│  └──────────────┬───────────────┘                 └──────────┬──────────┘  │
└─────────────────┼────────────────────────────────────────────┼─────────────┘
                  │ PATCH /api/config                          │ POST /api/backup/restore
                  │                                            │ POST /api/audit/prune
                  │                                            │ GET  /api/scripts
                  ▼                                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     Express Ledger API & Rule Engine                       │
│  • Config Hydration & Validation      • Atomic JSON Persistence            │
│  • Period Lock Enforcement on Post    • Audit Trail Recording              │
│  • Trial Balance & Register Health    • Schema-Validated State Restore     │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Extended System Configuration**: Expands the existing ledger config record with structured blocks:
    - *Company & Tax*: `legalEntityType`, `tinNumber`, `binVatNumber`, `tradeLicenseNo`, `registeredAddress`, `contactPhone`, `defaultVatPct`, `defaultTdsPct`, `defaultVdsPct`, `decimalPlaces`.
    - *Voucher Controls*: `voucherNumbering` (prefix, separator, padding, and starting sequence per voucher type: Payment, Receipt, Journal, Expense, Reversal), `autoApproveLimit`, `dualApprovalThreshold`, `enforceLiquidityCheck`, `enforceBudgetCheck`, `requireVoucherNarration`.
    - *Fiscal & Locking*: `fiscalStartDate`, `fiscalEndDate`, `globalLockDate`, `lockedMonths` (array of `YYYY-MM` keys), `allowBackdatedEntries`, `allowFutureDatedEntries`.
    - *Governance & Retention*: `activeRole`, `rolePermissions` (structured capability map per role), `auditRetentionDays`, `maxAuditEntries`.
  - **Live Diagnostics Snapshot**: Computed dynamically from authoritative ledger state (Trial Balance diff, Balance Sheet variance, reconciled vs. total registers, pending sync queue count, unposted draft count, and serialized database footprint).

- **Interactive Component & State Mapping**:
  - *Tab Navigation & Dirty-State Guard*: Switching tabs preserves local draft edits across configuration tabs until the user clicks **Save Configuration** or **Discard Changes**, showing a clear count of modified sections.
  - *Company & Tax Form*: Validates non-empty organization name, valid currency symbol/code, and bounded tax percentages (`0–100%`), updating app-wide header and statement metadata on save.
  - *Voucher Series & Threshold Editor*: Live-renders formatted sample voucher IDs as prefix/padding values change; validates that `dualApprovalThreshold >= autoApproveLimit`.
  - *Fiscal Period Lock Matrix*: Interactive 12-month grid (Jul 2024 – Jun 2025) with bulk **Lock Through Prior Month** / **Unlock All** helpers and date-picker for Global Lock Date; once saved, posting endpoints check entry dates against both `globalLockDate` and `lockedMonths` and return a clear `400` error if locked.
  - *Role Permissions & Audit Controls*: Interactive capability matrix table with role switcher; **Export Audit CSV** downloads the full log; **Prune Expired Entries** invokes a backend endpoint to trim records older than the configured retention policy while appending a governance audit entry.
  - *Backup, Restore & Diagnostics Console*: Client-side JSON snapshot download; file upload input parses and displays a pre-restore verification table before calling the restore endpoint; live diagnostics panel links directly to **Reconciliation Audit** if any sync item is pending; guarded **Load Sample Dataset** and **Reset to ATCL Baseline** actions remain protected by explicit two-step confirmation.
  - *Integrations & Scripts Tab*: Hosts the register auto-sync toggle, register folder name, sync status metadata, and the upgraded `.gs` module viewer with script filter, copy-to-clipboard, and file download.

- **Key Sequences**:
  1. *Save Configuration*: Client submits partial/full config payload via `PATCH /api/config` → server validates ranges & types, merges into authoritative state, appends a concise `UPDATE_CONFIG` audit entry summarizing changed domains, persists atomically, and returns updated state.
  2. *Restore Backup*: User selects `.json` snapshot → UI parses & previews account/transaction/voucher totals → user clicks **Confirm Restore** → `POST /api/backup/restore` validates required top-level ledger structure, hydrates missing optional fields, replaces live state, appends `RESTORE_BACKUP` audit entry, persists atomically, and refreshes UI state.

# Global Custom Instructions & AI Control Center for ATCL ERP

Introduce a centralized **Custom Instructions** system for ATCL ERP that lets finance leaders control application visual style, select and tune Gemini models, attach organization-specific accounting knowledge and reference files, and govern system prompts across four newly wired AI workflows.

### User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Scope & Architecture Decisions**
> - **Dual Access Points**: Manage full settings in a new **Custom Instructions** tab inside System Configuration (`/system-config/custom-instructions`) and inspect or tweak active presets from a **Quick-Access Header Drawer** anywhere in the app.
> - **Four Control Pillars**: Unified controls for **Style** (live UI theme presets, surface density, and AI output formatting), **Models** (default model, per-workflow overrides, and reasoning depth), **Specific Knowledge** (business rules, accounting glossary, and uploaded reference files), and **System Prompts** (global directives plus workflow-specific instructions).
> - **Global AI Integration**: Custom instructions are compiled server-side and applied automatically across four live AI workflows: **Executive ERP Assistant**, **Smart Voucher & Journal Drafting**, **Financial Report & Audit Insights**, and **Template Studio Generation**.
> - **Paid-Tier Model Gate**: Selecting `'gemini-4-hydrogen'` or `'gemini-3.1-flash-lite'` works on standard keys, whereas selecting `'gemini-4-neon'`, `'gemini-4-carbon'`, or `'gemini-4-argon'` requires a billing-enabled API key via AI Studio's paid-model authorization flow before execution.

- **SDK Upgrade Gate**: The existing `@google/genai` dependency will be upgraded during implementation (`>= 3.3.0`) to support Gemini 4 model identifiers (`gemini-4-hydrogen`, `gemini-4-neon`, `gemini-4-carbon`, `gemini-4-argon`, `gemini-3.1-flash-lite`) and structured `ThinkingLevel` controls (`LOW`, `MEDIUM`, `HIGH`, `XHIGH`).
- **API Key Handling**: `GEMINI_API_KEY` remains strictly server-side; no API key input fields will be added to the interface.

---

### 1. Overview & Core Concept

- **What It Does**: Adds an authoritative governance layer inside ATCL ERP where administrators define how the web application looks, which Gemini models power AI tasks, what ATCL-specific tax/IFRS/operational knowledge the models must obey, and what system instructions shape every AI output.
- **Target Audience & Persona**: Finance Controllers, Senior Accountants, and ERP Administrators at Advance Technology Consortium Ltd. (ATCL) who want deterministic, audit-safe AI behavior aligned with Bangladesh NBR tax rules, IFRS reporting standards, and ATCL's Chart of Accounts.
- **Key Value**: Eliminates generic AI responses and rigid single-style layouts by turning institutional accounting policies, COA mappings, and UI preferences into persistent, versioned configuration that travels with backups and powers every intelligent workflow in the ERP.

---

### 2. User Experience & Visual Design

#### Key User Flows

1. **Configuring Custom Instructions (System Configuration Tab)**
   - Users open **System Configuration -> Custom Instructions** (or click **Open Full Studio** from the quick header drawer).
   - Four clean, single-elevation sub-panels let users edit:
     - **Style & Appearance**: Live theme preset selector (*ATCL Classic Navy*, *Warm Ivory Ledger*, *Slate Executive Dark*, *High-Contrast Audit*), table row density (*Compact* / *Standard*), monospace/tabular emphasis, and AI response formatting rules (bullet density, BDT currency formatting, IFRS citation style).
     - **Models & Reasoning**: Global default Gemini model selector, per-workflow model overrides, reasoning depth (`ThinkingLevel`), and response length guidance. Paid-tier models display a clear billing-tier indicator and trigger the paid-model prompt if selected.
     - **Specific Knowledge & Files**: Structured **Business Rules** list (e.g., *"Always apply 15% VAT and 5% TDS on local IT equipment purchases"*), **Domain Glossary** key-value pairs (e.g., `BIN` -> *Business Identification Number*), and **Reference File Uploads** (`.txt`, `.md`, `.csv`, `.json`) whose parsed contents are indexed for server-side prompt grounding.
     - **System Prompts & Guardrails**: Global system persona editor, per-workflow prompt overrides, **Active Instruction Preview** showing the exact compiled prompt sent to Gemini, and a **Test Prompt Sandbox** to verify tone and model behavior immediately.

2. **Quick Header Drawer & Global AI Workflows**
   - **Header Controls**: Keeping within the SaaS top-bar contract, the header pairs the breadcrumb trail with a compact **Custom Instructions** quick-drawer trigger and **ERP Assistant** toggle alongside the primary **New Journal Voucher** action.
   - **Quick Header Drawer**: Lets users switch UI theme presets, toggle active knowledge packs, switch the active model profile, or jump to full configuration without leaving their current ledger or voucher screen.
   - **Executive ERP Assistant (Global Slide-Over Panel)**: Streaming multi-turn chat anchored to the user's current route and live ERP metrics (cash position, unposted vouchers, trial balance state), honoring all style, model, knowledge, and prompt settings.
   - **Smart Voucher & Journal Drafting**: Inside the Voucher Composer and Master Journal, users describe a transaction in plain English (e.g., *"Pay Tk 120,000 office rent to Banani Holdings via City Bank with 5% TDS"*) and receive balanced double-entry lines mapped to valid ATCL GL codes.
   - **Financial Report & Audit Insights**: On Trial Balance, Income Statement, Balance Sheet, and Audit Reconciliation pages, an **AI Commentary & Variance Analysis** panel generates IFRS-grounded executive summaries and discrepancy explanations.
   - **Template Studio AI Drafting**: Inside Template Studio, an **AI Generate / Refine Layout** drawer drafts or edits semantic HTML/CSS templates using ATCL's `{{merge_tokens}}` and active brand style.

#### Visual Identity & Theme

- **Aesthetic Direction**: Utilitarian financial precision—crisp 1px hairline borders, single-elevation flat surfaces, zero pill clutter (unboxed metadata separated by `·`), and strict tabular numerals (`IBM Plex Mono` / `tabular-nums`) across every financial figure.
- **Live Theme Architecture**:
  - Uses Tailwind CSS v4 `@custom-variant dark` and semantic CSS custom properties (`--surface-canvas`, `--surface-card`, `--border-subtle`, `--accent-primary`, `--text-primary`) bound to the root `<html>` attributes so switching between light presets and *Slate Executive Dark* updates sidebars, headers, tables, modals, and charts with zero contrast failures or `!important` inversion hacks.
  - **60-30-10 Color Discipline**: 60% neutral canvas, 30% structured surfaces, 10% primary accent (`#1F4E79` ATCL Navy by default, shifting cleanly with selected theme presets).
- **Interactive Feedback**: Theme and density changes apply instantaneously on preview/save (`<= 150ms` transitions); AI generations show structured streaming or skeleton states, clear inline error banners on API failures, and audit-logged save confirmations.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Side Persistence in `LedgerState.config` vs. Browser-Only `localStorage`**
  - *Chosen Approach*: Persist `customInstructions` (including style presets, model routing, rules, glossary, uploaded file extracts, and system prompts) inside the authoritative server JSON database (`SystemConfig.customInstructions`) via `PATCH /api/config` and dedicated knowledge-file endpoints, while mirroring the active theme/density attribute immediately on the client.
  - *Why*: Ensures custom instructions, knowledge rules, and uploaded reference files work seamlessly across browsers, appear automatically in System Configuration JSON backups/restores, and are available directly to server-side Gemini API calls without shipping oversized payloads on every AI request.
  - *Alternatives Considered*: Client `localStorage` only (rejected because server-side AI routes and ERP backups would lose access to knowledge and prompt rules).

- **Decision 2: Deterministic Server-Side Knowledge Compilation vs. Vector Database**
  - *Chosen Approach*: Store structured business rules, glossary terms, and bounded text extracts from uploaded files (`.txt`, `.md`, `.csv`, `.json`) with per-item enable/disable toggles and automatic token-budget summary indicators, compiled server-side into the `systemInstruction` payload.
  - *Why*: Zero external infrastructure dependencies, transparent inspectability in the "Compiled Instruction Preview", and deterministic adherence to accounting policies.
  - *Alternatives Considered*: External embedding store / pgvector (overkill for concise ERP accounting policies and reference schedules, and would require provisioning a separate database).

- **Decision 3: Global Default Model + Per-Workflow Overrides**
  - *Chosen Approach*: Provide a single global model + `ThinkingLevel` selector alongside optional per-workflow overrides (Assistant, Voucher Drafting, Report Commentary, Template Studio) and an explicit capability guard for paid-tier Gemini 4 models.
  - *Why*: Lets controllers run fast, zero-friction tasks on `gemini-4-hydrogen` or `gemini-3.1-flash-lite` while reserving deeper reasoning (`gemini-4-neon` or `gemini-4-carbon`) for complex audit diagnostics or multi-line tax journal drafting.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

#### System Architecture & Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ React SPA Shell (Theme & Density Provider on <html> + Route Context)         │
│                                                                              │
│  ┌──────────────────────┐   ┌───────────────────────────┐   ┌─────────────┐ │
│  │ Header Action Cluster│   │ System Config Hub         │   │ 4 AI        │ │
│  │ • Quick Style/Model  │──▶│ • Custom Instructions Tab │   │ Workflows   │ │
│  │   & Rules Drawer     │   │   (Style/Model/Knowledge/ │   │ • Assistant │ │
│  │ • Assistant Toggle   │   │    Prompts + Live Preview)│   │ • Vouchers  │ │
│  └──────────┬───────────┘   └─────────────┬─────────────┘   │ • Reports   │ │
│             │                             │                 │ • Templates │ │
└─────────────┼─────────────────────────────┼─────────────────┴──────┬────────┘
              │ PATCH /api/config           │ POST /api/ai/knowledge │ POST /api/ai/*
              ▼                             ▼                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Express Server (Authoritative Ledger Store + Gemini Proxy Layer)             │
│                                                                              │
│  ┌──────────────────────────────┐    ┌────────────────────────────────────┐  │
│  │ LedgerState.config           │───▶│ Instruction Compiler & Grounding   │  │
│  │ .customInstructions          │    │ • Global & Workflow System Prompts │  │
│  │  • style (theme, density)    │    │ • Enabled Rules, Glossary & Files  │  │
│  │  • models & thinkingLevel    │    │ • Live ERP Snapshot (COA, Totals)  │  │
│  │  • knowledgeRules & files    │    └──────────────────┬─────────────────┘  │
│  │  • global & workflow prompts │                       │                    │
│  └──────────────────────────────┘                       ▼                    │
│                                      ┌────────────────────────────────────┐  │
│                                      │ @google/genai Client (Server-Only) │  │
│                                      │ • apiKey: process.env.GEMINI_API_KEY│ │
│                                      │ • User-Agent: 'aistudio-build'     │  │
│                                      │ • generateContent / Stream / JSON  │  │
│                                      └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Data Model & State

- **`CustomInstructionsConfig`** (nested inside `SystemConfig.customInstructions`, hydrated safely via `hydrateSystemConfig` for backwards compatibility with existing snapshots):
  - `enabled: boolean` — Master toggle to apply custom instructions globally.
  - `style`:
    - `themePreset: 'atcl-navy' | 'warm-ivory' | 'slate-dark' | 'high-contrast'`
    - `density: 'standard' | 'compact'`
    - `accentHex: string`
    - `aiTone: 'executive-concise' | 'audit-formal' | 'analytical-detailed' | 'plain-english'`
    - `responseFormattingRules: string` (e.g., currency precision, Markdown table preference, citation rules).
  - `models`:
    - `defaultModel: 'gemini-4-hydrogen' | 'gemini-4-neon' | 'gemini-4-carbon' | 'gemini-4-argon' | 'gemini-3.1-flash-lite'`
    - `defaultThinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH'`
    - `workflowOverrides`: optional `{ assistant?, voucherDrafting?, reportInsights?, templateStudio? }` each specifying `{ model, thinkingLevel }`.
    - `includeReasoningSummary: boolean`
  - `knowledge`:
    - `rules: Array<{ id, title, category: 'Accounting' | 'Tax & VAT' | 'Approval' | 'Reporting' | 'General', content, enabled }>`
    - `glossary: Array<{ id, term, definition, enabled }>`
    - `documents: Array<{ id, filename, mimeType, sizeBytes, uploadedAt, extractedText, charCount, enabled }>`
  - `prompts`:
    - `globalSystemPrompt: string`
    - `workflowPrompts: { assistant: string; voucherDrafting: string; reportInsights: string; templateStudio: string }`
    - `prohibitedBehaviors: string` (negative constraints appended to system instructions).

#### Interactive Component & State Mapping

- **Theme & Style Synchronizer**: Reads `state.config.customInstructions.style` at root mount and on config updates; sets `data-theme`, `.dark` class (for `slate-dark`), `data-density`, and CSS variables on `document.documentElement` so styling applies immediately across all routes.
- **Custom Instructions Configuration Tab**: Controlled local draft state initialized from `state.config.customInstructions`, dirty-state tracking, rule/glossary CRUD, drag-and-drop or file-picker reference upload (`.txt`, `.md`, `.csv`, `.json` up to safe size limits), compiled prompt inspector, live **Run Test Prompt** button, and **Save** / **Reset to ATCL Defaults** actions persisted via `PATCH /api/config` + Audit Log entry.
- **Quick Header Drawer**: Slide-over drawer wired to the same `onSaveConfig` handler for one-click theme switching, model profile selection, toggling individual knowledge rules, and testing or launching the full Custom Instructions tab.
- **Server AI Endpoints (`/api/ai/*`)**:
  - `POST /api/ai/assistant` (SSE streaming or structured response with multi-turn history + live route context + compiled custom instructions).
  - `POST /api/ai/draft-voucher` (uses `responseMimeType: 'application/json'` and `responseSchema` to return balanced double-entry debit/credit lines constrained to active `state.accounts` GL codes).
  - `POST /api/ai/report-insights` (analyzes live Trial Balance, P&L, Balance Sheet, or Reconciliation discrepancies using active IFRS/tax rules).
  - `POST /api/ai/generate-template` (returns structured HTML/CSS + metadata using ATCL merge tokens and active style preset).
  - `POST /api/ai/test-instruction` (runs a single prompt in the Custom Instructions sandbox and returns model metadata, compiled prompt size, and response).
  - `POST /api/ai/knowledge/upload` & `DELETE /api/ai/knowledge/:id` (validates file type/size, extracts UTF-8 text safely, persists to `LedgerState`, and logs to `auditLogs`).
- **Error Handling & Resilience**: All `/api/ai/*` routes surface clear HTTP errors (`400`, `403`, `429`, `404`, `500`) without faking model output; the UI renders actionable inline messages (including guidance when a selected paid model requires a billing-enabled key).

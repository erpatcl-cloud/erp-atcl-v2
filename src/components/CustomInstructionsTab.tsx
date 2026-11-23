import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  FileText,
  FileUp,
  Layers,
  Palette,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react';
import { DEFAULT_CUSTOM_INSTRUCTIONS } from '../data/seedData.ts';
import { api, type CompiledInstructionsPreview, type InstructionTestResult } from '../lib/api.ts';
import { THEME_PRESETS, applyCustomStyleToDocument } from '../lib/themeUtils.ts';
import type {
  AiModelId,
  AiResponseTone,
  AiThinkingLevel,
  AiWorkflowKey,
  CustomInstructionsConfig,
  KnowledgeGlossaryItem,
  KnowledgeRuleCategory,
  KnowledgeRuleItem,
} from '../types/accounting.ts';

interface CustomInstructionsTabProps {
  value: CustomInstructionsConfig;
  busyAction: string | null;
  onChange: (next: CustomInstructionsConfig) => void;
  onDocumentMutated: (nextState: import('../types/accounting.ts').LedgerState, message: string) => void;
}

type StudioSection = 'style' | 'models' | 'knowledge' | 'prompts';

const MODEL_OPTIONS: Array<{
  id: AiModelId;
  label: string;
  tier: 'Standard Key' | 'Billing-Enabled Key';
  summary: string;
}> = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    tier: 'Standard Key',
    summary: 'Balanced speed and accuracy for daily ERP chat, drafting, and summaries',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    tier: 'Standard Key',
    summary: 'Ultra-low latency model for quick classifications and lightweight lookups',
  },
  {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon',
    tier: 'Billing-Enabled Key',
    summary: 'Advanced multi-step financial reasoning, tax logic, and template generation',
  },
  {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    tier: 'Billing-Enabled Key',
    summary: 'Deep reasoning for root-cause audit reconciliation and complex IFRS analysis',
  },
  {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon',
    tier: 'Billing-Enabled Key',
    summary: 'High-capacity analytical synthesis across dense ledger schedules',
  },
];

const THINKING_LEVELS: Array<{ id: AiThinkingLevel; label: string; hint: string }> = [
  { id: 'LOW', label: 'Low', hint: 'Fastest response' },
  { id: 'MEDIUM', label: 'Medium', hint: 'Balanced reasoning' },
  { id: 'HIGH', label: 'High', hint: 'Deep verification' },
  { id: 'XHIGH', label: 'Max (XHigh)', hint: 'Hydrogen / Neon only' },
];

const TONE_OPTIONS: Array<{ id: AiResponseTone; label: string; desc: string }> = [
  { id: 'executive-concise', label: 'Executive Concise', desc: 'Lead with bottom-line BDT figures and crisp action items' },
  { id: 'audit-formal', label: 'Audit & IFRS Formal', desc: 'Statutory phrasing with explicit GL code & standard citations' },
  { id: 'analytical-detailed', label: 'Analytical Detailed', desc: 'Step-by-step variance breakdowns and comparative ratios' },
  { id: 'plain-english', label: 'Plain Business English', desc: 'Clear operational explanations without heavy CPA jargon' },
];

const WORKFLOW_META: Array<{ key: AiWorkflowKey; label: string; description: string }> = [
  {
    key: 'assistant',
    label: 'Executive ERP Assistant',
    description: 'Global slide-over chat grounded in live ledger and route context',
  },
  {
    key: 'voucherDrafting',
    label: 'Smart Voucher & Journal Drafting',
    description: 'Natural-language to balanced double-entry GL line generation',
  },
  {
    key: 'reportInsights',
    label: 'Financial Report & Audit Insights',
    description: 'Executive commentary across Trial Balance, P&L, Balance Sheet, and Audit',
  },
  {
    key: 'templateStudio',
    label: 'Template Studio Generation',
    description: 'Semantic HTML/CSS and ATCL merge-token document drafting',
  },
];

const RULE_CATEGORIES: KnowledgeRuleCategory[] = [
  'Accounting',
  'Tax & VAT',
  'Approval',
  'Reporting',
  'General',
];

const ACCENT_SWATCHES = ['#2563EB', '#0F766E', '#1E4631', '#3730A3', '#0F172A', '#B45309'];

export const CustomInstructionsTab: React.FC<CustomInstructionsTabProps> = ({
  value,
  busyAction,
  onChange,
  onDocumentMutated,
}) => {
  const [section, setSection] = useState<StudioSection>('style');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Rule composer state
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleCat, setNewRuleCat] = useState<KnowledgeRuleCategory>('Accounting');
  const [newRuleContent, setNewRuleContent] = useState('');

  // Glossary composer state
  const [newTerm, setNewTerm] = useState('');
  const [newDef, setNewDef] = useState('');

  // Knowledge file upload state
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [inspectDocId, setInspectDocId] = useState<string | null>(null);

  // Compiled preview & sandbox test state
  const [sandboxWorkflow, setSandboxWorkflow] = useState<AiWorkflowKey>('assistant');
  const [previewData, setPreviewData] = useState<CompiledInstructionsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showCompiledPrompt, setShowCompiledPrompt] = useState(false);
  const [sandboxPrompt, setSandboxPrompt] = useState(
    'Summarize our current FY 2024-25 liquidity and flag any voucher approval or VAT compliance rules I should follow today.'
  );
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<InstructionTestResult | null>(null);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const activeRuleCount = useMemo(
    () => value.knowledge.rules.filter((r) => r.enabled).length,
    [value.knowledge.rules]
  );
  const activeGlossaryCount = useMemo(
    () => value.knowledge.glossary.filter((g) => g.enabled).length,
    [value.knowledge.glossary]
  );
  const activeDocCount = useMemo(
    () => value.knowledge.documents.filter((d) => d.enabled).length,
    [value.knowledge.documents]
  );

  const updateStyle = (patch: Partial<CustomInstructionsConfig['style']>) => {
    const nextStyle = { ...value.style, ...patch };
    applyCustomStyleToDocument(nextStyle);
    onChange({
      ...value,
      style: nextStyle,
    });
  };

  const handleAddRule = () => {
    if (!newRuleTitle.trim() || !newRuleContent.trim()) return;
    const item: KnowledgeRuleItem = {
      id: `RULE-${Date.now().toString(36).toUpperCase()}`,
      title: newRuleTitle.trim(),
      category: newRuleCat,
      content: newRuleContent.trim(),
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        rules: [item, ...value.knowledge.rules],
      },
    });
    setNewRuleTitle('');
    setNewRuleContent('');
  };

  const handleToggleRule = (id: string) => {
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        rules: value.knowledge.rules.map((r) =>
          r.id === id ? { ...r, enabled: !r.enabled } : r
        ),
      },
    });
  };

  const handleDeleteRule = (id: string) => {
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        rules: value.knowledge.rules.filter((r) => r.id !== id),
      },
    });
  };

  const handleAddGlossary = () => {
    if (!newTerm.trim() || !newDef.trim()) return;
    const item: KnowledgeGlossaryItem = {
      id: `GLOS-${Date.now().toString(36).toUpperCase()}`,
      term: newTerm.trim(),
      definition: newDef.trim(),
      enabled: true,
    };
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        glossary: [item, ...value.knowledge.glossary],
      },
    });
    setNewTerm('');
    setNewDef('');
  };

  const handleToggleGlossary = (id: string) => {
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        glossary: value.knowledge.glossary.map((g) =>
          g.id === id ? { ...g, enabled: !g.enabled } : g
        ),
      },
    });
  };

  const handleDeleteGlossary = (id: string) => {
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        glossary: value.knowledge.glossary.filter((g) => g.id !== id),
      },
    });
  };

  const handleUploadKnowledgeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDocError(null);
    setUploadingDoc(true);
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const res = isPdf
        ? await api.uploadKnowledgeDocument({
            filename: file.name,
            mimeType: file.type || 'application/pdf',
            base64Data: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(new Error('Unable to read PDF file.'));
              reader.readAsDataURL(file);
            }),
          })
        : await api.uploadKnowledgeDocument({
            filename: file.name,
            mimeType: file.type || 'text/plain',
            textContent: await file.text(),
          });
      onChange({
        ...value,
        knowledge: {
          ...value.knowledge,
          documents: res.state.config.customInstructions?.knowledge.documents || value.knowledge.documents,
        },
      });
      if (res.vectorWarning) {
        setDocError(`Uploaded ${res.document.filename}, but vectorization reported: ${res.vectorWarning}`);
      }
      onDocumentMutated(res.state, `Uploaded reference file ${res.document.filename}.`);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Unable to upload file.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleToggleDocument = (id: string) => {
    onChange({
      ...value,
      knowledge: {
        ...value.knowledge,
        documents: value.knowledge.documents.map((d) =>
          d.id === id ? { ...d, enabled: !d.enabled } : d
        ),
      },
    });
  };

  const handleDeleteDocument = async (id: string, filename: string) => {
    setDocError(null);
    try {
      const res = await api.deleteKnowledgeDocument(id);
      onChange({
        ...value,
        knowledge: {
          ...value.knowledge,
          documents: res.state.config.customInstructions?.knowledge.documents || [],
        },
      });
      onDocumentMutated(res.state, `Removed reference file ${filename}.`);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to delete document.');
    }
  };

  const handleLoadCompiledPreview = async (wf: AiWorkflowKey) => {
    setPreviewLoading(true);
    try {
      const data = await api.previewAiInstructions(wf, value);
      setPreviewData(data);
      setShowCompiledPrompt(true);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : 'Unable to compile prompt preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRunSandboxTest = async () => {
    if (!sandboxPrompt.trim()) return;
    setSandboxRunning(true);
    setSandboxError(null);
    try {
      const res = await api.testAiInstruction(sandboxPrompt.trim(), sandboxWorkflow, value);
      setSandboxResult(res);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : 'Sandbox test failed.');
    } finally {
      setSandboxRunning(false);
    }
  };

  const handleResetDefaults = () => {
    const resetCopy: CustomInstructionsConfig = {
      ...structuredClone(DEFAULT_CUSTOM_INSTRUCTIONS),
      knowledge: {
        ...structuredClone(DEFAULT_CUSTOM_INSTRUCTIONS.knowledge),
        documents: value.knowledge.documents,
      },
    };
    applyCustomStyleToDocument(resetCopy.style);
    onChange(resetCopy);
  };

  const selectedModelMeta = MODEL_OPTIONS.find((m) => m.id === value.models.defaultModel);

  return (
    <div className="space-y-6">
      {/* Governance Master Header Bar */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="w-4 h-4 text-[#2563EB] dark:text-blue-400 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Global Custom Instructions & AI Governance
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span>{value.enabled ? 'Active across all workflows' : 'Bypassed (using baseline defaults)'}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">{selectedModelMeta?.label || value.models.defaultModel}</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{activeRuleCount} rules</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{activeGlossaryCount} terms</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{activeDocCount} files</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
                className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
              />
              <span>Apply Custom Instructions Globally</span>
            </label>

            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore ATCL Defaults</span>
            </button>
          </div>
        </div>

        {/* Sub-navigation Segmented Bar */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
          {[
            { id: 'style' as const, label: '01. Style & Appearance', icon: Palette },
            { id: 'models' as const, label: '02. Models & Reasoning', icon: Cpu },
            { id: 'knowledge' as const, label: '03. Knowledge & Reference Files', icon: BookOpen },
            { id: 'prompts' as const, label: '04. System Prompts & Sandbox', icon: Terminal },
          ].map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* SECTION 1: STYLE & APPEARANCE */}
      {section === 'style' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Web Application Theme & Layout Density
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Changes preview immediately across every ERP ledger view; save configuration to persist server-wide
              </p>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {THEME_PRESETS.map((preset) => {
                  const selected = value.style.themePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        updateStyle({
                          themePreset: preset.id,
                          accentHex: preset.defaultAccent,
                        })
                      }
                      className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#2563EB] ring-2 ring-[#2563EB]/20 bg-slate-50/70 dark:bg-slate-800'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {preset.label}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-slate-300"
                            style={{ backgroundColor: preset.canvasPreview }}
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-slate-300"
                            style={{ backgroundColor: preset.surfacePreview }}
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-sm"
                            style={{ backgroundColor: preset.defaultAccent }}
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Table & Ledger Row Density
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                    {(['standard', 'compact'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateStyle({ density: mode })}
                        className={`py-1.5 px-3 text-xs font-medium rounded transition-colors capitalize cursor-pointer ${
                          value.style.density === mode
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Primary Brand Accent
                  </label>
                  <div className="flex items-center gap-2">
                    {ACCENT_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => updateStyle({ accentHex: hex })}
                        aria-label={`Select accent ${hex}`}
                        className={`w-7 h-7 rounded-md border cursor-pointer flex items-center justify-center ${
                          value.style.accentHex.toLowerCase() === hex.toLowerCase()
                            ? 'ring-2 ring-offset-2 ring-slate-500 border-white'
                            : 'border-slate-300'
                        }`}
                        style={{ backgroundColor: hex }}
                      >
                        {value.style.accentHex.toLowerCase() === hex.toLowerCase() && (
                          <Check className="w-3.5 h-3.5 text-white" />
                        )}
                      </button>
                    ))}
                    <input
                      type="text"
                      value={value.style.accentHex}
                      onChange={(e) => updateStyle({ accentHex: e.target.value })}
                      className="w-24 px-2.5 py-1.5 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.style.tabularEmphasis}
                  onChange={(e) => updateStyle({ tabularEmphasis: e.target.checked })}
                  className="mt-0.5 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                />
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    Strict Tabular Numerals Across All Ledgers & Tables
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Enforces fixed-width numeric alignment in Trial Balance, Register Books, and financial schedules.
                  </div>
                </div>
              </label>
            </div>
          </section>

          <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                AI Response Tone & Formatting Rules
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Applied to Assistant commentary, report narratives, and template copy
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Response Voice & Register
                </label>
                {TONE_OPTIONS.map((tone) => (
                  <label
                    key={tone.id}
                    className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${
                      value.style.aiTone === tone.id
                        ? 'border-[#2563EB] bg-slate-50 dark:bg-slate-800'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="aiTone"
                      checked={value.style.aiTone === tone.id}
                      onChange={() => updateStyle({ aiTone: tone.id })}
                      className="mt-0.5 text-[#2563EB]"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {tone.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tone.desc}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Formatting & Presentation Directives
                </label>
                <textarea
                  rows={5}
                  value={value.style.responseFormattingRules}
                  onChange={(e) => updateStyle({ responseFormattingRules: e.target.value })}
                  placeholder="Specify currency symbols, decimal precision, GL code formatting, or table preferences..."
                  className="w-full px-3 py-2 text-xs leading-relaxed border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* SECTION 2: MODELS & REASONING */}
      {section === 'models' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Global Default Gemini Model & Reasoning Budget
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Standard-key models work immediately; billing-tier models require a billing-enabled API key in Settings &gt; Secrets
              </p>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {MODEL_OPTIONS.map((m) => {
                  const selected = value.models.defaultModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          models: { ...value.models, defaultModel: m.id },
                        })
                      }
                      className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#2563EB] ring-2 ring-[#2563EB]/20 bg-slate-50/80 dark:bg-slate-800'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {m.label}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {m.tier}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#2563EB] dark:text-blue-400 mt-0.5">
                        {m.id}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                        {m.summary}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Default Thinking Level
                  </label>
                  <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                    {THINKING_LEVELS.map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() =>
                          onChange({
                            ...value,
                            models: { ...value.models, defaultThinkingLevel: lvl.id },
                          })
                        }
                        title={lvl.hint}
                        className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                          value.models.defaultThinkingLevel === lvl.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                        }`}
                      >
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Higher levels allocate deeper multi-step accounting verification before answering.
                  </p>
                </div>

                <div className="flex items-center">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value.models.includeReasoningSummary}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          models: { ...value.models, includeReasoningSummary: e.target.checked },
                        })
                      }
                      className="mt-0.5 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Include Basis & Assumptions Note in Responses
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Instructs the model to cite which GL figures, tax rates, or custom rules drove its answer.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Per-Workflow Overrides */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Per-Workflow Model Overrides
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Route specific ERP workflows to faster or deeper Gemini models independently of the global default
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 font-semibold">Workflow</th>
                    <th className="py-2.5 px-4 font-semibold">Override Mode</th>
                    <th className="py-2.5 px-4 font-semibold">Assigned Model</th>
                    <th className="py-2.5 px-4 font-semibold">Thinking Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {WORKFLOW_META.map((wf) => {
                    const ov = value.models.workflowOverrides[wf.key];
                    return (
                      <tr key={wf.key}>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {wf.label}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {wf.description}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <label className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ov.enabled}
                              onChange={(e) =>
                                onChange({
                                  ...value,
                                  models: {
                                    ...value.models,
                                    workflowOverrides: {
                                      ...value.models.workflowOverrides,
                                      [wf.key]: { ...ov, enabled: e.target.checked },
                                    },
                                  },
                                })
                              }
                              className="rounded border-slate-300 text-[#2563EB]"
                            />
                            <span className="text-slate-700 dark:text-slate-300">
                              {ov.enabled ? 'Custom' : 'Use Default'}
                            </span>
                          </label>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            disabled={!ov.enabled}
                            value={ov.model}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                models: {
                                  ...value.models,
                                  workflowOverrides: {
                                    ...value.models.workflowOverrides,
                                    [wf.key]: { ...ov, model: e.target.value as AiModelId },
                                  },
                                },
                              })
                            }
                            className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-50"
                          >
                            {MODEL_OPTIONS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label} ({m.tier})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            disabled={!ov.enabled}
                            value={ov.thinkingLevel}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                models: {
                                  ...value.models,
                                  workflowOverrides: {
                                    ...value.models.workflowOverrides,
                                    [wf.key]: {
                                      ...ov,
                                      thinkingLevel: e.target.value as AiThinkingLevel,
                                    },
                                  },
                                },
                              })
                            }
                            className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-50"
                          >
                            {THINKING_LEVELS.map((lvl) => (
                              <option key={lvl.id} value={lvl.id}>
                                {lvl.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* SECTION 3: SPECIFIC KNOWLEDGE & REFERENCE FILES */}
      {section === 'knowledge' && (
        <div className="space-y-6">
          {/* Business Rules */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Organization Accounting, Tax & Approval Rules
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Persistent policy directives injected into every AI prompt ({activeRuleCount} of {value.knowledge.rules.length} active)
                </p>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Add New Rule Row */}
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <input
                      type="text"
                      value={newRuleTitle}
                      onChange={(e) => setNewRuleTitle(e.target.value)}
                      placeholder="Rule title (e.g., LC Margin Settlement Policy)"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  </div>
                  <div>
                    <select
                      value={newRuleCat}
                      onChange={(e) => setNewRuleCat(e.target.value as KnowledgeRuleCategory)}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 dark:border-slate-700 rounded-md"
                    >
                      {RULE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <textarea
                    rows={2}
                    value={newRuleContent}
                    onChange={(e) => setNewRuleContent(e.target.value)}
                    placeholder="Exact instruction or accounting rule the AI must follow..."
                    className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={handleAddRule}
                    disabled={!newRuleTitle.trim() || !newRuleContent.trim()}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer self-start"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Rule</span>
                  </button>
                </div>
              </div>

              {/* Rules List */}
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                {value.knowledge.rules.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No custom business rules defined yet. Add your first statutory or operational policy above.
                  </div>
                ) : (
                  value.knowledge.rules.map((rule) => (
                    <div key={rule.id} className="p-4 flex items-start justify-between gap-4">
                      <label className="flex items-start gap-3 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => handleToggleRule(rule.id)}
                          className="mt-1 rounded border-slate-300 text-[#2563EB]"
                        />
                        <div className={rule.enabled ? '' : 'opacity-50'}>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {rule.title}
                            </span>
                            <span className="text-slate-400" aria-hidden="true">·</span>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {rule.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                            {rule.content}
                          </p>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded cursor-pointer shrink-0"
                        aria-label={`Delete rule ${rule.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Glossary + Uploaded Reference Documents */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Domain Glossary */}
            <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  ATCL Domain Glossary
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Acronyms, cost centers, and local banking terms ({activeGlossaryCount} active)
                </p>
              </div>
              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    placeholder="Term or Acronym (e.g., Mushak-6.3)"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newDef}
                      onChange={(e) => setNewDef(e.target.value)}
                      placeholder="Authoritative definition..."
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleAddGlossary}
                      disabled={!newTerm.trim() || !newDef.trim()}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md max-h-80 overflow-y-auto ledger-scroll">
                  {value.knowledge.glossary.map((g) => (
                    <div key={g.id} className="p-3 flex items-start justify-between gap-2">
                      <label className="flex items-start gap-2.5 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={g.enabled}
                          onChange={() => handleToggleGlossary(g.id)}
                          className="mt-0.5 rounded border-slate-300 text-[#2563EB]"
                        />
                        <div className={g.enabled ? '' : 'opacity-50'}>
                          <div className="text-xs font-semibold font-mono text-slate-900 dark:text-slate-100">
                            {g.term}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                            {g.definition}
                          </div>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleDeleteGlossary(g.id)}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                        aria-label={`Remove ${g.term}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Uploaded Reference Files */}
            <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Uploaded Reference Knowledge Files
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Vectorized policy manuals, vendor schedules, or COA notes (.pdf, .csv, .md, .txt, .json) synced with Document Store
                  </p>
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.md,.markdown,.txt,.json,.tsv"
                    onChange={handleUploadKnowledgeFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingDoc}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>{uploadingDoc ? 'Uploading...' : 'Upload Reference File'}</span>
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {docError && (
                  <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{docError}</span>
                  </div>
                )}

                {value.knowledge.documents.length === 0 ? (
                  <div className="p-8 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-center space-y-2">
                    <FileText className="w-6 h-6 text-slate-400 mx-auto" />
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      No reference documents uploaded yet
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                      Upload ATCL tax schedules, NBR circulars, supplier payment policies, or custom CSV mappings to ground every AI assistant and voucher draft.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                    {value.knowledge.documents.map((doc) => {
                      const inspecting = inspectDocId === doc.id;
                      return (
                        <div key={doc.id} className="p-3.5 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={doc.enabled}
                                onChange={() => handleToggleDocument(doc.id)}
                                className="rounded border-slate-300 text-[#2563EB]"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold font-mono text-slate-900 dark:text-slate-100 truncate">
                                  {doc.filename}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                  <span>{doc.fileType}</span>
                                  <span aria-hidden="true"> · </span>
                                  <span>{(doc.sizeBytes / 1024).toFixed(1)} KB</span>
                                  <span aria-hidden="true"> · </span>
                                  <span>
                                    {doc.vectorStatus === 'vectorized'
                                      ? `${doc.chunkCount} chunks (${doc.scope})`
                                      : doc.vectorStatus === 'error'
                                        ? 'Index error'
                                        : 'Pending index'}
                                  </span>
                                </div>
                              </div>
                            </label>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setInspectDocId(inspecting ? null : doc.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>{inspecting ? 'Hide' : 'Inspect'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                                className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                                aria-label={`Delete ${doc.filename}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {inspecting && (
                            <pre className="p-3 rounded bg-slate-900 text-slate-200 text-[11px] font-mono max-h-44 overflow-auto ledger-scroll whitespace-pre-wrap">
                              {doc.extractedText}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* SECTION 4: SYSTEM PROMPTS & SANDBOX */}
      {section === 'prompts' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Global System Prompt & Guardrails
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Core persona, statutory context, and strict negative boundaries enforced on every request
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Global System Persona & Context
                  </label>
                  <textarea
                    rows={4}
                    value={value.prompts.globalSystemPrompt}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        prompts: { ...value.prompts, globalSystemPrompt: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-xs leading-relaxed border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Prohibited Behaviors & Audit Guardrails
                  </label>
                  <textarea
                    rows={3}
                    value={value.prompts.prohibitedBehaviors}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        prompts: { ...value.prompts, prohibitedBehaviors: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-xs leading-relaxed border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Per-Workflow System Prompt Directives
                  </div>
                  {WORKFLOW_META.map((wf) => (
                    <div key={wf.key}>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        {wf.label}
                      </label>
                      <textarea
                        rows={2}
                        value={value.prompts.workflowPrompts[wf.key]}
                        onChange={(e) =>
                          onChange({
                            ...value,
                            prompts: {
                              ...value.prompts,
                              workflowPrompts: {
                                ...value.prompts.workflowPrompts,
                                [wf.key]: e.target.value,
                              },
                            },
                          })
                        }
                        className="w-full px-3 py-1.5 text-xs leading-relaxed border border-slate-300 dark:border-slate-700 rounded-md"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Right Column: Live Compiled Preview & Sandbox */}
            <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Instruction Compiler & Test Sandbox
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Verify how active rules, style, and model settings behave live
                  </p>
                </div>
              </div>

              <div className="p-5 space-y-4 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Target Workflow
                    </label>
                    <select
                      value={sandboxWorkflow}
                      onChange={(e) => setSandboxWorkflow(e.target.value as AiWorkflowKey)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
                    >
                      {WORKFLOW_META.map((wf) => (
                        <option key={wf.key} value={wf.key}>
                          {wf.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleLoadCompiledPreview(sandboxWorkflow)}
                    disabled={previewLoading}
                    className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{previewLoading ? 'Compiling...' : 'Inspect Prompt'}</span>
                  </button>
                </div>

                {showCompiledPrompt && previewData && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>
                        {previewData.model} · {previewData.thinkingLevel}
                      </span>
                      <span>
                        {previewData.compiledChars.toLocaleString()} chars (~{previewData.estimatedTokens.toLocaleString()} tokens)
                      </span>
                    </div>
                    <pre className="p-3 rounded-md bg-slate-900 text-slate-200 text-[11px] font-mono max-h-48 overflow-auto ledger-scroll whitespace-pre-wrap">
                      {previewData.systemInstruction}
                    </pre>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Test Prompt
                  </label>
                  <textarea
                    rows={3}
                    value={sandboxPrompt}
                    onChange={(e) => setSandboxPrompt(e.target.value)}
                    placeholder="Enter a test accounting question or prompt..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={handleRunSandboxTest}
                    disabled={sandboxRunning || !sandboxPrompt.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{sandboxRunning ? 'Running Against Gemini...' : 'Run Test With Draft Instructions'}</span>
                  </button>
                </div>

                {sandboxError && (
                  <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                    {sandboxError}
                  </div>
                )}

                {sandboxResult && (
                  <div className="p-3.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-sans font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{sandboxResult.model}</span>
                      </span>
                      <span>
                        {sandboxResult.thinkingLevel} · {sandboxResult.activeRulesCount} rules · {sandboxResult.activeDocumentsCount} files
                      </span>
                    </div>
                    <div className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto ledger-scroll">
                      {sandboxResult.text}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

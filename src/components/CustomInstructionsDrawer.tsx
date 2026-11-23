import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Cpu,
  Palette,
  Save,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { hydrateCustomInstructions } from '../data/seedData.ts';
import { THEME_PRESETS, applyCustomStyleToDocument } from '../lib/themeUtils.ts';
import type {
  AiModelId,
  AiResponseTone,
  CustomInstructionsConfig,
  SystemConfig,
} from '../types/accounting.ts';

interface CustomInstructionsDrawerProps {
  open: boolean;
  config: SystemConfig;
  busyAction: string | null;
  onClose: () => void;
  onSaveConfig: (payload: Partial<SystemConfig>) => Promise<void>;
  onOpenFullStudio: () => void;
}

const QUICK_MODELS: Array<{ id: AiModelId; label: string; tier: string }> = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', tier: 'Standard' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', tier: 'Fast' },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon', tier: 'Billing Key' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', tier: 'Billing Key' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', tier: 'Billing Key' },
];

const QUICK_TONES: Array<{ id: AiResponseTone; label: string }> = [
  { id: 'executive-concise', label: 'Executive Concise' },
  { id: 'audit-formal', label: 'Audit & IFRS Formal' },
  { id: 'analytical-detailed', label: 'Analytical Detailed' },
  { id: 'plain-english', label: 'Plain English' },
];

export const CustomInstructionsDrawer: React.FC<CustomInstructionsDrawerProps> = ({
  open,
  config,
  busyAction,
  onClose,
  onSaveConfig,
  onOpenFullStudio,
}) => {
  const persisted = hydrateCustomInstructions(config.customInstructions);
  const [draft, setDraft] = useState<CustomInstructionsConfig>(persisted);

  useEffect(() => {
    if (open) {
      setDraft(hydrateCustomInstructions(config.customInstructions));
    }
  }, [open, config.customInstructions]);

  if (!open) return null;

  const isDirty = JSON.stringify(draft) !== JSON.stringify(persisted);

  const handleStyleUpdate = (patch: Partial<CustomInstructionsConfig['style']>) => {
    const nextStyle = { ...draft.style, ...patch };
    applyCustomStyleToDocument(nextStyle);
    setDraft((prev) => ({ ...prev, style: nextStyle }));
  };

  const handleApplyAndSave = async () => {
    await onSaveConfig({ customInstructions: draft });
  };

  const handleClose = () => {
    // Revert any unsaved live theme preview when closing without saving
    if (isDirty) {
      applyCustomStyleToDocument(persisted.style);
    }
    onClose();
  };

  const activeRules = draft.knowledge.rules.filter((r) => r.enabled).length;
  const activeDocs = draft.knowledge.documents.filter((d) => d.enabled).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/40" onClick={handleClose} />
      <aside className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#2563EB] dark:text-blue-400 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                Custom Instructions Control
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              <span>{draft.enabled ? 'Global Active' : 'Disabled'}</span>
              <span aria-hidden="true"> · </span>
              <span>{activeRules} rules</span>
              <span aria-hidden="true"> · </span>
              <span>{activeDocs} files</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close Custom Instructions Drawer"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto ledger-scroll p-5 space-y-6">
          {/* Global Toggle */}
          <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Enable Custom Instructions Globally
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Applies style, models, knowledge & prompts to all AI workflows
              </div>
            </div>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
            />
          </label>

          {/* Quick Theme & Density */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Palette className="w-3.5 h-3.5 text-[#2563EB] dark:text-blue-400" />
              <span>App Theme & Density</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {THEME_PRESETS.map((preset) => {
                const active = draft.style.themePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      handleStyleUpdate({
                        themePreset: preset.id,
                        accentHex: preset.defaultAccent,
                      })
                    }
                    className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[#2563EB] bg-slate-50 dark:bg-slate-800'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {preset.label}
                      </span>
                      {active && <Check className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {(['standard', 'compact'] as const).map((density) => (
                <button
                  key={density}
                  type="button"
                  onClick={() => handleStyleUpdate({ density })}
                  className={`py-1.5 px-3 text-xs font-medium rounded-md border capitalize cursor-pointer ${
                    draft.style.density === density
                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {density} Density
                </button>
              ))}
            </div>
          </div>

          {/* Model & Tone */}
          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Cpu className="w-3.5 h-3.5 text-[#2563EB] dark:text-blue-400" />
              <span>Default Model & AI Response Tone</span>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Default Gemini Model
              </label>
              <select
                value={draft.models.defaultModel}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    models: { ...draft.models, defaultModel: e.target.value as AiModelId },
                  })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800"
              >
                {QUICK_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.tier}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                AI Tone & Formatting Style
              </label>
              <select
                value={draft.style.aiTone}
                onChange={(e) => handleStyleUpdate({ aiTone: e.target.value as AiResponseTone })}
                className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800"
              >
                {QUICK_TONES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Toggle Knowledge Rules & Files */}
          <div className="space-y-2.5 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Active Knowledge Rules & Documents
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
              {draft.knowledge.rules.map((rule) => (
                <label
                  key={rule.id}
                  className="flex items-start gap-2.5 p-2.5 text-xs cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        knowledge: {
                          ...draft.knowledge,
                          rules: draft.knowledge.rules.map((r) =>
                            r.id === rule.id ? { ...r, enabled: !r.enabled } : r
                          ),
                        },
                      })
                    }
                    className="mt-0.5 rounded border-slate-300 text-[#2563EB]"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {rule.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {rule.category}
                    </div>
                  </div>
                </label>
              ))}
              {draft.knowledge.documents.map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-start gap-2.5 p-2.5 text-xs cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <input
                    type="checkbox"
                    checked={doc.enabled}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        knowledge: {
                          ...draft.knowledge,
                          documents: draft.knowledge.documents.map((d) =>
                            d.id === doc.id ? { ...d, enabled: !d.enabled } : d
                          ),
                        },
                      })
                    }
                    className="mt-0.5 rounded border-slate-300 text-[#2563EB]"
                  />
                  <div className="min-w-0">
                    <div className="font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
                      {doc.filename}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {doc.fileType} · {doc.chunkCount > 0 ? `${doc.chunkCount} chunks` : `${doc.charCount.toLocaleString()} chars`} · {doc.scope}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Quick System Prompt Preview */}
          <div className="space-y-1.5 pt-4 border-t border-slate-200 dark:border-slate-800">
            <label className="block text-xs font-semibold text-slate-900 dark:text-slate-100">
              Global System Prompt
            </label>
            <textarea
              rows={3}
              value={draft.prompts.globalSystemPrompt}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  prompts: { ...draft.prompts, globalSystemPrompt: e.target.value },
                })
              }
              className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              handleClose();
              onOpenFullStudio();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:underline whitespace-nowrap cursor-pointer"
          >
            <span>Open Full Studio</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!isDirty || busyAction !== null}
              onClick={handleApplyAndSave}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{busyAction === 'save-config' ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

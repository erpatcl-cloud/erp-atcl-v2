import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  FileCode,
  FileText,
  Layers,
  Monitor,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  MERGE_TOKEN_REFERENCE,
  buildStandaloneHtmlDocument,
  buildTemplateTokenContext,
  interpolateTemplateText,
  sanitizeImportedHtml,
} from '../engine/templateEngine.ts';
import { api } from '../lib/api.ts';
import type {
  DocumentTemplateRecord,
  LedgerState,
  TemplateCategory,
  TemplateDataSource,
  TemplatePaperSize,
} from '../types/accounting.ts';

interface TemplateStudioPageProps {
  state: LedgerState;
  busyAction: string | null;
  onCreateTemplate: (
    payload: Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>
  ) => Promise<DocumentTemplateRecord | null>;
  onUpdateTemplate: (
    id: string,
    payload: Partial<Omit<DocumentTemplateRecord, 'id' | 'updatedAt'>>
  ) => Promise<DocumentTemplateRecord | null>;
  onDuplicateTemplate: (id: string) => Promise<DocumentTemplateRecord | null>;
  onDeleteTemplate: (id: string) => Promise<void>;
}

type CanvasMode = 'desktop' | 'a4' | 'edit';
type ImportTab = 'html' | 'builder' | 'clone';

const CATEGORIES: Array<'All' | TemplateCategory> = [
  'All',
  'Voucher',
  'Financial Report',
  'Commercial & LC',
  'Custom Page',
];

const ACCENT_PRESETS = [
  { label: 'ATCL Navy', value: '#2563EB' },
  { label: 'Deep Teal', value: '#0F766E' },
  { label: 'Slate Charcoal', value: '#334155' },
  { label: 'Indigo Slate', value: '#3730A3' },
];

export const TemplateStudioPage: React.FC<TemplateStudioPageProps> = ({
  state,
  busyAction,
  onCreateTemplate,
  onUpdateTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
}) => {
  const templates = state.templates || [];
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'All' | TemplateCategory>('All');
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('desktop');
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [draft, setDraft] = useState<DocumentTemplateRecord | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Slide-over Import / Clone Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importTab, setImportTab] = useState<ImportTab>('html');
  const [importName, setImportName] = useState('');
  const [importCode, setImportCode] = useState('');
  const [importCategory, setImportCategory] = useState<TemplateCategory>('Custom Page');
  const [importDataSource, setImportDataSource] = useState<TemplateDataSource>('financialSummary');
  const [importPaperSize, setImportPaperSize] = useState<TemplatePaperSize>('Responsive');
  const [importAccent, setImportAccent] = useState('#2563EB');
  const [importHtml, setImportHtml] = useState('');
  const [importCss, setImportCss] = useState('');
  const [importDescription, setImportDescription] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string>(templates[0]?.id || '');

  // AI Template Generator Modal state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMode, setAiMode] = useState<'new' | 'refine'>('new');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const htmlEditorRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) || templates[0] || null,
    [templates, selectedId]
  );

  // Sync working draft whenever the active template selection changes
  useEffect(() => {
    if (selectedTemplate) {
      setSelectedId(selectedTemplate.id);
      setDraft(structuredClone(selectedTemplate));
      setIsDirty(false);
      setConfirmDeleteId(null);
    } else {
      setDraft(null);
      setIsDirty(false);
    }
  }, [selectedTemplate?.id, selectedTemplate?.updatedAt]);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter((t) => {
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.sourceOrigin || '').toLowerCase().includes(q)
      );
    });
  }, [templates, searchQuery, categoryFilter]);

  const activeTemplate = draft || selectedTemplate;

  const resolvedCtx = useMemo(() => {
    if (!activeTemplate) return null;
    return buildTemplateTokenContext(state, activeTemplate.dataSource, selectedRecordId || undefined);
  }, [state, activeTemplate?.dataSource, selectedRecordId]);

  const iframeSrcDoc = useMemo(() => {
    if (!activeTemplate || activeTemplate.mode !== 'html') return '';
    return buildStandaloneHtmlDocument(activeTemplate, state, selectedRecordId || undefined);
  }, [activeTemplate, state, selectedRecordId]);

  const updateDraft = (updater: (prev: DocumentTemplateRecord) => DocumentTemplateRecord) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setIsDirty(true);
      return updater(prev);
    });
  };

  const handleSaveChanges = async () => {
    if (!draft) return;
    const saved = await onUpdateTemplate(draft.id, {
      name: draft.name,
      code: draft.code,
      description: draft.description,
      category: draft.category,
      mode: draft.mode,
      dataSource: draft.dataSource,
      paperSize: draft.paperSize,
      accentColor: draft.accentColor,
      status: draft.status,
      isDefault: draft.isDefault,
      sourceOrigin: draft.sourceOrigin,
      sections: draft.sections,
      htmlContent: draft.htmlContent,
      cssContent: draft.cssContent,
    });
    if (saved) {
      setIsDirty(false);
    }
  };

  const handleDiscardChanges = () => {
    if (selectedTemplate) {
      setDraft(structuredClone(selectedTemplate));
      setIsDirty(false);
    }
  };

  const handleExportHtml = () => {
    if (!activeTemplate) return;
    const html = buildStandaloneHtmlDocument(activeTemplate, state, selectedRecordId || undefined);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTemplate.code.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintSheet = () => {
    if (!activeTemplate) return;
    const html = buildStandaloneHtmlDocument(activeTemplate, state, selectedRecordId || undefined);
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);
    const doc = printFrame.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(printFrame);
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 500);
    }, 150);
  };

  const handleTokenClick = (token: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(token).catch(() => undefined);
    }
    if (draft && draft.mode === 'html' && canvasMode === 'edit' && htmlEditorRef.current) {
      const el = htmlEditorRef.current;
      const start = el.selectionStart ?? draft.htmlContent.length;
      const end = el.selectionEnd ?? draft.htmlContent.length;
      const nextHtml = draft.htmlContent.slice(0, start) + token + draft.htmlContent.slice(end);
      updateDraft((prev) => ({ ...prev, htmlContent: nextHtml }));
    }
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((curr) => (curr === token ? null : curr)), 1600);
  };

  const openImportDrawer = (tab: ImportTab = 'html') => {
    setImportTab(tab);
    setImportName('');
    setImportCode('');
    setImportCategory(tab === 'html' ? 'Custom Page' : 'Voucher');
    setImportDataSource('financialSummary');
    setImportPaperSize(tab === 'html' ? 'Responsive' : 'A4');
    setImportAccent('#2563EB');
    setImportHtml('');
    setImportCss('');
    setImportDescription('');
    setImportError(null);
    setCloneSourceId(selectedTemplate?.id || templates[0]?.id || '');
    setDrawerOpen(true);
  };

  const handleSubmitImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);

    if (importTab === 'clone') {
      if (!cloneSourceId) {
        setImportError('Select an existing template to clone.');
        return;
      }
      const cloned = await onDuplicateTemplate(cloneSourceId);
      if (cloned) {
        setSelectedId(cloned.id);
        setDrawerOpen(false);
      }
      return;
    }

    const trimmedName = importName.trim();
    if (!trimmedName) {
      setImportError('Please provide a template name.');
      return;
    }

    if (importTab === 'html' && !importHtml.trim()) {
      setImportError('Paste the HTML markup from http://localhost:5173/template to import.');
      return;
    }

    const created = await onCreateTemplate({
      code: importCode.trim().toUpperCase(),
      name: trimmedName,
      description:
        importDescription.trim() ||
        (importTab === 'html'
          ? 'Imported HTML/CSS layout replicated from localhost:5173/template.'
          : 'Structured corporate template created in ATCL Template Studio.'),
      category: importCategory,
      mode: importTab === 'html' ? 'html' : 'structured',
      dataSource: importDataSource,
      paperSize: importPaperSize,
      accentColor: importAccent,
      status: 'Published',
      isDefault: false,
      sourceOrigin:
        importTab === 'html' ? 'Imported from localhost:5173/template' : 'ATCL Visual Builder',
      sections: {
        headerTitle: trimmedName,
        headerSubtitle: '{{org.name}} · Fiscal Period {{org.fiscalPeriod}}',
        referenceLabel: 'Document Ref',
        showMetadataStrip: true,
        showKpiStrip: true,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Primary Value', token: '{{record.amount}}' },
          { label: 'Counterparty', token: '{{record.party}}' },
          { label: 'Status', token: '{{record.status}}' },
        ],
        signatories: ['Prepared By', 'Checked By', 'Approved By'],
        footerNote: 'Generated from ATCL General Ledger Template Studio.',
      },
      htmlContent: importTab === 'html' ? sanitizeImportedHtml(importHtml) : '',
      cssContent: importTab === 'html' ? importCss : '',
    });

    if (created) {
      setSelectedId(created.id);
      setCanvasMode('desktop');
      setDrawerOpen(false);
    }
  };

  const handleAiGenerateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || aiGenerating) return;
    setAiError(null);
    setAiGenerating(true);
    try {
      const targetCategory = activeTemplate?.category || 'Custom Page';
      const targetSource = activeTemplate?.dataSource || 'financialSummary';
      const targetPaper = activeTemplate?.paperSize || 'A4';
      const generated = await api.generateTemplateWithAi({
        prompt: aiPrompt.trim(),
        category: targetCategory,
        dataSource: targetSource,
        paperSize: targetPaper,
        existingHtml: aiMode === 'refine' ? activeTemplate?.htmlContent : undefined,
        existingCss: aiMode === 'refine' ? activeTemplate?.cssContent : undefined,
      });

      const cleanHtml = sanitizeImportedHtml(generated.htmlContent);

      if (aiMode === 'refine' && draft) {
        updateDraft((prev) => ({
          ...prev,
          mode: 'html',
          htmlContent: cleanHtml,
          cssContent: generated.cssContent || prev.cssContent,
          description: generated.description || prev.description,
        }));
        setCanvasMode('desktop');
        setAiModalOpen(false);
      } else {
        const created = await onCreateTemplate({
          code: generated.code || `TPL-AI-${templates.length + 1}`,
          name: generated.name || 'AI Generated Layout',
          description: generated.description,
          category: targetCategory,
          mode: 'html',
          dataSource: targetSource,
          paperSize: targetPaper,
          accentColor:
            state.config.customInstructions?.style?.accentHex || '#2563EB',
          status: 'Draft',
          isDefault: false,
          sourceOrigin: `AI Generated (${generated.model})`,
          sections: activeTemplate?.sections || {
            headerTitle: generated.name,
            headerSubtitle: '{{org.name}} · {{org.fiscalPeriod}}',
            referenceLabel: 'Document Ref',
            showMetadataStrip: true,
            showKpiStrip: true,
            showLineItemsTable: true,
            showSignatoryBlock: true,
            kpiSlots: [],
            signatories: ['Prepared By', 'Checked By', 'Approved By'],
            footerNote: 'Generated by ATCL Template Studio AI.',
          },
          htmlContent: cleanHtml,
          cssContent: generated.cssContent,
        });
        if (created) {
          setSelectedId(created.id);
          setCanvasMode('desktop');
          setAiModalOpen(false);
        }
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate template.');
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="text-xs font-semibold text-[#2563EB]">
            GOVERNANCE & DOCUMENT ARCHITECTURE · /TEMPLATE ROUTE ACTIVE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Template Studio & Page Importer
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono tabular-nums">{templates.length} Saved Templates</span>
            <span aria-hidden="true">·</span>
            <span>Live ATCL General Ledger & ERP Merge Tokens</span>
            <span aria-hidden="true">·</span>
            <span>Sandboxed HTML Replication for localhost:5173/template</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isDirty && (
            <>
              <button
                onClick={handleDiscardChanges}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Discard</span>
              </button>
              <button
                onClick={handleSaveChanges}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Changes</span>
              </button>
            </>
          )}
          <button
            onClick={handleExportHtml}
            disabled={!activeTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export HTML</span>
          </button>
          <button
            onClick={handlePrintSheet}
            disabled={!activeTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print Sheet</span>
          </button>
          <button
            onClick={() => {
              setAiError(null);
              setAiMode(activeTemplate?.mode === 'html' ? 'refine' : 'new');
              setAiModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>AI Draft Layout</span>
          </button>
          <button
            onClick={() => openImportDrawer('html')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Import / Clone Template</span>
          </button>
        </div>
      </div>

      {/* Main 3-Zone Studio Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* ZONE 1: Left Template Catalog (3 cols) */}
        <aside className="xl:col-span-3 bg-white border border-[#001F60] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates or codes..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 focus:border-[#2563EB]"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    categoryFilter === cat
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto ledger-scroll">
            {filteredTemplates.length === 0 ? (
              <div className="p-6 text-center space-y-2.5">
                <p className="text-xs text-slate-500">No templates match your current filter.</p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('All');
                  }}
                  className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              filteredTemplates.map((tpl) => {
                const isSelected = activeTemplate?.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => setSelectedId(tpl.id)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#EFF6FF]' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono font-semibold text-[#2563EB]">{tpl.code}</span>
                      <span
                        className={
                          tpl.status === 'Published'
                            ? 'text-emerald-700 font-medium'
                            : 'text-amber-700 font-medium'
                        }
                      >
                        {tpl.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 leading-snug">
                      {tpl.name}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span>{tpl.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{tpl.mode === 'html' ? 'HTML Markup' : 'Structured'}</span>
                      {tpl.isDefault && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-800 font-medium">Default</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ZONE 2: Center Live Canvas & Editor (6 cols) */}
        <div className="xl:col-span-6 space-y-4">
          {!activeTemplate || !resolvedCtx ? (
            <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700">No template selected.</p>
              <button
                onClick={() => openImportDrawer('html')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Import First Template</span>
              </button>
            </div>
          ) : (
            <>
              {/* Canvas Mode Toolbar */}
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-800">{activeTemplate.code}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{activeTemplate.sourceOrigin || 'ATCL Studio'}</span>
                    {isDirty && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-700 font-medium">Unsaved Edits</span>
                      </>
                    )}
                  </div>
                </div>

                <div
                  role="tablist"
                  aria-label="Template canvas mode"
                  className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md border border-slate-200/80"
                >
                  <button
                    role="tab"
                    aria-selected={canvasMode === 'desktop'}
                    onClick={() => setCanvasMode('desktop')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                      canvasMode === 'desktop'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span>Desktop Canvas</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={canvasMode === 'a4'}
                    onClick={() => setCanvasMode('a4')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                      canvasMode === 'a4'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>A4 Sheet</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={canvasMode === 'edit'}
                    onClick={() => setCanvasMode('edit')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                      canvasMode === 'edit'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {activeTemplate.mode === 'html' ? (
                      <Code2 className="w-3.5 h-3.5" />
                    ) : (
                      <Layers className="w-3.5 h-3.5" />
                    )}
                    <span>{activeTemplate.mode === 'html' ? 'Edit HTML / CSS' : 'Edit Sections'}</span>
                  </button>
                </div>
              </div>

              {/* Editor Panel when in 'edit' mode */}
              {canvasMode === 'edit' && draft && (
                <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Template Name
                      </label>
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) => updateDraft((p) => ({ ...p, name: e.target.value }))}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Template Code
                      </label>
                      <input
                        type="text"
                        value={draft.code}
                        onChange={(e) =>
                          updateDraft((p) => ({ ...p, code: e.target.value.toUpperCase() }))
                        }
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                      />
                    </div>
                  </div>

                  {draft.mode === 'html' ? (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-medium text-slate-700">
                            HTML Markup (Paste from localhost:5173/template · Supports {'{{tokens}}'})
                          </label>
                          <span className="text-[11px] text-slate-500">Scripts auto-stripped</span>
                        </div>
                        <textarea
                          ref={htmlEditorRef}
                          rows={10}
                          value={draft.htmlContent}
                          onChange={(e) =>
                            updateDraft((p) => ({ ...p, htmlContent: e.target.value }))
                          }
                          className="w-full px-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                          placeholder="<div class='page'>...</div>"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Scoped CSS Stylesheet
                        </label>
                        <textarea
                          rows={6}
                          value={draft.cssContent}
                          onChange={(e) =>
                            updateDraft((p) => ({ ...p, cssContent: e.target.value }))
                          }
                          className="w-full px-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                          placeholder=".page { padding: 24px; }"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Document Title (Tokens Allowed)
                          </label>
                          <input
                            type="text"
                            value={draft.sections.headerTitle}
                            onChange={(e) =>
                              updateDraft((p) => ({
                                ...p,
                                sections: { ...p.sections, headerTitle: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Reference Label
                          </label>
                          <input
                            type="text"
                            value={draft.sections.referenceLabel}
                            onChange={(e) =>
                              updateDraft((p) => ({
                                ...p,
                                sections: { ...p.sections, referenceLabel: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Header Subtitle
                        </label>
                        <input
                          type="text"
                          value={draft.sections.headerSubtitle}
                          onChange={(e) =>
                            updateDraft((p) => ({
                              ...p,
                              sections: { ...p.sections, headerSubtitle: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-4 pt-1">
                        {(
                          [
                            { key: 'showMetadataStrip', label: 'Metadata Grid' },
                            { key: 'showKpiStrip', label: 'KPI Strip' },
                            { key: 'showLineItemsTable', label: 'Line-Items Table' },
                            { key: 'showSignatoryBlock', label: 'Signatory Lines' },
                          ] as const
                        ).map((toggle) => (
                          <label
                            key={toggle.key}
                            className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={draft.sections[toggle.key]}
                              onChange={(e) =>
                                updateDraft((p) => ({
                                  ...p,
                                  sections: { ...p.sections, [toggle.key]: e.target.checked },
                                }))
                              }
                              className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                            />
                            <span>{toggle.label}</span>
                          </label>
                        ))}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Footer Statutory Note
                        </label>
                        <textarea
                          rows={2}
                          value={draft.sections.footerNote}
                          onChange={(e) =>
                            updateDraft((p) => ({
                              ...p,
                              sections: { ...p.sections, footerNote: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Live Document Preview Canvas */}
              <div className="bg-slate-100/80 border border-slate-200 rounded-lg p-4 sm:p-6 overflow-x-auto">
                <div
                  className={`mx-auto bg-white border border-[#001F60] rounded-lg overflow-hidden transition-all ${
                    canvasMode === 'a4' ? 'max-w-[720px]' : 'w-full'
                  }`}
                >
                  {activeTemplate.mode === 'html' ? (
                    <iframe
                      title={activeTemplate.name}
                      sandbox=""
                      srcDoc={iframeSrcDoc}
                      className="w-full min-h-[540px] border-0 bg-white block"
                    />
                  ) : (
                    <div className="p-6 sm:p-8 space-y-6">
                      {/* Structured Template Header */}
                      <div
                        className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b-2"
                        style={{ borderBottomColor: activeTemplate.accentColor }}
                      >
                        <div>
                          <div
                            className="text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: activeTemplate.accentColor }}
                          >
                            {interpolateTemplateText(
                              activeTemplate.sections.headerSubtitle,
                              resolvedCtx.tokens
                            )}
                          </div>
                          <h2 className="text-xl font-bold text-slate-900 mt-1">
                            {interpolateTemplateText(
                              activeTemplate.sections.headerTitle,
                              resolvedCtx.tokens
                            )}
                          </h2>
                        </div>
                        <div className="sm:text-right shrink-0">
                          <div className="text-[11px] text-slate-500">
                            {activeTemplate.sections.referenceLabel}
                          </div>
                          <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                            {resolvedCtx.tokens['record.ref']}
                          </div>
                        </div>
                      </div>

                      {/* Metadata Strip */}
                      {activeTemplate.sections.showMetadataStrip && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3 bg-slate-50 border border-slate-200 rounded-md p-3.5">
                          {resolvedCtx.metadata.map((meta) => (
                            <div key={meta.label}>
                              <div className="text-[10px] font-medium text-slate-500">
                                {meta.label}
                              </div>
                              <div className="text-xs font-semibold text-slate-900 mt-0.5 truncate">
                                {meta.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* KPI Strip */}
                      {activeTemplate.sections.showKpiStrip &&
                        activeTemplate.sections.kpiSlots.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 border border-slate-200 rounded-md divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                            {activeTemplate.sections.kpiSlots.map((slot, idx) => (
                              <div key={`${slot.label}-${idx}`} className="p-3.5">
                                <div className="text-[11px] text-slate-500">{slot.label}</div>
                                <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900 truncate">
                                  {interpolateTemplateText(slot.token, resolvedCtx.tokens)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Line Items Table */}
                      {activeTemplate.sections.showLineItemsTable && (
                        <div className="space-y-3">
                          <div className="overflow-x-auto border border-slate-200 rounded-md">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                  {resolvedCtx.columns.map((col) => (
                                    <th
                                      key={col.key}
                                      className={`py-2 px-3 font-semibold ${
                                        col.align === 'right' ? 'text-right' : 'text-left'
                                      }`}
                                    >
                                      {col.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {resolvedCtx.rows.map((row, idx) => (
                                  <tr key={idx}>
                                    {resolvedCtx.columns.map((col) => (
                                      <td
                                        key={col.key}
                                        className={`py-2 px-3 text-slate-800 ${
                                          col.align === 'right' ? 'text-right' : 'text-left'
                                        } ${col.mono ? 'font-mono tabular-nums whitespace-nowrap' : ''}`}
                                      >
                                        {row[col.key]}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="ml-auto max-w-xs space-y-1.5 pt-1">
                            {resolvedCtx.summaryLines.map((line) => (
                              <div
                                key={line.label}
                                className={`flex items-center justify-between gap-4 text-xs ${
                                  line.bold
                                    ? 'font-bold text-slate-900 pt-1.5 border-t border-slate-200'
                                    : 'text-slate-600'
                                }`}
                              >
                                <span>{line.label}</span>
                                <span className="font-mono tabular-nums">{line.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Signatory Block */}
                      {activeTemplate.sections.showSignatoryBlock &&
                        activeTemplate.sections.signatories.length > 0 && (
                          <div className="grid grid-cols-3 gap-6 pt-10">
                            {activeTemplate.sections.signatories.map((sig, idx) => (
                              <div key={`${sig}-${idx}`} className="text-center">
                                <div className="border-t border-slate-400 pt-1.5 text-[11px] text-slate-600">
                                  {sig}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Footer */}
                      {activeTemplate.sections.footerNote && (
                        <div className="pt-4 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                          {interpolateTemplateText(
                            activeTemplate.sections.footerNote,
                            resolvedCtx.tokens
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ZONE 3: Right Data Binding & Properties Inspector (3 cols) */}
        <aside className="xl:col-span-3 space-y-4">
          {activeTemplate && resolvedCtx && (
            <>
              {/* Live ERP Data Binding Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3.5">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">Live ATCL Data Binding</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Preview this template with live records from the ledger database
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Data Source
                  </label>
                  <select
                    value={activeTemplate.dataSource}
                    onChange={(e) => {
                      setSelectedRecordId('');
                      updateDraft((p) => ({
                        ...p,
                        dataSource: e.target.value as TemplateDataSource,
                      }));
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                  >
                    <option value="financialSummary">IFRS Financial Summary & KPIs</option>
                    <option value="voucher">Voucher Management (PV / RV / JV / EV)</option>
                    <option value="salesOrder">Sales & Distribution Orders</option>
                    <option value="importLC">Import LC & Landed Cost Files</option>
                    <option value="custom">Organization & Global KPIs</option>
                  </select>
                </div>

                {resolvedCtx.recordOptions.length > 1 && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Preview Record
                    </label>
                    <select
                      value={resolvedCtx.activeRecordId}
                      onChange={(e) => setSelectedRecordId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                    >
                      {resolvedCtx.recordOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-medium text-slate-600 mb-2">Accent Palette</div>
                  <div className="flex items-center gap-2">
                    {ACCENT_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        title={preset.label}
                        onClick={() => updateDraft((p) => ({ ...p, accentColor: preset.value }))}
                        className={`w-6 h-6 rounded border cursor-pointer flex items-center justify-center ${
                          activeTemplate.accentColor === preset.value
                            ? 'ring-2 ring-offset-1 ring-slate-900 border-white'
                            : 'border-slate-200'
                        }`}
                        style={{ backgroundColor: preset.value }}
                      >
                        {activeTemplate.accentColor === preset.value && (
                          <Check className="w-3.5 h-3.5 text-white" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Merge Token Palette */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">Merge Tokens</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Click any token to copy (or insert directly into the HTML editor)
                  </p>
                </div>

                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto ledger-scroll">
                  {MERGE_TOKEN_REFERENCE.map((item) => {
                    const key = item.token.replace(/\{\{|\}\}/g, '');
                    const resolvedVal = resolvedCtx.tokens[key] ?? '—';
                    const isCopied = copiedToken === item.token;
                    return (
                      <button
                        key={item.token}
                        onClick={() => handleTokenClick(item.token)}
                        className="w-full py-2 text-left hover:bg-slate-50 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono text-[#2563EB] truncate">
                            {item.token}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">{resolvedVal}</div>
                        </div>
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">
                          {isCopied ? (
                            <span className="text-emerald-700">Copied</span>
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Governance Controls */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-900">Template Governance</h3>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() =>
                      onUpdateTemplate(activeTemplate.id, {
                        status: activeTemplate.status === 'Published' ? 'Draft' : 'Published',
                      })
                    }
                    disabled={busyAction !== null}
                    className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer disabled:opacity-50"
                  >
                    {activeTemplate.status === 'Published' ? 'Mark Draft' : 'Publish'}
                  </button>
                  <button
                    onClick={() => onDuplicateTemplate(activeTemplate.id)}
                    disabled={busyAction !== null}
                    className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer disabled:opacity-50"
                  >
                    Duplicate
                  </button>
                </div>

                {!activeTemplate.isDefault && (
                  <button
                    onClick={() => onUpdateTemplate(activeTemplate.id, { isDefault: true })}
                    disabled={busyAction !== null}
                    className="w-full px-3 py-2 text-xs font-medium text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#2563EB]/25 rounded-md cursor-pointer disabled:opacity-50"
                  >
                    Set as Default for {activeTemplate.category}
                  </button>
                )}

                <div className="pt-2 border-t border-slate-100">
                  {confirmDeleteId === activeTemplate.id ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-red-700 font-medium">Confirm delete?</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            await onDeleteTemplate(activeTemplate.id);
                            setConfirmDeleteId(null);
                          }}
                          disabled={busyAction !== null}
                          className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(activeTemplate.id)}
                      className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Template</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Import / Clone Template Slide-Over Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
          role="dialog"
          aria-modal="true"
          aria-label="Import or clone template"
        >
          <div className="w-full max-w-xl bg-white h-full flex flex-col border-l border-slate-200 shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Import or Clone Template</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Replicate markup from http://localhost:5173/template or build a live ATCL template
                </p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                aria-label="Close drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Import Mode Tabs */}
            <div className="px-6 pt-4">
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md border border-slate-200/80">
                {(
                  [
                    { id: 'html', label: 'Paste HTML', icon: FileCode },
                    { id: 'builder', label: 'Visual Builder', icon: Layers },
                    { id: 'clone', label: 'Clone Existing', icon: Copy },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setImportTab(tab.id);
                        setImportError(null);
                      }}
                      className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                        importTab === tab.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <form
              onSubmit={handleSubmitImport}
              className="flex-1 overflow-y-auto ledger-scroll px-6 py-5 space-y-4"
            >
              {importError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                  {importError}
                </div>
              )}

              {importTab === 'clone' ? (
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Select Source Template to Duplicate
                  </label>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
                    {templates.map((tpl) => (
                      <label
                        key={tpl.id}
                        className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors ${
                          cloneSourceId === tpl.id ? 'bg-[#EFF6FF]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="cloneSource"
                          checked={cloneSourceId === tpl.id}
                          onChange={() => setCloneSourceId(tpl.id)}
                          className="mt-0.5 text-[#2563EB] focus:ring-[#2563EB]"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900">
                            {tpl.code} — {tpl.name}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{tpl.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {importTab === 'html' && (
                    <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                      <div className="font-semibold text-slate-800">
                        Copying from http://localhost:5173/template
                      </div>
                      <p className="leading-relaxed">
                        Open your local page, inspect its root container in browser DevTools, choose{' '}
                        <strong className="text-slate-800">Copy OuterHTML</strong>, and paste it below.
                        You can also insert ATCL live merge tokens such as{' '}
                        <code className="font-mono text-[#2563EB]">{'{{is.netProfit}}'}</code> or{' '}
                        <code className="font-mono text-[#2563EB]">{'{{kpi.currentRatio}}'}</code>.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Template Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={importName}
                        onChange={(e) => setImportName(e.target.value)}
                        placeholder={
                          importTab === 'html'
                            ? 'Localhost /template Replica'
                            : 'Board Executive Brief'
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Code (Optional)
                      </label>
                      <input
                        type="text"
                        value={importCode}
                        onChange={(e) => setImportCode(e.target.value.toUpperCase())}
                        placeholder="TPL-5173"
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Category
                      </label>
                      <select
                        value={importCategory}
                        onChange={(e) => setImportCategory(e.target.value as TemplateCategory)}
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-md"
                      >
                        <option value="Custom Page">Custom Page</option>
                        <option value="Voucher">Voucher</option>
                        <option value="Financial Report">Financial Report</option>
                        <option value="Commercial & LC">Commercial & LC</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ATCL Data Binding
                      </label>
                      <select
                        value={importDataSource}
                        onChange={(e) => setImportDataSource(e.target.value as TemplateDataSource)}
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-md"
                      >
                        <option value="financialSummary">IFRS Summary</option>
                        <option value="voucher">Vouchers</option>
                        <option value="salesOrder">Sales Orders</option>
                        <option value="importLC">Import LCs</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Layout Frame
                      </label>
                      <select
                        value={importPaperSize}
                        onChange={(e) => setImportPaperSize(e.target.value as TemplatePaperSize)}
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-md"
                      >
                        <option value="Responsive">Responsive Canvas</option>
                        <option value="A4">A4 Print Sheet</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={importDescription}
                      onChange={(e) => setImportDescription(e.target.value)}
                      placeholder="Short summary of where and how this template is used"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                    />
                  </div>

                  {importTab === 'html' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          HTML Markup *
                        </label>
                        <textarea
                          rows={8}
                          value={importHtml}
                          onChange={(e) => setImportHtml(e.target.value)}
                          placeholder="<main><h1>{{org.name}}</h1>...</main>"
                          className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Optional CSS Styles
                        </label>
                        <textarea
                          rows={4}
                          value={importCss}
                          onChange={(e) => setImportCss(e.target.value)}
                          placeholder="main { padding: 24px; font-family: 'Public Sans', sans-serif; }"
                          className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer disabled:opacity-50"
                >
                  {importTab === 'clone'
                    ? 'Clone Selected Template'
                    : importTab === 'html'
                      ? 'Import HTML Template'
                      : 'Create Structured Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  AI Template Copy & Layout Generator
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Honors active Custom Instructions, brand accent color, and ATCL merge tokens
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAiModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAiGenerateTemplate} className="p-5 space-y-4">
              {aiError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                  {aiError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setAiMode('new')}
                  className={`py-1.5 text-xs font-medium rounded cursor-pointer ${
                    aiMode === 'new' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Create New Template
                </button>
                <button
                  type="button"
                  disabled={!activeTemplate}
                  onClick={() => setAiMode('refine')}
                  className={`py-1.5 text-xs font-medium rounded disabled:opacity-40 cursor-pointer ${
                    aiMode === 'refine' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Refine Selected Draft
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Layout & Copy Instructions *
                </label>
                <textarea
                  rows={4}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe the template (e.g., Design an A4 VAT & TDS Payment Advice voucher with ATCL header, supplier BIN box, itemized deduction table, and 3 signature lines)..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAiModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={aiGenerating || !aiPrompt.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>{aiGenerating ? 'Generating...' : 'Generate HTML/CSS'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

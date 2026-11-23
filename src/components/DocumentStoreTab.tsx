import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  Layers,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  DocumentChunkPreview,
  DocumentFileType,
  DocumentInjectionScope,
  KnowledgeDocumentItem,
  LedgerState,
  VectorSearchHit,
} from '../types/accounting.ts';

interface DocumentStoreTabProps {
  documents: KnowledgeDocumentItem[];
  onDocumentsUpdated: (nextState: LedgerState, message: string) => void;
}

type FormatFilter = 'ALL' | 'PDF' | 'CSV' | 'MD';
type ScopeFilter = 'ALL' | DocumentInjectionScope;
type InspectorMode = 'chunks' | 'search';

const SCOPE_LABELS: Record<DocumentInjectionScope, string> = {
  global: 'Global (Assistant + Reporting)',
  assistant: 'Executive ERP Assistant',
  reporting: 'Financial Reporting Tools',
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Unable to read file ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export const DocumentStoreTab: React.FC<DocumentStoreTabProps> = ({
  documents,
  onDocumentsUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Upload controls
  const [uploadScope, setUploadScope] = useState<DocumentInjectionScope>('global');
  const [chunkSizeTarget, setChunkSizeTarget] = useState<number>(900);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);

  // Registry filters & selection
  const [searchTerm, setSearchTerm] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('ALL');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('ALL');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(documents[0]?.id ?? null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  // Inspector & semantic search
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('chunks');
  const [chunkSubView, setChunkSubView] = useState<'chunks' | 'full'>('chunks');
  const [loadedChunks, setLoadedChunks] = useState<DocumentChunkPreview[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const [ragQuery, setRagQuery] = useState(
    'What are ATCL withholding tax, VAT compliance, or fiscal covenant thresholds?'
  );
  const [ragScope, setRagScope] = useState<DocumentInjectionScope>('global');
  const [searchingRag, setSearchingRag] = useState(false);
  const [ragHits, setRagHits] = useState<VectorSearchHit[] | null>(null);
  const [ragModel, setRagModel] = useState<string>('gemini-embedding-2');

  const stats = useMemo(() => {
    const totalFiles = documents.length;
    const activeFiles = documents.filter((d) => d.enabled).length;
    const vectorizedFiles = documents.filter((d) => d.vectorStatus === 'vectorized').length;
    const totalChunks = documents.reduce((sum, d) => sum + (d.chunkCount || 0), 0);
    const dims =
      documents.find((d) => d.embeddingDimensions > 0)?.embeddingDimensions || 0;
    return { totalFiles, activeFiles, vectorizedFiles, totalChunks, dims };
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return documents.filter((d) => {
      if (formatFilter !== 'ALL') {
        if (formatFilter === 'MD' && d.fileType !== 'MD') return false;
        if (formatFilter === 'PDF' && d.fileType !== 'PDF') return false;
        if (formatFilter === 'CSV' && d.fileType !== 'CSV') return false;
      }
      if (scopeFilter !== 'ALL' && d.scope !== scopeFilter) return false;
      if (q) {
        const hay = `${d.filename} ${d.fileType} ${d.summaryPreview || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [documents, formatFilter, scopeFilter, searchTerm]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) || filteredDocs[0] || null,
    [documents, filteredDocs, selectedDocId]
  );

  // Load vector chunks when selected document changes
  useEffect(() => {
    if (!selectedDoc) {
      setLoadedChunks([]);
      return;
    }
    let cancelled = false;
    setLoadingChunks(true);
    api
      .getDocumentChunks(selectedDoc.id)
      .then((res) => {
        if (!cancelled) {
          setLoadedChunks(res.chunks);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadedChunks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChunks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDoc?.id, selectedDoc?.vectorizedAt]);

  const processFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    setWarningMsg(null);

    for (const file of Array.from(fileList)) {
      const lower = file.name.toLowerCase();
      const isPdf = lower.endsWith('.pdf');
      const isAllowed =
        isPdf ||
        lower.endsWith('.csv') ||
        lower.endsWith('.md') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.json') ||
        lower.endsWith('.tsv');

      if (!isAllowed) {
        setErrorMsg(`Unsupported file "${file.name}". Upload PDF, CSV, Markdown (.md), TXT, or JSON.`);
        continue;
      }

      setUploadingName(file.name);
      try {
        let res;
        if (isPdf) {
          const base64Data = await fileToBase64(file);
          res = await api.uploadKnowledgeDocument({
            filename: file.name,
            mimeType: file.type || 'application/pdf',
            base64Data,
            scope: uploadScope,
            chunkSizeTarget,
          });
        } else {
          const textContent = await file.text();
          res = await api.uploadKnowledgeDocument({
            filename: file.name,
            mimeType: file.type || 'text/plain',
            textContent,
            scope: uploadScope,
            chunkSizeTarget,
          });
        }

        setSelectedDocId(res.document.id);
        setInspectorMode('chunks');

        if (res.vectorWarning) {
          setWarningMsg(
            `${res.document.filename} text was saved, but Gemini vectorization reported: ${res.vectorWarning}`
          );
          onDocumentsUpdated(res.state, `Uploaded ${res.document.filename} (vector indexing paused).`);
        } else {
          onDocumentsUpdated(
            res.state,
            `Vectorized ${res.document.filename} into ${res.document.chunkCount} chunks (${res.document.embeddingDimensions} dims).`
          );
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : `Failed to upload ${file.name}.`);
      } finally {
        setUploadingName(null);
      }
    }
  };

  const handleToggleEnabled = async (doc: KnowledgeDocumentItem) => {
    setBusyDocId(doc.id);
    setErrorMsg(null);
    try {
      const res = await api.updateDocumentStoreItem(doc.id, { enabled: !doc.enabled });
      onDocumentsUpdated(
        res.state,
        `${doc.filename} ${!doc.enabled ? 'enabled in' : 'excluded from'} global AI context.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update document state.');
    } finally {
      setBusyDocId(null);
    }
  };

  const handleChangeScope = async (doc: KnowledgeDocumentItem, scope: DocumentInjectionScope) => {
    setBusyDocId(doc.id);
    setErrorMsg(null);
    try {
      const res = await api.updateDocumentStoreItem(doc.id, { scope });
      onDocumentsUpdated(res.state, `${doc.filename} scope set to ${SCOPE_LABELS[scope]}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update context scope.');
    } finally {
      setBusyDocId(null);
    }
  };

  const handleRevectorize = async (doc: KnowledgeDocumentItem) => {
    setBusyDocId(doc.id);
    setErrorMsg(null);
    setWarningMsg(null);
    try {
      const res = await api.revectorizeDocument(doc.id, chunkSizeTarget);
      onDocumentsUpdated(
        res.state,
        `Re-vectorized ${res.document.filename}: ${res.document.chunkCount} chunks (${res.document.embeddingDimensions} dims).`
      );
      if (selectedDoc?.id === doc.id) {
        const chunkRes = await api.getDocumentChunks(doc.id);
        setLoadedChunks(chunkRes.chunks);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vectorization failed.');
    } finally {
      setBusyDocId(null);
    }
  };

  const handleDelete = async (doc: KnowledgeDocumentItem) => {
    setBusyDocId(doc.id);
    setErrorMsg(null);
    try {
      const res = await api.deleteKnowledgeDocument(doc.id);
      if (selectedDocId === doc.id) {
        setSelectedDocId(null);
      }
      onDocumentsUpdated(res.state, `Removed ${doc.filename} and purged vector chunks.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete document.');
    } finally {
      setBusyDocId(null);
    }
  };

  const handleRunVectorSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragQuery.trim()) return;
    setSearchingRag(true);
    setErrorMsg(null);
    try {
      const res = await api.searchDocumentStore({
        query: ragQuery.trim(),
        targetScope: ragScope,
        topK: 6,
      });
      setRagHits(res.hits);
      setRagModel(res.embeddingModel);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Semantic vector search failed.');
    } finally {
      setSearchingRag(false);
    }
  };

  const renderFormatIcon = (fileType: DocumentFileType) => {
    if (fileType === 'CSV') {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />;
    }
    if (fileType === 'PDF') {
      return <FileText className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-[#2563EB] dark:text-blue-400 shrink-0" />;
  };

  return (
    <div className="space-y-6">
      {/* Vector Index Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Stored Reference Files
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {stats.totalFiles}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {stats.vectorizedFiles} vectorized · 25 max
          </div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Active in Global Context
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {stats.activeFiles}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Assistant & Financial Reporting
          </div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Indexed Vector Chunks
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {stats.totalChunks.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Cosine similarity semantic RAG
          </div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Embedding Engine
          </div>
          <div className="mt-1 text-sm font-semibold font-mono text-[#2563EB] dark:text-blue-400 truncate">
            gemini-embedding-2
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {stats.dims > 0 ? `${stats.dims.toLocaleString()} vector dimensions` : 'Ready on first upload'}
          </div>
        </div>
      </section>

      {/* Multi-Format Ingestion & Vectorization Panel */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Document Store Ingestion & Vector Pipeline
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload PDF manuals, CSV financial schedules, or Markdown circulars to chunk, embed, and inject into global AI context
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.csv,.md,.markdown,.txt,.json,.tsv"
              onChange={(e) => {
                processFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingName !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>{uploadingName ? `Vectorizing ${uploadingName}...` : 'Upload Reference File'}</span>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Global Context Target Scope
              </label>
              <select
                value={uploadScope}
                onChange={(e) => setUploadScope(e.target.value as DocumentInjectionScope)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="global">Global Context (Executive ERP Assistant + Financial Reporting)</option>
                <option value="assistant">Executive ERP Assistant Only</option>
                <option value="reporting">Financial Reporting & Audit Tools Only</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Vector Chunk Granularity
              </label>
              <select
                value={chunkSizeTarget}
                onChange={(e) => setChunkSizeTarget(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value={500}>High Precision (500 chars / chunk)</option>
                <option value={900}>Balanced Enterprise Default (900 chars / chunk)</option>
                <option value={1400}>Broad Section Context (1,400 chars / chunk)</option>
              </select>
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              processFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`p-6 border border-dashed rounded-lg text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-[#2563EB] bg-[#2563EB]/5'
                : 'border-slate-300 dark:border-slate-700 hover:border-[#2563EB]/60 bg-slate-50/50 dark:bg-slate-800/30'
            }`}
          >
            <FileUp className="w-6 h-6 text-[#2563EB] dark:text-blue-400 mx-auto mb-2" />
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              {uploadingName
                ? `Extracting text and generating vector embeddings for ${uploadingName}...`
                : 'Drop PDF, CSV, or Markdown (.md) files here, or click to browse'}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Supported formats: PDF (up to 5 MB), CSV / TSV (headers preserved per chunk), Markdown / TXT / JSON (up to 2 MB)
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {warningMsg && (
            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{warningMsg}</span>
            </div>
          )}
        </div>
      </section>

      {/* Document Registry + Chunk Inspector / Semantic Search */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Document Registry */}
        <section className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Vectorized Document Registry
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manage active documents and which AI tools receive their vectorized context
                </p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filter documents..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
                {(['ALL', 'PDF', 'CSV', 'MD'] as FormatFilter[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormatFilter(fmt)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                      formatFilter === fmt
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {fmt === 'ALL' ? 'All Formats' : fmt}
                  </button>
                ))}
              </div>

              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
                className="px-2.5 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
              >
                <option value="ALL">All Injection Scopes</option>
                <option value="global">Global (Both)</option>
                <option value="assistant">Assistant Only</option>
                <option value="reporting">Financial Reporting Only</option>
              </select>
            </div>
          </div>

          {filteredDocs.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <FileText className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {documents.length === 0
                  ? 'Document Store is empty'
                  : 'No documents match your active filter'}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                {documents.length === 0
                  ? 'Upload ATCL tax policies (PDF), vendor/account schedules (CSV), or IFRS reporting notes (MD) above to populate the global vector index.'
                  : 'Clear the search box or switch format filters to inspect uploaded documents.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-3 font-semibold w-10">Use</th>
                    <th className="py-2.5 px-3 font-semibold">Document</th>
                    <th className="py-2.5 px-3 font-semibold">Context Scope</th>
                    <th className="py-2.5 px-3 font-semibold">Vector Index</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredDocs.map((doc) => {
                    const isSelected = selectedDoc?.id === doc.id;
                    const isBusy = busyDocId === doc.id;
                    return (
                      <tr
                        key={doc.id}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-slate-50 dark:bg-slate-800/70'
                            : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-3 px-3 align-top">
                          <input
                            type="checkbox"
                            checked={doc.enabled}
                            disabled={isBusy}
                            onChange={() => handleToggleEnabled(doc)}
                            aria-label={`Include ${doc.filename} in global context`}
                            className="mt-0.5 rounded border-slate-300 text-[#2563EB] cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3 align-top max-w-[230px]">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDocId(doc.id);
                              setInspectorMode('chunks');
                            }}
                            className="flex items-start gap-2 text-left w-full cursor-pointer group"
                          >
                            {renderFormatIcon(doc.fileType)}
                            <div className={`min-w-0 ${doc.enabled ? '' : 'opacity-50'}`}>
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-[#2563EB]">
                                {doc.filename}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                                {doc.fileType} · {(doc.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                                {doc.charCount.toLocaleString()} chars
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className="py-3 px-3 align-top">
                          <select
                            value={doc.scope}
                            disabled={isBusy}
                            onChange={(e) =>
                              handleChangeScope(doc, e.target.value as DocumentInjectionScope)
                            }
                            className="px-2 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded cursor-pointer"
                          >
                            <option value="global">Global (Both)</option>
                            <option value="assistant">Assistant Only</option>
                            <option value="reporting">Reporting Only</option>
                          </select>
                        </td>
                        <td className="py-3 px-3 align-top tabular-nums">
                          {doc.vectorStatus === 'vectorized' ? (
                            <div className="space-y-0.5">
                              <div className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span>{doc.chunkCount} chunks</span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {doc.embeddingDimensions}d
                              </div>
                            </div>
                          ) : doc.vectorStatus === 'error' ? (
                            <div className="text-[11px] text-red-700 dark:text-red-400" title={doc.vectorError}>
                              Index error
                            </div>
                          ) : (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400">
                              Needs indexing
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDocId(doc.id);
                                setInspectorMode('chunks');
                              }}
                              title="Inspect extracted chunks"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] rounded cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevectorize(doc)}
                              disabled={isBusy}
                              title="Re-chunk & vectorize with Gemini Embeddings"
                              className="p-1.5 text-slate-500 hover:text-[#2563EB] rounded disabled:opacity-40 cursor-pointer"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(doc)}
                              disabled={isBusy}
                              title="Delete document and vectors"
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded disabled:opacity-40 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right: Chunk Inspector & Live Vector Search Simulator */}
        <section className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
              <button
                type="button"
                onClick={() => setInspectorMode('chunks')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  inspectorMode === 'chunks'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Chunk Inspector</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectorMode('search')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  inspectorMode === 'search'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Vector Search Test</span>
              </button>
            </div>
          </div>

          {inspectorMode === 'chunks' ? (
            !selectedDoc ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Select a document from the registry to inspect its parsed text and vectorized chunks.
              </div>
            ) : (
              <div className="p-5 space-y-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold font-mono text-slate-900 dark:text-slate-100 truncate">
                      {selectedDoc.filename}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {SCOPE_LABELS[selectedDoc.scope]} · {selectedDoc.chunkCount} chunks ·{' '}
                      {selectedDoc.embeddingModel}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[11px] shrink-0">
                    <button
                      type="button"
                      onClick={() => setChunkSubView('chunks')}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        chunkSubView === 'chunks'
                          ? 'bg-white dark:bg-slate-700 font-medium text-slate-900 dark:text-white'
                          : 'text-slate-500'
                      }`}
                    >
                      Chunks ({loadedChunks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setChunkSubView('full')}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        chunkSubView === 'full'
                          ? 'bg-white dark:bg-slate-700 font-medium text-slate-900 dark:text-white'
                          : 'text-slate-500'
                      }`}
                    >
                      Raw Text
                    </button>
                  </div>
                </div>

                {selectedDoc.vectorError && (
                  <div className="p-3 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-[11px] text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                    <span>{selectedDoc.vectorError}</span>
                    <button
                      type="button"
                      onClick={() => handleRevectorize(selectedDoc)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Retry Index
                    </button>
                  </div>
                )}

                {chunkSubView === 'full' ? (
                  <pre className="p-3 rounded-md bg-slate-900 text-slate-200 text-[11px] font-mono max-h-[420px] overflow-auto ledger-scroll whitespace-pre-wrap leading-relaxed">
                    {selectedDoc.extractedText}
                  </pre>
                ) : loadingChunks ? (
                  <div className="py-8 text-center text-xs text-slate-500">Loading vector chunks...</div>
                ) : loadedChunks.length === 0 ? (
                  <div className="p-6 border border-dashed border-slate-200 dark:border-slate-700 rounded-md text-center space-y-2">
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      No vector chunks stored for this document yet.
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevectorize(selectedDoc)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Vectorize Now</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[440px] overflow-y-auto ledger-scroll pr-1">
                    {loadedChunks.map((chunk) => (
                      <div
                        key={chunk.id}
                        className="p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>
                            Chunk #{chunk.chunkIndex + 1}
                            {chunk.sectionLabel ? ` · ${chunk.sectionLabel}` : ''}
                          </span>
                          <span>
                            {chunk.charCount} chars · ~{chunk.tokenEstimate} tok · {chunk.embeddingDimensions}d
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                          {chunk.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="p-5 space-y-4 flex-1">
              <form onSubmit={handleRunVectorSearch} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Target Global Context Scope
                  </label>
                  <select
                    value={ragScope}
                    onChange={(e) => setRagScope(e.target.value as DocumentInjectionScope)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="global">All Active Global Context Docs</option>
                    <option value="assistant">Executive ERP Assistant Scope</option>
                    <option value="reporting">Financial Reporting Tools Scope</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Test Query (Cosine Similarity Search)
                  </label>
                  <textarea
                    rows={2}
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    placeholder="Ask a question to preview which vectorized chunks get injected..."
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>

                <button
                  type="submit"
                  disabled={searchingRag || !ragQuery.trim()}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{searchingRag ? 'Embedding Query & Searching...' : 'Preview Context Injection'}</span>
                </button>
              </form>

              {ragHits !== null && (
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800 max-h-[340px] overflow-y-auto ledger-scroll">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {ragHits.length} matching chunk{ragHits.length === 1 ? '' : 's'} via {ragModel}
                  </div>
                  {ragHits.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded">
                      No matching vectorized chunks found for this scope. Upload and vectorize a document first.
                    </div>
                  ) : (
                    ragHits.map((hit, idx) => (
                      <div
                        key={`${hit.docId}-${hit.chunkIndex}-${idx}`}
                        className="p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                          <span className="font-semibold text-[#2563EB] dark:text-blue-400 truncate">
                            {hit.filename} · Chunk #{hit.chunkIndex + 1}
                          </span>
                          <span className="text-emerald-700 dark:text-emerald-400 shrink-0">
                            {(hit.similarity * 100).toFixed(1)}% match
                          </span>
                        </div>
                        {hit.sectionLabel && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Section: {hit.sectionLabel}
                          </div>
                        )}
                        <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                          {hit.text}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

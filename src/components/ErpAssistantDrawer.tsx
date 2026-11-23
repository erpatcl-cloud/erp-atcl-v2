import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  MessageSquareText,
  RotateCcw,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { hydrateCustomInstructions } from '../data/seedData.ts';
import { api, type RetrievedDocCitation } from '../lib/api.ts';
import type { ActiveRoute, LedgerState } from '../types/accounting.ts';

interface ErpAssistantDrawerProps {
  open: boolean;
  activeRoute: ActiveRoute;
  state: LedgerState;
  onClose: () => void;
  onOpenCustomInstructions: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  retrievedDocs?: RetrievedDocCitation[];
}

function getStarterPrompts(route: ActiveRoute): string[] {
  if (route.startsWith('reports-')) {
    return [
      'Summarize FY 2024-25 revenue, gross margin, and net profit vs prior year.',
      'Explain our liquidity coverage and any working capital risks.',
    ];
  }
  if (route === 'journal' || route.startsWith('vm-')) {
    return [
      'Which vouchers are unposted or awaiting dual sign-off right now?',
      'What TDS & VDS rates apply to an IT services vendor invoice?',
    ];
  }
  if (route === 'audit' || route === 'audit-log') {
    return [
      'Review our GL Register reconciliation status and any discrepancies.',
      'Summarize recent high-impact configuration or posting audit events.',
    ];
  }
  return [
    'Give me an executive snapshot of cash, receivables, and unposted vouchers.',
    'What statutory VAT, TDS, and approval policies are currently enforced?',
  ];
}

export const ErpAssistantDrawer: React.FC<ErpAssistantDrawerProps> = ({
  open,
  activeRoute,
  state,
  onClose,
  onOpenCustomInstructions,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const ci = useMemo(
    () => hydrateCustomInstructions(state.config.customInstructions),
    [state.config.customInstructions]
  );

  const activeModel = ci.models.workflowOverrides.assistant.enabled
    ? ci.models.workflowOverrides.assistant.model
    : ci.models.defaultModel;
  const activeRuleCount = ci.knowledge.rules.filter((r) => r.enabled).length;
  const activeDocCount = ci.knowledge.documents.filter((d) => d.enabled).length;
  const starters = useMemo(() => getStarterPrompts(activeRoute), [activeRoute]);

  if (!open) return null;

  const sendMessage = async (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || streaming) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: clean,
    };
    const modelMsgId = `m-${Date.now() + 1}`;
    const nextHistory = [...messages, userMsg];
    setMessages([...nextHistory, { id: modelMsgId, role: 'model', text: '' }]);
    setInput('');
    setStreaming(true);

    try {
      const meta = await api.streamAssistantChat(
        nextHistory.map((m) => ({ role: m.role, text: m.text })),
        activeRoute,
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === modelMsgId ? { ...m, text: m.text + chunk } : m))
          );
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }
      );
      if (meta.retrievedDocs && meta.retrievedDocs.length > 0) {
        setMessages((prev) =>
          prev.map((m) => (m.id === modelMsgId ? { ...m, retrievedDocs: meta.retrievedDocs } : m))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant failed to respond.');
      setMessages((prev) => prev.filter((m) => m.id !== modelMsgId || m.text.length > 0));
    } finally {
      setStreaming(false);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 text-[#2563EB] dark:text-blue-400 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                ATCL Executive ERP Assistant
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
              <span className="font-mono">{activeModel}</span>
              <span aria-hidden="true"> · </span>
              <span>{ci.enabled ? `${activeRuleCount} rules` : 'Default instructions'}</span>
              {activeDocCount > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{activeDocCount} files</span>
                </>
              )}
              <span aria-hidden="true"> · </span>
              <span>Route: {activeRoute}</span>
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCustomInstructions();
              }}
              title="Adjust Custom Instructions"
              className="p-1.5 text-slate-500 hover:text-[#2563EB] rounded cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                title="Reset conversation"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close ERP Assistant"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto ledger-scroll p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-1.5">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Grounded in Live ATCL Ledger & Custom Instructions
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Ask about Trial Balance positions, GL register activity, Bangladesh VAT/TDS/VDS rules, or operational workflows. Responses follow your configured tone, model, and uploaded knowledge documents.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Suggested questions for this view
                </div>
                {starters.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="w-full text-left p-3 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#2563EB] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-lg p-3.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#2563EB] text-white ml-8'
                    : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 mr-4'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1 opacity-75 text-[11px]">
                  <span className="font-semibold">
                    {msg.role === 'user' ? 'You' : 'ATCL Advisor'}
                  </span>
                  {msg.role === 'model' && msg.text && (
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.id, msg.text)}
                      className="inline-flex items-center gap-1 hover:opacity-100 cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
                <div className="whitespace-pre-wrap">
                  {msg.text || (streaming ? 'Analyzing ledger state...' : '')}
                </div>
                {msg.role === 'model' && msg.retrievedDocs && msg.retrievedDocs.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span>Document Store context: </span>
                    {msg.retrievedDocs
                      .slice(0, 3)
                      .map((d) => `${d.filename} #${d.chunkIndex + 1} (${Math.round(d.similarity * 100)}%)`)
                      .join(' · ')}
                  </div>
                )}
              </div>
            ))
          )}

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="p-4 border-t border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-800/60"
        >
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask about GL balances, tax rules, or voucher entries..."
              className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 resize-none"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{streaming ? 'Thinking' : 'Send'}</span>
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};

import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  RefreshCw,
} from 'lucide-react';
import { api, type ReportInsightsResult } from '../lib/api.ts';

interface AiReportInsightsCardProps {
  reportScope: 'summary' | 'trial-balance' | 'income' | 'balance-sheet' | 'monthly' | 'audit';
  title: string;
}

export const AiReportInsightsCard: React.FC<AiReportInsightsCardProps> = ({
  reportScope,
  title,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [focusQuestion, setFocusQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportInsightsResult | null>(null);

  const handleGenerate = async () => {
    setExpanded(true);
    setLoading(true);
    setError(null);
    try {
      const data = await api.generateReportInsights(reportScope, focusQuestion.trim() || undefined);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate AI commentary.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden no-print">
      <div className="px-5 py-3.5 bg-[#F8FAFC] dark:bg-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-2.5 text-left cursor-pointer min-w-0"
        >
          <FileSpreadsheet className="w-4 h-4 text-[#2563EB] dark:text-blue-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {title}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {result
                ? `${result.model} · ${result.thinkingLevel} · ${result.headline}`
                : 'Generate IFRS commentary, variance drivers, and control checks using active Custom Instructions'}
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Analyzing...' : result ? 'Refresh Commentary' : 'Generate AI Commentary'}</span>
        </button>
      </div>

      {expanded && (
        <div className="p-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={focusQuestion}
              onChange={(e) => setFocusQuestion(e.target.value)}
              placeholder="Optional focus (e.g., explain operating expense growth or cash coverage)..."
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-md"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
            >
              Run Analysis
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {loading && !result && (
            <div className="space-y-2">
              <div className="h-4 w-2/3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-12 w-full bg-slate-100 dark:bg-slate-800/70 rounded animate-pulse" />
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {result.headline}
                </h3>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">
                  {result.executiveSummary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    Key Financial Observations
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">
                    {result.keyObservations.map((obs, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {obs}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-3">
                  {result.riskFlags.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Control & Compliance Alerts</span>
                      </div>
                      <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300 list-disc pl-4">
                        {result.riskFlags.map((flag, idx) => (
                          <li key={idx}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                      Recommended Controller Actions
                    </div>
                    <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">
                      {result.recommendedActions.map((act, idx) => (
                        <li key={idx}>{act}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {result.retrievedDocs && result.retrievedDocs.length > 0 && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>Grounded in Document Store: </span>
                  {result.retrievedDocs
                    .slice(0, 4)
                    .map(
                      (d) =>
                        `${d.filename} · Chunk #${d.chunkIndex + 1} (${Math.round(d.similarity * 100)}%)`
                    )
                    .join(' | ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

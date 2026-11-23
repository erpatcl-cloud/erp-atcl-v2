import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  exportRowsToCSV,
  formatBDT,
  reconcileAllRegisters,
} from '../engine/accountingEngine.ts';
import { AiReportInsightsCard } from './AiReportInsightsCard.tsx';
import type { LedgerState, ReconciliationResult } from '../types/accounting.ts';

interface AuditReconciliationProps {
  state: LedgerState;
  mode: 'audit' | 'audit-log';
  busyAction: string | null;
  lastAuditResult: ReconciliationResult | null;
  onRunReconciliation: () => Promise<void>;
  onSelfHeal: () => Promise<void>;
  onRebuildSingle: (code: string) => Promise<void>;
  onOpenRegister: (code: string) => void;
}

export const AuditReconciliation: React.FC<AuditReconciliationProps> = ({
  state,
  mode,
  busyAction,
  lastAuditResult,
  onRunReconciliation,
  onSelfHeal,
  onRebuildSingle,
  onOpenRegister,
}) => {
  const [rebuildCode, setRebuildCode] = useState(state.accounts[0]?.code || '1010');
  const [logSearch, setLogSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');

  const livePreview = useMemo(() => {
    if (lastAuditResult) return lastAuditResult;
    return reconcileAllRegisters(state, false);
  }, [state, lastAuditResult]);

  const auditModules = useMemo(() => {
    const set = new Set<string>();
    state.auditLogs.forEach((l) => set.add(l.module));
    return ['ALL', ...Array.from(set).sort()];
  }, [state.auditLogs]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return state.auditLogs.filter((log) => {
      if (moduleFilter !== 'ALL' && log.module !== moduleFilter) return false;
      if (!q) return true;
      return (
        log.action.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.userEmail.toLowerCase().includes(q) ||
        log.logId.toLowerCase().includes(q)
      );
    });
  }, [state.auditLogs, logSearch, moduleFilter]);

  const handleExportLogs = () => {
    exportRowsToCSV(
      `ATCL_System_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Timestamp', 'Log ID', 'User Email', 'Module', 'Action', 'Details', 'Status'],
      filteredLogs.map((l) => [l.timestamp, l.logId, l.userEmail, l.module, l.action, l.details, l.status])
    );
  };

  if (mode === 'audit-log') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              System Audit Log
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Immutable chronological trail of all COA, Journal Posting, Register Sync, and Reconciliation operations
            </p>
          </div>
          <button
            onClick={handleExportLogs}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Audit Trail CSV</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
            {auditModules.map((mod) => (
              <button
                key={mod}
                onClick={() => setModuleFilter(mod)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                  moduleFilter === mod ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mod}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Search action, details, user..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
            />
          </div>
        </div>

        <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#2563EB] text-white text-xs font-medium">
                  <th className="py-2.5 px-4 whitespace-nowrap">Timestamp</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Log ID</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">User Email</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Module</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Action</th>
                  <th className="py-2.5 px-4">Details</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map((log) => (
                  <tr key={log.logId} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {log.timestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{log.logId}</td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{log.userEmail}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">{log.module}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 whitespace-nowrap">{log.action}</td>
                    <td className="py-2.5 px-4 text-slate-700">{log.details}</td>
                    <td className="py-2.5 px-4 font-semibold whitespace-nowrap">
                      <span
                        className={
                          log.status === 'SUCCESS'
                            ? 'text-emerald-700'
                            : log.status === 'FAILED'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            System Reconciliation Audit & Self-Healing
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Cross-verifies every individual GL Register Book closing balance and entry count against the authoritative Posted Journal Store
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onRunReconciliation}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Run Full Reconciliation Audit</span>
          </button>

          <button
            onClick={onSelfHeal}
            disabled={busyAction !== null || livePreview.discrepancies.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Self-Heal Discrepancies ({livePreview.discrepancies.length})</span>
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200 grid grid-cols-1 md:grid-cols-3">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Active Registers Audited</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {livePreview.totalChecked}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Mathematically Reconciled</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {livePreview.reconciledCount}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Discrepancies Detected</div>
          <div
            className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
              livePreview.discrepancies.length === 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {livePreview.discrepancies.length}
          </div>
        </div>
      </div>

      <AiReportInsightsCard
        reportScope="audit"
        title="AI Reconciliation & Audit Diagnostics"
      />

      {/* Audit Result Panel */}
      {livePreview.discrepancies.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-emerald-900">
              Audit Passed — Zero Cross-Register Discrepancies
            </h2>
            <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
              All {livePreview.totalChecked} active GL Account Register Books match the immutable Master Posted Journal Store and 8-Column Trial Balance with ৳0.00 variance. To test discrepancy detection and self-healing, disable Auto-Sync on Post in System Configuration, post a new voucher, and re-run this audit.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 bg-red-50 border-b border-red-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-800">
              <AlertTriangle className="w-4 h-4" />
              <span>
                Detected {livePreview.discrepancies.length} out-of-sync GL Register Book(s)
              </span>
            </div>
            <button
              onClick={onSelfHeal}
              disabled={busyAction !== null}
              className="text-xs font-semibold text-red-800 hover:underline cursor-pointer"
            >
              Repair All Now
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4">GL Code</th>
                  <th className="py-2.5 px-4">Account Name</th>
                  <th className="py-2.5 px-4 text-right">Master Store Expected</th>
                  <th className="py-2.5 px-4 text-right">Register Actual</th>
                  <th className="py-2.5 px-4 text-right">Variance</th>
                  <th className="py-2.5 px-4">Diagnostic</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {livePreview.discrepancies.map((d) => (
                  <tr key={d.code}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#2563EB]">{d.code}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{d.name}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatBDT(d.expected)}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatBDT(d.actual)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-red-700 tabular-nums">
                      {formatBDT(d.diff)}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {d.error || 'Closing balance drift'}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => onRebuildSingle(d.code)}
                        disabled={busyAction !== null}
                        className="text-[#2563EB] font-medium hover:underline cursor-pointer"
                      >
                        Rebuild
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Single Account Register Rebuild Tool */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Rebuild Single Account Register from Authoritative Master Store
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Cleanly regenerates all chronological ledger rows and recalculates running balances for any GL account from Posted_Journal_Store.
        </p>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 max-w-2xl">
          <select
            value={rebuildCode}
            onChange={(e) => setRebuildCode(e.target.value)}
            className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
          >
            {state.accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name} ({a.category})
              </option>
            ))}
          </select>
          <button
            onClick={() => onRebuildSingle(rebuildCode)}
            disabled={busyAction !== null}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Rebuild Register</span>
          </button>
          <button
            onClick={() => onOpenRegister(rebuildCode)}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
          >
            <span>Inspect</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

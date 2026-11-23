import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { formatBDT } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { ApprovalRequestRecord, LedgerState } from '../types/accounting.ts';

interface ApprovalQueuePageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const ApprovalQueuePage: React.FC<ApprovalQueuePageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const approvals = state.approvalRequests || [];
  const auditLogs = state.auditLogs || [];
  const [activeTab, setActiveTab] = useState<'approvals' | 'audit'>('approvals');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ApprovalRequestRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const threshold = state.config.autoApproveLimit || 250000;

  const stats = useMemo(() => {
    const pending = approvals.filter((a) => a.status === 'Pending');
    const approved = approvals.filter((a) => a.status === 'Approved');
    const rejected = approvals.filter((a) => a.status === 'Rejected');
    const highValue = pending.filter((a) => a.amount >= threshold);
    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      highValueCount: highValue.length,
    };
  }, [approvals, threshold]);

  const filteredApprovals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return approvals.filter((a) => {
      if (statusFilter !== 'All' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.requestNo.toLowerCase().includes(q) ||
        a.referenceNo.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.requestedBy.toLowerCase().includes(q) ||
        a.module.toLowerCase().includes(q)
      );
    });
  }, [approvals, statusFilter, searchQuery]);

  const handleDecision = async (
    req: ApprovalRequestRecord,
    decision: 'Approved' | 'Rejected',
    reviewNotes?: string
  ) => {
    setBusyId(req.id);
    try {
      const res = await api.decideApprovalRequest(req.id, { decision, reviewNotes });
      onStateChange(res.state);
      onNotify(
        decision === 'Approved' ? 'success' : 'info',
        `${req.requestNo} (${req.referenceNo}) marked ${decision}.`
      );
      setRejectTarget(null);
      setRejectReason('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to decide approval request.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Role-Based Approval Queue &amp; Audit Governance</h1>
          <p className="text-xs text-slate-500">
            Dual-control authorization for high-value POs (&ge; {formatBDT(threshold)}), credit overrides, large vouchers, and stock adjustments. Active role:{' '}
            <span className="font-mono font-semibold text-slate-800">{state.config.activeRole || 'finance_controller'}</span>
          </p>
        </div>
        <div className="inline-flex bg-slate-200/70 p-0.5 rounded-md text-xs">
          <button
            onClick={() => setActiveTab('approvals')}
            className={`px-3 py-1.5 rounded font-medium cursor-pointer ${
              activeTab === 'approvals' ? 'bg-white text-[#2563EB] shadow-xs' : 'text-slate-600'
            }`}
          >
            Approval Queue ({stats.pendingCount} Pending)
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded font-medium cursor-pointer ${
              activeTab === 'audit' ? 'bg-white text-[#2563EB] shadow-xs' : 'text-slate-600'
            }`}
          >
            Security &amp; Action Trail ({auditLogs.length})
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 border-t-2 border-t-amber-500 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending Review</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900">{stats.pendingCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Awaiting controller / manager sign-off</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Approved Requests</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-700">{stats.approvedCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Authorized with immutable reviewer stamp</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-red-600 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Rejected / Returned</span>
            <XCircle className="w-4 h-4 text-red-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-red-700">{stats.rejectedCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Blocked with mandatory rationale</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>High-Value Escalations</span>
            <ShieldAlert className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900">{stats.highValueCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Pending items &ge; {formatBDT(threshold)}</div>
        </div>
      </div>

      {activeTab === 'approvals' ? (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5 text-xs">
              {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                    statusFilter === st
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search request, ref, summary..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3 text-left">Request #</th>
                  <th className="py-2.5 px-3 text-left">Type &amp; Reference</th>
                  <th className="py-2.5 px-3 text-left">Summary</th>
                  <th className="py-2.5 px-3 text-right">Amount (BDT)</th>
                  <th className="py-2.5 px-3 text-left">Maker / Role Req</th>
                  <th className="py-2.5 px-3 text-left">Status / Reviewer</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApprovals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      <ShieldCheck className="w-7 h-7 mx-auto mb-2 opacity-40" />
                      No approval requests matching filter. High-value POs, credit overrides, large vouchers, and stock adjustments queue here automatically.
                    </td>
                  </tr>
                ) : (
                  filteredApprovals.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                        <div>{req.requestNo}</div>
                        <div className="text-[11px] text-slate-400">{req.requestedAt.slice(0, 10)}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-semibold text-slate-700">
                          {req.requestType}
                        </span>
                        <div className="font-mono text-slate-900 mt-0.5">{req.referenceNo}</div>
                      </td>
                      <td className="py-2.5 px-3 max-w-xs text-slate-700">
                        <div>{req.summary}</div>
                        {req.reviewNotes && (
                          <div className="text-[11px] text-slate-500 mt-0.5 italic">Note: {req.reviewNotes}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                        {formatBDT(req.amount)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-slate-800">{req.requestedBy}</div>
                        <div className="text-[11px] font-mono text-slate-400">Req: {req.requiredRole}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            req.status === 'Approved'
                              ? 'bg-emerald-50 text-emerald-700'
                              : req.status === 'Rejected'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {req.status}
                        </span>
                        {req.reviewedBy && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{req.reviewedBy}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                        {req.status === 'Pending' ? (
                          <>
                            <button
                              disabled={busyId === req.id}
                              onClick={() => handleDecision(req, 'Approved', 'Approved via Governance Queue')}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded cursor-pointer disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyId === req.id}
                              onClick={() => {
                                setRejectTarget(req);
                                setRejectReason('');
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded cursor-pointer disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <Lock className="w-3 h-3" /> Decided
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[65vh]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                <tr>
                  <th className="py-2.5 px-3 text-left">Timestamp</th>
                  <th className="py-2.5 px-3 text-left">User</th>
                  <th className="py-2.5 px-3 text-left">Module / Action</th>
                  <th className="py-2.5 px-3 text-left">Details</th>
                  <th className="py-2.5 px-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.slice(0, 100).map((log) => (
                  <tr key={log.logId} className="hover:bg-slate-50/60">
                    <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {log.timestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-2 px-3 text-slate-700">{log.userEmail}</td>
                    <td className="py-2 px-3 font-mono text-slate-800">
                      {log.module} · {log.action}
                    </td>
                    <td className="py-2 px-3 text-slate-700">{log.details}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          log.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700'
                            : log.status === 'FAILED'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-800'
                        }`}
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
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleDecision(rejectTarget, 'Rejected', rejectReason.trim());
            }}
            className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs"
          >
            <h2 className="text-base font-bold text-slate-900">
              Reject Approval Request {rejectTarget.requestNo}
            </h2>
            <p className="text-slate-500">{rejectTarget.summary}</p>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Mandatory Rejection Reason *</label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this request is rejected or needs revision..."
                className="w-full px-2.5 py-2 border border-slate-300 rounded"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === rejectTarget.id || !rejectReason.trim()}
                className="px-4 py-1.5 bg-red-600 text-white font-semibold rounded cursor-pointer disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

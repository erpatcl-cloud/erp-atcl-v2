import React, { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Plus, X } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type {
  LedgerState,
  PurchaseRequisitionLine,
  PurchaseRequisitionRecord,
  PurchaseRequisitionStatus,
} from '../types/accounting.ts';

interface PurchaseRequisitionPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onNavigatePO: () => void;
}

export const PurchaseRequisitionPage: React.FC<PurchaseRequisitionPageProps> = ({
  state,
  onStateChange,
  onNotify,
  onNavigatePO,
}) => {
  const prs = state.purchaseRequisitions || [];
  const [statusFilter, setStatusFilter] = useState<'All' | PurchaseRequisitionStatus>('All');
  const [showModal, setShowModal] = useState(false);

  const [prNumber, setPrNumber] = useState(() => `PR-2026-${String(prs.length + 101).padStart(4, '0')}`);
  const [prDate, setPrDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requiredByDate, setRequiredByDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [department, setDepartment] = useState('Engineering & Projects');
  const [requestedBy, setRequestedBy] = useState(state.config.operatorEmail || 'operations@atclbd.com');
  const [priority, setPriority] = useState<PurchaseRequisitionRecord['priority']>('Standard');
  const [justification, setJustification] = useState('');
  const [lines, setLines] = useState<PurchaseRequisitionLine[]>([
    { id: 'PRL-1', description: '', qty: 1, unit: 'Pcs', estimatedUnitCost: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(
    () => (statusFilter === 'All' ? prs : prs.filter((r) => r.status === statusFilter)),
    [prs, statusFilter]
  );

  const estTotal = useMemo(
    () => round2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.estimatedUnitCost) || 0), 0)),
    [lines]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prNumber.trim() || lines.every((l) => !l.description.trim())) {
      onNotify('error', 'PR Number and at least one item description are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createPurchaseRequisition({
        prNumber: prNumber.trim().toUpperCase(),
        prDate,
        requiredByDate,
        department,
        requestedBy: requestedBy.trim(),
        priority,
        lines: lines.filter((l) => l.description.trim()),
        estimatedTotal: estTotal,
        status: 'Submitted',
        justification: justification.trim() || 'Operational requirement',
      });
      onStateChange(res.state);
      onNotify('success', `Submitted Purchase Requisition ${res.requisition.prNumber}.`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to create PR.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (pr: PurchaseRequisitionRecord, status: PurchaseRequisitionStatus) => {
    try {
      const res = await api.updatePurchaseRequisition(pr.id, { status });
      onStateChange(res.state);
      onNotify('success', `Updated ${pr.prNumber} → ${status}.`);
      if (status === 'Converted to PO') {
        onNavigatePO();
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update PR.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Purchase Requisitions (PR)</h1>
          <p className="text-xs text-slate-500">
            Department purchase requests, budget justification, and approval before RFQ or PO issuance.
          </p>
        </div>
        <button
          onClick={() => {
            setPrNumber(`PR-2026-${String(prs.length + 101).padStart(4, '0')}`);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          New Purchase Requisition
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['All', 'Draft', 'Submitted', 'Approved', 'Converted to PO', 'Rejected'] as const).map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
              statusFilter === st
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">PR No.</th>
              <th className="py-2.5 px-3 text-left">Date / Required</th>
              <th className="py-2.5 px-3 text-left">Department &amp; Requester</th>
              <th className="py-2.5 px-3 text-left">Items / Justification</th>
              <th className="py-2.5 px-3 text-right">Est. Total</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <ClipboardList className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No purchase requisitions recorded yet. Click &ldquo;New Purchase Requisition&rdquo; to begin.
                </td>
              </tr>
            ) : (
              filtered.map((pr) => (
                <tr key={pr.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{pr.prNumber}</td>
                  <td className="py-2.5 px-3 text-slate-600">
                    <div>{pr.prDate}</div>
                    <div className="text-[11px] text-slate-400">Req: {pr.requiredByDate}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-800">{pr.department}</div>
                    <div className="text-[11px] text-slate-500">{pr.requestedBy}</div>
                  </td>
                  <td className="py-2.5 px-3 max-w-xs">
                    <div className="truncate font-medium text-slate-800">
                      {pr.lines.map((l) => `${l.description} (${l.qty} ${l.unit})`).join(', ')}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{pr.justification}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                    {formatBDT(pr.estimatedTotal)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
                      {pr.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right space-x-1.5">
                    {pr.status === 'Submitted' && (
                      <button
                        onClick={() => handleStatusChange(pr, 'Approved')}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Approve
                      </button>
                    )}
                    {pr.status === 'Approved' && (
                      <button
                        onClick={() => handleStatusChange(pr, 'Converted to PO')}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-blue-50 text-[#2563EB] border border-blue-200 rounded cursor-pointer"
                      >
                        Issue PO
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">New Purchase Requisition</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">PR Number *</label>
                <input
                  value={prNumber}
                  onChange={(e) => setPrNumber(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-md font-mono"
                  required
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">PR Date</label>
                <input type="date" value={prDate} onChange={(e) => setPrDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-md" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Required By</label>
                <input type="date" value={requiredByDate} onChange={(e) => setRequiredByDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-md" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Department</label>
                <input value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-md" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Requested By</label>
                <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-md" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="w-full px-2.5 py-2 border border-slate-300 rounded-md bg-white">
                  <option value="Standard">Standard</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-medium text-slate-700">Requested Items *</label>
                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) => [
                      ...prev,
                      { id: `PRL-${prev.length + 1}`, description: '', qty: 1, unit: 'Pcs', estimatedUnitCost: 0 },
                    ])
                  }
                  className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                >
                  + Add Line
                </button>
              </div>
              {lines.map((ln, idx) => (
                <div key={ln.id} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    placeholder="Item description"
                    value={ln.description}
                    onChange={(e) =>
                      setLines((p) => p.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                    }
                    className="col-span-6 px-2 py-1.5 border border-slate-300 rounded"
                  />
                  <input
                    type="number"
                    min="1"
                    value={ln.qty}
                    onChange={(e) =>
                      setLines((p) => p.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)))
                    }
                    className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-right font-mono"
                  />
                  <input
                    value={ln.unit}
                    onChange={(e) =>
                      setLines((p) => p.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))
                    }
                    className="col-span-2 px-2 py-1.5 border border-slate-300 rounded"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Est. Cost"
                    value={ln.estimatedUnitCost}
                    onChange={(e) =>
                      setLines((p) =>
                        p.map((x, i) => (i === idx ? { ...x, estimatedUnitCost: Number(e.target.value) } : x))
                      )
                    }
                    className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-right font-mono"
                  />
                </div>
              ))}
            </div>
            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">Justification</label>
              <input
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Project / operational need"
                className="w-full px-2.5 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
              <span className="font-mono font-bold text-slate-900">Estimated Total: {formatBDT(estTotal)}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded-md cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded-md hover:bg-blue-700 cursor-pointer"
                >
                  {submitting ? 'Submitting...' : 'Submit PR'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

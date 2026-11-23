import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  Landmark,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import { computeGLSummary, formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState, TenderProjectRecord } from '../types/accounting.ts';

interface TenderProjectsPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onOpenRegister: (code: string) => void;
}

export const TenderProjectsPage: React.FC<TenderProjectsPageProps> = ({
  state,
  onStateChange,
  onNotify,
  onOpenRegister,
}) => {
  const projects = state.tenderProjects || [];
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [retentionModal, setRetentionModal] = useState<{
    project: TenderProjectRecord;
    mode: 'hold' | 'release';
  } | null>(null);
  const [retAmount, setRetAmount] = useState('');
  const [retBankGl, setRetBankGl] = useState('1240');
  const [retRef, setRetRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Create form
  const [projectCode, setProjectCode] = useState(() => `PRJ-2026-${String(projects.length + 101).padStart(3, '0')}`);
  const [tenderRef, setTenderRef] = useState('');
  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? '');
  const [contractValue, setContractValue] = useState('');
  const [budgetedCost, setBudgetedCost] = useState('');
  const [retentionPct, setRetentionPct] = useState('10');
  const [bgSecurityAmount, setBgSecurityAmount] = useState('0');
  const [bgBankName, setBgBankName] = useState('Shahjalal Islami Bank PLC');
  const [status, setStatus] = useState<TenderProjectRecord['status']>('Awarded');

  const glSummary = useMemo(() => computeGLSummary(state), [state]);
  const gl1135Balance = glSummary.find((a) => a.code === '1135')?.closingBalance ?? 0;

  const stats = useMemo(() => {
    const active = projects.filter((p) => p.status !== 'Lost');
    const totalContract = round2(active.reduce((s, p) => s + p.contractValue, 0));
    const totalBudget = round2(active.reduce((s, p) => s + p.budgetedCost, 0));
    const totalBg = round2(active.reduce((s, p) => s + p.bgSecurityAmount, 0));
    return {
      totalContract,
      totalBudget,
      totalBg,
      estMargin: round2(totalContract - totalBudget),
    };
  }, [projects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = state.customers.find((c) => c.id === customerId);
    if (!cust) {
      onNotify('error', 'Select a customer / institutional authority.');
      return;
    }
    setSubmitting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const linkedSOs = state.salesOrders
        .filter((o) => o.customerId === cust.id && o.projectCode === projectCode.trim().toUpperCase())
        .map((o) => o.id);
      const res = await api.createTenderProject({
        projectCode: projectCode.trim().toUpperCase(),
        tenderRef: tenderRef.trim() || projectCode.trim().toUpperCase(),
        title: title.trim(),
        customerId: cust.id,
        customerName: cust.name,
        contractValue: round2(Number(contractValue) || 0),
        budgetedCost: round2(Number(budgetedCost) || 0),
        retentionPct: Number(retentionPct) || 0,
        retentionHeld: 0,
        retentionReleased: 0,
        billedAmount: 0,
        collectedAmount: 0,
        bgSecurityAmount: round2(Number(bgSecurityAmount) || 0),
        bgBankName: bgBankName.trim() || undefined,
        startDate: today,
        completionDate: today,
        status,
        linkedSoIds: linkedSOs,
        notes: '',
      });
      onStateChange(res.state);
      onNotify('success', `Created Tender / Project ${res.project.projectCode}.`);
      setShowCreateModal(false);
      setTitle('');
      setTenderRef('');
      setContractValue('');
      setBudgetedCost('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save tender project.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetentionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retentionModal) return;
    setSubmitting(true);
    try {
      const amt = round2(Number(retAmount) || 0);
      if (retentionModal.mode === 'hold') {
        const res = await api.holdProjectRetention(retentionModal.project.id, {
          amount: amt,
          reference: retRef.trim() || undefined,
        });
        onStateChange(res.state);
        onNotify('success', `Transferred ${formatBDT(amt)} from AR (1120) to Retention Money Receivable (1135).`);
      } else {
        const res = await api.releaseProjectRetention(retentionModal.project.id, {
          amount: amt,
          bankGlCode: retBankGl,
          reference: retRef.trim() || undefined,
        });
        onStateChange(res.state);
        onNotify('success', `Released ${formatBDT(amt)} from Retention (1135) into Bank GL ${retBankGl}.`);
      }
      setRetentionModal(null);
      setRetAmount('');
      setRetRef('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Retention posting failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Institutional Tenders &amp; Turnkey Projects</h1>
          <p className="text-xs text-slate-500">
            Track DESCO/DPDC/PGCB utility tenders, contract budgets vs. SO billings, Bank Guarantees, and Retention Money Receivable (GL 1135).
          </p>
        </div>
        <button
          onClick={() => {
            setProjectCode(`PRJ-2026-${String(projects.length + 101).padStart(3, '0')}`);
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> New Tender / Project
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Awarded / Active Contract Value</span>
            <Briefcase className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-slate-900">{formatBDT(stats.totalContract)}</div>
          <div className="text-[11px] text-slate-400 mt-1">{projects.length} project file(s) tracked</div>
        </div>

        <div onClick={() => onOpenRegister('1135')} className="bg-white border border-slate-200 border-t-2 border-t-amber-500 rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Retention Receivable (GL 1135)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#2563EB]" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-amber-700">{formatBDT(gl1135Balance)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Click to inspect GL 1135 Register</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-indigo-600 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Bank Guarantees / EMD Pledged</span>
            <Landmark className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-indigo-700">{formatBDT(stats.totalBg)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Performance security &amp; bid bonds</div>
        </div>

        <div className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Projected Gross Margin</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-emerald-700">{formatBDT(stats.estMargin)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Contract value minus budgeted cost</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Project / Tender Ref</th>
              <th className="py-2.5 px-3 text-left">Authority / Client</th>
              <th className="py-2.5 px-3 text-right">Contract Value</th>
              <th className="py-2.5 px-3 text-right">Budgeted Cost</th>
              <th className="py-2.5 px-3 text-right">Retention Held / Released</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Retention GL Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {projects.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <ShieldCheck className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No Institutional Tender / Turnkey Projects registered yet.
                </td>
              </tr>
            ) : (
              projects.map((p) => {
                const netHeld = round2(Math.max(0, p.retentionHeld - p.retentionReleased));
                const defaultRetAmt = round2((p.contractValue * p.retentionPct) / 100);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3">
                      <div className="font-mono font-semibold text-slate-900">{p.projectCode}</div>
                      <div className="text-slate-700 font-medium">{p.title}</div>
                      <div className="text-[11px] font-mono text-slate-400">{p.tenderRef}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-800">{p.customerName}</div>
                      {p.bgSecurityAmount > 0 && (
                        <div className="text-[11px] text-slate-400">
                          BG: {formatBDT(p.bgSecurityAmount)} ({p.bgBankName || 'Bank'})
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatBDT(p.contractValue)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatBDT(p.budgetedCost)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <div className="text-amber-700 font-semibold">{formatBDT(netHeld)} net held</div>
                      <div className="text-[11px] text-slate-400">
                        Held {formatBDT(p.retentionHeld)} · Rel {formatBDT(p.retentionReleased)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-[#2563EB]">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRetAmount(String(defaultRetAmt || ''));
                          setRetentionModal({ project: p, mode: 'hold' });
                        }}
                        className="px-2 py-1 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded cursor-pointer hover:bg-amber-100"
                      >
                        Hold (1135)
                      </button>
                      {netHeld > 0.01 && (
                        <button
                          onClick={() => {
                            setRetAmount(String(netHeld));
                            setRetentionModal({ project: p, mode: 'release' });
                          }}
                          className="px-2 py-1 text-[11px] font-medium bg-emerald-600 text-white rounded cursor-pointer hover:bg-emerald-700"
                        >
                          Release
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Register Tender / Turnkey Project</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Project Code *</label>
                <input value={projectCode} onChange={(e) => setProjectCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tender / e-GP Ref *</label>
                <input value={tenderRef} onChange={(e) => setTenderRef(e.target.value)} placeholder="e-GP ID / PGCB-TND-..." className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Project Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="33/11kV Substation Switchgear Supply & Commissioning" className="w-full px-2.5 py-2 border border-slate-300 rounded" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Institutional Client *</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Project Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option>Bidding</option>
                  <option>Awarded</option>
                  <option>In Execution</option>
                  <option>Defect Liability</option>
                  <option>Completed</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Contract Value *</label>
                <input type="number" step="0.01" value={contractValue} onChange={(e) => setContractValue(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Budgeted Cost *</label>
                <input type="number" step="0.01" value={budgetedCost} onChange={(e) => setBudgetedCost(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Retention %</label>
                <input type="number" step="0.5" value={retentionPct} onChange={(e) => setRetentionPct(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Bank Guarantee (BDT)</label>
                <input type="number" step="0.01" value={bgSecurityAmount} onChange={(e) => setBgSecurityAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Issuing Bank</label>
                <input value={bgBankName} onChange={(e) => setBgBankName(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowCreateModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Save Project</button>
            </div>
          </form>
        </div>
      )}

      {retentionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleRetentionSubmit} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">
                {retentionModal.mode === 'hold'
                  ? `Hold Retention Money (Dr 1135 / Cr 1120) — ${retentionModal.project.projectCode}`
                  : `Release Retention Money (Dr Bank / Cr 1135) — ${retentionModal.project.projectCode}`}
              </h2>
              <button type="button" onClick={() => setRetentionModal(null)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Amount (BDT) *</label>
              <input type="number" step="0.01" min="0.01" value={retAmount} onChange={(e) => setRetAmount(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
            </div>
            {retentionModal.mode === 'release' && (
              <div>
                <label className="block font-medium text-slate-700 mb-1">Deposit Into Bank GL *</label>
                <select value={retBankGl} onChange={(e) => setRetBankGl(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white font-mono">
                  <option value="1240">1240 — Bank SJIBL</option>
                  <option value="1230">1230 — Bank Al-Arafah</option>
                  <option value="1220">1220 — Bank IBBL</option>
                </select>
              </div>
            )}
            <div>
              <label className="block font-medium text-slate-700 mb-1">Certificate / Advice Reference</label>
              <input value={retRef} onChange={(e) => setRetRef(e.target.value)} placeholder="PAC / FAC Completion Certificate #" className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setRetentionModal(null)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Post GL Entry</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

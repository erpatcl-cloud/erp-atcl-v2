import React, { useMemo, useState } from 'react';
import { CalendarCheck, CheckCircle2, Lock, Plus, ShieldAlert, Trash2, Unlock } from 'lucide-react';
import {
  computeGLSummary,
  computeTrialBalance,
  formatBDT,
  reconcileAllRegisters,
  round2,
} from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface MonthEndClosingPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const MonthEndClosingPage: React.FC<MonthEndClosingPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);

  // Budget form
  const [department, setDepartment] = useState('Engineering & Projects');
  const [glCode, setGlCode] = useState('5110');
  const [annualBudget, setAnnualBudget] = useState('');
  const [notes, setNotes] = useState('');

  const tb = useMemo(() => computeTrialBalance(state), [state]);
  const glSummary = useMemo(() => computeGLSummary(state), [state]);
  const reconPreview = useMemo(() => {
    const clone = structuredClone(state);
    return reconcileAllRegisters(clone);
  }, [state]);

  const unpostedVouchers = useMemo(
    () => state.journalLines.filter((j) => j.postingStatus !== 'POSTED').length,
    [state.journalLines]
  );

  const lockedMonths = state.config.lockedMonths || [];
  const isMonthLocked = lockedMonths.includes(monthKey);
  const tbBalanced = tb.isClosingBalanced;
  const zeroDiscrepancies = reconPreview.discrepancies.length === 0;

  const budgets = state.departmentBudgets || [];
  const expenseAccounts = useMemo(
    () => state.accounts.filter((a) => a.category === 'Expense' && a.status === 'Active'),
    [state.accounts]
  );

  const handleCloseOrReopen = async (reopen = false) => {
    setBusy(true);
    try {
      const res = await api.closeAccountingMonth({ monthKey, reopen });
      onStateChange(res.state);
      onNotify(
        'success',
        reopen ? `Reopened fiscal month ${monthKey}.` : `Verified checklist & locked fiscal month ${monthKey}.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Month-end action failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const acc = state.accounts.find((a) => a.code === glCode);
    setBusy(true);
    try {
      const res = await api.saveDepartmentBudget({
        fiscalPeriod: state.config.fiscalPeriod,
        department,
        glCode,
        glName: acc?.name || glCode,
        annualBudget: round2(Number(annualBudget) || 0),
        notes: notes.trim(),
      });
      onStateChange(res.state);
      onNotify('success', `Saved budget for ${department} (${glCode}).`);
      setAnnualBudget('');
      setNotes('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to save budget.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      const res = await api.deleteDepartmentBudget(id);
      onStateChange(res.state);
      onNotify('info', 'Removed budget line.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to delete budget.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Month-End Closing Checklist &amp; Department Budgets</h1>
          <p className="text-xs text-slate-500">
            Verify Trial Balance equality, zero register discrepancies, and manage closed accounting months alongside Expense GL Budget vs. Actual variance.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input
            type="month"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white font-mono"
          />
          {isMonthLocked ? (
            <button
              disabled={busy}
              onClick={() => void handleCloseOrReopen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md cursor-pointer"
            >
              <Unlock className="w-3.5 h-3.5" /> Reopen {monthKey}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void handleCloseOrReopen(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" /> Close &amp; Lock {monthKey}
            </button>
          )}
        </div>
      </div>

      {/* Pre-Close Checklist */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
          {tbBalanced ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="font-bold text-slate-900">Trial Balance Equality</div>
            <div className="text-slate-500 mt-0.5 font-mono">
              Dr {formatBDT(tb.totals.closingDr)} = Cr {formatBDT(tb.totals.closingCr)}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
          {unpostedVouchers === 0 ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="font-bold text-slate-900">Unposted Master Journal Queue</div>
            <div className="text-slate-500 mt-0.5">
              {unpostedVouchers === 0
                ? 'All journal lines posted cleanly to GL.'
                : `${unpostedVouchers} unposted journal line(s) awaiting posting.`}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
          {zeroDiscrepancies ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="font-bold text-slate-900">15-Column Register Audit</div>
            <div className="text-slate-500 mt-0.5">
              {zeroDiscrepancies
                ? `All ${reconPreview.totalChecked} active registers reconciled (৳0.00 variance).`
                : `${reconPreview.discrepancies.length} register discrepancy(ies) detected.`}
            </div>
          </div>
        </div>
      </div>

      {/* Locked Months Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-800 inline-flex items-center gap-1.5 mr-2">
          <CalendarCheck className="w-4 h-4 text-[#2563EB]" /> Locked Months ({lockedMonths.length}):
        </span>
        {lockedMonths.length === 0 ? (
          <span className="text-slate-400">No months closed yet. Closed months block backdated postings via Central Posting Engine.</span>
        ) : (
          lockedMonths.map((m) => (
            <span key={m} className="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 font-mono font-semibold text-slate-700">
              {m}
            </span>
          ))
        )}
      </div>

      {/* Department Budget vs Actual */}
      <div className="space-y-3">
        <form onSubmit={handleSaveBudget} className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="px-2.5 py-1.5 border border-slate-300 rounded bg-white">
            <option>Engineering &amp; Projects</option>
            <option>Sales &amp; Distribution</option>
            <option>Supply Chain &amp; Imports</option>
            <option>Service &amp; Calibration</option>
            <option>Finance &amp; Admin</option>
          </select>
          <select value={glCode} onChange={(e) => setGlCode(e.target.value)} className="px-2.5 py-1.5 border border-slate-300 rounded bg-white font-mono">
            {expenseAccounts.map((a) => (
              <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
            ))}
          </select>
          <input type="number" step="1000" min="1" value={annualBudget} onChange={(e) => setAnnualBudget(e.target.value)} placeholder="Annual Budget (BDT) *" className="px-2.5 py-1.5 border border-slate-300 rounded font-mono" required />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Budget notes" className="px-2.5 py-1.5 border border-slate-300 rounded" />
          <button type="submit" disabled={busy} className="px-3 py-1.5 bg-[#2563EB] text-white font-semibold rounded inline-flex items-center justify-center gap-1 cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Set Budget
          </button>
        </form>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Department</th>
                <th className="py-2.5 px-3 text-left">GL Account</th>
                <th className="py-2.5 px-3 text-right">Annual Budget</th>
                <th className="py-2.5 px-3 text-right">Actual YTD Spend</th>
                <th className="py-2.5 px-3 text-right">Remaining / Variance</th>
                <th className="py-2.5 px-3 text-right">Utilization</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {budgets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No department expense budgets configured yet. Add a GL budget target above to track Budget vs. Actual variance.
                  </td>
                </tr>
              ) : (
                budgets.map((b) => {
                  const actual = round2(glSummary.find((g) => g.code === b.glCode)?.closingBalance ?? 0);
                  const variance = round2(b.annualBudget - actual);
                  const pct = b.annualBudget > 0 ? (actual / b.annualBudget) * 100 : 0;
                  return (
                    <tr key={b.id}>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{b.department}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{b.glCode} · {b.glName}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatBDT(b.annualBudget)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">{formatBDT(actual)}</td>
                      <td className={`py-2.5 px-3 text-right font-mono font-bold ${variance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatBDT(variance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{pct.toFixed(1)}%</td>
                      <td className="py-2.5 px-3 text-right">
                        <button onClick={() => void handleDeleteBudget(b.id)} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

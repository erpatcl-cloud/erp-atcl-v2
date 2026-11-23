import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Building2, Calculator, Plus, X } from 'lucide-react';
import { computeGLSummary, formatBDT, round2 } from '../engine/accountingEngine.ts';
import { api } from '../lib/api.ts';
import type { LedgerState } from '../types/accounting.ts';

interface FixedAssetsPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
  onOpenRegister: (code: string) => void;
}

export const FixedAssetsPage: React.FC<FixedAssetsPageProps> = ({
  state,
  onStateChange,
  onNotify,
  onOpenRegister,
}) => {
  const assets = state.fixedAssets || [];
  const [showAddModal, setShowAddModal] = useState(false);
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [submitting, setSubmitting] = useState(false);

  // Add asset form
  const [assetCode, setAssetCode] = useState(() => `FA-${String(assets.length + 101).padStart(4, '0')}`);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Calibration & Test Equipment');
  const [acquisitionDate, setAcquisitionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('');
  const [salvageValue, setSalvageValue] = useState('0');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('60');
  const [location, setLocation] = useState('Dhaka Head Office');
  const [postCapitalization, setPostCapitalization] = useState(false);
  const [paymentGlCode, setPaymentGlCode] = useState('1240');

  const glSummary = useMemo(() => computeGLSummary(state), [state]);
  const gl1010 = glSummary.find((a) => a.code === '1010')?.closingBalance ?? 0;
  const gl1020 = glSummary.find((a) => a.code === '1020')?.closingBalance ?? 0;
  const gl5340 = glSummary.find((a) => a.code === '5340')?.closingBalance ?? 0;

  const totals = useMemo(() => {
    const grossCost = round2(assets.reduce((s, a) => s + a.cost, 0));
    const accum = round2(assets.reduce((s, a) => s + a.accumulatedDepreciation, 0));
    const nbv = round2(assets.reduce((s, a) => s + a.netBookValue, 0));
    return { grossCost, accum, nbv };
  }, [assets]);

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createFixedAsset({
        assetCode: assetCode.trim().toUpperCase(),
        name: name.trim(),
        category,
        acquisitionDate,
        cost: round2(Number(cost) || 0),
        salvageValue: round2(Number(salvageValue) || 0),
        usefulLifeMonths: Math.max(1, Number(usefulLifeMonths) || 60),
        accumulatedDepreciation: 0,
        assetGlCode: '1010',
        accumDeprGlCode: '1020',
        deprExpenseGlCode: '5340',
        location,
        status: 'Active',
        postToGl: postCapitalization,
        paymentGlCode,
      });
      onStateChange(res.state);
      onNotify('success', `Added Fixed Asset ${res.asset.assetCode} (${res.asset.name}).`);
      setShowAddModal(false);
      setName('');
      setCost('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to add fixed asset.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunDepreciation = async () => {
    setSubmitting(true);
    try {
      const res = await api.runMonthlyDepreciation({ monthKey });
      onStateChange(res.state);
      onNotify(
        'success',
        `Posted monthly depreciation ${res.voucherNo}: ${formatBDT(res.totalDepreciation)} across ${res.assetsDepreciated} asset(s) (Dr 5340 / Cr 1020).`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Depreciation run failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Fixed Assets &amp; Monthly Depreciation Register</h1>
          <p className="text-xs text-slate-500">
            Track PPE assets (GL 1010), straight-line depreciation expense (GL 5340), and Accumulated Depreciation (GL 1020).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="month"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white font-mono"
          />
          <button
            disabled={submitting || assets.length === 0}
            onClick={() => void handleRunDepreciation()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-800 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-md cursor-pointer disabled:opacity-40"
          >
            <Calculator className="w-3.5 h-3.5" /> Run Depreciation (Dr 5340 / Cr 1020)
          </button>
          <button
            onClick={() => {
              setAssetCode(`FA-${String(assets.length + 101).padStart(4, '0')}`);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Register Asset
          </button>
        </div>
      </div>

      {/* GL & Register Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div onClick={() => onOpenRegister('1010')} className="bg-white border border-slate-200 border-t-2 border-t-[#2563EB] rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>PPE Gross Cost (GL 1010)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#2563EB]" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-slate-900">{formatBDT(gl1010)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Register tracked: {formatBDT(totals.grossCost)}</div>
        </div>
        <div onClick={() => onOpenRegister('1020')} className="bg-white border border-slate-200 border-t-2 border-t-amber-600 rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Accumulated Depreciation (GL 1020)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-amber-700">{formatBDT(gl1020)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Register accum: {formatBDT(totals.accum)}</div>
        </div>
        <div onClick={() => onOpenRegister('5340')} className="bg-white border border-slate-200 border-t-2 border-t-emerald-600 rounded-xl p-4 cursor-pointer hover:shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Depreciation Expense (GL 5340)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-emerald-700">{formatBDT(gl5340)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Net Book Value (Register): {formatBDT(totals.nbv)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Asset Code</th>
              <th className="py-2.5 px-3 text-left">Asset Description &amp; Location</th>
              <th className="py-2.5 px-3 text-left">Acq Date</th>
              <th className="py-2.5 px-3 text-right">Cost</th>
              <th className="py-2.5 px-3 text-right">Accum Depr</th>
              <th className="py-2.5 px-3 text-right">Net Book Value</th>
              <th className="py-2.5 px-3 text-left">Life / Last Run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assets.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  <Building2 className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No fixed assets registered yet. Click &ldquo;Register Asset&rdquo; to track equipment, vehicles &amp; IT infrastructure.
                </td>
              </tr>
            ) : (
              assets.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{a.assetCode}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-800">{a.name}</div>
                    <div className="text-[11px] text-slate-400">{a.category} · {a.location}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600">{a.acquisitionDate}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{formatBDT(a.cost)}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-amber-700">{formatBDT(a.accumulatedDepreciation)}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatBDT(a.netBookValue)}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-600">
                    {a.usefulLifeMonths}m · {a.lastDeprMonth || 'Never'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleAddAsset} className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Register Fixed Asset (PPE 1010)</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Asset Code *</label>
                <input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Acquisition Date</label>
                <input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Asset Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Omicron CPC 100 Relay Test Set" className="w-full px-2.5 py-2 border border-slate-300 rounded" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option>Calibration &amp; Test Equipment</option>
                  <option>IT Servers &amp; Networking</option>
                  <option>Office Furniture &amp; Fixtures</option>
                  <option>Motor Vehicles</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Location</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Cost (BDT) *</label>
                <input type="number" step="0.01" min="1" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Salvage Value</label>
                <input type="number" step="0.01" min="0" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Life (Months)</label>
                <input type="number" min="1" value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-2">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                <input type="checkbox" checked={postCapitalization} onChange={(e) => setPostCapitalization(e.target.checked)} />
                <span>Post Capitalization GL Entry (Dr 1010 / Cr Payment Bank or AP)</span>
              </label>
              {postCapitalization && (
                <select value={paymentGlCode} onChange={(e) => setPaymentGlCode(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white font-mono">
                  <option value="1240">1240 — Bank SJIBL</option>
                  <option value="2080">2080 — Accounts Payable</option>
                  <option value="1210">1210 — Cash in Hand</option>
                </select>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">Save Asset</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

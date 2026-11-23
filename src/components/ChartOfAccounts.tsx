import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  FolderPlus,
  Plus,
  Search,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import { computeGLSummary, exportRowsToCSV, formatBDT } from '../engine/accountingEngine.ts';
import type { AccountCategory, COAValidationResult, LedgerState } from '../types/accounting.ts';

interface ChartOfAccountsProps {
  state: LedgerState;
  busyAction: string | null;
  onOpenRegister: (glCode: string) => void;
  onAddAccount: (payload: {
    code: string;
    name: string;
    category: AccountCategory;
    group: string;
    openingBalance: number;
    autoCreateRegister: boolean;
  }) => Promise<void>;
  onToggleStatus: (code: string, nextStatus: 'Active' | 'Inactive') => Promise<void>;
  onValidateCOA: () => Promise<COAValidationResult | null>;
  onCreateMissingRegisters: () => Promise<void>;
  onImportCOA: (
    accounts: Array<{
      code: string;
      name: string;
      category: AccountCategory;
      group: string;
      openingBalance: number;
    }>
  ) => Promise<void>;
}

const TYPE_ORDER: AccountCategory[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

const TYPE_COLORS: Record<AccountCategory, { color: string; bg: string; label: string }> = {
  Asset: { color: '#2563eb', bg: 'rgba(37,99,235,0.08)', label: 'ASSET ACCOUNTS' },
  Liability: { color: '#dc2626', bg: 'rgba(239,68,68,0.08)', label: 'LIABILITY ACCOUNTS' },
  Equity: { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', label: 'EQUITY ACCOUNTS' },
  Income: { color: '#059669', bg: 'rgba(5,150,105,0.08)', label: 'REVENUE / INCOME ACCOUNTS' },
  Expense: { color: '#d97706', bg: 'rgba(217,119,6,0.08)', label: 'EXPENSE ACCOUNTS' },
};

function getNextGLCodeForCategory(
  accounts: LedgerState['accounts'],
  cat: AccountCategory,
  baseCode?: string
): string {
  const existing = new Set(accounts.map((a) => a.code));
  const start = baseCode && /^\d{4}$/.test(baseCode)
    ? parseInt(baseCode, 10) + 1
    : cat === 'Asset'
      ? 1100
      : cat === 'Liability'
        ? 2100
        : cat === 'Equity'
          ? 3100
          : cat === 'Income'
            ? 4100
            : 5100;
  let candidate = start;
  while (existing.has(String(candidate))) {
    candidate += 1;
  }
  return String(candidate);
}

const DEFAULT_GROUPS: Record<AccountCategory, string[]> = {
  Asset: ['Current Assets', 'Non-Current Assets'],
  Liability: ['Current Liabilities', 'Non-Current Liabilities'],
  Equity: ['Shareholders Equity'],
  Income: ['Revenue', 'Other Income'],
  Expense: [
    'Direct Expense',
    'Operating Expense',
    'Financial Expense',
    'Tax Expense',
  ],
};

export const ChartOfAccounts: React.FC<ChartOfAccountsProps> = ({
  state,
  busyAction,
  onOpenRegister,
  onAddAccount,
  onToggleStatus,
  onValidateCOA,
  onCreateMissingRegisters,
  onImportCOA,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'All' | AccountCategory>('All');
  const [expandedTypes, setExpandedTypes] = useState<Record<AccountCategory, boolean>>({
    Asset: true,
    Liability: true,
    Equity: true,
    Income: true,
    Expense: true,
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importError, setImportError] = useState('');
  const [validationResult, setValidationResult] = useState<COAValidationResult | null>(null);

  const toggleTypeSection = (cat: AccountCategory) => {
    setExpandedTypes((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Add account form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AccountCategory>('Expense');
  const [group, setGroup] = useState('Operating Expense');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [autoCreateRegister, setAutoCreateRegister] = useState(true);
  const [formError, setFormError] = useState('');

  const summaryMap = useMemo(() => {
    const rows = computeGLSummary(state);
    return new Map(rows.map((r) => [r.code, r]));
  }, [state]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.accounts.filter((acc) => {
      if (categoryFilter !== 'All' && acc.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        acc.code.toLowerCase().includes(q) ||
        acc.name.toLowerCase().includes(q) ||
        acc.group.toLowerCase().includes(q)
      );
    });
  }, [state.accounts, search, categoryFilter]);

  const typeComposition = useMemo(() => {
    const rows = TYPE_ORDER.map((cat) => {
      const catAccounts = state.accounts.filter((a) => a.category === cat);
      const total = Math.abs(
        catAccounts.reduce((sum, a) => {
          const s = summaryMap.get(a.code);
          return sum + (s?.closingBalance ?? a.openingBalance);
        }, 0)
      );
      return {
        cat,
        count: catAccounts.length,
        total,
        ...TYPE_COLORS[cat],
      };
    });
    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    return { rows, grandTotal };
  }, [state.accounts, summaryMap]);

  const CATEGORIES: Array<'All' | AccountCategory> = ['All', ...TYPE_ORDER];

  const handleValidate = async () => {
    const res = await onValidateCOA();
    if (res) setValidationResult(res);
  };

  const handleCategoryChange = (nextCat: AccountCategory) => {
    setCategory(nextCat);
    setGroup(DEFAULT_GROUPS[nextCat][0]);
  };

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!/^\d{4}$/.test(code.trim())) {
      setFormError('GL Account Code must be a unique 4-digit numeric code (e.g., 5330).');
      return;
    }
    if (!name.trim()) {
      setFormError('Account Name is required.');
      return;
    }
    try {
      await onAddAccount({
        code: code.trim(),
        name: name.trim(),
        category,
        group: group.trim(),
        openingBalance: Number(openingBalance) || 0,
        autoCreateRegister,
      });
      setCode('');
      setName('');
      setOpeningBalance('0');
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to add account.');
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'GL Account Code',
      'GL Account Name',
      'Category',
      'Subgroup',
      'Opening Balance (BDT)',
      'Normal Balance',
      'Closing Balance (BDT)',
      'Register Book ID',
      'Status',
    ];
    const rows = filteredAccounts.map((a) => {
      const s = summaryMap.get(a.code);
      return [
        a.code,
        a.name,
        a.category,
        a.group,
        a.openingBalance.toFixed(2),
        a.normalBalance,
        (s?.closingBalance ?? a.openingBalance).toFixed(2),
        a.registerFileId || 'UNLINKED',
        a.status,
      ];
    });
    exportRowsToCSV(`ATCL_Chart_of_Accounts_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError('');
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setImportError('Paste CSV rows in format: Code, Name, Category, Subgroup, OpeningBalance');
      return;
    }

    const parsed: Array<{
      code: string;
      name: string;
      category: AccountCategory;
      group: string;
      openingBalance: number;
    }> = [];
    const validCats: AccountCategory[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

    for (const rawLine of lines) {
      const cols = rawLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 3) continue;
      if (cols[0].toLowerCase().includes('code') || cols[0].toLowerCase().includes('gl')) continue;
      const catMatch = validCats.find((c) => c.toLowerCase() === cols[2].toLowerCase());
      if (!catMatch) continue;
      parsed.push({
        code: cols[0],
        name: cols[1],
        category: catMatch,
        group: cols[3] || 'General',
        openingBalance: Number(String(cols[4] || '0').replace(/[^0-9.-]/g, '')) || 0,
      });
    }

    if (parsed.length === 0) {
      setImportError('No valid rows found. Ensure columns follow: GL Code, Account Name, Category, Subgroup, Opening Balance.');
      return;
    }

    try {
      await onImportCOA(parsed);
      setCsvText('');
      setShowImportModal(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import COA CSV.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Chart of Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {state.accounts.length} GL Accounts configured ·{' '}
            {state.accounts.filter((a) => a.registerFileId && state.registers[a.code]).length} linked to individual Register Books
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleValidate}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>Validate COA</span>
          </button>

          {(() => {
            const unlinked = state.accounts.filter(
              (a) => a.status === 'Active' && (!a.registerFileId || !state.registers[a.code])
            ).length;
            return (
              <button
                onClick={onCreateMissingRegisters}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#2563EB]" />
                <span>
                  Create Missing Registers{unlinked > 0 ? ` (${unlinked})` : ''}
                </span>
              </button>
            );
          })()}

          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            <span>Import CSV</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => {
              if (!showAddModal) {
                setCode(getNextGLCodeForCategory(state.accounts, category));
              }
              setShowAddModal((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddModal ? 'Close Form' : 'Add Account Head'}</span>
          </button>
        </div>
      </div>

      {/* Ledger Composition Overview Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Ledger Composition Overview
          </h2>
          <span className="text-xs font-semibold text-slate-500">
            {state.accounts.length} total accounts
          </span>
        </div>
        <div className="flex h-3 rounded-lg overflow-hidden gap-0.5 mb-3.5 bg-slate-100">
          {typeComposition.rows.map((row) => {
            const pct =
              typeComposition.grandTotal > 0 ? (row.total / typeComposition.grandTotal) * 100 : 20;
            return (
              <div
                key={row.cat}
                title={`${row.cat}: ${pct.toFixed(1)}% (${formatBDT(row.total)})`}
                style={{
                  flex: typeComposition.grandTotal > 0 ? Math.max(row.total, 0.01) : 1,
                  background: row.color,
                  minWidth: 4,
                  transition: 'flex 0.4s ease',
                }}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {typeComposition.rows.map((row) => {
            const pct =
              typeComposition.grandTotal > 0 ? (row.total / typeComposition.grandTotal) * 100 : 0;
            return (
              <div key={row.cat} className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: row.color }}
                />
                <span className="font-bold text-slate-700">{row.cat}</span>
                <span className="text-slate-400">({row.count})</span>
                <span className="font-extrabold font-mono" style={{ color: row.color }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Validation Feedback Panel */}
      {validationResult && (
        <div
          className={`p-4 rounded-md border text-sm flex items-start justify-between gap-4 ${
            validationResult.isValid
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {validationResult.isValid ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />
            )}
            <div>
              <div className="font-semibold">
                {validationResult.isValid
                  ? `Chart of Accounts Validated (${validationResult.totalAccounts} accounts checked, 0 duplicates)`
                  : `COA Validation found ${validationResult.errors.length} issue(s)`}
              </div>
              {!validationResult.isValid && (
                <ul className="mt-1 list-disc list-inside text-xs space-y-0.5">
                  {validationResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            onClick={() => setValidationResult(null)}
            className="text-xs underline shrink-0 cursor-pointer"
          >
            Close
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Segmented Category Filter */}
        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search GL code, account name, group..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Inline Collapsible Add New Ledger Account Drawer */}
      {showAddModal && (
        <div
          id="add-coa-form"
          className="bg-white border border-slate-200 border-l-4 border-l-[#2563EB] rounded-xl p-5 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Add New Ledger Account</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Register a 4-digit GL account head with automatic Register Book provisioning.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmitAdd} className="space-y-4">
            {formError && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Code *
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g., 5330"
                  maxLength={4}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                  required
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Petty Cash Dhaka"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Type
                </label>
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value as AccountCategory)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                >
                  {TYPE_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Classification Group
                </label>
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                >
                  {DEFAULT_GROUPS[category].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-44">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Opening Balance (BDT)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer pt-4">
                  <input
                    type="checkbox"
                    checked={autoCreateRegister}
                    onChange={(e) => setAutoCreateRegister(e.target.checked)}
                    className="rounded border-slate-300 text-[#2563EB]"
                  />
                  <span>Auto-create linked Register Book</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                >
                  Register Account
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* 5 Color-Coded Collapsible Account Type Sections */}
      {TYPE_ORDER.filter((t) => categoryFilter === 'All' || categoryFilter === t).map((cat) => {
        const list = filteredAccounts.filter((a) => a.category === cat);
        if (list.length === 0) return null;
        const style = TYPE_COLORS[cat];
        const isExpanded = expandedTypes[cat] ?? true;
        const groupTotal = list.reduce((sum, acc) => {
          const s = summaryMap.get(acc.code);
          return sum + (s?.closingBalance ?? acc.openingBalance);
        }, 0);

        return (
          <div
            key={cat}
            className="bg-white border border-[#001F60] rounded-lg overflow-hidden shadow-xs"
          >
            <button
              type="button"
              onClick={() => toggleTypeSection(cat)}
              style={{
                background: style.bg,
                borderBottom: `2px solid ${style.color}`,
                color: style.color,
              }}
              className="w-full px-5 py-3 flex items-center justify-between text-left cursor-pointer transition-opacity hover:opacity-90"
            >
              <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider">
                <span>{isExpanded ? '▼' : '▶'}</span>
                <span>{style.label}</span>
              </div>
              <div className="text-xs font-semibold text-slate-600 font-mono tabular-nums">
                {list.length} items | Balance: {formatBDT(groupTotal, true)}
              </div>
            </button>

            {isExpanded && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#001F60] text-white text-xs font-bold">
                      <th className="py-2.5 px-3 whitespace-nowrap">Account Code &amp; Name</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Classification</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Opening Balance</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Normal</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Current Balance</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Register ID</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">Status</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white text-xs text-slate-800">
                    {list.map((acc) => {
                      const summary = summaryMap.get(acc.code);
                      const closing = summary?.closingBalance ?? acc.openingBalance;
                      const regLinked = Boolean(acc.registerFileId && state.registers[acc.code]);
                      return (
                        <tr
                          key={acc.code}
                          className={`hover:bg-blue-50/40 transition-colors ${
                            acc.status === 'Inactive' ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <code
                                style={{
                                  background: style.bg,
                                  color: style.color,
                                }}
                                className="px-2 py-0.5 rounded font-mono font-bold text-xs shrink-0"
                              >
                                {acc.code}
                              </code>
                              <span className="font-semibold text-slate-900">{acc.name}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span
                              style={{
                                background: style.bg,
                                color: style.color,
                              }}
                              className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                            >
                              {acc.accountType || acc.group}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                            {formatBDT(acc.openingBalance, true)}
                          </td>
                          <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                            {acc.normalBalance}
                          </td>
                          <td
                            style={{ color: closing !== 0 ? style.color : undefined }}
                            className="py-2 px-3 text-right font-mono font-bold tabular-nums whitespace-nowrap"
                          >
                            {formatBDT(closing, true)}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                            {regLinked ? acc.registerFileId : <span className="text-amber-700">Unlinked</span>}
                          </td>
                          <td className="py-2 px-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                onToggleStatus(acc.code, acc.status === 'Active' ? 'Inactive' : 'Active')
                              }
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer ${
                                acc.status === 'Active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                              }`}
                            >
                              {acc.status}
                            </button>
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setCategory(acc.category);
                                  setGroup(acc.group || DEFAULT_GROUPS[acc.category][0]);
                                  setCode(getNextGLCodeForCategory(state.accounts, acc.category, acc.code));
                                  setName('');
                                  setShowAddModal(true);
                                  setTimeout(() => {
                                    document.getElementById('add-coa-form')?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'center',
                                    });
                                  }, 80);
                                }}
                                title="Add sub-account / service head under this category"
                                className="px-2 py-1 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
                              >
                                + Service Head
                              </button>
                              {regLinked ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenRegister(acc.code)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-[#2563EB] bg-blue-50 border border-blue-200 hover:bg-blue-100 cursor-pointer"
                                >
                                  <span>Register</span>
                                  <ArrowUpRight className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">Run Sync</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {filteredAccounts.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg py-12 px-4 text-center text-sm text-slate-500">
          No GL accounts match your current filter.
        </div>
      )}

      {/* Import Chart of Accounts CSV Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-xl w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Import Chart of Accounts CSV
              </h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleImportSubmit} className="p-6 space-y-4">
              {importError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                  {importError}
                </div>
              )}
              <p className="text-xs text-slate-600 leading-relaxed">
                Paste your <span className="font-mono">Chart_of_Accounts</span> CSV rows below (columns: <span className="font-mono">GL Code, Account Name, Category, Subgroup, Opening Balance</span>). Importing replaces the COA and automatically provisions individual Register Books for every account.
              </p>
              <textarea
                rows={8}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`1210,Cash in Hand,Asset,Current Assets,782888.00\n1240,Bank - Shahjalal Islami Bank PLC,Asset,Current Assets,58042.89`}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 cursor-pointer"
                >
                  Import & Provision Registers
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

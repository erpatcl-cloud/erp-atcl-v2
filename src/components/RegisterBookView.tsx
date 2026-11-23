import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Download,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { exportRowsToCSV, formatBDT, round2 } from '../engine/accountingEngine.ts';
import type { LedgerState } from '../types/accounting.ts';

interface RegisterBookViewProps {
  state: LedgerState;
  selectedCode: string;
  busyAction: string | null;
  onSelectAccount: (code: string) => void;
  onRebuildRegister: (code: string) => Promise<void>;
}

export const RegisterBookView: React.FC<RegisterBookViewProps> = ({
  state,
  selectedCode,
  busyAction,
  onSelectAccount,
  onRebuildRegister,
}) => {
  const [accountSearch, setAccountSearch] = useState('');
  const [entrySearch, setEntrySearch] = useState('');

  const account = useMemo(
    () => state.accounts.find((a) => a.code === selectedCode) || state.accounts[0],
    [state.accounts, selectedCode]
  );

  const register = account ? state.registers[account.code] : undefined;

  const filteredAccountList = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return state.accounts.filter((a) => {
      if (!q) return true;
      return (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    });
  }, [state.accounts, accountSearch]);

  const metrics = useMemo(() => {
    if (!account) {
      return { opening: 0, periodDr: 0, periodCr: 0, closing: 0, positionLabel: '—', isOverdrawn: false };
    }
    const entries = register?.entries || [];
    const periodDr = round2(entries.reduce((s, e) => s + e.debit, 0));
    const periodCr = round2(entries.reduce((s, e) => s + e.credit, 0));
    const closing =
      account.normalBalance === 'Debit'
        ? round2(account.openingBalance + periodDr - periodCr)
        : round2(account.openingBalance + periodCr - periodDr);

    const isOverdrawn = closing < 0;
    const positionLabel =
      account.normalBalance === 'Debit'
        ? isOverdrawn
          ? 'CREDIT (Overdrawn)'
          : 'DEBIT (Normal)'
        : isOverdrawn
          ? 'DEBIT (Overdrawn)'
          : 'CREDIT (Normal)';

    return {
      opening: account.openingBalance,
      periodDr,
      periodCr,
      closing,
      positionLabel,
      isOverdrawn,
    };
  }, [account, register]);

  const visibleEntries = useMemo(() => {
    const entries = register?.entries || [];
    const q = entrySearch.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.voucherNo.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.counterparty.toLowerCase().includes(q) ||
        e.contraCode.toLowerCase().includes(q) ||
        e.contraName.toLowerCase().includes(q) ||
        e.reference.toLowerCase().includes(q) ||
        e.transactionId.toLowerCase().includes(q)
    );
  }, [register, entrySearch]);

  const handleExportCSV = () => {
    if (!account || !register) return;
    const headers = [
      'Transaction Date',
      'Voucher Number',
      'Transaction Type',
      'Description / Narration',
      'Reference Number',
      'Counterparty / Party',
      'Contra GL Code',
      'Contra GL Name',
      'Debit Amount',
      'Credit Amount',
      'Running Balance',
      'Balance Type',
      'Entered By',
      'Entry Timestamp',
      'Transaction ID',
    ];
    const rows = register.entries.map((e) => [
      e.date,
      e.voucherNo,
      e.type,
      e.description,
      e.reference,
      e.counterparty,
      e.contraCode,
      e.contraName,
      e.debit > 0 ? e.debit.toFixed(2) : '',
      e.credit > 0 ? e.credit.toFixed(2) : '',
      e.runningBalance.toFixed(2),
      e.balanceType,
      e.enteredBy,
      e.entryTimestamp,
      e.transactionId,
    ]);
    exportRowsToCSV(`${account.code}_${account.name.replace(/[^a-zA-Z0-9]+/g, '_')}_Register.csv`, headers, rows);
  };

  if (!account) {
    return <div className="text-sm text-slate-500">No GL accounts configured.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Top Selector Bar & Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
          <div className="relative sm:w-56 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="Filter 54 register books..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
            />
          </div>
          <select
            aria-label="Select GL Account Register Book"
            value={account.code}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="flex-1 max-w-xl px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
          >
            {filteredAccountList.map((a) => {
              const txCount = state.registers[a.code]?.entries.length ?? 0;
              return (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name} ({a.category} · {txCount} {txCount === 1 ? 'entry' : 'entries'})
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => onRebuildRegister(account.code)}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>Rebuild from Master</span>
          </button>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print Book</span>
          </button>
        </div>
      </div>

      {/* Official Register Book Document Header (Mirroring 03_RegisterManager.gs rows 1-5) */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 bg-[#F8FAFC]">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-[#2563EB]">
                {state.config.organizationName} · General Ledger Account Register
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-1">
                <span className="font-mono text-[#2563EB] mr-2 tabular-nums">{account.code}</span>
                {account.name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Category: <strong className="text-slate-700 font-medium">{account.category}</strong></span>
                <span aria-hidden="true">·</span>
                <span>Subgroup: <strong className="text-slate-700 font-medium">{account.group}</strong></span>
                <span aria-hidden="true">·</span>
                <span>Normal Balance: <strong className="text-slate-700 font-medium">{account.normalBalance}</strong></span>
                <span aria-hidden="true">·</span>
                <span>Currency: {state.config.currencyCode} ({state.config.currencySymbol})</span>
              </div>
            </div>

            <div className="text-xs text-slate-500 md:text-right font-mono tabular-nums space-y-0.5 shrink-0">
              <div>Register ID: {register?.fileId || 'Not Provisioned'}</div>
              <div>
                Last Synced:{' '}
                {register?.lastSyncedAt
                  ? new Date(register.lastSyncedAt).toLocaleString('en-GB', {
                      year: 'numeric',
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Never'}
              </div>
            </div>
          </div>
        </div>

        {/* 5 Metric Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200">
          <div className="p-4">
            <div className="text-xs text-slate-500">Opening Balance</div>
            <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
              {formatBDT(metrics.opening)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Total Period Debits</div>
            <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
              {formatBDT(metrics.periodDr)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Total Period Credits</div>
            <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
              {formatBDT(metrics.periodCr)}
            </div>
          </div>
          <div className="p-4 bg-[#EFF6FF]">
            <div className="text-xs font-medium text-[#2563EB]">Closing Balance</div>
            <div
              className={`mt-1 text-base font-bold font-mono tabular-nums ${
                metrics.closing < 0 ? 'text-red-700' : 'text-[#2563EB]'
              }`}
            >
              {formatBDT(metrics.closing)}
            </div>
          </div>
          <div className="p-4 col-span-2 lg:col-span-1">
            <div className="text-xs text-slate-500">Balance Position</div>
            <div
              className={`mt-1 text-sm font-semibold ${
                metrics.isOverdrawn ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {metrics.positionLabel}
            </div>
          </div>
        </div>

        {/* Filter Bar inside Register Book */}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white no-print">
          <div className="text-xs text-slate-500">
            Showing <strong className="text-slate-800 font-mono tabular-nums">{visibleEntries.length}</strong> of{' '}
            <strong className="text-slate-800 font-mono tabular-nums">{register?.entries.length ?? 0}</strong> posted register transaction(s)
          </div>
          <div className="relative sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={entrySearch}
              onChange={(e) => setEntrySearch(e.target.value)}
              placeholder="Search voucher, contra account, party..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
            />
          </div>
        </div>

        {/* 15 Standard Columns Ledger Table */}
        <div className="overflow-x-auto ledger-scroll">
          <table className="w-full text-left border-collapse min-w-[1380px]">
            <thead>
              <tr className="bg-[#2563EB] text-white text-xs font-medium">
                <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Voucher No</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Description / Narration</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Ref No</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Counterparty</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Contra GL</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Contra Account Name</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Debit</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Credit</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Running Balance</th>
                <th className="py-2.5 px-3 text-center whitespace-nowrap">Bal</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Entered By</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Entry Timestamp</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Transaction ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {/* Opening Balance Brought Forward Row */}
              <tr className="bg-slate-50/90 font-medium text-slate-700">
                <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">2024-07-01</td>
                <td className="py-2.5 px-3 font-mono text-slate-400">—</td>
                <td className="py-2.5 px-3 text-slate-500">Opening</td>
                <td className="py-2.5 px-3" colSpan={5}>
                  Balance Brought Forward (Opening Ledger Balance)
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">—</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">—</td>
                <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                  {formatBDT(account.openingBalance)}
                </td>
                <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                  {account.normalBalance === 'Debit' ? 'Dr' : 'Cr'}
                </td>
                <td className="py-2.5 px-3 text-slate-400" colSpan={3}>
                  System Opening Balance
                </td>
              </tr>

              {visibleEntries.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-10 text-center text-slate-500">
                    No posted transactions recorded in this register book yet. Post an approved journal voucher referencing GL {account.code} to populate entries.
                  </td>
                </tr>
              ) : (
                visibleEntries.map((entry) => (
                  <tr key={entry.transactionId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {entry.date}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-[#2563EB] whitespace-nowrap">
                      {entry.voucherNo}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                      {entry.type}
                    </td>
                    <td className="py-2.5 px-3 text-slate-900 max-w-xs">
                      {entry.description}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {entry.reference || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                      {entry.counterparty}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                      {entry.contraCode !== 'MULTI' ? (
                        <button
                          onClick={() => onSelectAccount(entry.contraCode)}
                          className="inline-flex items-center gap-0.5 text-[#2563EB] hover:underline font-medium cursor-pointer"
                          title={`Jump to GL ${entry.contraCode} Register Book`}
                        >
                          <span>{entry.contraCode}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-slate-500 font-medium">MULTI</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                      {entry.contraName}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {entry.debit > 0 ? formatBDT(entry.debit) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {entry.credit > 0 ? formatBDT(entry.credit) : '—'}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        entry.runningBalance < 0 ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {formatBDT(entry.runningBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-medium text-slate-600 whitespace-nowrap">
                      {entry.balanceType}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {entry.enteredBy}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {entry.entryTimestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {entry.transactionId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

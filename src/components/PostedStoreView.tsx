import React, { useMemo, useState } from 'react';
import { Download, Lock, RefreshCw, Search } from 'lucide-react';
import { exportRowsToCSV, formatBDT, round2 } from '../engine/accountingEngine.ts';
import { PaginationBar } from './common/PaginationBar.tsx';
import type { LedgerState } from '../types/accounting.ts';

interface PostedStoreViewProps {
  state: LedgerState;
  busyAction: string | null;
  onSyncRegisters: () => Promise<void>;
  onOpenRegister: (code: string) => void;
}

export const PostedStoreView: React.FC<PostedStoreViewProps> = ({
  state,
  busyAction,
  onSyncRegisters,
  onOpenRegister,
}) => {
  const [search, setSearch] = useState('');
  const [syncFilter, setSyncFilter] = useState<'ALL' | 'SYNCED' | 'PENDING'>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const pendingCount = useMemo(
    () => state.postedTransactions.filter((t) => t.registerSynced === 'PENDING').length,
    [state.postedTransactions]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...state.postedTransactions]
      .reverse()
      .filter((t) => {
        if (syncFilter !== 'ALL' && t.registerSynced !== syncFilter) return false;
        if (!q) return true;
        return (
          t.voucherNo.toLowerCase().includes(q) ||
          t.glCode.toLowerCase().includes(q) ||
          t.glName.toLowerCase().includes(q) ||
          t.contraCode.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.transactionId.toLowerCase().includes(q)
        );
      });
  }, [state.postedTransactions, search, syncFilter]);

  const totals = useMemo(() => {
    const dr = round2(filtered.reduce((s, t) => s + t.debit, 0));
    const cr = round2(filtered.reduce((s, t) => s + t.credit, 0));
    return { dr, cr };
  }, [filtered]);

  const handleExportCSV = () => {
    const headers = [
      'Post Timestamp',
      'Journal ID',
      'Voucher No',
      'Date',
      'Type',
      'Description',
      'Reference',
      'Counterparty',
      'GL Code',
      'GL Name',
      'Contra Code',
      'Contra Name',
      'Debit',
      'Credit',
      'Entered By',
      'Transaction ID',
      'Register Synced',
    ];
    const rows = filtered.map((t) => [
      t.postTimestamp,
      t.journalId,
      t.voucherNo,
      t.date,
      t.type,
      t.description,
      t.reference,
      t.counterparty,
      t.glCode,
      t.glName,
      t.contraCode,
      t.contraName,
      t.debit > 0 ? t.debit.toFixed(2) : '',
      t.credit > 0 ? t.credit.toFixed(2) : '',
      t.enteredBy,
      t.transactionId,
      t.registerSynced,
    ]);
    exportRowsToCSV(`ATCL_Posted_Journal_Store_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Lock className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>Authoritative Append-Only Ledger · {state.postedTransactions.length} Posted Lines</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Posted Journal Store
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSyncRegisters}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>
              Sync Pending to Registers{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </span>
          </button>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
          {(['ALL', 'SYNCED', 'PENDING'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setSyncFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                syncFilter === status
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status === 'ALL' ? 'All Posted' : status === 'SYNCED' ? 'Synced' : `Pending (${pendingCount})`}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voucher, GL code, contra, UUID..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* 17-Column Immutable Store Table */}
      <div className="bg-white border border-[#001F60] rounded-lg overflow-hidden">
        <div className="overflow-x-auto ledger-scroll">
          <table className="w-full text-left border-collapse min-w-[1440px]">
            <thead>
              <tr className="bg-[#2563EB] text-white text-xs font-medium">
                <th className="py-2.5 px-3 whitespace-nowrap">Post Timestamp</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Voucher No</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Description</th>
                <th className="py-2.5 px-3 whitespace-nowrap">GL Code</th>
                <th className="py-2.5 px-3 whitespace-nowrap">GL Name</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Contra GL</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Contra Name</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Debit</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Credit</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Entered By</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Transaction ID</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.slice((Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize))) - 1) * pageSize, Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize))) * pageSize).map((t) => (
                <tr key={t.transactionId} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                    {t.postTimestamp.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-semibold text-[#2563EB] whitespace-nowrap">
                    {t.voucherNo}
                  </td>
                  <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                    {t.date}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{t.type}</td>
                  <td className="py-2.5 px-3 text-slate-800 max-w-[220px] truncate" title={t.description}>
                    {t.description}
                  </td>
                  <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                    <button
                      onClick={() => onOpenRegister(t.glCode)}
                      className="text-[#2563EB] hover:underline font-medium cursor-pointer"
                    >
                      {t.glCode}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{t.glName}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                    {t.contraCode !== 'MULTI' ? (
                      <button
                        onClick={() => onOpenRegister(t.contraCode)}
                        className="text-[#2563EB] hover:underline cursor-pointer"
                      >
                        {t.contraCode}
                      </button>
                    ) : (
                      'MULTI'
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{t.contraName}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                    {t.debit > 0 ? formatBDT(t.debit) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                    {t.credit > 0 ? formatBDT(t.credit) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">{t.enteredBy}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {t.transactionId}
                  </td>
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                    <span
                      className={
                        t.registerSynced === 'SYNCED' ? 'text-emerald-700' : 'text-amber-700'
                      }
                    >
                      {t.registerSynced}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#EFF6FF] border-t border-slate-200 text-xs font-semibold text-slate-900">
                <td colSpan={9} className="py-3 px-3">
                  Filtered Posted Store Totals ({filtered.length} lines)
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {formatBDT(totals.dr)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {formatBDT(totals.cr)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        <PaginationBar
          page={Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))}
          pageSize={pageSize}
          totalItems={filtered.length}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
};

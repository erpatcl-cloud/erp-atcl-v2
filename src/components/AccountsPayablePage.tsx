import React, { useMemo } from 'react';
import { Wallet } from 'lucide-react';
import { formatBDT, round2 } from '../engine/accountingEngine.ts';
import type { LedgerState } from '../types/accounting.ts';

interface AccountsPayablePageProps {
  state: LedgerState;
  onOpenNewVoucher: () => void;
}

export const AccountsPayablePage: React.FC<AccountsPayablePageProps> = ({
  state,
  onOpenNewVoucher,
}) => {
  const invoices = (state.purchaseInvoices || []).filter((i) => i.status !== 'Voided');

  const agingSummary = useMemo(() => {
    const now = Date.now();
    let current = 0;
    let d30 = 0;
    let d60 = 0;
    let d90Plus = 0;

    for (const inv of invoices) {
      if (inv.outstandingAmount <= 0) continue;
      const due = new Date(inv.dueDate).getTime();
      const daysOver = Number.isNaN(due) ? 0 : Math.floor((now - due) / 86_400_000);
      if (daysOver <= 0) current = round2(current + inv.outstandingAmount);
      else if (daysOver <= 30) d30 = round2(d30 + inv.outstandingAmount);
      else if (daysOver <= 60) d60 = round2(d60 + inv.outstandingAmount);
      else d90Plus = round2(d90Plus + inv.outstandingAmount);
    }
    return {
      current,
      d30,
      d60,
      d90Plus,
      total: round2(current + d30 + d60 + d90Plus),
    };
  }, [invoices]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Accounts Payable &amp; Aging (GL 2080)</h1>
          <p className="text-xs text-slate-500">
            Track open supplier liabilities, overdue aging buckets, and settle balances via Payment Vouchers.
          </p>
        </div>
        <button
          onClick={onOpenNewVoucher}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Wallet className="w-3.5 h-3.5" /> Settle via Payment Voucher
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Open AP', val: agingSummary.total },
          { label: 'Current / Not Due', val: agingSummary.current },
          { label: '1–30 Days Past Due', val: agingSummary.d30 },
          { label: '31–60 Days Past Due', val: agingSummary.d60 },
          { label: '60+ Days Overdue', val: agingSummary.d90Plus },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">{card.label}</div>
            <div className="mt-1 text-base font-bold font-mono text-slate-900">{formatBDT(card.val)}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Supplier</th>
              <th className="py-2.5 px-3 text-left">Invoice / Bill No.</th>
              <th className="py-2.5 px-3 text-left">Due Date</th>
              <th className="py-2.5 px-3 text-right">Gross</th>
              <th className="py-2.5 px-3 text-right">Paid</th>
              <th className="py-2.5 px-3 text-right">Outstanding</th>
              <th className="py-2.5 px-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  No open supplier invoices in Accounts Payable.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-medium text-slate-800">{inv.supplierName}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-700">{inv.invoiceNumber} ({inv.supplierInvoiceNo})</td>
                  <td className="py-2.5 px-3 text-slate-600">{inv.dueDate}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{formatBDT(inv.grossAmount)}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-emerald-700">{formatBDT(inv.paidAmount)}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatBDT(inv.outstandingAmount)}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

import React, { useMemo } from 'react';
import { ArrowRight, ExternalLink, FileText, GitBranch, Package, Receipt, ShieldCheck, Truck, X } from 'lucide-react';
import { formatBDT } from '../../engine/accountingEngine.ts';
import type { LedgerState } from '../../types/accounting.ts';

export interface TraceDocTarget {
  docType: 'PO' | 'LC' | 'GRN' | 'PINV' | 'SO' | 'DO' | 'SINV' | 'VOUCHER';
  docRef: string;
  title?: string;
}

interface DocumentTraceabilityDrawerProps {
  state: LedgerState;
  target: TraceDocTarget | null;
  onClose: () => void;
  onOpenRegister?: (glCode: string) => void;
}

export const DocumentTraceabilityDrawer: React.FC<DocumentTraceabilityDrawerProps> = ({
  state,
  target,
  onClose,
  onOpenRegister,
}) => {
  const trace = useMemo(() => {
    if (!target) return null;
    const ref = target.docRef.trim().toUpperCase();

    // Identify linked Procurement & Sales docs by reference / ID matching
    const po =
      state.localPurchaseOrders.find(
        (p) => p.poNumber.toUpperCase() === ref || p.id.toUpperCase() === ref
      ) ||
      (() => {
        const grnMatch = (state.goodsReceipts || []).find((g) => g.grnNumber.toUpperCase() === ref);
        if (grnMatch?.sourceRef) {
          return state.localPurchaseOrders.find(
            (p) => p.poNumber.toUpperCase() === grnMatch.sourceRef.toUpperCase()
          );
        }
        const pinvMatch = (state.purchaseInvoices || []).find(
          (pi) => pi.invoiceNumber.toUpperCase() === ref || pi.supplierInvoiceNo.toUpperCase() === ref
        );
        if (pinvMatch?.sourceRef) {
          return state.localPurchaseOrders.find(
            (p) => p.poNumber.toUpperCase() === pinvMatch.sourceRef?.toUpperCase()
          );
        }
        if (pinvMatch?.grnNumber) {
          const viaGrn = (state.goodsReceipts || []).find(
            (g) => g.grnNumber.toUpperCase() === pinvMatch.grnNumber?.toUpperCase()
          );
          if (viaGrn?.sourceRef) {
            return state.localPurchaseOrders.find(
              (p) => p.poNumber.toUpperCase() === viaGrn.sourceRef.toUpperCase()
            );
          }
        }
        return undefined;
      })();

    const poRef = po?.poNumber.toUpperCase() || ref;

    const linkedGrns = (state.goodsReceipts || []).filter(
      (g) =>
        g.grnNumber.toUpperCase() === ref ||
        g.sourceRef.toUpperCase() === poRef ||
        g.sourceRef.toUpperCase() === ref
    );
    const grnNos = new Set(linkedGrns.map((g) => g.grnNumber.toUpperCase()));

    const linkedPinvs = (state.purchaseInvoices || []).filter(
      (pi) =>
        pi.invoiceNumber.toUpperCase() === ref ||
        pi.supplierInvoiceNo.toUpperCase() === ref ||
        (pi.sourceRef && (pi.sourceRef.toUpperCase() === ref || pi.sourceRef.toUpperCase() === poRef)) ||
        (pi.grnNumber && grnNos.has(pi.grnNumber.toUpperCase()))
    );

    const so =
      state.salesOrders.find((o) => o.orderNo.toUpperCase() === ref || o.id.toUpperCase() === ref) ||
      (() => {
        const dOrder = (state.deliveryOrders || []).find((d) => d.challanNo.toUpperCase() === ref);
        if (dOrder) return state.salesOrders.find((o) => o.id === dOrder.salesOrderId);
        const sInv = (state.salesInvoices || []).find((i) => i.invoiceNumber.toUpperCase() === ref);
        if (sInv?.salesOrderId) return state.salesOrders.find((o) => o.id === sInv.salesOrderId);
        return undefined;
      })();

    const soRef = so?.orderNo.toUpperCase() || ref;

    const linkedDos = (state.deliveryOrders || []).filter(
      (d) =>
        d.challanNo.toUpperCase() === ref ||
        d.salesOrderNo.toUpperCase() === soRef ||
        d.salesOrderNo.toUpperCase() === ref
    );

    const linkedSinvs = (state.salesInvoices || []).filter(
      (si) =>
        si.invoiceNumber.toUpperCase() === ref ||
        (si.salesOrderNo && (si.salesOrderNo.toUpperCase() === soRef || si.salesOrderNo.toUpperCase() === ref)) ||
        (si.deliveryOrderNo && linkedDos.some((d) => d.challanNo.toUpperCase() === si.deliveryOrderNo?.toUpperCase()))
    );

    const allRefs = new Set<string>([
      ref,
      ...(po ? [po.poNumber.toUpperCase(), `JRN-${po.poNumber.toUpperCase()}`] : []),
      ...(so ? [so.orderNo.toUpperCase()] : []),
      ...linkedGrns.flatMap((g) => [g.grnNumber.toUpperCase(), g.postedVoucherNo?.toUpperCase() || '']),
      ...linkedPinvs.flatMap((p) => [p.invoiceNumber.toUpperCase(), p.supplierInvoiceNo.toUpperCase(), p.postedVoucherNo?.toUpperCase() || '']),
      ...linkedDos.map((d) => d.challanNo.toUpperCase()),
      ...linkedSinvs.flatMap((s) => [s.invoiceNumber.toUpperCase(), s.postedVoucherNo?.toUpperCase() || '']),
    ]);

    const linkedVouchers = state.vouchers.filter((v) => {
      const vRef = v.voucherRef.toUpperCase();
      const bankRef = (v.bankReferenceNo || '').toUpperCase();
      const linkedSrcMatch = (v.linkedSourceDocs || []).some(
        (d) =>
          allRefs.has(d.docRef.toUpperCase()) ||
          (po && d.docId.toUpperCase() === po.id.toUpperCase()) ||
          (so && d.docId.toUpperCase() === so.id.toUpperCase())
      );
      const allocPinvs = (v.invoiceAllocations || []).some((a) => allRefs.has(a.invoiceNo.toUpperCase()));
      const allocSinvs = (v.salesInvoiceAllocations || []).some((a) => allRefs.has(a.invoiceNo.toUpperCase()));
      return (
        allRefs.has(vRef) ||
        allRefs.has(bankRef) ||
        linkedSrcMatch ||
        allocPinvs ||
        allocSinvs
      );
    });

    linkedVouchers.forEach((v) => {
      allRefs.add(v.voucherRef.toUpperCase());
      if (v.postedVoucherNo) allRefs.add(v.postedVoucherNo.toUpperCase());
    });

    const linkedMovements = (state.inventoryMovements || []).filter(
      (m) => allRefs.has(m.sourceRef.toUpperCase())
    );

    const linkedSerials = state.inventorySerials.filter(
      (s) =>
        allRefs.has(s.batchOrLcRef.toUpperCase()) ||
        linkedDos.some((d) => d.allocatedSerials.includes(s.serialNumber))
    );

    const linkedGlLines = state.postedTransactions.filter(
      (t) =>
        allRefs.has(t.voucherNo.toUpperCase()) ||
        allRefs.has(t.reference.toUpperCase())
    );

    return {
      po,
      linkedGrns,
      linkedPinvs,
      so,
      linkedDos,
      linkedSinvs,
      linkedVouchers,
      linkedMovements,
      linkedSerials,
      linkedGlLines,
    };
  }, [state, target]);

  if (!target || !trace) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="sticky top-0 bg-white z-10 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-blue-50 text-[#2563EB] border border-blue-200">
                {target.docType}
              </span>
              <h2 className="text-base font-bold text-slate-900 font-mono">{target.docRef}</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              End-to-End ERP Traceability{target.title ? ` — ${target.title}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-xs">
          {/* Flow Chain Summary */}
          <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-700">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="w-3.5 h-3.5 text-[#2563EB]" /> Trace Graph:
            </span>
            {trace.po && (
              <>
                <span className="px-2 py-0.5 bg-white border border-slate-200 rounded font-mono">PO {trace.po.poNumber}</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
              </>
            )}
            {trace.so && (
              <>
                <span className="px-2 py-0.5 bg-white border border-slate-200 rounded font-mono">SO {trace.so.orderNo}</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
              </>
            )}
            <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">
              {trace.linkedGrns.length} GRN / {trace.linkedDos.length} Challan
            </span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
            <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">
              {trace.linkedPinvs.length + trace.linkedSinvs.length} Invoice(s)
            </span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded">
              {trace.linkedGlLines.length} GL Line(s)
            </span>
          </div>

          {/* Warehouse & Fulfillment */}
          {(trace.linkedGrns.length > 0 || trace.linkedDos.length > 0) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-slate-500" /> Warehouse Receipts &amp; Deliveries
              </h3>
              <div className="grid gap-2">
                {trace.linkedGrns.map((g) => (
                  <div key={g.id} className="p-2.5 border border-slate-200 rounded-md flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-slate-900">{g.grnNumber}</span>
                      <span className="text-slate-500 ml-2">{g.grnDate} · {g.warehouse}</span>
                    </div>
                    <div className="font-mono font-semibold text-emerald-700">{formatBDT(g.totalAmount)}</div>
                  </div>
                ))}
                {trace.linkedDos.map((d) => (
                  <div key={d.id} className="p-2.5 border border-slate-200 rounded-md flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-slate-900">{d.challanNo}</span>
                      <span className="text-slate-500 ml-2">{d.deliveryDate} · {d.warehouse}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{d.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invoices */}
          {(trace.linkedPinvs.length > 0 || trace.linkedSinvs.length > 0) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-slate-500" /> Linked Statutory Invoices (AP / AR)
              </h3>
              <div className="grid gap-2">
                {trace.linkedPinvs.map((pi) => (
                  <div key={pi.id} className="p-2.5 border border-slate-200 rounded-md flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-slate-900">{pi.invoiceNumber}</span>
                      <span className="text-slate-500 ml-2">Bill: {pi.supplierInvoiceNo} · {pi.status}</span>
                    </div>
                    <div className="text-right font-mono">
                      <div>Gross {formatBDT(pi.grossAmount)}</div>
                      <div className="text-[11px] text-amber-700">Due {formatBDT(pi.outstandingAmount)}</div>
                    </div>
                  </div>
                ))}
                {trace.linkedSinvs.map((si) => (
                  <div key={si.id} className="p-2.5 border border-slate-200 rounded-md flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-slate-900">{si.invoiceNumber}</span>
                      <span className="text-slate-500 ml-2">{si.customerName} · {si.status}</span>
                    </div>
                    <div className="text-right font-mono">
                      <div>Gross {formatBDT(si.grossAmount)}</div>
                      <div className="text-[11px] text-amber-700">Due {formatBDT(si.outstandingAmount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vouchers & Settlements */}
          {trace.linkedVouchers.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-800 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-500" /> Settlement Vouchers
              </h3>
              <div className="grid gap-2">
                {trace.linkedVouchers.map((v) => (
                  <div key={v.id} className="p-2.5 border border-slate-200 rounded-md flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-slate-900">{v.voucherRef}</span>
                      <span className="text-slate-500 ml-2">{v.voucherType} · {v.voucherDate} · {v.status}</span>
                    </div>
                    <span className="font-mono font-semibold text-slate-900">{formatBDT(v.totalAmount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stock Movements & Serials */}
          {(trace.linkedMovements.length > 0 || trace.linkedSerials.length > 0) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-slate-500" /> Stock Movements &amp; Serial Units
              </h3>
              {trace.linkedSerials.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {trace.linkedSerials.map((s) => (
                    <span key={s.id} className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 font-mono text-[11px]">
                      {s.serialNumber} ({s.status})
                    </span>
                  ))}
                </div>
              )}
              {trace.linkedMovements.map((m) => (
                <div key={m.id} className="p-2 border border-slate-200 rounded flex items-center justify-between text-[11px]">
                  <div>
                    <span className="font-mono font-semibold">{m.sku}</span> · {m.movementType} ({m.warehouse})
                  </div>
                  <span className={`font-mono font-bold ${m.qtyDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {m.qtyDelta >= 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* GL Postings */}
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Posted General Ledger Impact
            </h3>
            {trace.linkedGlLines.length === 0 ? (
              <p className="text-slate-400 italic">No General Ledger transactions linked to this reference yet.</p>
            ) : (
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-2.5 text-left">Voucher</th>
                      <th className="py-2 px-2.5 text-left">GL Account</th>
                      <th className="py-2 px-2.5 text-right">Debit</th>
                      <th className="py-2 px-2.5 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trace.linkedGlLines.map((gl) => (
                      <tr key={gl.transactionId}>
                        <td className="py-1.5 px-2.5 font-mono text-slate-700">{gl.voucherNo}</td>
                        <td className="py-1.5 px-2.5">
                          {onOpenRegister ? (
                            <button
                              onClick={() => onOpenRegister(gl.glCode)}
                              className="inline-flex items-center gap-1 font-mono text-[#2563EB] hover:underline cursor-pointer"
                            >
                              {gl.glCode} {gl.glName}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          ) : (
                            <span className="font-mono text-slate-800">{gl.glCode} {gl.glName}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{gl.debit > 0 ? formatBDT(gl.debit) : '—'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{gl.credit > 0 ? formatBDT(gl.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

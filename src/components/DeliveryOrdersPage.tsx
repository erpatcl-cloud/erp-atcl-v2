import React, { useMemo, useState } from 'react';
import { Ban, GitBranch, Plus, Truck, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  DocumentTraceabilityDrawer,
  type TraceDocTarget,
} from './common/DocumentTraceabilityDrawer.tsx';
import type { LedgerState } from '../types/accounting.ts';

interface DeliveryOrdersPageProps {
  state: LedgerState;
  onStateChange: (nextState: LedgerState) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const DeliveryOrdersPage: React.FC<DeliveryOrdersPageProps> = ({
  state,
  onStateChange,
  onNotify,
}) => {
  const deliveries = state.deliveryOrders || [];
  const [showModal, setShowModal] = useState(false);

  const [challanNo, setChallanNo] = useState(() => `DC-2026-${String(deliveries.length + 101).padStart(4, '0')}`);
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesOrderId, setSalesOrderId] = useState(state.salesOrders[0]?.id ?? '');
  const [warehouse, setWarehouse] = useState('Dhaka Central Warehouse');
  const [transporter, setTransporter] = useState('ATCL Fleet Logistics');
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [traceDoc, setTraceDoc] = useState<TraceDocTarget | null>(null);

  const eligibleSerials = useMemo(
    () =>
      (state.inventorySerials || []).filter(
        (u) =>
          (u.status === 'In Stock' || u.status === 'Reserved') &&
          u.warehouseLocation !== 'Chattogram Port Bonded'
      ),
    [state.inventorySerials]
  );

  const toggleSerial = (sn: string) => {
    setSelectedSerials((prev) => (prev.includes(sn) ? prev.filter((s) => s !== sn) : [...prev, sn]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const so = state.salesOrders.find((o) => o.id === salesOrderId);
    if (!so) {
      onNotify('error', 'Select a Sales Order to dispatch.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createDeliveryOrder({
        challanNo: challanNo.trim().toUpperCase(),
        deliveryDate,
        salesOrderId: so.id,
        salesOrderNo: so.orderNo,
        customerId: so.customerId,
        customerName: so.customerName,
        warehouse,
        transporter,
        lines: (so.lines || []).map((l) => ({
          description: l.description,
          sku: l.sku,
          orderedQty: l.qty,
          dispatchedQty: l.qty,
          unit: l.unit,
        })),
        allocatedSerials: selectedSerials,
        status: 'Delivered',
        notes,
      });
      onStateChange(res.state);
      onNotify('success', `Dispatched Challan ${res.deliveryOrder.challanNo} (${selectedSerials.length} serials).`);
      setShowModal(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to create delivery challan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const res = await api.cancelDeliveryOrder(id);
      onStateChange(res.state);
      onNotify('info', `Cancelled Challan ${res.deliveryOrder.challanNo} & restored serials to In Stock.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to cancel delivery.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Delivery Orders &amp; Challans</h1>
          <p className="text-xs text-slate-500">
            Partial/full dispatches with serialized equipment allocation (blocks Bonded, In Transit &amp; QC Hold units).
          </p>
        </div>
        <button
          onClick={() => {
            setChallanNo(`DC-2026-${String(deliveries.length + 101).padStart(4, '0')}`);
            setSelectedSerials([]);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-md cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Create Delivery Challan
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2.5 px-3 text-left">Challan No.</th>
              <th className="py-2.5 px-3 text-left">Sales Order &amp; Customer</th>
              <th className="py-2.5 px-3 text-left">Warehouse &amp; Transporter</th>
              <th className="py-2.5 px-3 text-left">Allocated Serials</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deliveries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  <Truck className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  No delivery challans dispatched yet.
                </td>
              </tr>
            ) : (
              deliveries.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                    <div>{d.challanNo}</div>
                    <div className="text-[11px] text-slate-400">{d.deliveryDate}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-mono text-slate-800">{d.salesOrderNo}</div>
                    <div className="text-[11px] text-slate-500">{d.customerName}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div>{d.warehouse}</div>
                    <div className="text-[11px] text-slate-400">{d.transporter}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                    {d.allocatedSerials.length > 0 ? d.allocatedSerials.join(', ') : 'Non-serialized'}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${d.status === 'Cancelled' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() =>
                        setTraceDoc({
                          docType: 'DO',
                          docRef: d.challanNo,
                          title: `${d.salesOrderNo} · ${d.customerName}`,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded cursor-pointer hover:bg-indigo-100"
                    >
                      <GitBranch className="w-3 h-3" /> Trace
                    </button>
                    {d.status !== 'Cancelled' && (
                      <button
                        onClick={() => handleCancel(d.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded cursor-pointer"
                      >
                        <Ban className="w-3 h-3" /> Cancel &amp; Reverse
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
          <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-base font-bold text-slate-900">Create Delivery Order / Challan</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Challan No. *</label>
                <input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono" required />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Delivery Date</label>
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Sales Order *</label>
              <select value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                {state.salesOrders.map((o) => (
                  <option key={o.id} value={o.id}>{o.orderNo} — {o.customerName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Dispatch Warehouse</label>
                <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white">
                  <option>Dhaka Central Warehouse</option>
                  <option>Gazipur Staging Yard</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Transporter / Courier</label>
                <input value={transporter} onChange={(e) => setTransporter(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Allocate Eligible In-Stock Serials ({eligibleSerials.length} available)
              </label>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded p-2 space-y-1 bg-slate-50">
                {eligibleSerials.length === 0 ? (
                  <p className="text-slate-400">No eligible In-Stock serials available.</p>
                ) : (
                  eligibleSerials.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSerials.includes(u.serialNumber)}
                        onChange={() => toggleSerial(u.serialNumber)}
                        className="rounded border-slate-300"
                      />
                      <span className="font-mono font-semibold text-slate-800">{u.serialNumber}</span>
                      <span className="text-slate-500">— {u.productName} ({u.warehouseLocation})</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Delivery / Receiver Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 border border-slate-200 rounded cursor-pointer">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[#2563EB] text-white font-semibold rounded cursor-pointer">
                {submitting ? 'Dispatching...' : 'Dispatch Challan'}
              </button>
            </div>
          </form>
        </div>
      )}

      <DocumentTraceabilityDrawer
        state={state}
        target={traceDoc}
        onClose={() => setTraceDoc(null)}
      />
    </div>
  );
};

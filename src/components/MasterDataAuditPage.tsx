import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ShieldCheck } from 'lucide-react';
import {
  computeCustomerLiveAR,
  computeGLSummary,
  computeSupplierLiveAP,
  exportRowsToCSV,
  formatBDT,
  round2,
} from '../engine/accountingEngine.ts';
import { validateGlCategory } from '../lib/masterDataService.ts';
import type { LedgerState } from '../types/accounting.ts';

interface MasterDataAuditPageProps {
  state: LedgerState;
}

type AuditTab = 'products' | 'customers' | 'suppliers';

export const MasterDataAuditPage: React.FC<MasterDataAuditPageProps> = ({ state }) => {
  const [tab, setTab] = useState<AuditTab>('products');

  const glByCode = useMemo(() => {
    const summary = computeGLSummary(state);
    return new Map(summary.map((r) => [r.code, r.closingBalance]));
  }, [state]);

  const productAudit = useMemo(() => {
    const reorderAlerts = state.products.filter(
      (p) => p.status === 'Active' && p.itemType === 'Inventory' && p.stockQty <= p.reorderLevel
    );
    const inactiveWithStock = state.products.filter(
      (p) => p.status !== 'Active' && p.stockQty > 0
    );
    const invalidGlMappings = state.products.filter((p) => {
      const inv = validateGlCategory(state.accounts, p.inventoryGlCode, ['Asset']);
      const rev = validateGlCategory(state.accounts, p.revenueGlCode, ['Income']);
      const cogs = validateGlCategory(state.accounts, p.cogsGlCode, ['Expense']);
      return !inv.valid || !rev.valid || !cogs.valid;
    });
    const totalValuation = round2(
      state.products
        .filter((p) => p.itemType === 'Inventory')
        .reduce((s, p) => s + p.stockQty * p.unitCost, 0)
    );
    return { reorderAlerts, inactiveWithStock, invalidGlMappings, totalValuation };
  }, [state.products, state.accounts]);

  const customerAudit = useMemo(() => {
    const rows = state.customers.map((c) => {
      const ar = computeCustomerLiveAR(state, c.id);
      const overLimit = c.creditLimit > 0 && ar.outstanding > c.creditLimit;
      const onHoldWithAr = c.status !== 'Active' && ar.outstanding > 0.01;
      return { customer: c, ar, overLimit, onHoldWithAr };
    });
    const totalSubledgerAr = round2(rows.reduce((s, r) => s + r.ar.outstanding, 0));
    const overLimitCount = rows.filter((r) => r.overLimit).length;
    const onHoldWithArCount = rows.filter((r) => r.onHoldWithAr).length;
    return { rows, totalSubledgerAr, overLimitCount, onHoldWithArCount };
  }, [state]);

  const supplierAudit = useMemo(() => {
    const rows = state.suppliers.map((s) => {
      const ap = computeSupplierLiveAP(state, s.id);
      const missingCompliance = !s.taxNo?.trim() || !s.binNumber?.trim() || !s.bankName?.trim();
      return { supplier: s, ap, missingCompliance };
    });
    const totalSubledgerAp = round2(rows.reduce((s, r) => s + r.ap.outstanding, 0));
    const nonCompliantCount = rows.filter((r) => r.missingCompliance).length;
    return { rows, totalSubledgerAp, nonCompliantCount };
  }, [state]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#2563EB]" />
            Master Data Audit &amp; Exception Reports
          </h1>
          <p className="text-xs text-slate-500">
            Verify GL mappings, reorder alerts, inactive stock, credit exposure, supplier compliance, and subledger-to-GL reconciliation.
          </p>
        </div>
        <button
          onClick={() =>
            exportRowsToCSV(
              'ATCL_Master_Data_Audit.csv',
              ['Domain', 'Code / SKU', 'Name', 'Status', 'Metric / Finding'],
              [
                ...productAudit.reorderAlerts.map((p) => [
                  'Product Reorder Alert',
                  p.sku,
                  p.name,
                  p.status,
                  `Stock ${p.stockQty} <= Reorder ${p.reorderLevel}`,
                ]),
                ...productAudit.inactiveWithStock.map((p) => [
                  'Inactive Product w/ Stock',
                  p.sku,
                  p.name,
                  p.status,
                  `Stock ${p.stockQty}`,
                ]),
                ...customerAudit.rows
                  .filter((r) => r.overLimit || r.onHoldWithAr)
                  .map((r) => [
                    'Customer Credit Exception',
                    r.customer.code,
                    r.customer.name,
                    r.customer.status,
                    `AR ${r.ar.outstanding} / Limit ${r.customer.creditLimit}`,
                  ]),
              ]
            )
          }
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" /> Export Exceptions CSV
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Catalog Valuation / GL 1110</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">
            {formatBDT(productAudit.totalValuation)} / {formatBDT(glByCode.get('1110') ?? 0)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Product Exceptions</div>
          <div className="mt-1 text-sm font-bold font-mono text-amber-700">
            {productAudit.reorderAlerts.length} Reorder · {productAudit.invalidGlMappings.length} GL Err
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Customer AR / GL 1120</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">
            {formatBDT(customerAudit.totalSubledgerAr)} / {formatBDT(glByCode.get('1120') ?? 0)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-slate-500">Supplier AP / GL 2080</div>
          <div className="mt-1 text-sm font-bold font-mono text-slate-900">
            {formatBDT(supplierAudit.totalSubledgerAp)} / {formatBDT(glByCode.get('2080') ?? 0)}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        {[
          { id: 'products', label: `Products (${state.products.length})` },
          { id: 'customers', label: `Customers (${state.customers.length})` },
          { id: 'suppliers', label: `Suppliers (${state.suppliers.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as AuditTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
              tab === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">SKU</th>
                <th className="py-2.5 px-3 text-left">Product Name</th>
                <th className="py-2.5 px-3 text-right">Stock / Reorder</th>
                <th className="py-2.5 px-3 text-left">GL Mapping (Inv / Rev / COGS)</th>
                <th className="py-2.5 px-3 text-left">Audit Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.products.map((p) => {
                const isLow = p.status === 'Active' && p.itemType === 'Inventory' && p.stockQty <= p.reorderLevel;
                const isInactiveStock = p.status !== 'Active' && p.stockQty > 0;
                const invOk = validateGlCategory(state.accounts, p.inventoryGlCode, ['Asset']).valid;
                const revOk = validateGlCategory(state.accounts, p.revenueGlCode, ['Income']).valid;
                const cogsOk = validateGlCategory(state.accounts, p.cogsGlCode, ['Expense']).valid;
                const glOk = invOk && revOk && cogsOk;
                return (
                  <tr key={p.id}>
                    <td className="py-2 px-3 font-mono font-semibold">{p.sku}</td>
                    <td className="py-2 px-3">{p.name}</td>
                    <td className="py-2 px-3 text-right font-mono">{p.stockQty} / {p.reorderLevel}</td>
                    <td className="py-2 px-3 font-mono">{p.inventoryGlCode} / {p.revenueGlCode} / {p.cogsGlCode}</td>
                    <td className="py-2 px-3">
                      {!glOk ? (
                        <span className="inline-flex items-center gap-1 text-red-700 font-medium"><AlertTriangle className="w-3 h-3" /> Invalid GL</span>
                      ) : isInactiveStock ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium"><AlertTriangle className="w-3 h-3" /> Inactive w/ Stock</span>
                      ) : isLow ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium"><AlertTriangle className="w-3 h-3" /> Reorder Alert</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium"><CheckCircle2 className="w-3 h-3" /> Healthy</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'customers' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Code</th>
                <th className="py-2.5 px-3 text-left">Customer</th>
                <th className="py-2.5 px-3 text-right">Live AR (1120)</th>
                <th className="py-2.5 px-3 text-right">Credit Limit</th>
                <th className="py-2.5 px-3 text-left">Credit / Status Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customerAudit.rows.map(({ customer, ar, overLimit, onHoldWithAr }) => (
                <tr key={customer.id}>
                  <td className="py-2 px-3 font-mono font-semibold">{customer.code}</td>
                  <td className="py-2 px-3">{customer.name}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(ar.outstanding)}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(customer.creditLimit)}</td>
                  <td className="py-2 px-3">
                    {overLimit ? (
                      <span className="text-red-700 font-medium">Over Credit Limit</span>
                    ) : onHoldWithAr ? (
                      <span className="text-amber-700 font-medium">{customer.status} w/ Open AR</span>
                    ) : (
                      <span className="text-emerald-700 font-medium">Within Limit ({customer.status})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-left">Code</th>
                <th className="py-2.5 px-3 text-left">Supplier</th>
                <th className="py-2.5 px-3 text-right">Live AP (2080)</th>
                <th className="py-2.5 px-3 text-left">Bank / Tax Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplierAudit.rows.map(({ supplier, ap, missingCompliance }) => (
                <tr key={supplier.id}>
                  <td className="py-2 px-3 font-mono font-semibold">{supplier.code}</td>
                  <td className="py-2 px-3">{supplier.name}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatBDT(ap.outstanding)}</td>
                  <td className="py-2 px-3">
                    {missingCompliance ? (
                      <span className="text-amber-700 font-medium">Missing TIN / BIN / Bank</span>
                    ) : (
                      <span className="text-emerald-700 font-medium">Compliant ({supplier.bankName})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

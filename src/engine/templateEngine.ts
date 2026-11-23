import {
  computeBalanceSheet,
  computeFinancialRatios,
  computeIncomeStatement,
  formatBDT,
  formatCompactBDT,
} from './accountingEngine.ts';
import type {
  DocumentTemplateRecord,
  LedgerState,
  TemplateDataSource,
} from '../types/accounting.ts';

export interface TemplateTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  mono?: boolean;
}

export interface TemplateTableRow {
  [key: string]: string;
}

export interface ResolvedTemplateContext {
  tokens: Record<string, string>;
  metadata: Array<{ label: string; value: string }>;
  columns: TemplateTableColumn[];
  rows: TemplateTableRow[];
  summaryLines: Array<{ label: string; value: string; bold?: boolean }>;
  recordOptions: Array<{ id: string; label: string }>;
  activeRecordId: string;
}

export function buildTemplateTokenContext(
  state: LedgerState,
  dataSource: TemplateDataSource,
  requestedRecordId?: string
): ResolvedTemplateContext {
  const bs = computeBalanceSheet(state);
  const is = computeIncomeStatement(state);
  const ratios = computeFinancialRatios(state);

  const baseTokens: Record<string, string> = {
    'org.name': state.config.organizationName,
    'org.fiscalPeriod': state.config.fiscalPeriod,
    'org.currency': `${state.config.currencyCode} (${state.config.currencySymbol})`,
    'org.operator': state.config.operatorEmail,
    'bs.totalAssets': formatBDT(bs.totalAssets),
    'bs.totalAssetsCompact': formatCompactBDT(bs.totalAssets),
    'bs.totalLiabilities': formatBDT(bs.totalLiabilities),
    'bs.totalEquity': formatBDT(bs.totalEquity),
    'is.revenue': formatBDT(is.totalIncome),
    'is.grossProfit': formatBDT(is.grossProfit),
    'is.operatingProfit': formatBDT(is.operatingProfit),
    'is.netProfit': formatBDT(is.netProfit),
    'kpi.currentRatio': `${ratios.current.currentRatio.toFixed(2)}x`,
    'kpi.quickRatio': `${ratios.current.quickRatio.toFixed(2)}x`,
    'kpi.cashRatio': `${ratios.current.cashRatio.toFixed(2)}x`,
    'kpi.netProfitMargin': `${ratios.current.netProfitMarginPct.toFixed(2)}%`,
    'kpi.grossMargin': `${ratios.current.grossMarginPct.toFixed(2)}%`,
    'kpi.roe': `${ratios.current.returnOnEquityPct.toFixed(2)}%`,
    'kpi.roa': `${ratios.current.returnOnAssetsPct.toFixed(2)}%`,
    'kpi.debtToEquity': `${ratios.current.debtToEquity.toFixed(2)}x`,
    'record.ref': `FY-${state.config.fiscalPeriod}`,
    'record.type': 'Statutory Statement',
    'record.date': new Date().toISOString().slice(0, 10),
    'record.party': state.config.organizationName,
    'record.amount': formatBDT(is.netProfit),
    'record.secondaryAmount': formatBDT(bs.totalAssets),
    'record.status': bs.isBalanced ? 'Balanced (IFRS)' : 'Review Required',
    'record.summary': `Reconciled across ${state.accounts.length} active General Ledger accounts.`,
  };

  if (dataSource === 'voucher' && state.vouchers.length > 0) {
    const recordOptions = state.vouchers.map((v) => ({
      id: v.id,
      label: `${v.voucherRef} · ${v.voucherType} (${formatCompactBDT(v.totalAmount)})`,
    }));
    const v = state.vouchers.find((x) => x.id === requestedRecordId) || state.vouchers[0];

    const party = v.supplierName || v.customerName || v.employeeName || 'Internal Ledger Adjustment';
    const tokens: Record<string, string> = {
      ...baseTokens,
      'record.ref': v.voucherRef,
      'record.type': v.voucherType,
      'record.date': v.voucherDate,
      'record.party': party,
      'record.amount': formatBDT(v.totalAmount),
      'record.secondaryAmount': formatBDT(v.netPayableAmount ?? v.collectionAmount ?? v.totalAmount),
      'record.status': v.postedToGl ? 'Posted to GL' : v.status,
      'record.summary': v.narration,
    };

    const metadata = [
      { label: 'Voucher Ref', value: v.voucherRef },
      { label: 'Voucher Date', value: v.voucherDate },
      { label: 'Posting Date', value: v.postingDate },
      { label: 'Counterparty', value: party },
      { label: 'Mode / Ref', value: v.paymentMode || v.receiptMode || v.postingType || 'Standard' },
      { label: 'Status', value: v.postedToGl ? 'Posted to GL' : v.status },
    ];

    const columns: TemplateTableColumn[] = [
      { key: 'glCode', label: 'GL Code', mono: true },
      { key: 'glName', label: 'Account Head' },
      { key: 'memo', label: 'Particulars' },
      { key: 'debit', label: 'Debit (BDT)', align: 'right', mono: true },
      { key: 'credit', label: 'Credit (BDT)', align: 'right', mono: true },
    ];

    const rows: TemplateTableRow[] = v.doubleEntryLines.map((l) => ({
      glCode: l.glCode,
      glName: l.glName,
      memo: l.memo || v.narration,
      debit: l.debit > 0 ? formatBDT(l.debit) : '—',
      credit: l.credit > 0 ? formatBDT(l.credit) : '—',
    }));

    const summaryLines: Array<{ label: string; value: string; bold?: boolean }> = [];
    if (v.voucherType === 'Payment') {
      summaryLines.push({ label: 'Base Payable Amount', value: formatBDT(v.baseAmount || v.totalAmount) });
      if ((v.tdsAmount || 0) > 0) {
        summaryLines.push({ label: `Less: TDS (${v.tdsRate || 0}%)`, value: `(${formatBDT(v.tdsAmount || 0)})` });
      }
      if ((v.vdsAmount || 0) > 0) {
        summaryLines.push({ label: `Less: VDS (${v.vdsRate || 0}%)`, value: `(${formatBDT(v.vdsAmount || 0)})` });
      }
      summaryLines.push({ label: 'Net Disbursed Amount', value: formatBDT(v.netPayableAmount || v.totalAmount), bold: true });
    } else {
      summaryLines.push({ label: 'Total Balanced Dr / Cr', value: formatBDT(v.totalAmount), bold: true });
    }

    return {
      tokens,
      metadata,
      columns,
      rows,
      summaryLines,
      recordOptions,
      activeRecordId: v.id,
    };
  }

  if (dataSource === 'salesOrder' && state.salesOrders.length > 0) {
    const recordOptions = state.salesOrders.map((o) => ({
      id: o.id,
      label: `${o.orderNo} · ${o.customerName} (${formatCompactBDT(o.grossAmount)})`,
    }));
    const so = state.salesOrders.find((x) => x.id === requestedRecordId) || state.salesOrders[0];
    const outstanding = Math.max(0, so.grossAmount - so.collectedAmount);

    const tokens: Record<string, string> = {
      ...baseTokens,
      'record.ref': so.orderNo,
      'record.type': 'Sales Invoice',
      'record.date': so.orderDate,
      'record.party': so.customerName,
      'record.amount': formatBDT(so.grossAmount),
      'record.secondaryAmount': formatBDT(so.collectedAmount),
      'record.status': so.status,
      'record.summary': so.description,
    };

    const metadata = [
      { label: 'Order / Invoice No', value: so.orderNo },
      { label: 'Order Date', value: so.orderDate },
      { label: 'Delivery Date', value: so.deliveryDate },
      { label: 'Customer', value: so.customerName },
      { label: 'Channel', value: so.channel },
      { label: 'Challan No', value: so.challanNo || 'Pending Dispatch' },
    ];

    const columns: TemplateTableColumn[] = [
      { key: 'desc', label: 'Deliverable / Scope' },
      { key: 'gl', label: 'Revenue GL', mono: true },
      { key: 'net', label: 'Net Value', align: 'right', mono: true },
      { key: 'vat', label: `VAT (${so.vatRate}%)`, align: 'right', mono: true },
      { key: 'gross', label: 'Gross Total', align: 'right', mono: true },
    ];

    const rows: TemplateTableRow[] = [
      {
        desc: so.description,
        gl: so.revenueGlCode,
        net: formatBDT(so.netAmount),
        vat: formatBDT(so.vatAmount),
        gross: formatBDT(so.grossAmount),
      },
    ];

    const summaryLines = [
      { label: 'Subtotal (Excl. VAT)', value: formatBDT(so.netAmount) },
      { label: `Statutory VAT (${so.vatRate}%)`, value: formatBDT(so.vatAmount) },
      { label: 'Gross Invoice Payable', value: formatBDT(so.grossAmount), bold: true },
      { label: 'Collected to Date', value: formatBDT(so.collectedAmount) },
      { label: 'Balance Receivable', value: formatBDT(outstanding), bold: true },
    ];

    return {
      tokens,
      metadata,
      columns,
      rows,
      summaryLines,
      recordOptions,
      activeRecordId: so.id,
    };
  }

  if (dataSource === 'importLC' && state.importLCs.length > 0) {
    const recordOptions = state.importLCs.map((l) => ({
      id: l.id,
      label: `${l.lcNumber} · ${l.supplierName} (${formatCompactBDT(l.totalLandedCostBdt)})`,
    }));
    const lc = state.importLCs.find((x) => x.id === requestedRecordId) || state.importLCs[0];

    const tokens: Record<string, string> = {
      ...baseTokens,
      'record.ref': lc.lcNumber,
      'record.type': lc.lcType,
      'record.date': lc.openDate,
      'record.party': lc.supplierName,
      'record.amount': formatBDT(lc.totalLandedCostBdt),
      'record.secondaryAmount': formatBDT(lc.marginDepositBdt),
      'record.status': lc.status,
      'record.summary': lc.goodsDescription,
    };

    const metadata = [
      { label: 'LC Number', value: lc.lcNumber },
      { label: 'Issuing Bank', value: lc.issuingBank },
      { label: 'Supplier / Origin', value: `${lc.supplierName} (${lc.originCountry})` },
      { label: 'FX Value', value: `${lc.currency} ${lc.foreignAmount.toLocaleString()} @ ${lc.exchangeRate}` },
      { label: 'Port of Discharge', value: lc.portOfDischarge },
      { label: 'Bill of Entry', value: lc.billOfEntryNo || 'In Transit' },
    ];

    const columns: TemplateTableColumn[] = [
      { key: 'component', label: 'Landed Cost Component' },
      { key: 'gl', label: 'Linked GL', mono: true },
      { key: 'amount', label: 'Amount (BDT)', align: 'right', mono: true },
    ];

    const rows: TemplateTableRow[] = [
      { component: `LC CIF Value (${lc.currency} ${lc.foreignAmount.toLocaleString()})`, gl: lc.loanGlCode, amount: formatBDT(lc.bdtValue) },
      { component: `Customs Duty & C&F (${lc.cnfAgent})`, gl: '5030', amount: formatBDT(lc.customsDutyAndCnfBdt) },
      { component: `Issuing Bank Charges & Commission (${lc.issuingBank})`, gl: '5420', amount: formatBDT(lc.bankChargesBdt) },
    ];

    const summaryLines = [
      { label: `Cash Margin Deposit (${lc.marginPct}%)`, value: formatBDT(lc.marginDepositBdt) },
      { label: 'Total Landed Cost (BDT)', value: formatBDT(lc.totalLandedCostBdt), bold: true },
    ];

    return {
      tokens,
      metadata,
      columns,
      rows,
      summaryLines,
      recordOptions,
      activeRecordId: lc.id,
    };
  }

  // Default: Financial Summary / Custom bound to live IFRS statements
  const metadata = [
    { label: 'Entity', value: state.config.organizationName },
    { label: 'Fiscal Period', value: state.config.fiscalPeriod },
    { label: 'Currency', value: `${state.config.currencyCode} (${state.config.currencySymbol})` },
    { label: 'Active GL Accounts', value: `${state.accounts.length} Reconciled` },
    { label: 'Current Ratio', value: `${ratios.current.currentRatio.toFixed(2)}x` },
    { label: 'Quick Ratio', value: `${ratios.current.quickRatio.toFixed(2)}x` },
  ];

  const columns: TemplateTableColumn[] = [
    { key: 'line', label: 'IFRS Statement Line' },
    { key: 'fy25', label: 'FY 2024–25 (BDT)', align: 'right', mono: true },
    { key: 'fy24', label: 'FY 2023–24 (BDT)', align: 'right', mono: true },
  ];

  const rows: TemplateTableRow[] = [
    { line: 'Sales Revenue (Gross)', fy25: formatBDT(is.totalIncome), fy24: formatBDT(is.priorYear.totalIncome) },
    { line: 'Gross Profit', fy25: formatBDT(is.grossProfit), fy24: formatBDT(is.priorYear.grossProfit) },
    { line: 'Operating Profit (EBIT)', fy25: formatBDT(is.operatingProfit), fy24: formatBDT(is.priorYear.operatingProfit) },
    { line: 'Net Profit After Tax', fy25: formatBDT(is.netProfit), fy24: formatBDT(is.priorYear.netProfit) },
    { line: 'Total Assets', fy25: formatBDT(bs.totalAssets), fy24: formatBDT(bs.priorYear.totalAssets) },
    { line: 'Total Equity (Incl. Profit)', fy25: formatBDT(bs.totalEquity), fy24: formatBDT(bs.priorYear.totalEquity) },
    { line: 'Total Liabilities', fy25: formatBDT(bs.totalLiabilities), fy24: formatBDT(bs.priorYear.totalLiabilities) },
  ];

  const summaryLines = [
    { label: 'Net Profit Margin', value: `${ratios.current.netProfitMarginPct.toFixed(2)}%`, bold: true },
    { label: 'Return on Equity (ROE)', value: `${ratios.current.returnOnEquityPct.toFixed(2)}%`, bold: true },
  ];

  return {
    tokens: baseTokens,
    metadata,
    columns,
    rows,
    summaryLines,
    recordOptions: [{ id: 'fy-current', label: `FY ${state.config.fiscalPeriod} Statutory IFRS Summary` }],
    activeRecordId: 'fy-current',
  };
}

export function interpolateTemplateText(input: string, tokens: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
    return key in tokens ? tokens[key] : `{{${key}}}`;
  });
}

/**
 * Strips executable script tags, embedded active objects, and inline event handlers
 * so pasted HTML from external pages previews safely inside a sandboxed iframe.
 */
export function sanitizeImportedHtml(rawHtml: string): string {
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildStandaloneHtmlDocument(
  template: DocumentTemplateRecord,
  state: LedgerState,
  selectedRecordId?: string
): string {
  const ctx = buildTemplateTokenContext(state, template.dataSource, selectedRecordId);

  if (template.mode === 'html') {
    const safeBody = interpolateTemplateText(sanitizeImportedHtml(template.htmlContent), ctx.tokens);
    const safeCss = template.cssContent.replace(/<\/style/gi, '');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(template.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #ffffff; color: #0f172a; font-family: 'Public Sans', system-ui, sans-serif; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    ${safeCss}
  </style>
</head>
<body>${safeBody}</body>
</html>`;
  }

  const title = interpolateTemplateText(template.sections.headerTitle, ctx.tokens);
  const subtitle = interpolateTemplateText(template.sections.headerSubtitle, ctx.tokens);
  const footer = interpolateTemplateText(template.sections.footerNote, ctx.tokens);

  const metaHtml = template.sections.showMetadataStrip
    ? `<div class="meta-grid">${ctx.metadata
        .map(
          (m) =>
            `<div class="meta-item"><div class="meta-label">${escapeHtml(m.label)}</div><div class="meta-val">${escapeHtml(m.value)}</div></div>`
        )
        .join('')}</div>`
    : '';

  const kpiHtml =
    template.sections.showKpiStrip && template.sections.kpiSlots.length > 0
      ? `<div class="kpi-grid">${template.sections.kpiSlots
          .map(
            (slot) =>
              `<div class="kpi-item"><div class="kpi-label">${escapeHtml(slot.label)}</div><div class="kpi-val">${escapeHtml(
                interpolateTemplateText(slot.token, ctx.tokens)
              )}</div></div>`
          )
          .join('')}</div>`
      : '';

  const tableHtml = template.sections.showLineItemsTable
    ? `<table>
        <thead><tr>${ctx.columns
          .map((c) => `<th class="${c.align === 'right' ? 'right' : ''}">${escapeHtml(c.label)}</th>`)
          .join('')}</tr></thead>
        <tbody>${ctx.rows
          .map(
            (r) =>
              `<tr>${ctx.columns
                .map(
                  (c) =>
                    `<td class="${c.align === 'right' ? 'right' : ''} ${c.mono ? 'mono' : ''}">${escapeHtml(
                      r[c.key] ?? ''
                    )}</td>`
                )
                .join('')}</tr>`
          )
          .join('')}</tbody>
      </table>
      <div class="summary-wrap">${ctx.summaryLines
        .map(
          (s) =>
            `<div class="summary-line ${s.bold ? 'bold' : ''}"><span>${escapeHtml(s.label)}</span><span class="mono">${escapeHtml(
              s.value
            )}</span></div>`
        )
        .join('')}</div>`
    : '';

  const sigHtml =
    template.sections.showSignatoryBlock && template.sections.signatories.length > 0
      ? `<div class="sig-grid">${template.sections.signatories
          .map((s) => `<div class="sig-box"><div class="sig-line"></div><div class="sig-label">${escapeHtml(s)}</div></div>`)
          .join('')}</div>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} — ${escapeHtml(template.code)}</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700&family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; font-family: 'Public Sans', system-ui, sans-serif; color: #0f172a; background: #ffffff; }
    .sheet { max-width: ${template.paperSize === 'A4' ? '794px' : '1040px'}; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${escapeHtml(
      template.accentColor
    )}; padding-bottom: 16px; }
    .eyebrow { font-size: 11px; font-weight: 600; color: ${escapeHtml(template.accentColor)}; }
    h1 { margin: 4px 0 0; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 22px; font-weight: 700; }
    .ref-box { text-align: right; }
    .ref-label { font-size: 11px; color: #64748b; }
    .ref-val { font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 2px; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 18px; margin-top: 18px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
    .meta-label { font-size: 10px; color: #64748b; }
    .meta-val { font-size: 12px; font-weight: 600; color: #0f172a; margin-top: 2px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
    .kpi-item { border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
    .kpi-label { font-size: 11px; color: #64748b; }
    .kpi-val { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; font-weight: 600; color: #475569; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .right { text-align: right; }
    .mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
    .summary-wrap { margin-top: 14px; margin-left: auto; max-width: 320px; }
    .summary-line { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #475569; }
    .summary-line.bold { font-weight: 700; color: #0f172a; border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 4px; }
    .sig-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 48px; }
    .sig-line { border-top: 1px solid #94a3b8; margin-bottom: 6px; }
    .sig-label { font-size: 11px; color: #475569; text-align: center; }
    .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }
    @media print { body { padding: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="eyebrow">${escapeHtml(subtitle)}</div>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="ref-box">
        <div class="ref-label">${escapeHtml(template.sections.referenceLabel)}</div>
        <div class="ref-val">${escapeHtml(ctx.tokens['record.ref'])}</div>
      </div>
    </div>
    ${metaHtml}
    ${kpiHtml}
    ${tableHtml}
    ${sigHtml}
    <div class="footer">${escapeHtml(footer)}</div>
  </div>
</body>
</html>`;
}

export const MERGE_TOKEN_REFERENCE: Array<{ token: string; label: string; group: string }> = [
  { token: '{{org.name}}', label: 'Organization Name', group: 'Organization' },
  { token: '{{org.fiscalPeriod}}', label: 'Fiscal Period', group: 'Organization' },
  { token: '{{org.currency}}', label: 'Currency Code', group: 'Organization' },
  { token: '{{record.ref}}', label: 'Active Record Ref', group: 'Active Record' },
  { token: '{{record.date}}', label: 'Active Record Date', group: 'Active Record' },
  { token: '{{record.party}}', label: 'Counterparty / Entity', group: 'Active Record' },
  { token: '{{record.amount}}', label: 'Primary Amount', group: 'Active Record' },
  { token: '{{record.status}}', label: 'Record Status', group: 'Active Record' },
  { token: '{{is.revenue}}', label: 'Gross Revenue', group: 'IFRS Financials' },
  { token: '{{is.netProfit}}', label: 'Net Profit After Tax', group: 'IFRS Financials' },
  { token: '{{bs.totalAssets}}', label: 'Total Assets', group: 'IFRS Financials' },
  { token: '{{bs.totalEquity}}', label: 'Total Equity', group: 'IFRS Financials' },
  { token: '{{kpi.currentRatio}}', label: 'Current Ratio', group: 'Financial KPIs' },
  { token: '{{kpi.quickRatio}}', label: 'Quick Ratio', group: 'Financial KPIs' },
  { token: '{{kpi.netProfitMargin}}', label: 'Net Profit Margin', group: 'Financial KPIs' },
  { token: '{{kpi.roe}}', label: 'Return on Equity', group: 'Financial KPIs' },
];

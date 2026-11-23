import type { DocumentTemplateRecord } from '../types/accounting.ts';

export function buildInitialTemplates(): DocumentTemplateRecord[] {
  const now = '2025-06-30T18:00:00.000Z';

  return [
    {
      id: 'TPL-001',
      code: 'TPL-VCH-01',
      name: 'ATCL Statutory Voucher Print Sheet',
      description:
        'A4 double-entry voucher layout bound to Payment, Receipt, Journal, and Expense vouchers with TDS/VDS breakdown and 3-tier authorization.',
      category: 'Voucher',
      mode: 'structured',
      dataSource: 'voucher',
      paperSize: 'A4',
      accentColor: '#1F4E79',
      status: 'Published',
      isDefault: true,
      sourceOrigin: 'Built-in ATCL Standard',
      sections: {
        headerTitle: '{{record.type}} Voucher',
        headerSubtitle: '{{org.name}} · Fiscal Period {{org.fiscalPeriod}}',
        referenceLabel: 'Voucher Ref',
        showMetadataStrip: true,
        showKpiStrip: true,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Voucher Total', token: '{{record.amount}}' },
          { label: 'Counterparty', token: '{{record.party}}' },
          { label: 'GL Posting Status', token: '{{record.status}}' },
        ],
        signatories: ['Prepared By (Accounts Officer)', 'Checked By (Finance Controller)', 'Approved By (Managing Director)'],
        footerNote:
          'System-generated statutory voucher synced with ATCL Master General Ledger. All Debit and Credit lines are verified balanced prior to posting.',
      },
      htmlContent: '',
      cssContent: '',
      updatedAt: now,
    },
    {
      id: 'TPL-002',
      code: 'TPL-INV-01',
      name: 'Commercial Sales Invoice & VAT Summary',
      description:
        'Customer billing template connected to live Sales & Distribution orders with VAT calculation, challan reference, and collection tracking.',
      category: 'Commercial & LC',
      mode: 'structured',
      dataSource: 'salesOrder',
      paperSize: 'A4',
      accentColor: '#1F4E79',
      status: 'Published',
      isDefault: true,
      sourceOrigin: 'Built-in ATCL Standard',
      sections: {
        headerTitle: 'Commercial Tax Invoice',
        headerSubtitle: '{{org.name}} · Sales & Distribution Division',
        referenceLabel: 'Sales Order No',
        showMetadataStrip: true,
        showKpiStrip: true,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Gross Invoice Value', token: '{{record.amount}}' },
          { label: 'Collected to Date', token: '{{record.secondaryAmount}}' },
          { label: 'Order Status', token: '{{record.status}}' },
        ],
        signatories: ['Sales Operations', 'Accounts Receivable', 'Customer Acknowledgment'],
        footerNote:
          'Remit payments to ATCL designated corporate bank accounts referencing the Sales Order & Challan number. Subject to Bangladesh VAT Act compliance.',
      },
      htmlContent: '',
      cssContent: '',
      updatedAt: now,
    },
    {
      id: 'TPL-003',
      code: 'TPL-FIN-01',
      name: 'Executive IFRS Financial Brief',
      description:
        'Board-ready one-page summary pulling live Revenue, Net Profit, Balance Sheet position, Current Ratio, Quick Ratio, and ROE directly from the General Ledger.',
      category: 'Financial Report',
      mode: 'structured',
      dataSource: 'financialSummary',
      paperSize: 'Responsive',
      accentColor: '#0F766E',
      status: 'Published',
      isDefault: true,
      sourceOrigin: 'Built-in ATCL Standard',
      sections: {
        headerTitle: 'IFRS Executive Financial Summary',
        headerSubtitle: '{{org.name}} · Statutory Period {{org.fiscalPeriod}}',
        referenceLabel: 'Statement Basis',
        showMetadataStrip: true,
        showKpiStrip: true,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Total Assets', token: '{{bs.totalAssets}}' },
          { label: 'Net Profit After Tax', token: '{{is.netProfit}}' },
          { label: 'Current / Quick Ratio', token: '{{kpi.currentRatio}} / {{kpi.quickRatio}}' },
        ],
        signatories: ['Chief Financial Officer', 'Managing Director', 'External Statutory Auditor'],
        footerNote:
          'Prepared in accordance with International Financial Reporting Standards (IFRS) directly from reconciled ATCL General Ledger Account Registers.',
      },
      htmlContent: '',
      cssContent: '',
      updatedAt: now,
    },
    {
      id: 'TPL-004',
      code: 'TPL-LC-01',
      name: 'Import LC & Landed Cost Cover Sheet',
      description:
        'Trade finance cover template linked to live Import LC files showing foreign currency value, FX conversion, margin deposit, customs, and total landed cost.',
      category: 'Commercial & LC',
      mode: 'structured',
      dataSource: 'importLC',
      paperSize: 'A4',
      accentColor: '#1F4E79',
      status: 'Published',
      isDefault: false,
      sourceOrigin: 'Built-in ATCL Standard',
      sections: {
        headerTitle: 'Import Letter of Credit Dossier',
        headerSubtitle: '{{org.name}} · Trade Finance & Supply Chain',
        referenceLabel: 'LC Number',
        showMetadataStrip: true,
        showKpiStrip: true,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Total Landed Cost', token: '{{record.amount}}' },
          { label: 'Margin Deposit', token: '{{record.secondaryAmount}}' },
          { label: 'Clearance Stage', token: '{{record.status}}' },
        ],
        signatories: ['Import & LC Officer', 'C&F Logistics Lead', 'Treasury Head'],
        footerNote:
          'Bank charges reconcile to GL 5420 and Customs/C&F charges reconcile to GL 5030. Attach Bill of Entry and Commercial Invoice copies.',
      },
      htmlContent: '',
      cssContent: '',
      updatedAt: now,
    },
    {
      id: 'TPL-005',
      code: 'TPL-HTML-01',
      name: 'Custom HTML Replica Starter (/template)',
      description:
        'Sandboxed HTML & CSS template ready for pasting markup copied from http://localhost:5173/template while keeping live ATCL merge tokens active.',
      category: 'Custom Page',
      mode: 'html',
      dataSource: 'financialSummary',
      paperSize: 'Responsive',
      accentColor: '#1F4E79',
      status: 'Draft',
      isDefault: false,
      sourceOrigin: 'Ready for localhost:5173/template import',
      sections: {
        headerTitle: 'Custom Imported Page Template',
        headerSubtitle: '{{org.name}} · Custom HTML Layout',
        referenceLabel: 'Template Ref',
        showMetadataStrip: true,
        showKpiStrip: false,
        showLineItemsTable: false,
        showSignatoryBlock: false,
        kpiSlots: [],
        signatories: [],
        footerNote: 'Paste markup from http://localhost:5173/template to replace this starter.',
      },
      htmlContent: `<div class="page-shell">
  <header class="page-header">
    <div>
      <div class="eyebrow">{{org.name}} · {{org.fiscalPeriod}}</div>
      <h1>Executive Template Workspace</h1>
      <p class="subtitle">Paste HTML from <strong>http://localhost:5173/template</strong> in the editor to replace this layout while retaining live ledger bindings.</p>
    </div>
    <div class="meta-box">
      <div class="meta-label">Reporting Currency</div>
      <div class="meta-value">{{org.currency}}</div>
    </div>
  </header>

  <section class="kpi-grid">
    <div class="kpi-card">
      <span class="kpi-label">Sales Revenue</span>
      <strong class="kpi-value">{{is.revenue}}</strong>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Net Profit After Tax</span>
      <strong class="kpi-value accent">{{is.netProfit}}</strong>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Current Ratio</span>
      <strong class="kpi-value">{{kpi.currentRatio}}</strong>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Net Profit Margin</span>
      <strong class="kpi-value">{{kpi.netProfitMargin}}</strong>
    </div>
  </section>

  <section class="summary-block">
    <h2>Balance Sheet Snapshot</h2>
    <div class="summary-row"><span>Total Assets</span><strong>{{bs.totalAssets}}</strong></div>
    <div class="summary-row"><span>Total Liabilities</span><strong>{{bs.totalLiabilities}}</strong></div>
    <div class="summary-row"><span>Total Equity (Incl. Profit)</span><strong>{{bs.totalEquity}}</strong></div>
    <div class="summary-row"><span>Quick Ratio (Acid-Test)</span><strong>{{kpi.quickRatio}}</strong></div>
  </section>
</div>`,
      cssContent: `.page-shell { font-family: 'Public Sans', system-ui, sans-serif; color: #0f172a; padding: 32px; background: #ffffff; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
.eyebrow { font-size: 11px; font-weight: 600; color: #1F4E79; letter-spacing: 0.04em; text-transform: uppercase; }
h1 { margin: 6px 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.subtitle { margin: 0; font-size: 13px; color: #64748b; max-width: 560px; line-height: 1.5; }
.meta-box { text-align: right; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; background: #f8fafc; }
.meta-label { font-size: 11px; color: #64748b; }
.meta-value { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 600; margin-top: 2px; color: #1F4E79; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
.kpi-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; background: #ffffff; }
.kpi-label { display: block; font-size: 11px; color: #64748b; }
.kpi-value { display: block; margin-top: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-weight: 600; color: #0f172a; }
.kpi-value.accent { color: #047857; }
.summary-block { margin-top: 24px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; }
.summary-block h2 { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #0f172a; }
.summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #f1f5f9; font-size: 13px; }
.summary-row strong { font-family: 'IBM Plex Mono', monospace; }`,
      updatedAt: now,
    },
    {
      id: 'TPL-PV-A4',
      code: 'TPL-VCH-PV-A4',
      name: 'ATCL Payment Voucher — Official A4 Print Sheet',
      description:
        'Official A4 portrait Payment Voucher print template with meta grid, payee/bank panels, GL line items, amount in words, AIT/TDS & VAT totals, 4-step approval trail, and 4-column signatory block.',
      category: 'Voucher',
      mode: 'html',
      dataSource: 'voucher',
      paperSize: 'A4',
      accentColor: '#0b4f8a',
      status: 'Published',
      isDefault: false,
      sourceOrigin: 'ATCL Official Payment Voucher A4',
      sections: {
        headerTitle: 'PAYMENT VOUCHER',
        headerSubtitle: 'Advance Technology Consortium Ltd · Phone: 01819-556755',
        referenceLabel: 'Voucher No.',
        showMetadataStrip: true,
        showKpiStrip: false,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Net Payable', token: '{{record.amount}}' },
          { label: 'Payee / Vendor', token: '{{record.party}}' },
          { label: 'Status', token: '{{record.status}}' },
        ],
        signatories: ['Prepared By', 'Verified By', 'Approved By', 'Received By'],
        footerNote:
          'System-generated document. No manual alteration permitted. This voucher is valid only when posted in the ATCL ERP and supported by approved bills, PO and GRN.',
      },
      htmlContent: `<div class="pv-page">
  <header class="hdr">
    <div class="logo">ATCL</div>
    <div class="company">
      <h1>{{org.name}}</h1>
      <p>12-A (12th Floor), Concord Center Point, Kazi Nazrul Islam Ave, Dhaka 1215</p>
      <p class="tel">Phone: 01819-556755</p>
    </div>
    <div class="docbadge">
      <div class="dt">PAYMENT VOUCHER</div>
      <span class="st">● {{record.status}}</span>
    </div>
  </header>
  <div class="meta">
    <div class="cell"><div class="k">Voucher No.</div><div class="v mono">{{record.ref}}</div></div>
    <div class="cell"><div class="k">Voucher Date</div><div class="v">{{record.date}}</div></div>
    <div class="cell"><div class="k">Payee / Vendor</div><div class="v">{{record.party}}</div></div>
    <div class="cell"><div class="k">Fiscal Year</div><div class="v">{{org.fiscalPeriod}}</div></div>
  </div>
  <div class="summary-block">
    <div class="wl">Amount</div>
    <div class="wv">{{record.amount}}</div>
  </div>
</div>`,
      cssContent: `.pv-page{background:#fff;padding:24px;border-top:5px solid #0b4f8a;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1a1a1a;}
.hdr{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:3px double #0b4f8a;}
.logo{width:52px;height:52px;border-radius:9px;background:#0b4f8a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;}
.company h1{margin:0;font-size:16px;font-weight:800;color:#0b4f8a;text-transform:uppercase;}
.company p{margin:2px 0 0;font-size:10px;color:#33414d;}
.company p.tel{font-weight:700;color:#0b4f8a;}
.docbadge{margin-left:auto;text-align:right;}
.docbadge .dt{font-size:13px;font-weight:800;letter-spacing:2px;color:#0b4f8a;border:1.5px solid #0b4f8a;border-radius:4px;padding:5px 10px;}
.docbadge .st{margin-top:5px;display:inline-block;font-size:9px;font-weight:800;padding:3px 9px;border-radius:20px;background:#e6f4ea;color:#1e7e34;border:1px solid #b7dfc2;}
.meta{display:grid;grid-template-columns:repeat(4,1fr);margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;overflow:hidden;}
.cell{padding:6px 9px;border-right:1px solid #d3dde6;}
.cell:last-child{border-right:0;}
.cell .k{font-size:8px;font-weight:800;color:#6b7b8a;text-transform:uppercase;}
.cell .v{font-size:11px;font-weight:700;color:#153a5c;margin-top:2px;}
.summary-block{margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;padding:10px;background:#eef3f8;}
.wl{font-size:9px;font-weight:800;color:#0b4f8a;text-transform:uppercase;}
.wv{font-size:14px;font-weight:800;color:#153a5c;margin-top:3px;}`,
      updatedAt: now,
    },
    {
      id: 'TPL-RV-A4',
      code: 'TPL-VCH-RV-A4',
      name: 'ATCL Receipt Voucher — Official A4 Print Sheet',
      description:
        'Official A4 portrait Receipt Voucher print template with green accent bar, customer/bank deposit panels, GL line items, amount in words, invoice allocation table, instrument strip, posting trail, and 4-column signatory block.',
      category: 'Voucher',
      mode: 'html',
      dataSource: 'voucher',
      paperSize: 'A4',
      accentColor: '#0e7a4f',
      status: 'Published',
      isDefault: false,
      sourceOrigin: 'ATCL Official Receipt Voucher A4',
      sections: {
        headerTitle: 'RECEIPT VOUCHER',
        headerSubtitle: 'Advance Technology Consortium Ltd · Phone: 01819-556755',
        referenceLabel: 'Voucher No.',
        showMetadataStrip: true,
        showKpiStrip: false,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Net Received', token: '{{record.amount}}' },
          { label: 'Received From', token: '{{record.party}}' },
          { label: 'Status', token: '{{record.status}}' },
        ],
        signatories: ['Prepared By', 'Verified By', 'Approved By', 'Received By'],
        footerNote:
          'System-generated document. No manual alteration permitted. This receipt is valid only when posted in the ATCL ERP and reconciled with the bank statement.',
      },
      htmlContent: `<div class="rv-page">
  <header class="hdr">
    <div class="logo">ATCL</div>
    <div class="company">
      <h1>{{org.name}}</h1>
      <p>12-A (12th Floor), Concord Center Point, Kazi Nazrul Islam Ave, Dhaka 1215</p>
      <p class="tel">Phone: 01819-556755</p>
    </div>
    <div class="docbadge">
      <div class="dt">RECEIPT VOUCHER</div>
      <span class="st">● {{record.status}}</span>
    </div>
  </header>
  <div class="meta">
    <div class="cell"><div class="k">Voucher No.</div><div class="v mono">{{record.ref}}</div></div>
    <div class="cell"><div class="k">Voucher Date</div><div class="v">{{record.date}}</div></div>
    <div class="cell"><div class="k">Received From</div><div class="v">{{record.party}}</div></div>
    <div class="cell"><div class="k">Fiscal Year</div><div class="v">{{org.fiscalPeriod}}</div></div>
  </div>
  <div class="summary-block">
    <div class="wl">Net Amount Received</div>
    <div class="wv">{{record.amount}}</div>
  </div>
</div>`,
      cssContent: `.rv-page{background:#fff;padding:24px;border-top:5px solid #0e7a4f;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1a1a1a;}
.hdr{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:3px double #0b4f8a;}
.logo{width:52px;height:52px;border-radius:9px;background:#0b4f8a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;}
.company h1{margin:0;font-size:16px;font-weight:800;color:#0b4f8a;text-transform:uppercase;}
.company p{margin:2px 0 0;font-size:10px;color:#33414d;}
.company p.tel{font-weight:700;color:#0b4f8a;}
.docbadge{margin-left:auto;text-align:right;}
.docbadge .dt{font-size:13px;font-weight:800;letter-spacing:2px;color:#0e7a4f;border:1.5px solid #0e7a4f;border-radius:4px;padding:5px 10px;}
.docbadge .st{margin-top:5px;display:inline-block;font-size:9px;font-weight:800;padding:3px 9px;border-radius:20px;background:#e6f4ea;color:#1e7e34;border:1px solid #b7dfc2;}
.meta{display:grid;grid-template-columns:repeat(4,1fr);margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;overflow:hidden;}
.cell{padding:6px 9px;border-right:1px solid #d3dde6;}
.cell:last-child{border-right:0;}
.cell .k{font-size:8px;font-weight:800;color:#6b7b8a;text-transform:uppercase;}
.cell .v{font-size:11px;font-weight:700;color:#153a5c;margin-top:2px;}
.summary-block{margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;padding:10px;background:#eef3f8;}
.wl{font-size:9px;font-weight:800;color:#0e7a4f;text-transform:uppercase;}
.wv{font-size:14px;font-weight:800;color:#153a5c;margin-top:3px;}`,
      updatedAt: now,
    },
    {
      id: 'TPL-JV-A4',
      code: 'TPL-VCH-JV-A4',
      name: 'ATCL Journal Voucher — Official A4 Print Sheet',
      description:
        'Official A4 portrait Journal Voucher print template with deep indigo accent, multi-line GL entries, double-entry balance check bar, amount in words, auto-reverse schedule, supporting workings, approval trail, and 4-column signatory block.',
      category: 'Voucher',
      mode: 'html',
      dataSource: 'voucher',
      paperSize: 'A4',
      accentColor: '#4527a0',
      status: 'Published',
      isDefault: false,
      sourceOrigin: 'ATCL Official Journal Voucher A4',
      sections: {
        headerTitle: 'JOURNAL VOUCHER',
        headerSubtitle: 'Advance Technology Consortium Ltd · Phone: 01819-556755',
        referenceLabel: 'Voucher No.',
        showMetadataStrip: true,
        showKpiStrip: false,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Total Journal', token: '{{record.amount}}' },
          { label: 'Posting Type', token: '{{record.party}}' },
          { label: 'Status', token: '{{record.status}}' },
        ],
        signatories: ['Prepared By', 'Verified By', 'Approved By', 'Reviewed By'],
        footerNote:
          'System-generated document. No manual alteration permitted. This journal voucher is valid only when posted in the ATCL ERP and supported by approved workings and supporting schedules.',
      },
      htmlContent: `<div class="jv-page">
  <header class="hdr">
    <div class="logo">ATCL</div>
    <div class="company">
      <h1>{{org.name}}</h1>
      <p>12-A (12th Floor), Concord Center Point, Kazi Nazrul Islam Ave, Dhaka 1215</p>
      <p class="tel">Phone: 01819-556755</p>
    </div>
    <div class="docbadge">
      <div class="dt">JOURNAL VOUCHER</div>
      <span class="st">● {{record.status}}</span>
    </div>
  </header>
  <div class="meta">
    <div class="cell"><div class="k">Voucher No.</div><div class="v mono">{{record.ref}}</div></div>
    <div class="cell"><div class="k">Voucher Date</div><div class="v">{{record.date}}</div></div>
    <div class="cell"><div class="k">Journal Scope</div><div class="v">{{record.party}}</div></div>
    <div class="cell"><div class="k">Fiscal Year</div><div class="v">{{org.fiscalPeriod}}</div></div>
  </div>
  <div class="summary-block">
    <div class="wl">Total Journal Amount</div>
    <div class="wv">{{record.amount}}</div>
  </div>
</div>`,
      cssContent: `.jv-page{background:#fff;padding:24px;border-top:5px solid #4527a0;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1a1a1a;}
.hdr{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:3px double #4527a0;}
.logo{width:50px;height:50px;border-radius:9px;background:#4527a0;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;}
.company h1{margin:0;font-size:16px;font-weight:800;color:#4527a0;text-transform:uppercase;}
.company p{margin:2px 0 0;font-size:10px;color:#33414d;}
.company p.tel{font-weight:700;color:#4527a0;}
.docbadge{margin-left:auto;text-align:right;}
.docbadge .dt{font-size:12.5px;font-weight:800;letter-spacing:1.8px;color:#4527a0;border:1.5px solid #4527a0;border-radius:4px;padding:5px 10px;}
.docbadge .st{margin-top:5px;display:inline-block;font-size:8.5px;font-weight:800;padding:3px 9px;border-radius:20px;background:#f1eef9;color:#4527a0;border:1px solid #cfc3ea;}
.meta{display:grid;grid-template-columns:repeat(4,1fr);margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;overflow:hidden;}
.cell{padding:6px 9px;border-right:1px solid #d3dde6;}
.cell:last-child{border-right:0;}
.cell .k{font-size:8px;font-weight:800;color:#6b7b8a;text-transform:uppercase;}
.cell .v{font-size:11px;font-weight:700;color:#153a5c;margin-top:2px;}
.summary-block{margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;padding:10px;background:#f1eef9;}
.wl{font-size:9px;font-weight:800;color:#4527a0;text-transform:uppercase;}
.wv{font-size:14px;font-weight:800;color:#153a5c;margin-top:3px;}`,
      updatedAt: now,
    },
    {
      id: 'TPL-EV-A4',
      code: 'TPL-VCH-EV-A4',
      name: 'ATCL Expense Voucher — Official A4 Print Sheet',
      description:
        'Official A4 portrait Expense Voucher print template with amber accent, claimant/budget owner panels, multi-item expense splits, department budget validation, real-time liquidity check, approval trail, and 4-column signatory block.',
      category: 'Voucher',
      mode: 'html',
      dataSource: 'voucher',
      paperSize: 'A4',
      accentColor: '#b45309',
      status: 'Published',
      isDefault: false,
      sourceOrigin: 'ATCL Official Expense Voucher A4',
      sections: {
        headerTitle: 'EXPENSE VOUCHER',
        headerSubtitle: 'Advance Technology Consortium Ltd · Phone: 01819-556755',
        referenceLabel: 'Voucher No.',
        showMetadataStrip: true,
        showKpiStrip: false,
        showLineItemsTable: true,
        showSignatoryBlock: true,
        kpiSlots: [
          { label: 'Net Payable', token: '{{record.amount}}' },
          { label: 'Claimant', token: '{{record.party}}' },
          { label: 'Status', token: '{{record.status}}' },
        ],
        signatories: ['Claimant', 'Budget Owner', 'Verified By', 'Approved By'],
        footerNote:
          'System-generated document. No manual alteration permitted. This expense voucher is valid only when posted in the ATCL ERP and supported by original bills, budget validation and override approval (where applicable).',
      },
      htmlContent: `<div class="ev-page">
  <header class="hdr">
    <div class="logo">ATCL</div>
    <div class="company">
      <h1>{{org.name}}</h1>
      <p>12-A (12th Floor), Concord Center Point, Kazi Nazrul Islam Ave, Dhaka 1215</p>
      <p class="tel">Phone: 01819-556755</p>
    </div>
    <div class="docbadge">
      <div class="dt">EXPENSE VOUCHER</div>
      <span class="st">● {{record.status}}</span>
    </div>
  </header>
  <div class="meta">
    <div class="cell"><div class="k">Voucher No.</div><div class="v mono">{{record.ref}}</div></div>
    <div class="cell"><div class="k">Voucher Date</div><div class="v">{{record.date}}</div></div>
    <div class="cell"><div class="k">Claimant</div><div class="v">{{record.party}}</div></div>
    <div class="cell"><div class="k">Fiscal Year</div><div class="v">{{org.fiscalPeriod}}</div></div>
  </div>
  <div class="summary-block">
    <div class="wl">Net Payable</div>
    <div class="wv">{{record.amount}}</div>
  </div>
</div>`,
      cssContent: `.ev-page{background:#fff;padding:24px;border-top:5px solid #b45309;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1a1a1a;}
.hdr{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:3px double #b45309;}
.logo{width:50px;height:50px;border-radius:9px;background:#b45309;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;}
.company h1{margin:0;font-size:16px;font-weight:800;color:#b45309;text-transform:uppercase;}
.company p{margin:2px 0 0;font-size:10px;color:#33414d;}
.company p.tel{font-weight:700;color:#b45309;}
.docbadge{margin-left:auto;text-align:right;}
.docbadge .dt{font-size:12.5px;font-weight:800;letter-spacing:1.8px;color:#b45309;border:1.5px solid #b45309;border-radius:4px;padding:5px 10px;}
.docbadge .st{margin-top:5px;display:inline-block;font-size:8.5px;font-weight:800;padding:3px 9px;border-radius:20px;background:#fff6e0;color:#8a5a00;border:1px solid #e8d4a4;}
.meta{display:grid;grid-template-columns:repeat(4,1fr);margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;overflow:hidden;}
.cell{padding:6px 9px;border-right:1px solid #d3dde6;}
.cell:last-child{border-right:0;}
.cell .k{font-size:8px;font-weight:800;color:#6b7b8a;text-transform:uppercase;}
.cell .v{font-size:11px;font-weight:700;color:#4a2c07;margin-top:2px;}
.summary-block{margin-top:12px;border:1px solid #a8b7c4;border-radius:4px;padding:10px;background:#fdf4e6;}
.wl{font-size:9px;font-weight:800;color:#78350f;text-transform:uppercase;}
.wv{font-size:14px;font-weight:800;color:#4a2c07;margin-top:3px;}`,
      updatedAt: now,
    },
  ];
}

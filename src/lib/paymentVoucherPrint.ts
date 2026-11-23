import type { LedgerState, VoucherRecord } from '../types/accounting.ts';

export function escapeHtml(val: string | number | undefined | null): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtMoney(n: number): string {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtDateDisplay(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

export function numberToTakaWords(amount: number): string {
  const num = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(num);
  const poisha = Math.round((num - whole) * 100);

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${tens[t]}-${ones[o]}` : tens[t];
  };

  const threeDigits = (n: number): string => {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    if (!h) return twoDigits(rem);
    return rem ? `${ones[h]} Hundred ${twoDigits(rem)}` : `${ones[h]} Hundred`;
  };

  const convertInt = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    const billions = Math.floor(n / 1_000_000_000);
    const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
    const thousands = Math.floor((n % 1_000_000) / 1000);
    const rest = n % 1000;
    if (billions) parts.push(`${threeDigits(billions)} Billion`);
    if (millions) parts.push(`${threeDigits(millions)} Million`);
    if (thousands) parts.push(`${threeDigits(thousands)} Thousand`);
    if (rest) parts.push(threeDigits(rest));
    return parts.join(' ');
  };

  const takaPart = `Taka ${convertInt(whole)}`;
  if (poisha > 0) {
    return `${takaPart} and ${twoDigits(poisha)} Poisha Only`;
  }
  return `${takaPart} Only`;
}

export function buildPaymentVoucherHtml(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy = 'accounts@atclbd.com'
): string {
  const supplier = state.suppliers.find(
    (s) =>
      (voucher.supplierId && s.id === voucher.supplierId) ||
      (voucher.supplierName && s.name.toLowerCase() === voucher.supplierName.toLowerCase())
  );

  const accountMap = new Map(state.accounts.map((a) => [a.code, a]));
  const paidFromGl = voucher.paidFromGlCode || '1105';
  const bankAcc = accountMap.get(paidFromGl);

  const grossAmount = voucher.baseAmount ?? voucher.totalAmount ?? 0;
  const tdsAmount = voucher.tdsAmount ?? 0;
  const vdsAmount = voucher.vdsAmount ?? 0;
  const netPayable = voucher.netPayableAmount ?? Math.max(0, grossAmount - tdsAmount - vdsAmount);

  // Build GL lines from doubleEntryLines or synthesize from voucher payment details
  const rawLines =
    voucher.doubleEntryLines && voucher.doubleEntryLines.length > 0
      ? voucher.doubleEntryLines.map((l) => ({
          glCode: l.glCode,
          glName: accountMap.get(l.glCode)?.name || l.memo || 'GL Account',
          narration: l.memo || voucher.narration,
          costCenter: voucher.costCenter || 'CC-HO',
          debit: l.debit,
          credit: l.credit,
        }))
      : [
          {
            glCode: supplier?.expenseGlCode || '5010',
            glName: accountMap.get(supplier?.expenseGlCode || '5010')?.name || 'Accounts Payable / Expense',
            narration: voucher.narration || `Payment to ${voucher.supplierName || 'Vendor'}`,
            costCenter: voucher.costCenter || 'CC-HO',
            debit: grossAmount,
            credit: 0,
          },
          ...(tdsAmount > 0
            ? [
                {
                  glCode: '2200',
                  glName: accountMap.get('2200')?.name || 'AIT / TDS Payable — Vendor',
                  narration: `Withholding tax @ ${voucher.tdsRate || 0}% on bill value`,
                  costCenter: voucher.costCenter || 'CC-HO',
                  debit: 0,
                  credit: tdsAmount,
                },
              ]
            : []),
          ...(vdsAmount > 0
            ? [
                {
                  glCode: '2210',
                  glName: accountMap.get('2210')?.name || 'VAT / VDS Payable',
                  narration: `VAT deduction @ ${voucher.vdsRate || 0}% on bill value`,
                  costCenter: voucher.costCenter || 'CC-HO',
                  debit: 0,
                  credit: vdsAmount,
                },
              ]
            : []),
          {
            glCode: paidFromGl,
            glName: bankAcc?.name || 'Corporate Bank / Cash A/C',
            narration: `Net ${voucher.paymentMode || 'Bank Transfer'} released to vendor`,
            costCenter: voucher.costCenter || 'CC-HO',
            debit: 0,
            credit: netPayable,
          },
        ];

  const totalDebit = rawLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = rawLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

  const lineRowsHtml = rawLines
    .map(
      (line, idx) => `
        <tr>
          <td class="t-c">${idx + 1}</td>
          <td class="mono">${escapeHtml(line.glCode)}</td>
          <td>${escapeHtml(line.glName)}</td>
          <td>${escapeHtml(line.narration)}</td>
          <td class="t-c">${escapeHtml(line.costCenter || 'HO')}</td>
          <td class="t-r mono">${line.debit > 0 ? fmtMoney(line.debit) : '—'}</td>
          <td class="t-r mono">${line.credit > 0 ? fmtMoney(line.credit) : '—'}</td>
        </tr>`
    )
    .join('');

  const poDoc = voucher.linkedSourceDocs.find((d) => /po|lpo|lc/i.test(d.docType))?.docRef || '—';
  const allocSummary =
    voucher.invoiceAllocations && voucher.invoiceAllocations.length > 0
      ? voucher.invoiceAllocations.map((a) => `${a.invoiceNo} (${fmtMoney(a.allocatedAmount)})`).join(', ')
      : '';
  const invDoc =
    allocSummary ||
    voucher.linkedSourceDocs.find((d) => /inv|bill/i.test(d.docType))?.docRef ||
    voucher.bankReferenceNo ||
    '—';
  const isPosted = voucher.postedToGl;
  const statusLabel = voucher.postedToGl
    ? '● POSTED'
    : voucher.status === 'Voided'
      ? '● VOIDED'
      : 'DRAFT — UNPOSTED';
  const printedTimestamp = `${fmtDateDisplay(new Date().toISOString())} ${new Date().toTimeString().slice(0, 5)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment Voucher ${escapeHtml(voucher.voucherRef)} — ATCL ERP</title>
<style>
  :root{
    --pri:#0b4f8a;
    --pri-dark:#083a67;
    --accent:#17a2b8;
    --ink:#1a1a1a;
    --muted:#6b7b8a;
    --line:#a8b7c4;
    --soft:#eef3f8;
    --ok:#1e7e34;
    --ok-bg:#e6f4ea;
    --warn:#8a5a00;
    --warn-bg:#fff6e0;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    background:#e8ecf1;
    font-family:"Segoe UI",Tahoma,Arial,Helvetica,sans-serif;
    color:var(--ink);
    font-size:11px;
    line-height:1.35;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .mono{font-family:"Consolas","Courier New",monospace;}
  .toolbar{text-align:center;padding:16px 12px 6px;}
  .toolbar button{
    font:600 13px/1 "Segoe UI",Arial,sans-serif;
    background:var(--pri);color:#fff;border:0;border-radius:6px;
    padding:12px 26px;cursor:pointer;letter-spacing:.4px;
    box-shadow:0 2px 8px rgba(11,79,138,.35);
  }
  .toolbar button:hover{background:var(--pri-dark);}
  .toolbar small{display:block;margin-top:8px;color:#5b6b7a;font-size:11.5px;}
  .page{
    width:210mm;min-height:297mm;
    margin:0 auto 26px;background:#fff;
    padding:11mm 13mm 9mm;
    box-shadow:0 6px 26px rgba(0,0,0,.18);
    display:flex;flex-direction:column;
    position:relative;
  }
  .page::before{
    content:"";position:absolute;top:0;left:0;right:0;height:4.5mm;
    background:linear-gradient(90deg,var(--pri) 0%,var(--pri) 62%,var(--accent) 100%);
  }
  .hdr{
    display:flex;align-items:center;gap:12px;
    padding-top:3mm;padding-bottom:7px;
    border-bottom:3px double var(--pri);
  }
  .logo{
    width:52px;height:52px;flex:0 0 auto;border-radius:9px;
    background:var(--pri);color:#fff;display:flex;align-items:center;
    justify-content:center;font-weight:800;font-size:16px;letter-spacing:.5px;
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);
  }
  .company h1{
    margin:0;font-size:16.5px;font-weight:800;color:var(--pri);
    letter-spacing:.3px;text-transform:uppercase;
  }
  .company p{margin:2px 0 0;font-size:10px;color:#33414d;}
  .company p.tel{font-weight:700;color:var(--pri);}
  .docbadge{margin-left:auto;flex:0 0 auto;text-align:right;}
  .docbadge .dt{
    font-size:13px;font-weight:800;letter-spacing:2px;color:var(--pri);
    border:1.5px solid var(--pri);border-radius:4px;padding:5px 10px;
  }
  .docbadge .st{
    margin-top:5px;display:inline-block;font-size:9px;font-weight:800;
    letter-spacing:1.2px;padding:3px 9px;border-radius:20px;
    background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;
  }
  .docbadge .st.warn{background:var(--warn-bg);color:var(--warn);border-color:#e8d4a4;}
  .meta{
    display:grid;grid-template-columns:repeat(4,1fr);
    gap:0;margin-top:9px;
    border:1px solid var(--line);border-radius:4px;overflow:hidden;
  }
  .cell{
    padding:5px 9px;border-right:1px solid #d3dde6;border-bottom:1px solid #d3dde6;
    min-height:34px;
  }
  .cell:nth-child(4n){border-right:0;}
  .cell:nth-last-child(-n+4){border-bottom:0;}
  .cell .k{
    font-size:8px;font-weight:800;letter-spacing:.9px;color:var(--muted);
    text-transform:uppercase;margin-bottom:2px;
  }
  .cell .v{font-size:10.5px;font-weight:700;color:#153a5c;word-break:break-word;}
  .cell .v.sm{font-size:9.5px;font-weight:600;color:#33414d;}
  .parties{display:grid;grid-template-columns:1.15fr 1fr;gap:9px;margin-top:9px;}
  .panel{border:1px solid var(--line);border-radius:4px;overflow:hidden;}
  .panel .ph{
    background:var(--soft);color:var(--pri);font-size:8.5px;font-weight:800;
    letter-spacing:1.1px;text-transform:uppercase;padding:4px 9px;
    border-bottom:1px solid var(--line);
  }
  .panel .pb{padding:7px 9px;}
  .kv{display:flex;gap:8px;align-items:baseline;margin-bottom:4px;}
  .kv:last-child{margin-bottom:0;}
  .kv .kk{font-size:8.5px;font-weight:700;color:var(--muted);width:52px;flex:0 0 auto;text-transform:uppercase;letter-spacing:.4px;}
  .kv .vv{font-size:10.5px;font-weight:600;color:#21313f;flex:1;}
  .kv .vv.strong{font-weight:800;color:#153a5c;}
  table.items{width:100%;border-collapse:collapse;margin-top:9px;font-size:10px;}
  table.items th{
    background:var(--pri);color:#fff;border:1px solid var(--pri-dark);
    padding:5px 6px;text-align:left;font-size:8.5px;
    letter-spacing:.7px;text-transform:uppercase;font-weight:800;
  }
  table.items td{border:1px solid var(--line);padding:4.5px 6px;vertical-align:top;height:22px;}
  table.items tbody tr:nth-child(even) td{background:#fafcfe;}
  .t-c{text-align:center;}
  .t-r{text-align:right;}
  .c-sl{width:8mm;}
  .c-acc{width:23mm;}
  .c-name{width:37mm;}
  .c-cc{width:14mm;}
  .c-amt{width:22mm;}
  table.items tfoot tr.grand td{
    background:var(--pri);color:#fff;border-color:var(--pri-dark);
    font-size:11px;letter-spacing:.5px;font-weight:800;padding:5px 6px;
  }
  .summary{display:grid;grid-template-columns:1fr 74mm;gap:9px;margin-top:9px;}
  .words-box{
    border:1px solid var(--line);border-radius:4px;padding:7px 9px;
    background:#fdfefe;display:flex;flex-direction:column;justify-content:center;
  }
  .words-box .wl{
    font-size:8.5px;font-weight:800;letter-spacing:1px;color:var(--pri);
    text-transform:uppercase;margin-bottom:4px;
  }
  .words-box .wv{
    font-size:11px;font-weight:800;color:#153a5c;font-style:italic;
    border-bottom:1px dotted #8d9aa8;padding-bottom:3px;
  }
  .words-box .wn{font-size:8.5px;color:var(--muted);margin-top:4px;}
  table.totals{width:100%;border-collapse:collapse;font-size:10.5px;}
  table.totals td{border:1px solid var(--line);padding:5px 8px;}
  table.totals td.lbl{color:#33414d;font-weight:600;}
  table.totals td.amt{text-align:right;width:30mm;font-weight:700;font-family:"Consolas","Courier New",monospace;}
  table.totals tr.net td{background:var(--pri);color:#fff;font-weight:800;font-size:12px;border-color:var(--pri-dark);}
  .sec-title{
    font-size:8.5px;font-weight:800;letter-spacing:1.2px;color:var(--pri);
    text-transform:uppercase;margin:10px 0 4px;
    border-bottom:1px solid #d3dde6;padding-bottom:3px;
  }
  table.trail{width:100%;border-collapse:collapse;font-size:9.5px;}
  table.trail th{
    background:var(--soft);border:1px solid var(--line);padding:4px 6px;
    text-align:left;font-size:8px;letter-spacing:.7px;text-transform:uppercase;
    color:var(--pri);font-weight:800;
  }
  table.trail td{border:1px solid var(--line);padding:4px 6px;}
  .pill{
    display:inline-block;font-size:8px;font-weight:800;letter-spacing:.6px;
    padding:1.5px 7px;border-radius:20px;text-transform:uppercase;
    background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;
  }
  .pill.warn{background:var(--warn-bg);color:var(--warn);border-color:#e8d4a4;}
  .spacer{flex:1 1 auto;min-height:6mm;}
  .signs{display:grid;grid-template-columns:repeat(4,1fr);gap:9mm;margin-top:2mm;}
  .sign .blank{height:26px;border-bottom:1px solid #444;}
  .sign .lbl{padding-top:4px;text-align:center;font-size:9.5px;font-weight:800;color:#33414d;letter-spacing:.4px;}
  .sign .sub{text-align:center;font-size:8px;color:var(--muted);margin-top:1px;}
  .foot{
    margin-top:9px;padding-top:6px;border-top:1px solid #d3dde6;
    display:flex;justify-content:space-between;gap:12px;align-items:flex-end;
    font-size:8.5px;color:var(--muted);
  }
  .foot .fnote{max-width:110mm;}
  .foot b{color:#4a5a68;}
  .foot .hash{font-family:"Consolas","Courier New",monospace;letter-spacing:.3px;}
  .barcode{display:flex;align-items:flex-end;gap:1px;height:16px;margin-bottom:3px;justify-content:flex-end;}
  .barcode i{display:block;background:#1a1a1a;height:100%;}
  @page{size:A4 portrait;margin:0;}
  @media print{
    body{background:#fff;}
    .toolbar{display:none !important;}
    .page{width:210mm;min-height:296mm;margin:0;box-shadow:none;padding:11mm 13mm 9mm;}
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨️ Print / Save as PDF</button>
    <small>Ctrl + P → Paper: A4 → Margins: None → Scale: 100% → Background graphics: ON</small>
  </div>

  <div class="page">
    <header class="hdr">
      <div class="logo">ATCL</div>
      <div class="company">
        <h1>${escapeHtml(state.config.organizationName || 'Advance Technology Consortium Ltd')}</h1>
        <p>12-A (12th Floor), Concord Center Point, Kazi Nazrul Islam Ave, Dhaka 1215</p>
        <p class="tel">Phone: 01819-556755</p>
      </div>
      <div class="docbadge">
        <div class="dt">${escapeHtml(voucher.voucherType.toUpperCase())} VOUCHER</div>
        <span class="st ${isPosted ? '' : 'warn'}">${escapeHtml(statusLabel)}</span>
      </div>
    </header>

    <div class="meta">
      <div class="cell">
        <div class="k">Voucher No.</div>
        <div class="v mono">${escapeHtml(voucher.voucherRef)}</div>
      </div>
      <div class="cell">
        <div class="k">Voucher Date</div>
        <div class="v">${escapeHtml(fmtDateDisplay(voucher.voucherDate))}</div>
      </div>
      <div class="cell">
        <div class="k">Posting Date</div>
        <div class="v">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</div>
      </div>
      <div class="cell">
        <div class="k">Fiscal Year / Period</div>
        <div class="v">${escapeHtml(state.config.fiscalPeriod || 'FY 2025-26')}</div>
      </div>
      <div class="cell">
        <div class="k">Voucher Type</div>
        <div class="v sm">${escapeHtml(voucher.voucherType)} Voucher</div>
      </div>
      <div class="cell">
        <div class="k">Currency / Rate</div>
        <div class="v sm">${escapeHtml(state.config.currencyCode || 'BDT')} &nbsp;·&nbsp; 1.0000</div>
      </div>
      <div class="cell">
        <div class="k">Payment Method</div>
        <div class="v sm">${escapeHtml(voucher.paymentMode || voucher.receiptMode || 'Bank Transfer (EFT)')}</div>
      </div>
      <div class="cell">
        <div class="k">Cheque / Ref. No.</div>
        <div class="v mono">${escapeHtml(voucher.bankReferenceNo || '—')}</div>
      </div>
      <div class="cell">
        <div class="k">Invoice / Bill Ref.</div>
        <div class="v mono">${escapeHtml(invDoc)}</div>
      </div>
      <div class="cell">
        <div class="k">Purchase Order</div>
        <div class="v mono">${escapeHtml(poDoc)}</div>
      </div>
      <div class="cell">
        <div class="k">Posted GL Ref</div>
        <div class="v sm mono">${escapeHtml(voucher.postedVoucherNo || 'Unposted')}</div>
      </div>
      <div class="cell">
        <div class="k">Cost Center / Project</div>
        <div class="v sm">${escapeHtml(voucher.costCenter || 'CC-HO')} / ${escapeHtml(voucher.department || 'Operations')}</div>
      </div>
    </div>

    <div class="parties">
      <div class="panel">
        <div class="ph">Payee / Vendor Master</div>
        <div class="pb">
          <div class="kv"><span class="kk">Vendor</span><span class="vv strong">${escapeHtml(voucher.supplierName || voucher.customerName || voucher.employeeName || '—')}</span></div>
          <div class="kv"><span class="kk">Code</span><span class="vv mono">${escapeHtml(supplier?.code || voucher.supplierId || '—')}</span></div>
          <div class="kv"><span class="kk">Address</span><span class="vv">${escapeHtml(supplier?.country || 'Dhaka, Bangladesh')}</span></div>
          <div class="kv"><span class="kk">Contact</span><span class="vv">${escapeHtml(supplier?.phone || '—')} &nbsp;·&nbsp; ${escapeHtml(supplier?.email || '—')}</span></div>
          <div class="kv"><span class="kk">TIN / BIN</span><span class="vv mono">TIN: ${escapeHtml(supplier?.taxNo || '—')} &nbsp;·&nbsp; BIN: ${escapeHtml(supplier?.binNumber || '—')}</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="ph">Debit Account / Bank</div>
        <div class="pb">
          <div class="kv"><span class="kk">Account</span><span class="vv strong">${escapeHtml(bankAcc?.name || supplier?.bankName || 'Corporate Bank Account')}</span></div>
          <div class="kv"><span class="kk">GL Code</span><span class="vv mono">${escapeHtml(paidFromGl)}</span></div>
          <div class="kv"><span class="kk">Channel</span><span class="vv">${escapeHtml(supplier?.bankName || voucher.paymentMode || 'Bank Transfer')}</span></div>
          <div class="kv"><span class="kk">Beneficiary</span><span class="vv">${escapeHtml(voucher.supplierName || voucher.customerName || '—')}</span></div>
          <div class="kv"><span class="kk">Terms</span><span class="vv">${escapeHtml(supplier?.paymentTerms || 'Net 30 Days')}</span></div>
        </div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="c-sl t-c">#</th>
          <th class="c-acc">Account Code</th>
          <th class="c-name">Account Name</th>
          <th>Description / Narration</th>
          <th class="c-cc t-c">Cost Ctr</th>
          <th class="c-amt t-r">Debit (BDT)</th>
          <th class="c-amt t-r">Credit (BDT)</th>
        </tr>
      </thead>
      <tbody>
        ${lineRowsHtml}
      </tbody>
      <tfoot>
        <tr class="grand">
          <td colspan="5" class="t-r">TOTAL</td>
          <td class="t-r mono">${fmtMoney(totalDebit)}</td>
          <td class="t-r mono">${fmtMoney(totalCredit)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="summary">
      <div class="words-box">
        <div class="wl">Amount in Words</div>
        <div class="wv">${escapeHtml(numberToTakaWords(netPayable))}</div>
        <div class="wn">Net payable after deduction of AIT/TDS BDT ${fmtMoney(tdsAmount)} &amp; VAT BDT ${fmtMoney(vdsAmount)}</div>
      </div>

      <table class="totals">
        <tr><td class="lbl">Gross Bill Amount</td><td class="amt">${fmtMoney(grossAmount)}</td></tr>
        <tr><td class="lbl">Less: AIT / TDS (${voucher.tdsRate || 0}%)</td><td class="amt">${tdsAmount > 0 ? `(${fmtMoney(tdsAmount)})` : '0.00'}</td></tr>
        <tr><td class="lbl">Less: VAT Deduction (${voucher.vdsRate || 0}%)</td><td class="amt">${vdsAmount > 0 ? `(${fmtMoney(vdsAmount)})` : '0.00'}</td></tr>
        <tr class="net"><td class="lbl">NET PAYABLE</td><td class="amt">${fmtMoney(netPayable)}</td></tr>
      </table>
    </div>

    <div class="sec-title">Approval &amp; Posting Trail</div>
    <table class="trail">
      <thead>
        <tr>
          <th style="width:8mm" class="t-c">Step</th>
          <th style="width:24mm">Action</th>
          <th style="width:30mm">User / Role</th>
          <th style="width:26mm">Date &amp; Time</th>
          <th>Remarks</th>
          <th style="width:22mm" class="t-c">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="t-c">1</td>
          <td>Created</td>
          <td>${escapeHtml(printedBy)} — <span style="color:#6b7b8a">Accounts Officer</span></td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.voucherDate))}</td>
          <td>${escapeHtml(voucher.narration || 'Voucher created in ATCL ERP')}</td>
          <td class="t-c"><span class="pill">Completed</span></td>
        </tr>
        <tr>
          <td class="t-c">2</td>
          <td>Verified</td>
          <td>Accounts Manager</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Supporting documents &amp; GL codes verified</td>
          <td class="t-c"><span class="pill ${isPosted ? '' : 'warn'}">${isPosted ? 'Completed' : 'Pending'}</span></td>
        </tr>
        <tr>
          <td class="t-c">3</td>
          <td>Approved</td>
          <td>Finance Controller</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Authorized for settlement &amp; GL posting</td>
          <td class="t-c"><span class="pill ${isPosted ? '' : 'warn'}">${isPosted ? 'Approved' : escapeHtml(voucher.status)}</span></td>
        </tr>
        <tr>
          <td class="t-c">4</td>
          <td>Posted to GL</td>
          <td>GL Posting Engine</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Journal ${escapeHtml(voucher.postedVoucherNo || 'Pending')}</td>
          <td class="t-c"><span class="pill ${voucher.postedToGl ? '' : 'warn'}">${voucher.postedToGl ? 'Posted' : 'Queued'}</span></td>
        </tr>
      </tbody>
    </table>

    <div class="spacer"></div>

    <div class="signs">
      <div class="sign"><div class="blank"></div><div class="lbl">Prepared By</div><div class="sub">Accounts Executive</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Verified By</div><div class="sub">Accounts Manager</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Approved By</div><div class="sub">Chief Financial Officer</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Received By</div><div class="sub">Name, Signature &amp; Seal</div></div>
    </div>

    <div class="foot">
      <div class="fnote">
        <b>System-generated document.</b> No manual alteration permitted. This voucher is valid only
        when posted in the ATCL ERP and supported by approved bills, PO and GRN.
      </div>
      <div style="text-align:right">
        <div class="barcode">
          <i style="width:1px"></i><i style="width:2px"></i><i style="width:1px"></i><i style="width:3px"></i>
          <i style="width:1px"></i><i style="width:1px"></i><i style="width:2px"></i><i style="width:1px"></i>
          <i style="width:3px"></i><i style="width:1px"></i><i style="width:2px"></i><i style="width:1px"></i>
          <i style="width:1px"></i><i style="width:3px"></i><i style="width:1px"></i><i style="width:2px"></i>
          <i style="width:1px"></i><i style="width:2px"></i><i style="width:1px"></i><i style="width:3px"></i>
          <i style="width:1px"></i><i style="width:1px"></i><i style="width:2px"></i><i style="width:1px"></i>
          <i style="width:3px"></i><i style="width:1px"></i><i style="width:2px"></i><i style="width:1px"></i>
        </div>
        <div class="hash">${escapeHtml(voucher.voucherRef)} · ${escapeHtml(voucher.id)}</div>
        <div>ATCL ERP · Printed by <b>${escapeHtml(printedBy)}</b> · ${escapeHtml(printedTimestamp)} · Page <b>1 of 1</b></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function openPaymentVoucherPrintPreview(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy?: string
): void {
  const html = buildPaymentVoucherHtml(voucher, state, printedBy);
  const win = window.open('', '_blank', 'width=960,height=1050');
  if (!win) {
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

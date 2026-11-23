import type { LedgerState, VoucherRecord } from '../types/accounting.ts';
import {
  escapeHtml,
  fmtDateDisplay,
  fmtMoney,
  numberToTakaWords,
} from './paymentVoucherPrint.ts';

export function buildReceiptVoucherHtml(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy = 'accounts@atclbd.com'
): string {
  const customer = state.customers.find(
    (c) =>
      (voucher.customerId && c.id === voucher.customerId) ||
      (voucher.customerName && c.name.toLowerCase() === voucher.customerName.toLowerCase())
  );

  const accountMap = new Map(state.accounts.map((a) => [a.code, a]));
  const depositToGl = voucher.depositToGlCode || '1105';
  const bankAcc = accountMap.get(depositToGl);

  const grossReceived = voucher.collectionAmount ?? voucher.totalAmount ?? 0;
  const bankCharge = 0;
  const discount = 0;
  const netReceived = Math.max(0, grossReceived - bankCharge - discount);

  const receivableGl = customer?.receivableGlCode || '1120';
  const receivableAcc = accountMap.get(receivableGl);

  const rawLines =
    voucher.doubleEntryLines && voucher.doubleEntryLines.length > 0
      ? voucher.doubleEntryLines.map((l) => ({
          glCode: l.glCode,
          glName: accountMap.get(l.glCode)?.name || l.glName || l.memo || 'GL Account',
          narration: l.memo || voucher.narration,
          costCenter: voucher.costCenter || 'CC-HO',
          debit: l.debit,
          credit: l.credit,
        }))
      : [
          {
            glCode: depositToGl,
            glName: bankAcc?.name || 'Corporate Bank / Cash A/C',
            narration: `Funds received via ${voucher.receiptMode || 'Bank Transfer'} (${voucher.bankReferenceNo || 'Ref N/A'})`,
            costCenter: voucher.costCenter || 'CC-HO',
            debit: netReceived,
            credit: 0,
          },
          {
            glCode: receivableGl,
            glName: receivableAcc?.name || 'Accounts Receivable — Trade',
            narration: voucher.narration || 'Adjusted against customer invoice(s)',
            costCenter: voucher.costCenter || 'CC-HO',
            debit: 0,
            credit: netReceived,
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

  let remainingToAllocate = netReceived;
  const allocItems =
    voucher.salesInvoiceAllocations && voucher.salesInvoiceAllocations.length > 0
      ? voucher.salesInvoiceAllocations.map((a) => ({
          ref: a.invoiceNo,
          invDate: fmtDateDisplay(voucher.voucherDate),
          dueDate: fmtDateDisplay(voucher.postingDate),
          invAmt: a.allocatedAmount,
          adjusted: a.allocatedAmount,
          balAfter: 0,
          settled: true,
        }))
      : voucher.linkedSourceDocs.length > 0
        ? voucher.linkedSourceDocs.map((doc) => {
            const invAmt = doc.amount > 0 ? doc.amount : netReceived;
            const adjusted = Math.min(invAmt, Math.max(0, remainingToAllocate));
            remainingToAllocate = Math.max(0, remainingToAllocate - adjusted);
            const balAfter = Math.max(0, invAmt - adjusted);
            return {
              ref: doc.docRef,
              invDate: fmtDateDisplay(voucher.voucherDate),
              dueDate: fmtDateDisplay(voucher.postingDate),
              invAmt,
              adjusted,
              balAfter,
              settled: balAfter <= 0.005,
            };
          })
        : [
            {
              ref: voucher.bankReferenceNo || voucher.voucherRef,
              invDate: fmtDateDisplay(voucher.voucherDate),
              dueDate: fmtDateDisplay(voucher.postingDate),
              invAmt: grossReceived,
              adjusted: netReceived,
              balAfter: 0,
              settled: true,
            },
          ];

  const totalAllocInv = allocItems.reduce((s, a) => s + a.invAmt, 0);
  const totalAllocAdj = allocItems.reduce((s, a) => s + a.adjusted, 0);
  const totalAllocBal = allocItems.reduce((s, a) => s + a.balAfter, 0);

  const allocRowsHtml = allocItems
    .map(
      (item, idx) => `
        <tr>
          <td class="t-c">${idx + 1}</td>
          <td class="mono">${escapeHtml(item.ref)}</td>
          <td>${escapeHtml(item.invDate)}</td>
          <td>${escapeHtml(item.dueDate)}</td>
          <td class="t-r mono">${fmtMoney(item.invAmt)}</td>
          <td class="t-r mono">${fmtMoney(item.adjusted)}</td>
          <td class="t-r mono">${fmtMoney(item.balAfter)}</td>
          <td class="t-c"><span class="pill ${item.settled ? '' : 'warn'}">${item.settled ? 'Settled' : 'Part Paid'}</span></td>
        </tr>`
    )
    .join('');

  const mode = voucher.receiptMode || 'Bank Transfer (EFT In)';
  const isCash = /cash/i.test(mode);
  const isCheque = /cheque|check/i.test(mode);
  const isPayOrder = /pay\s*order/i.test(mode);
  const isMobile = /bkash|nagad|rocket|mobile|mfs/i.test(mode);
  const isBankEft = !isCash && !isCheque && !isPayOrder && !isMobile;

  const soDoc =
    voucher.linkedSourceDocs.find((d) => /so|contract|job/i.test(d.docType))?.docRef ||
    voucher.linkedSourceDocs[0]?.docRef ||
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
<title>Receipt Voucher ${escapeHtml(voucher.voucherRef)} — ATCL ERP</title>
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
    background:linear-gradient(90deg,#0e7a4f 0%,#0e7a4f 62%,var(--accent) 100%);
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
    font-size:13px;font-weight:800;letter-spacing:2px;color:#0e7a4f;
    border:1.5px solid #0e7a4f;border-radius:4px;padding:5px 10px;
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
  .kv .kk{
    font-size:8.5px;font-weight:700;color:var(--muted);width:54px;
    flex:0 0 auto;text-transform:uppercase;letter-spacing:.4px;
  }
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
  .c-name{width:40mm;}
  .c-cc{width:14mm;}
  .c-amt{width:22mm;}
  table.items tfoot td{
    font-weight:800;background:var(--soft);border:1px solid var(--line);
    padding:5px 6px;font-size:10.5px;
  }
  table.items tfoot tr.grand td{
    background:#0e7a4f;color:#fff;border-color:#0a5c3b;
    font-size:11px;letter-spacing:.5px;
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
  table.totals td.amt{
    text-align:right;width:30mm;font-weight:700;
    font-family:"Consolas","Courier New",monospace;
  }
  table.totals tr.net td{
    background:#0e7a4f;color:#fff;font-weight:800;font-size:12px;
    border-color:#0a5c3b;
  }
  .sec-title{
    font-size:8.5px;font-weight:800;letter-spacing:1.2px;color:var(--pri);
    text-transform:uppercase;margin:10px 0 4px;
    border-bottom:1px solid #d3dde6;padding-bottom:3px;
    display:flex;justify-content:space-between;align-items:baseline;
  }
  .sec-title .mini{
    font-size:8px;font-weight:700;letter-spacing:.4px;
    color:var(--muted);text-transform:none;
  }
  table.alloc{width:100%;border-collapse:collapse;font-size:9.5px;}
  table.alloc th{
    background:var(--soft);border:1px solid var(--line);padding:4px 6px;
    text-align:left;font-size:8px;letter-spacing:.7px;text-transform:uppercase;
    color:var(--pri);font-weight:800;
  }
  table.alloc td{border:1px solid var(--line);padding:4px 6px;height:19px;}
  table.alloc tbody tr:nth-child(even) td{background:#fafcfe;}
  table.alloc tfoot td{background:var(--soft);font-weight:800;border:1px solid var(--line);}
  .pill{
    display:inline-block;font-size:7.5px;font-weight:800;letter-spacing:.6px;
    padding:1.5px 7px;border-radius:20px;text-transform:uppercase;
    background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;
  }
  .pill.warn{background:var(--warn-bg);color:var(--warn);border-color:#e8d4a4;}
  .paymethod{
    display:flex;flex-wrap:wrap;align-items:center;gap:5px 14px;
    margin-top:9px;padding:8px 10px;
    border:1px dashed #b9c6d2;border-radius:5px;
    background:#fbfcfd;font-size:10px;
  }
  .paymethod .pm-title{
    font-size:8.5px;font-weight:800;letter-spacing:1px;
    color:var(--pri);text-transform:uppercase;margin-right:2px;
  }
  .pm-item{color:#33414d;white-space:nowrap;}
  .pm-ref{margin-left:auto;color:#33414d;display:flex;align-items:baseline;gap:6px;}
  table.trail{width:100%;border-collapse:collapse;font-size:9.5px;}
  table.trail th{
    background:var(--soft);border:1px solid var(--line);padding:4px 6px;
    text-align:left;font-size:8px;letter-spacing:.7px;text-transform:uppercase;
    color:var(--pri);font-weight:800;
  }
  table.trail td{border:1px solid var(--line);padding:4px 6px;}
  .role{color:var(--muted);}
  .spacer{flex:1 1 auto;min-height:5mm;}
  .signs{display:grid;grid-template-columns:repeat(4,1fr);gap:9mm;margin-top:2mm;}
  .sign .blank{height:26px;border-bottom:1px solid #444;}
  .sign .lbl{
    padding-top:4px;text-align:center;font-size:9.5px;font-weight:800;
    color:#33414d;letter-spacing:.4px;
  }
  .sign .sub{text-align:center;font-size:8px;color:var(--muted);margin-top:1px;}
  .foot{
    margin-top:9px;padding-top:6px;border-top:1px solid #d3dde6;
    display:flex;justify-content:space-between;gap:12px;align-items:flex-end;
    font-size:8.5px;color:var(--muted);
  }
  .foot .fnote{max-width:108mm;}
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
        <div class="dt">RECEIPT VOUCHER</div>
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
        <div class="v sm">${isCash ? 'Cash Receipt (CRV)' : 'Bank Receipt (BRV)'}</div>
      </div>
      <div class="cell">
        <div class="k">Currency / Rate</div>
        <div class="v sm">${escapeHtml(state.config.currencyCode || 'BDT')} &nbsp;·&nbsp; 1.0000</div>
      </div>
      <div class="cell">
        <div class="k">Mode of Receipt</div>
        <div class="v sm">${escapeHtml(mode)}</div>
      </div>
      <div class="cell">
        <div class="k">Deposit Slip / Ref. No.</div>
        <div class="v mono">${escapeHtml(voucher.bankReferenceNo || '—')}</div>
      </div>
      <div class="cell">
        <div class="k">Received Against</div>
        <div class="v sm">${voucher.linkedSourceDocs.length > 0 ? 'Sales Invoice(s) — Credit' : 'Customer Collection / Advance'}</div>
      </div>
      <div class="cell">
        <div class="k">Sales Order / Contract</div>
        <div class="v mono">${escapeHtml(soDoc)}</div>
      </div>
      <div class="cell">
        <div class="k">Value Date / Clearing</div>
        <div class="v sm">${escapeHtml(fmtDateDisplay(voucher.voucherDate))} &nbsp;/&nbsp; ${escapeHtml(fmtDateDisplay(voucher.postingDate))}</div>
      </div>
      <div class="cell">
        <div class="k">Cost Center / Project</div>
        <div class="v sm">${escapeHtml(voucher.costCenter || 'CC-HO')} &nbsp;/&nbsp; ${escapeHtml(voucher.department || voucher.linkedProject || 'Operations')}</div>
      </div>
    </div>

    <div class="parties">
      <div class="panel">
        <div class="ph">Received From / Customer Master</div>
        <div class="pb">
          <div class="kv"><span class="kk">Customer</span><span class="vv strong">${escapeHtml(voucher.customerName || customer?.name || '—')}</span></div>
          <div class="kv"><span class="kk">Code</span><span class="vv mono">${escapeHtml(customer?.code || voucher.customerId || '—')}</span></div>
          <div class="kv"><span class="kk">Address</span><span class="vv">${escapeHtml(customer?.city || 'Dhaka, Bangladesh')}</span></div>
          <div class="kv"><span class="kk">Contact</span><span class="vv">${escapeHtml(customer?.phone || '—')} &nbsp;·&nbsp; ${escapeHtml(customer?.email || '—')}</span></div>
          <div class="kv"><span class="kk">TIN / BIN</span><span class="vv mono">TIN: ${escapeHtml(customer?.vat || '—')} &nbsp;·&nbsp; BIN: ${escapeHtml(customer?.binNumber || '—')}</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="ph">Credit Account / Bank Deposit</div>
        <div class="pb">
          <div class="kv"><span class="kk">Account</span><span class="vv strong">${escapeHtml(bankAcc?.name || 'Corporate Bank Account')}</span></div>
          <div class="kv"><span class="kk">GL Code</span><span class="vv mono">${escapeHtml(depositToGl)}</span></div>
          <div class="kv"><span class="kk">Channel</span><span class="vv">${escapeHtml(mode)}</span></div>
          <div class="kv"><span class="kk">Remitter</span><span class="vv">${escapeHtml(voucher.customerName || customer?.name || '—')}</span></div>
          <div class="kv"><span class="kk">Ref. No.</span><span class="vv mono">${escapeHtml(voucher.bankReferenceNo || '—')}</span></div>
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
        <div class="wv">${escapeHtml(numberToTakaWords(netReceived))}</div>
        <div class="wn">Received in settlement of customer account / invoices listed in the allocation table below.</div>
      </div>

      <table class="totals">
        <tr><td class="lbl">Amount Received (Gross)</td><td class="amt">${fmtMoney(grossReceived)}</td></tr>
        <tr><td class="lbl">Less: Bank Charge</td><td class="amt">${fmtMoney(bankCharge)}</td></tr>
        <tr><td class="lbl">Less: Discount / Rebate</td><td class="amt">${fmtMoney(discount)}</td></tr>
        <tr class="net"><td class="lbl">NET AMOUNT RECEIVED</td><td class="amt">${fmtMoney(netReceived)}</td></tr>
      </table>
    </div>

    <div class="sec-title">
      Invoice Allocation / Adjustment
      <span class="mini">Auto-matched by ERP — FIFO rule applied</span>
    </div>
    <table class="alloc">
      <thead>
        <tr>
          <th style="width:8mm" class="t-c">#</th>
          <th style="width:32mm">Invoice No.</th>
          <th style="width:24mm">Invoice Date</th>
          <th style="width:22mm">Due Date</th>
          <th class="t-r" style="width:26mm">Invoice Amount</th>
          <th class="t-r" style="width:26mm">Adjusted Now</th>
          <th class="t-r" style="width:26mm">Balance After</th>
          <th class="t-c" style="width:22mm">Status</th>
        </tr>
      </thead>
      <tbody>
        ${allocRowsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4" class="t-r">TOTAL ADJUSTED</td>
          <td class="t-r mono">${fmtMoney(totalAllocInv)}</td>
          <td class="t-r mono">${fmtMoney(totalAllocAdj)}</td>
          <td class="t-r mono">${fmtMoney(totalAllocBal)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <div class="paymethod">
      <span class="pm-title">Instrument:</span>
      <span class="pm-item">${isCash ? '☑' : '☐'} Cash</span>
      <span class="pm-item">${isCheque ? '☑' : '☐'} Cheque</span>
      <span class="pm-item">${isBankEft ? '☑' : '☐'} Bank Transfer / EFT</span>
      <span class="pm-item">${isPayOrder ? '☑' : '☐'} Pay Order</span>
      <span class="pm-item">${isMobile ? '☑' : '☐'} bKash / Mobile Banking</span>
      <span class="pm-ref">Instrument / Cheque No.: <b class="mono">${escapeHtml(voucher.bankReferenceNo || '—')}</b></span>
    </div>

    <div class="sec-title">Receipt &amp; Posting Trail</div>
    <table class="trail">
      <thead>
        <tr>
          <th style="width:8mm" class="t-c">Step</th>
          <th style="width:26mm">Action</th>
          <th style="width:32mm">User / Role</th>
          <th style="width:26mm">Date &amp; Time</th>
          <th>Remarks</th>
          <th style="width:22mm" class="t-c">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="t-c">1</td>
          <td>Created</td>
          <td>${escapeHtml(printedBy)} — <span class="role">Accounts Officer</span></td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.voucherDate))}</td>
          <td>${escapeHtml(voucher.narration || 'Receipt voucher created in ATCL ERP')}</td>
          <td class="t-c"><span class="pill">Completed</span></td>
        </tr>
        <tr>
          <td class="t-c">2</td>
          <td>Verified</td>
          <td>Accounts Manager</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Bank statement / deposit slip matched in A/C ${escapeHtml(depositToGl)}</td>
          <td class="t-c"><span class="pill ${isPosted ? '' : 'warn'}">${isPosted ? 'Completed' : 'Pending'}</span></td>
        </tr>
        <tr>
          <td class="t-c">3</td>
          <td>Approved</td>
          <td>Chief Financial Officer</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Approved for AR adjustment &amp; GL posting</td>
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
      <div class="sign"><div class="blank"></div><div class="lbl">Prepared By</div><div class="sub">Accounts Officer</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Verified By</div><div class="sub">Accounts Manager</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Approved By</div><div class="sub">Chief Financial Officer</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Received By</div><div class="sub">Cashier / Bank Seal</div></div>
    </div>

    <div class="foot">
      <div class="fnote">
        <b>System-generated document.</b> No manual alteration permitted. This receipt is valid only
        when posted in the ATCL ERP and reconciled with the bank statement.
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
          <i style="width:2px"></i><i style="width:1px"></i><i style="width:3px"></i><i style="width:1px"></i>
        </div>
        <div class="hash">${escapeHtml(voucher.voucherRef)} · ${escapeHtml(voucher.id)}</div>
        <div>ATCL ERP · Printed by <b>${escapeHtml(printedBy)}</b> · ${escapeHtml(printedTimestamp)} · Page <b>1 of 1</b></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function openReceiptVoucherPrintPreview(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy?: string
): void {
  const html = buildReceiptVoucherHtml(voucher, state, printedBy);
  const win = window.open('', '_blank', 'width=960,height=1050');
  if (!win) {
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

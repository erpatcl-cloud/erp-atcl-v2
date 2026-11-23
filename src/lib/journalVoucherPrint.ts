import type { LedgerState, VoucherRecord } from '../types/accounting.ts';
import {
  escapeHtml,
  fmtDateDisplay,
  fmtMoney,
  numberToTakaWords,
} from './paymentVoucherPrint.ts';

export function buildJournalVoucherHtml(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy = 'accounts@atclbd.com'
): string {
  const accountMap = new Map(state.accounts.map((a) => [a.code, a]));
  const fallbackAmount = voucher.totalAmount || 0;

  const rawLines =
    voucher.doubleEntryLines && voucher.doubleEntryLines.length > 0
      ? voucher.doubleEntryLines.map((l) => ({
          glCode: l.glCode,
          glName: accountMap.get(l.glCode)?.name || l.glName || l.memo || 'GL Account',
          narration: l.memo || voucher.narration || 'Journal adjustment entry',
          costCenter: voucher.costCenter || 'CC-HO',
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        }))
      : [
          {
            glCode: '5010',
            glName: accountMap.get('5010')?.name || 'Operating / Adjustment Expense',
            narration: voucher.narration || 'Journal debit adjustment',
            costCenter: voucher.costCenter || 'CC-HO',
            debit: fallbackAmount,
            credit: 0,
          },
          {
            glCode: '2200',
            glName: accountMap.get('2200')?.name || 'Accrued Liabilities / Adjustment Control',
            narration: voucher.narration || 'Journal credit adjustment',
            costCenter: voucher.costCenter || 'CC-HO',
            debit: 0,
            credit: fallbackAmount,
          },
        ];

  const totalDebit = rawLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = rawLines.reduce((s, l) => s + l.credit, 0);
  const diff = Math.abs(totalDebit - totalCredit);
  const isBalanced = diff <= 0.005;

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

  const debitLines = rawLines.filter((l) => l.debit > 0);
  const creditLines = rawLines.filter((l) => l.credit > 0);
  const hasAutoReverse = Boolean(voucher.autoReverseDate);

  const reversalRowsHtml = hasAutoReverse
    ? debitLines
        .map((dl, idx) => {
          const cl = creditLines[idx] || creditLines[0];
          const revAmt = Math.min(dl.debit, cl ? cl.credit : dl.debit);
          return `
        <tr>
          <td class="t-c">${idx + 1}</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.autoReverseDate))}</td>
          <td>Auto — Next Period</td>
          <td class="mono">${escapeHtml(cl?.glCode || '—')}</td>
          <td class="mono">${escapeHtml(dl.glCode)}</td>
          <td class="t-r mono">${fmtMoney(revAmt)}</td>
          <td class="t-c"><span class="pill">Scheduled</span></td>
        </tr>`;
        })
        .join('')
    : `
        <tr>
          <td class="t-c">—</td>
          <td class="mono">N/A</td>
          <td>Permanent Entry (No Auto-Reverse)</td>
          <td class="mono">—</td>
          <td class="mono">—</td>
          <td class="t-r mono">0.00</td>
          <td class="t-c"><span class="pill warn">Disabled</span></td>
        </tr>`;

  const sourceDocRowsHtml =
    voucher.linkedSourceDocs.length > 0
      ? voucher.linkedSourceDocs
          .map(
            (doc) => `
              <tr>
                <td class="mono">${escapeHtml(doc.docType)} · ${escapeHtml(doc.docRef)}</td>
                <td>${escapeHtml(doc.label || 'Linked Source Document')}</td>
                <td class="t-r mono">${fmtMoney(doc.amount)}</td>
              </tr>`
          )
          .join('')
      : `
              <tr>
                <td class="mono">${escapeHtml(voucher.voucherRef)}</td>
                <td>Direct GL Journal Entry</td>
                <td class="t-r mono">${fmtMoney(totalDebit)}</td>
              </tr>`;

  const isPosted = voucher.postedToGl || voucher.status === 'Auto-Approved';
  const statusLabel = voucher.postedToGl ? '● POSTED' : `● ${voucher.status.toUpperCase()}`;
  const badgeType = voucher.postingType
    ? `● ${voucher.postingType.toUpperCase()}`
    : '● ADJUSTING / ACCRUAL';
  const refDoc =
    voucher.bankReferenceNo || voucher.linkedSourceDocs[0]?.docRef || voucher.voucherRef;
  const printedTimestamp = `${fmtDateDisplay(new Date().toISOString())} ${new Date().toTimeString().slice(0, 5)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Journal Voucher ${escapeHtml(voucher.voucherRef)} — ATCL ERP</title>
<style>
  :root{
    --pri:#4527a0;
    --pri-dark:#2d1b69;
    --accent:#7e57c2;
    --ink:#1a1a1a;
    --muted:#6b7b8a;
    --line:#a8b7c4;
    --soft:#f1eef9;
    --ok:#1e7e34;
    --ok-bg:#e6f4ea;
    --warn:#8a5a00;
    --warn-bg:#fff6e0;
    --danger:#b02a37;
    --danger-bg:#fbe9eb;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    background:#e8ecf1;
    font-family:"Segoe UI",Tahoma,Arial,Helvetica,sans-serif;
    color:var(--ink);
    font-size:10.5px;
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
    box-shadow:0 2px 8px rgba(69,39,160,.35);
  }
  .toolbar button:hover{background:var(--pri-dark);}
  .toolbar small{display:block;margin-top:8px;color:#5b6b7a;font-size:11.5px;}
  .page{
    width:210mm;min-height:297mm;
    margin:0 auto 26px;background:#fff;
    padding:10mm 12mm 8mm;
    box-shadow:0 6px 26px rgba(0,0,0,.18);
    display:flex;flex-direction:column;
    position:relative;
  }
  .page::before{
    content:"";position:absolute;top:0;left:0;right:0;height:4.5mm;
    background:linear-gradient(90deg,var(--pri) 0%,var(--pri) 58%,var(--accent) 100%);
  }
  .hdr{
    display:flex;align-items:center;gap:11px;
    padding-top:3mm;padding-bottom:6px;
    border-bottom:3px double var(--pri);
  }
  .logo{
    width:50px;height:50px;flex:0 0 auto;border-radius:9px;
    background:var(--pri);color:#fff;display:flex;align-items:center;
    justify-content:center;font-weight:800;font-size:15px;letter-spacing:.5px;
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);
  }
  .company h1{
    margin:0;font-size:16px;font-weight:800;color:var(--pri);
    letter-spacing:.3px;text-transform:uppercase;
  }
  .company p{margin:2px 0 0;font-size:9.5px;color:#33414d;}
  .company p.tel{font-weight:700;color:var(--pri);}
  .docbadge{margin-left:auto;flex:0 0 auto;text-align:right;}
  .docbadge .dt{
    font-size:12.5px;font-weight:800;letter-spacing:1.8px;color:var(--pri);
    border:1.5px solid var(--pri);border-radius:4px;padding:5px 10px;
  }
  .docbadge .st{
    margin-top:5px;display:inline-block;font-size:8.5px;font-weight:800;
    letter-spacing:1px;padding:3px 9px;border-radius:20px;
    background:var(--soft);color:var(--pri);border:1px solid #cfc3ea;
  }
  .meta{
    display:grid;grid-template-columns:repeat(4,1fr);
    gap:0;margin-top:8px;
    border:1px solid var(--line);border-radius:4px;overflow:hidden;
  }
  .cell{
    padding:4.5px 8px;border-right:1px solid #d3dde6;border-bottom:1px solid #d3dde6;
    min-height:31px;
  }
  .cell:nth-child(4n){border-right:0;}
  .cell:nth-last-child(-n+4){border-bottom:0;}
  .cell .k{
    font-size:7.5px;font-weight:800;letter-spacing:.9px;color:var(--muted);
    text-transform:uppercase;margin-bottom:2px;
  }
  .cell .v{font-size:10px;font-weight:700;color:#153a5c;word-break:break-word;}
  .cell .v.sm{font-size:9px;font-weight:600;color:#33414d;}
  .cell .v .tag{
    display:inline-block;font-size:7.5px;font-weight:800;padding:1px 6px;
    border-radius:20px;letter-spacing:.4px;
  }
  .tag-ok{background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;}
  .tag-warn{background:var(--warn-bg);color:var(--warn);border:1px solid #e8d4a4;}
  table.items{width:100%;border-collapse:collapse;margin-top:8px;font-size:9.5px;}
  table.items th{
    background:var(--pri);color:#fff;border:1px solid var(--pri-dark);
    padding:4.5px 5px;text-align:left;font-size:8px;
    letter-spacing:.7px;text-transform:uppercase;font-weight:800;
  }
  table.items td{
    border:1px solid var(--line);padding:3.5px 5px;vertical-align:top;height:19px;
  }
  table.items tbody tr:nth-child(even) td{background:#faf9fe;}
  .t-c{text-align:center;}
  .t-r{text-align:right;}
  .c-sl{width:7mm;}
  .c-acc{width:21mm;}
  .c-name{width:36mm;}
  .c-cc{width:12mm;}
  .c-amt{width:21mm;}
  table.items tfoot td{
    font-weight:800;background:var(--soft);border:1px solid var(--line);
    padding:5px;font-size:10.5px;
  }
  table.items tfoot tr.grand td{
    background:var(--pri);color:#fff;border-color:var(--pri-dark);
    font-size:10.5px;letter-spacing:.5px;
  }
  .balance-check{
    display:flex;align-items:stretch;margin-top:6px;
    border:1.5px solid #b7dfc2;border-radius:5px;overflow:hidden;
    background:#f3faf5;
  }
  .balance-check.unbalanced{border-color:#e5b2b7;background:var(--danger-bg);}
  .bc-item{flex:1;padding:6px 11px;border-right:1px solid #cfe8d8;}
  .bc-item:last-child{border-right:0;}
  .bc-item span{
    display:block;font-size:7.5px;font-weight:800;letter-spacing:.8px;
    color:#5b7a66;text-transform:uppercase;
  }
  .bc-item b{
    display:block;font-size:12px;font-weight:800;color:#153a5c;
    font-family:"Consolas","Courier New",monospace;margin-top:1px;
  }
  .bc-item b.ok{color:var(--ok);}
  .bc-item b.ng{color:var(--danger);}
  .bc-status{
    flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    padding:0 16px;background:var(--ok);color:#fff;
    font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;
  }
  .bc-status.fail{background:var(--danger);}
  .summary{display:grid;grid-template-columns:1fr 76mm;gap:8px;margin-top:8px;}
  .words-box{
    border:1px solid var(--line);border-radius:4px;padding:6px 9px;
    background:#fdfefe;display:flex;flex-direction:column;justify-content:center;
  }
  .words-box .wl{
    font-size:8px;font-weight:800;letter-spacing:1px;color:var(--pri);
    text-transform:uppercase;margin-bottom:3px;
  }
  .words-box .wv{
    font-size:10.5px;font-weight:800;color:#153a5c;font-style:italic;
    border-bottom:1px dotted #8d9aa8;padding-bottom:2px;
  }
  .words-box .wn{font-size:8px;color:var(--muted);margin-top:3px;}
  table.totals{width:100%;border-collapse:collapse;font-size:10px;}
  table.totals td{border:1px solid var(--line);padding:4px 7px;}
  table.totals td.lbl{color:#33414d;font-weight:600;}
  table.totals td.amt{
    text-align:right;width:32mm;font-weight:700;
    font-family:"Consolas","Courier New",monospace;
  }
  table.totals tr.net td{
    background:var(--pri);color:#fff;font-weight:800;font-size:11px;
    border-color:var(--pri-dark);
  }
  .sec-title{
    font-size:8px;font-weight:800;letter-spacing:1.1px;color:var(--pri);
    text-transform:uppercase;margin:8px 0 3px;
    border-bottom:1px solid #d3dde6;padding-bottom:3px;
    display:flex;justify-content:space-between;align-items:baseline;
  }
  .sec-title .mini{
    font-size:7.5px;font-weight:700;letter-spacing:.4px;
    color:var(--muted);text-transform:none;
  }
  table.reverse{width:100%;border-collapse:collapse;font-size:9px;}
  table.reverse th{
    background:var(--soft);border:1px solid var(--line);padding:3.5px 5px;
    text-align:left;font-size:7.5px;letter-spacing:.6px;text-transform:uppercase;
    color:var(--pri);font-weight:800;
  }
  table.reverse td{border:1px solid var(--line);padding:3.5px 5px;height:18px;}
  table.reverse tbody tr:nth-child(even) td{background:#faf9fe;}
  .pill{
    display:inline-block;font-size:7px;font-weight:800;letter-spacing:.5px;
    padding:1.5px 6px;border-radius:20px;text-transform:uppercase;
    background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;
  }
  .pill.warn{background:var(--warn-bg);color:var(--warn);border-color:#e8d4a4;}
  .rev-note{font-size:8px;color:var(--muted);margin-top:3px;font-style:italic;}
  .workings{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px;}
  .work-panel{border:1px solid var(--line);border-radius:4px;overflow:hidden;}
  .work-panel .wh{
    background:var(--soft);color:var(--pri);font-size:8px;font-weight:800;
    letter-spacing:.9px;text-transform:uppercase;padding:3.5px 8px;
    border-bottom:1px solid var(--line);
  }
  .work-panel .wb{padding:6px 8px;}
  table.mini{width:100%;border-collapse:collapse;font-size:8.5px;}
  table.mini th{
    border-bottom:1px solid var(--line);padding:2px 3px;text-align:left;
    font-size:7px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);
  }
  table.mini td{border-bottom:1px dotted #d3dde6;padding:2.5px 3px;}
  table.mini tbody tr:last-child td{border-bottom:0;}
  table.mini tfoot td{border-top:1px solid var(--line);padding:3px;font-weight:800;}
  .accrual-list div{
    font-size:8.5px;color:#33414d;padding:2.5px 0;border-bottom:1px dotted #e2e8ee;
    line-height:1.35;
  }
  .accrual-list div:last-child{border-bottom:0;}
  .accrual-list b{color:var(--pri);font-weight:800;}
  table.trail{width:100%;border-collapse:collapse;font-size:9px;}
  table.trail th{
    background:var(--soft);border:1px solid var(--line);padding:3.5px 5px;
    text-align:left;font-size:7.5px;letter-spacing:.6px;text-transform:uppercase;
    color:var(--pri);font-weight:800;
  }
  table.trail td{border:1px solid var(--line);padding:3.5px 5px;height:17px;}
  .role{color:var(--muted);}
  .spacer{flex:1 1 auto;min-height:4mm;}
  .signs{display:grid;grid-template-columns:repeat(4,1fr);gap:8mm;margin-top:2mm;}
  .sign .blank{height:24px;border-bottom:1px solid #444;}
  .sign .lbl{
    padding-top:3px;text-align:center;font-size:9px;font-weight:800;
    color:#33414d;letter-spacing:.4px;
  }
  .sign .sub{text-align:center;font-size:7.5px;color:var(--muted);margin-top:1px;}
  .foot{
    margin-top:7px;padding-top:5px;border-top:1px solid #d3dde6;
    display:flex;justify-content:space-between;gap:12px;align-items:flex-end;
    font-size:8px;color:var(--muted);
  }
  .foot .fnote{max-width:108mm;}
  .foot b{color:#4a5a68;}
  .foot .hash{font-family:"Consolas","Courier New",monospace;letter-spacing:.3px;}
  .barcode{display:flex;align-items:flex-end;gap:1px;height:14px;margin-bottom:2px;justify-content:flex-end;}
  .barcode i{display:block;background:#1a1a1a;height:100%;}
  @page{size:A4 portrait;margin:0;}
  @media print{
    body{background:#fff;}
    .toolbar{display:none !important;}
    .page{width:210mm;min-height:296mm;margin:0;box-shadow:none;padding:10mm 12mm 8mm;}
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
        <div class="dt">JOURNAL VOUCHER</div>
        <span class="st">${escapeHtml(badgeType)}</span>
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
        <div class="k">Journal Type</div>
        <div class="v sm">${escapeHtml(voucher.postingType || 'Adjusting Entry')}</div>
      </div>
      <div class="cell">
        <div class="k">Source Module</div>
        <div class="v sm">${escapeHtml(voucher.linkedProject || 'General Ledger')}</div>
      </div>
      <div class="cell">
        <div class="k">Reference / Schedule</div>
        <div class="v mono">${escapeHtml(refDoc)}</div>
      </div>
      <div class="cell">
        <div class="k">Auto-Reverse</div>
        <div class="v sm">
          <span class="tag ${hasAutoReverse ? 'tag-ok' : 'tag-warn'}">${hasAutoReverse ? 'ENABLED' : 'DISABLED'}</span>
          ${hasAutoReverse ? ` &nbsp;${escapeHtml(fmtDateDisplay(voucher.autoReverseDate))}` : ''}
        </div>
      </div>
      <div class="cell">
        <div class="k">Batch / Journal ID</div>
        <div class="v mono">${escapeHtml(voucher.postedVoucherNo || 'Unposted')}</div>
      </div>
      <div class="cell">
        <div class="k">Currency / Rate</div>
        <div class="v sm">${escapeHtml(state.config.currencyCode || 'BDT')} &nbsp;·&nbsp; 1.0000</div>
      </div>
      <div class="cell">
        <div class="k">Cost Center / Project</div>
        <div class="v sm">${escapeHtml(voucher.costCenter || 'CC-HO')} &nbsp;/&nbsp; ${escapeHtml(voucher.department || voucher.linkedProject || 'Operations')}</div>
      </div>
      <div class="cell">
        <div class="k">Status</div>
        <div class="v"><span class="tag ${isPosted ? 'tag-ok' : 'tag-warn'}">${escapeHtml(statusLabel)}</span></div>
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
          <td colspan="5" class="t-r">TOTAL JOURNAL AMOUNT</td>
          <td class="t-r mono">${fmtMoney(totalDebit)}</td>
          <td class="t-r mono">${fmtMoney(totalCredit)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="balance-check ${isBalanced ? '' : 'unbalanced'}">
      <div class="bc-item">
        <span>Total Debits</span>
        <b class="${isBalanced ? 'ok' : 'ng'}">${fmtMoney(totalDebit)}</b>
      </div>
      <div class="bc-item">
        <span>Total Credits</span>
        <b class="${isBalanced ? 'ok' : 'ng'}">${fmtMoney(totalCredit)}</b>
      </div>
      <div class="bc-item">
        <span>Difference</span>
        <b class="${isBalanced ? 'ok' : 'ng'}">${fmtMoney(diff)}</b>
      </div>
      <div class="bc-status ${isBalanced ? '' : 'fail'}">${isBalanced ? '✓ Double-Entry Balanced' : '✕ Unbalanced Entry'}</div>
    </div>

    <div class="summary">
      <div class="words-box">
        <div class="wl">Amount in Words</div>
        <div class="wv">${escapeHtml(numberToTakaWords(totalDebit))}</div>
        <div class="wn">${escapeHtml(voucher.narration || 'Being journal adjusting / accrual entry recorded in ATCL ERP.')}</div>
      </div>

      <table class="totals">
        <tr><td class="lbl">Debit Lines (${debitLines.length})</td><td class="amt">${fmtMoney(totalDebit)}</td></tr>
        <tr><td class="lbl">Credit Lines (${creditLines.length})</td><td class="amt">${fmtMoney(totalCredit)}</td></tr>
        <tr><td class="lbl">Posting Type</td><td class="amt">${escapeHtml(voucher.postingType || 'Standard')}</td></tr>
        <tr class="net"><td class="lbl">TOTAL JOURNAL AMOUNT</td><td class="amt">${fmtMoney(totalDebit)}</td></tr>
      </table>
    </div>

    <div class="sec-title">
      Auto-Reverse Schedule
      <span class="mini">Generated by ERP scheduler · ${hasAutoReverse ? 'Scheduled for next period' : 'Manual / Permanent posting'}</span>
    </div>
    <table class="reverse">
      <thead>
        <tr>
          <th style="width:7mm" class="t-c">#</th>
          <th style="width:23mm">Reversal Date</th>
          <th style="width:24mm">Reversal Type</th>
          <th style="width:24mm">Debit Account</th>
          <th style="width:24mm">Credit Account</th>
          <th class="t-r" style="width:20mm">Amount (BDT)</th>
          <th class="t-c" style="width:21mm">Status</th>
        </tr>
      </thead>
      <tbody>
        ${reversalRowsHtml}
      </tbody>
    </table>
    <div class="rev-note">
      Note: ${
        hasAutoReverse
          ? `Reversal entries are scheduled for ${escapeHtml(fmtDateDisplay(voucher.autoReverseDate))}. Manual review is recommended before posting.`
          : 'No auto-reversal date is configured on this journal voucher; entries remain permanent in the General Ledger.'
      }
    </div>

    <div class="sec-title">
      Supporting Workings / Calculation Basis
      <span class="mini">Attached to voucher ${escapeHtml(voucher.voucherRef)}</span>
    </div>
    <div class="workings">
      <div class="work-panel">
        <div class="wh">Source Documents &amp; Reference Basis</div>
        <div class="wb">
          <table class="mini">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Description</th>
                <th class="t-r">Amount (BDT)</th>
              </tr>
            </thead>
            <tbody>
              ${sourceDocRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" class="t-r">Total Journal Value</td>
                <td class="t-r mono">${fmtMoney(totalDebit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div class="work-panel">
        <div class="wh">Accrual, Reclass &amp; Audit Notes</div>
        <div class="wb">
          <div class="accrual-list">
            <div><b>Narration:</b> ${escapeHtml(voucher.narration || 'Journal adjustment recorded per accounting policy.')}</div>
            <div><b>Department / Cost Ctr:</b> ${escapeHtml(voucher.department || 'Finance & Accounts')} · ${escapeHtml(voucher.costCenter || 'CC-HO')}</div>
            <div><b>Attachments:</b> ${voucher.attachments.length > 0 ? escapeHtml(voucher.attachments.map((a) => a.name).join(', ')) : 'Supporting working schedule filed in ERP'}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="sec-title">Approval &amp; Posting Trail</div>
    <table class="trail">
      <thead>
        <tr>
          <th style="width:7mm" class="t-c">Step</th>
          <th style="width:24mm">Action</th>
          <th style="width:32mm">User / Role</th>
          <th style="width:25mm">Date &amp; Time</th>
          <th>Remarks</th>
          <th style="width:20mm" class="t-c">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="t-c">1</td>
          <td>Created</td>
          <td>${escapeHtml(printedBy)} — <span class="role">Accounts Officer</span></td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.voucherDate))}</td>
          <td>${escapeHtml(voucher.narration || 'Journal voucher prepared in ATCL ERP')}</td>
          <td class="t-c"><span class="pill">Completed</span></td>
        </tr>
        <tr>
          <td class="t-c">2</td>
          <td>Verified</td>
          <td>Accounts Manager</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Supporting workings &amp; double-entry balance verified</td>
          <td class="t-c"><span class="pill ${isPosted ? '' : 'warn'}">${isPosted ? 'Completed' : 'Pending'}</span></td>
        </tr>
        <tr>
          <td class="t-c">3</td>
          <td>Approved</td>
          <td>Chief Financial Officer</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Approved for GL posting${hasAutoReverse ? ' and auto-reverse scheduling' : ''}</td>
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
      <div class="sign"><div class="blank"></div><div class="lbl">Reviewed By</div><div class="sub">Internal Audit / Controller</div></div>
    </div>

    <div class="foot">
      <div class="fnote">
        <b>System-generated document.</b> No manual alteration permitted. This journal voucher is valid
        only when posted in the ATCL ERP and supported by approved workings and supporting schedules.
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

export function openJournalVoucherPrintPreview(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy?: string
): void {
  const html = buildJournalVoucherHtml(voucher, state, printedBy);
  const win = window.open('', '_blank', 'width=960,height=1050');
  if (!win) {
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

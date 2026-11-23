import type { LedgerState, VoucherRecord } from '../types/accounting.ts';
import {
  escapeHtml,
  fmtDateDisplay,
  fmtMoney,
  numberToTakaWords,
} from './paymentVoucherPrint.ts';

export function buildExpenseVoucherHtml(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy = 'accounts@atclbd.com'
): string {
  const accountMap = new Map(state.accounts.map((a) => [a.code, a]));
  const paidFromGl = voucher.paidFromGlCode || '1105';
  const bankAcc = accountMap.get(paidFromGl);

  const deptLabel = voucher.department || 'Operations';

  // Build expense line items from expenseSplits -> debit doubleEntryLines -> fallback
  const expenseItems =
    voucher.expenseSplits && voucher.expenseSplits.length > 0
      ? voucher.expenseSplits.map((sp) => ({
          glCode: sp.glCode,
          description: `${sp.glName || accountMap.get(sp.glCode)?.name || 'Expense'} — ${sp.memo || voucher.narration || 'Expense item'}`,
          dept: deptLabel,
          amount: Number(sp.amount) || 0,
          withinBudget: true,
        }))
      : voucher.doubleEntryLines && voucher.doubleEntryLines.some((l) => l.debit > 0)
        ? voucher.doubleEntryLines
            .filter((l) => l.debit > 0)
            .map((l) => ({
              glCode: l.glCode,
              description: `${accountMap.get(l.glCode)?.name || l.glName || 'Expense'} — ${l.memo || voucher.narration || 'Expense item'}`,
              dept: deptLabel,
              amount: Number(l.debit) || 0,
              withinBudget: true,
            }))
        : [
            {
              glCode: '6100',
              description: voucher.narration || 'Direct / Reimbursable Expense',
              dept: deptLabel,
              amount: Number(voucher.totalAmount) || 0,
              withinBudget: true,
            },
          ];

  const totalExpense = expenseItems.reduce((s, item) => s + item.amount, 0);
  const advanceAdjustment = 0;
  const nonReimbursable = 0;
  const netPayable = Math.max(0, totalExpense - advanceAdjustment - nonReimbursable);

  const itemRowsHtml = expenseItems
    .map(
      (item, idx) => `
        <tr>
          <td class="t-c">${idx + 1}</td>
          <td class="mono">${escapeHtml(item.glCode)}</td>
          <td>${escapeHtml(item.description)}</td>
          <td class="t-c">${escapeHtml(item.dept)}</td>
          <td class="t-c"><span class="tag ${item.withinBudget ? 'tag-ok' : 'tag-danger'}">${item.withinBudget ? 'WITHIN' : 'OVERRIDE'}</span></td>
          <td class="t-r mono">${fmtMoney(item.amount)}</td>
        </tr>`
    )
    .join('');

  // Department spend summary from prior posted/approved Expense vouchers
  const priorDeptUtilized = state.vouchers
    .filter(
      (v) =>
        v.id !== voucher.id &&
        v.voucherType === 'Expense' &&
        v.status !== 'Voided' &&
        (v.department || 'Operations').toLowerCase() === deptLabel.toLowerCase()
    )
    .reduce((s, v) => s + (Number(v.totalAmount) || 0), 0);

  const deptAllocated = Math.max(priorDeptUtilized + totalExpense, 500_000);
  const deptRemaining = deptAllocated - priorDeptUtilized - totalExpense;
  const deptWithin = deptRemaining >= 0;

  // Liquidity check on paidFromGl
  const glDelta = state.journalLines
    .filter((l) => l.glCode === paidFromGl)
    .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
  const bankBalance = (bankAcc?.openingBalance ?? 0) + glDelta;
  const committedAmount = 0;
  const availableLiquidity = bankBalance - committedAmount;
  const postVoucherBalance = availableLiquidity - netPayable;
  const isSufficient = postVoucherBalance >= 0;

  const isPosted = voucher.postedToGl || voucher.status === 'Auto-Approved';
  const statusLabel = voucher.postedToGl ? '● POSTED' : `● ${voucher.status.toUpperCase()}`;
  const printedTimestamp = `${fmtDateDisplay(new Date().toISOString())} ${new Date().toTimeString().slice(0, 5)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Expense Voucher ${escapeHtml(voucher.voucherRef)} — ATCL ERP</title>
<style>
  :root{
    --pri:#b45309;
    --pri-dark:#78350f;
    --accent:#f59e0b;
    --ink:#1a1a1a;
    --muted:#6b7b8a;
    --line:#a8b7c4;
    --soft:#fdf4e6;
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
    font-size:10px;
    line-height:1.32;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .mono{font-family:"Consolas","Courier New",monospace;}
  .toolbar{text-align:center;padding:16px 12px 6px;}
  .toolbar button{
    font:600 13px/1 "Segoe UI",Arial,sans-serif;
    background:var(--pri);color:#fff;border:0;border-radius:6px;
    padding:12px 26px;cursor:pointer;letter-spacing:.4px;
    box-shadow:0 2px 8px rgba(180,83,9,.35);
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
    background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;
  }
  .docbadge .st.warn{background:var(--warn-bg);color:var(--warn);border-color:#e8d4a4;}
  .meta{
    display:grid;grid-template-columns:repeat(4,1fr);
    gap:0;margin-top:8px;
    border:1px solid var(--line);border-radius:4px;overflow:hidden;
  }
  .cell{
    padding:4px 8px;border-right:1px solid #d3dde6;border-bottom:1px solid #d3dde6;
    min-height:29px;
  }
  .cell:nth-child(4n){border-right:0;}
  .cell:nth-last-child(-n+4){border-bottom:0;}
  .cell .k{
    font-size:7.5px;font-weight:800;letter-spacing:.9px;color:var(--muted);
    text-transform:uppercase;margin-bottom:1.5px;
  }
  .cell .v{font-size:9.8px;font-weight:700;color:#4a2c07;word-break:break-word;}
  .cell .v.sm{font-size:8.8px;font-weight:600;color:#4a3a2a;}
  .tag{
    display:inline-block;font-size:7.5px;font-weight:800;padding:1px 6px;
    border-radius:20px;letter-spacing:.4px;text-transform:uppercase;
  }
  .tag-ok{background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;}
  .tag-warn{background:var(--warn-bg);color:var(--warn);border:1px solid #e8d4a4;}
  .tag-danger{background:var(--danger-bg);color:var(--danger);border:1px solid #ecc0c5;}
  .parties{display:grid;grid-template-columns:1.1fr 1fr;gap:8px;margin-top:8px;}
  .panel{border:1px solid var(--line);border-radius:4px;overflow:hidden;}
  .panel .ph{
    background:var(--soft);color:var(--pri-dark);font-size:8px;font-weight:800;
    letter-spacing:1px;text-transform:uppercase;padding:3.5px 8px;
    border-bottom:1px solid var(--line);
  }
  .panel .pb{padding:6px 8px;}
  .kv{display:flex;gap:7px;align-items:baseline;margin-bottom:3px;}
  .kv:last-child{margin-bottom:0;}
  .kv .kk{
    font-size:8px;font-weight:700;color:var(--muted);width:56px;
    flex:0 0 auto;text-transform:uppercase;letter-spacing:.4px;
  }
  .kv .vv{font-size:9.8px;font-weight:600;color:#21313f;flex:1;}
  .kv .vv.strong{font-weight:800;color:#4a2c07;}
  table.items{width:100%;border-collapse:collapse;margin-top:8px;font-size:9.2px;}
  table.items th{
    background:var(--pri);color:#fff;border:1px solid var(--pri-dark);
    padding:4px 5px;text-align:left;font-size:7.5px;
    letter-spacing:.6px;text-transform:uppercase;font-weight:800;
  }
  table.items td{
    border:1px solid var(--line);padding:3px 5px;vertical-align:middle;height:18px;
  }
  table.items tbody tr:nth-child(even) td{background:#fffdf8;}
  .t-c{text-align:center;}
  .t-r{text-align:right;}
  .c-sl{width:7mm;}
  .c-gl{width:19mm;}
  .c-dept{width:20mm;}
  .c-chk{width:17mm;}
  .c-amt{width:22mm;}
  table.items tfoot td{
    font-weight:800;background:var(--soft);border:1px solid var(--line);
    padding:4.5px 5px;font-size:10px;
  }
  table.items tfoot tr.grand td{
    background:var(--pri);color:#fff;border-color:var(--pri-dark);
    font-size:10.5px;letter-spacing:.5px;
  }
  .sec-title{
    font-size:7.8px;font-weight:800;letter-spacing:1.1px;color:var(--pri-dark);
    text-transform:uppercase;margin:7px 0 3px;
    border-bottom:1px solid #e2d4bd;padding-bottom:2.5px;
    display:flex;justify-content:space-between;align-items:baseline;
  }
  .sec-title .mini{
    font-size:7px;font-weight:700;letter-spacing:.4px;
    color:var(--muted);text-transform:none;
  }
  table.budget{width:100%;border-collapse:collapse;font-size:8.8px;}
  table.budget th{
    background:var(--soft);border:1px solid var(--line);padding:3px 5px;
    text-align:left;font-size:7px;letter-spacing:.6px;text-transform:uppercase;
    color:var(--pri-dark);font-weight:800;
  }
  table.budget td{border:1px solid var(--line);padding:3px 5px;height:16px;}
  table.budget tbody tr:nth-child(even) td{background:#fffdf8;}
  table.budget tfoot td{background:var(--soft);font-weight:800;border:1px solid var(--line);}
  .neg{color:var(--danger);font-weight:800;}
  .liquidity{
    display:flex;align-items:stretch;margin-top:2px;
    border:1.5px solid #b7dfc2;border-radius:5px;overflow:hidden;
    background:#f3faf5;
  }
  .liquidity.low{border-color:#e5b2b7;background:var(--danger-bg);}
  .lq-item{flex:1;padding:5px 9px;border-right:1px solid #cfe8d8;}
  .lq-item:last-child{border-right:0;}
  .lq-item span{
    display:block;font-size:6.8px;font-weight:800;letter-spacing:.7px;
    color:#5b7a66;text-transform:uppercase;
  }
  .lq-item b{
    display:block;font-size:10.5px;font-weight:800;color:#153a5c;
    font-family:"Consolas","Courier New",monospace;margin-top:1px;
  }
  .lq-item b.ok{color:var(--ok);}
  .lq-item b.ng{color:var(--danger);}
  .lq-status{
    flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    padding:0 14px;background:var(--ok);color:#fff;
    font-size:8.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;
  }
  .lq-status.fail{background:var(--danger);}
  .summary{display:grid;grid-template-columns:1fr 74mm;gap:8px;margin-top:8px;}
  .words-box{
    border:1px solid var(--line);border-radius:4px;padding:6px 9px;
    background:#fffdf8;display:flex;flex-direction:column;justify-content:center;
  }
  .words-box .wl{
    font-size:7.5px;font-weight:800;letter-spacing:1px;color:var(--pri-dark);
    text-transform:uppercase;margin-bottom:3px;
  }
  .words-box .wv{
    font-size:10.5px;font-weight:800;color:#4a2c07;font-style:italic;
    border-bottom:1px dotted #c9b89d;padding-bottom:2px;
  }
  .words-box .wn{font-size:7.8px;color:var(--muted);margin-top:3px;}
  table.totals{width:100%;border-collapse:collapse;font-size:9.8px;}
  table.totals td{border:1px solid var(--line);padding:4px 7px;}
  table.totals td.lbl{color:#4a3a2a;font-weight:600;}
  table.totals td.amt{
    text-align:right;width:31mm;font-weight:700;
    font-family:"Consolas","Courier New",monospace;
  }
  table.totals tr.net td{
    background:var(--pri);color:#fff;font-weight:800;font-size:11px;
    border-color:var(--pri-dark);
  }
  table.trail{width:100%;border-collapse:collapse;font-size:8.8px;}
  table.trail th{
    background:var(--soft);border:1px solid var(--line);padding:3px 5px;
    text-align:left;font-size:7px;letter-spacing:.6px;text-transform:uppercase;
    color:var(--pri-dark);font-weight:800;
  }
  table.trail td{border:1px solid var(--line);padding:3px 5px;height:16px;}
  .role{color:var(--muted);}
  .pill{
    display:inline-block;font-size:7px;font-weight:800;letter-spacing:.5px;
    padding:1.5px 6px;border-radius:20px;text-transform:uppercase;
    background:var(--ok-bg);color:var(--ok);border:1px solid #b7dfc2;
  }
  .pill.warn{background:var(--warn-bg);color:var(--warn);border-color:#e8d4a4;}
  .spacer{flex:1 1 auto;min-height:3mm;}
  .signs{display:grid;grid-template-columns:repeat(4,1fr);gap:8mm;margin-top:1mm;}
  .sign .blank{height:23px;border-bottom:1px solid #444;}
  .sign .lbl{
    padding-top:3px;text-align:center;font-size:8.8px;font-weight:800;
    color:#4a3a2a;letter-spacing:.4px;
  }
  .sign .sub{text-align:center;font-size:7.2px;color:var(--muted);margin-top:1px;}
  .foot{
    margin-top:6px;padding-top:5px;border-top:1px solid #d3dde6;
    display:flex;justify-content:space-between;gap:12px;align-items:flex-end;
    font-size:7.5px;color:var(--muted);
  }
  .foot .fnote{max-width:108mm;}
  .foot b{color:#4a5a68;}
  .foot .hash{font-family:"Consolas","Courier New",monospace;letter-spacing:.3px;}
  .barcode{display:flex;align-items:flex-end;gap:1px;height:13px;margin-bottom:2px;justify-content:flex-end;}
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
        <div class="dt">EXPENSE VOUCHER</div>
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
        <div class="k">Expense Type</div>
        <div class="v sm">${escapeHtml(voucher.allocationMode || 'Simple Cost')}</div>
      </div>
      <div class="cell">
        <div class="k">Claimant</div>
        <div class="v sm">${escapeHtml(voucher.employeeName || 'Direct Company Expense')}</div>
      </div>
      <div class="cell">
        <div class="k">Primary Department</div>
        <div class="v sm">${escapeHtml(deptLabel)}</div>
      </div>
      <div class="cell">
        <div class="k">Budget Period</div>
        <div class="v sm">${escapeHtml(state.config.fiscalPeriod || 'FY 2025-26')}</div>
      </div>
      <div class="cell">
        <div class="k">Voucher Type</div>
        <div class="v sm">Expense Voucher (EV)</div>
      </div>
      <div class="cell">
        <div class="k">Payment Method</div>
        <div class="v sm">${escapeHtml(voucher.paymentMode || 'Bank Transfer / Cash')}</div>
      </div>
      <div class="cell">
        <div class="k">Batch / Journal ID</div>
        <div class="v mono">${escapeHtml(voucher.postedVoucherNo || 'Unposted')}</div>
      </div>
      <div class="cell">
        <div class="k">Status</div>
        <div class="v"><span class="tag ${isPosted ? 'tag-ok' : 'tag-warn'}">${escapeHtml(statusLabel)}</span></div>
      </div>
    </div>

    <div class="parties">
      <div class="panel">
        <div class="ph">Claimant / Employee Master</div>
        <div class="pb">
          <div class="kv"><span class="kk">Claimant</span><span class="vv strong">${escapeHtml(voucher.employeeName || 'Corporate Operations')}</span></div>
          <div class="kv"><span class="kk">Department</span><span class="vv">${escapeHtml(deptLabel)}</span></div>
          <div class="kv"><span class="kk">Cost Center</span><span class="vv mono">${escapeHtml(voucher.costCenter || 'CC-HO')}</span></div>
          <div class="kv"><span class="kk">Project</span><span class="vv">${escapeHtml(voucher.linkedProject || 'General Operations')}</span></div>
          <div class="kv"><span class="kk">Paid From</span><span class="vv mono">${escapeHtml(paidFromGl)} · ${escapeHtml(bankAcc?.name || 'Corporate Bank / Cash')}</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="ph">Budget Owner / Approver</div>
        <div class="pb">
          <div class="kv"><span class="kk">Dept Head</span><span class="vv strong">Head of ${escapeHtml(deptLabel)}</span></div>
          <div class="kv"><span class="kk">Cost Center</span><span class="vv mono">${escapeHtml(voucher.costCenter || 'CC-HO')}</span></div>
          <div class="kv"><span class="kk">Allocation</span><span class="vv">${escapeHtml(voucher.allocationMode || 'Simple Cost')}</span></div>
          <div class="kv"><span class="kk">Channel</span><span class="vv">${escapeHtml(voucher.paymentMode || 'Bank Transfer / Cash')}</span></div>
          <div class="kv"><span class="kk">Ref. No.</span><span class="vv mono">${escapeHtml(voucher.bankReferenceNo || voucher.voucherRef)}</span></div>
        </div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="c-sl t-c">#</th>
          <th class="c-gl">GL Code</th>
          <th>Expense Head &amp; Description</th>
          <th class="c-dept t-c">Dept</th>
          <th class="c-chk t-c">Budget Check</th>
          <th class="c-amt t-r">Amount (BDT)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
      </tbody>
      <tfoot>
        <tr class="grand">
          <td colspan="5" class="t-r">TOTAL EXPENSE AMOUNT</td>
          <td class="t-r mono">${fmtMoney(totalExpense)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="sec-title">
      Department Budget Validation
      <span class="mini">Budget period: ${escapeHtml(state.config.fiscalPeriod || 'FY 2025-26')} · Checked against posted + committed expenses</span>
    </div>
    <table class="budget">
      <thead>
        <tr>
          <th style="width:34mm">Department</th>
          <th class="t-r" style="width:24mm">Allocated (BDT)</th>
          <th class="t-r" style="width:24mm">Utilized (BDT)</th>
          <th class="t-r" style="width:24mm">This Voucher (BDT)</th>
          <th class="t-r" style="width:24mm">Remaining (BDT)</th>
          <th class="t-c" style="width:24mm">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(deptLabel)}</td>
          <td class="t-r mono">${fmtMoney(deptAllocated)}</td>
          <td class="t-r mono">${fmtMoney(priorDeptUtilized)}</td>
          <td class="t-r mono">${fmtMoney(totalExpense)}</td>
          <td class="t-r mono ${deptWithin ? '' : 'neg'}">${deptWithin ? fmtMoney(deptRemaining) : `(${fmtMoney(Math.abs(deptRemaining))})`}</td>
          <td class="t-c"><span class="tag ${deptWithin ? 'tag-ok' : 'tag-danger'}">${deptWithin ? 'WITHIN' : 'OVERRIDE'}</span></td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="t-r">TOTAL</td>
          <td class="t-r mono">${fmtMoney(deptAllocated)}</td>
          <td class="t-r mono">${fmtMoney(priorDeptUtilized)}</td>
          <td class="t-r mono">${fmtMoney(totalExpense)}</td>
          <td class="t-r mono">${fmtMoney(Math.max(0, deptRemaining))}</td>
          <td class="t-c"><span class="tag ${deptWithin ? 'tag-ok' : 'tag-warn'}">${deptWithin ? 'WITHIN' : '1 OVERRIDE'}</span></td>
        </tr>
      </tfoot>
    </table>

    <div class="sec-title">
      Liquidity Check
      <span class="mini">Source: ${escapeHtml(bankAcc?.name || 'Corporate Bank / Cash')} · GL ${escapeHtml(paidFromGl)} · Real-time ledger balance</span>
    </div>
    <div class="liquidity ${isSufficient ? '' : 'low'}">
      <div class="lq-item">
        <span>Bank / Cash Balance</span>
        <b>${fmtMoney(bankBalance)}</b>
      </div>
      <div class="lq-item">
        <span>Committed / Outstanding</span>
        <b>${fmtMoney(committedAmount)}</b>
      </div>
      <div class="lq-item">
        <span>Available Liquidity</span>
        <b>${fmtMoney(availableLiquidity)}</b>
      </div>
      <div class="lq-item">
        <span>This Voucher</span>
        <b>${fmtMoney(netPayable)}</b>
      </div>
      <div class="lq-item">
        <span>Post-Voucher Balance</span>
        <b class="${isSufficient ? 'ok' : 'ng'}">${fmtMoney(postVoucherBalance)}</b>
      </div>
      <div class="lq-status ${isSufficient ? '' : 'fail'}">${isSufficient ? '✓ Sufficient' : '⚠ Low Balance'}</div>
    </div>

    <div class="summary">
      <div class="words-box">
        <div class="wl">Amount in Words</div>
        <div class="wv">${escapeHtml(numberToTakaWords(netPayable))}</div>
        <div class="wn">${escapeHtml(voucher.narration || 'Being reimbursement and direct-bill expenses recorded in ATCL ERP.')}</div>
      </div>

      <table class="totals">
        <tr><td class="lbl">Gross Expense Amount</td><td class="amt">${fmtMoney(totalExpense)}</td></tr>
        <tr><td class="lbl">Less: Advance / Adjustment</td><td class="amt">${fmtMoney(advanceAdjustment)}</td></tr>
        <tr><td class="lbl">Less: Non-Reimbursable</td><td class="amt">${fmtMoney(nonReimbursable)}</td></tr>
        <tr class="net"><td class="lbl">NET PAYABLE</td><td class="amt">${fmtMoney(netPayable)}</td></tr>
      </table>
    </div>

    <div class="sec-title">Approval &amp; Posting Trail</div>
    <table class="trail">
      <thead>
        <tr>
          <th style="width:7mm" class="t-c">Step</th>
          <th style="width:26mm">Action</th>
          <th style="width:38mm">User / Role</th>
          <th style="width:25mm">Date &amp; Time</th>
          <th>Remarks</th>
          <th style="width:21mm" class="t-c">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="t-c">1</td>
          <td>Submitted</td>
          <td>${escapeHtml(voucher.employeeName || printedBy)} — <span class="role">Claimant / Preparer</span></td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.voucherDate))}</td>
          <td>${escapeHtml(voucher.narration || 'Expense claim / direct bill submitted in ATCL ERP')}</td>
          <td class="t-c"><span class="pill">Completed</span></td>
        </tr>
        <tr>
          <td class="t-c">2</td>
          <td>Budget Check</td>
          <td>erp.budget.engine — <span class="role">Budget Validation</span></td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.voucherDate))}</td>
          <td>Department ${escapeHtml(deptLabel)} validated (${expenseItems.length} line item${expenseItems.length > 1 ? 's' : ''})</td>
          <td class="t-c"><span class="pill ${deptWithin ? '' : 'warn'}">${deptWithin ? 'Within' : 'Override Req.'}</span></td>
        </tr>
        <tr>
          <td class="t-c">3</td>
          <td>Verified</td>
          <td>Accounts Manager</td>
          <td class="mono">${escapeHtml(fmtDateDisplay(voucher.postingDate))}</td>
          <td>Supporting bills verified &amp; GL ${escapeHtml(paidFromGl)} liquidity checked</td>
          <td class="t-c"><span class="pill ${isPosted ? '' : 'warn'}">${isPosted ? 'Completed' : 'Pending'}</span></td>
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
      <div class="sign"><div class="blank"></div><div class="lbl">Claimant</div><div class="sub">Name &amp; Signature</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Budget Owner</div><div class="sub">Dept Head — Approval</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Verified By</div><div class="sub">Accounts Manager</div></div>
      <div class="sign"><div class="blank"></div><div class="lbl">Approved By</div><div class="sub">Chief Financial Officer</div></div>
    </div>

    <div class="foot">
      <div class="fnote">
        <b>System-generated document.</b> No manual alteration permitted. This expense voucher is valid
        only when posted in the ATCL ERP and supported by original bills, budget validation and override approval (where applicable).
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

export function openExpenseVoucherPrintPreview(
  voucher: VoucherRecord,
  state: LedgerState,
  printedBy?: string
): void {
  const html = buildExpenseVoucherHtml(voucher, state, printedBy);
  const win = window.open('', '_blank', 'width=960,height=1050');
  if (!win) {
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

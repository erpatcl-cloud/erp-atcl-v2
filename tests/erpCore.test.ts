import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSamplePopulatedLedgerState } from '../src/data/seedData.ts';
import {
  applyPaymentAllocationsToInvoices,
  applyReceiptAllocationsToSalesInvoices,
  computeStockAvailability,
  computeTrialBalance,
  ensureDefaultTaxRules,
  ensurePurchaseControlAccounts,
  ensureSalesControlAccounts,
  reconcileAllRegisters,
  recordInventoryMovement,
  validateBackupSnapshot,
} from '../src/engine/accountingEngine.ts';
import {
  postViaCentralEngine,
  reverseViaCentralEngine,
} from '../src/engine/postingService.ts';

describe('ATCL ERP V2 Core Integrity Suite', () => {
  it('posts balanced double-entry transactions, prevents duplicates, and enforces fiscal locks', () => {
    const state = createSamplePopulatedLedgerState();
    state.config.lockedMonths = ['2025-05'];
    state.config.globalLockDate = '2025-04-30';

    // Unbalanced post fails
    assert.throws(() => {
      postViaCentralEngine(state, {
        sourceModule: 'VOUCHER',
        voucherNo: 'TEST-UNBAL-1',
        date: '2025-06-15',
        description: 'Unbalanced entry test',
        reference: 'REF-1',
        counterparty: 'Test Vendor',
        lines: [
          { glCode: '5010', debit: 1000, credit: 0 },
          { glCode: '1240', debit: 0, credit: 900 },
        ],
      });
    }, /Double-entry imbalance/i);

    // Locked month post fails
    assert.throws(() => {
      postViaCentralEngine(state, {
        sourceModule: 'VOUCHER',
        voucherNo: 'TEST-LOCK-1',
        date: '2025-05-15',
        description: 'Locked month entry',
        reference: 'REF-2',
        counterparty: 'Test',
        lines: [
          { glCode: '5010', debit: 500, credit: 0 },
          { glCode: '1240', debit: 0, credit: 500 },
        ],
      });
    }, /Locked Accounting Month/i);

    // Global lock date fails
    assert.throws(() => {
      postViaCentralEngine(state, {
        sourceModule: 'VOUCHER',
        voucherNo: 'TEST-GLOCK-1',
        date: '2025-04-25',
        description: 'Global lock entry',
        reference: 'REF-3',
        counterparty: 'Test',
        lines: [
          { glCode: '5010', debit: 500, credit: 0 },
          { glCode: '1240', debit: 0, credit: 500 },
        ],
      });
    }, /Fiscal Period Lock/i);

    // Valid posting succeeds
    const res = postViaCentralEngine(state, {
      sourceModule: 'VOUCHER',
      idempotencyKey: 'TEST:KEY:001',
      voucherNo: 'TEST-OK-1',
      date: '2025-06-15',
      description: 'Valid central post',
      reference: 'REF-OK',
      counterparty: 'ATCL Partner',
      lines: [
        { glCode: '5010', debit: 2500, credit: 0 },
        { glCode: '1240', debit: 0, credit: 2500 },
      ],
    });
    assert.equal(res.voucherNo, 'TEST-OK-1');
    assert.equal(res.linesPosted, 2);

    // Duplicate idempotency key blocked
    assert.throws(() => {
      postViaCentralEngine(state, {
        sourceModule: 'VOUCHER',
        idempotencyKey: 'TEST:KEY:001',
        voucherNo: 'TEST-OK-2',
        date: '2025-06-15',
        description: 'Duplicate idempotency attempt',
        reference: 'REF-DUP',
        counterparty: 'ATCL Partner',
        lines: [
          { glCode: '5010', debit: 2500, credit: 0 },
          { glCode: '1240', debit: 0, credit: 2500 },
        ],
      });
    }, /Duplicate posting blocked/i);
  });

  it('maintains balanced Trial Balance and reconciled registers across posting and reversal', () => {
    const state = createSamplePopulatedLedgerState();
    const initialTb = computeTrialBalance(state);
    postViaCentralEngine(state, {
      sourceModule: 'FIXED_ASSET',
      idempotencyKey: 'DEPR:2025-06',
      voucherNo: 'DEPR-2025-06',
      date: '2025-06-28',
      description: 'Depreciation Test (Dr 5340 / Cr 1020)',
      reference: '2025-06',
      counterparty: 'Fixed Assets',
      lines: [
        { glCode: '5340', debit: 15000, credit: 0 },
        { glCode: '1020', debit: 0, credit: 15000 },
      ],
    });

    const rev = reverseViaCentralEngine(state, 'DEPR-2025-06', 'Unit test reversal');
    assert.equal(rev.reversalVoucherNo, 'REV-DEPR-2025-06');

    const tb = computeTrialBalance(state);
    assert.ok(tb.isClosingBalanced);
    assert.equal(tb.closingDiff, initialTb.closingDiff);
    assert.ok(Math.abs(tb.totals.periodDr - tb.totals.periodCr) <= 0.01);

    const recon = reconcileAllRegisters(state);
    assert.equal(recon.discrepancies.length, 0);
  });

  it('computes SKU stock availability and logs stock movement ledger entries accurately', () => {
    const state = createSamplePopulatedLedgerState();
    const firstProd = state.products[0];
    assert.ok(firstProd, 'Seed state should contain products');

    recordInventoryMovement(state, {
      movementDate: '2025-06-20',
      sku: firstProd.sku,
      productName: firstProd.name,
      movementType: 'GRN',
      qtyDelta: 5,
      unitCost: firstProd.unitCost,
      warehouse: 'Dhaka Central Warehouse',
      sourceRef: 'GRN-TEST-01',
    });

    const avail = computeStockAvailability(state).find((r) => r.sku === firstProd.sku);
    assert.ok(avail);
    assert.equal(avail.onHandQty, firstProd.stockQty);
    assert.equal(
      avail.availableQty,
      Math.max(0, firstProd.stockQty - avail.reservedQty - avail.qcHoldQty)
    );
    assert.equal(state.inventoryMovements?.[0].sourceRef, 'GRN-TEST-01');
  });

  it('blocks AP over-payment and AR over-collection against invoice balances', () => {
    const state = createSamplePopulatedLedgerState();
    state.purchaseInvoices = [
      {
        id: 'PINV-T1',
        invoiceNumber: 'PINV-TEST-01',
        supplierInvoiceNo: 'BILL-01',
        invoiceDate: '2025-06-01',
        dueDate: '2025-06-30',
        supplierId: 'SUP-1',
        supplierName: 'Test Supplier',
        sourceType: 'PO',
        debitGlCode: '2090',
        apGlCode: '2080',
        netAmount: 1000,
        vatAmount: 0,
        grossAmount: 1000,
        paidAmount: 0,
        outstandingAmount: 1000,
        status: 'Posted',
        postedToGl: true,
        notes: '',
        updatedAt: '2025-06-01T00:00:00Z',
      },
    ];
    state.salesInvoices = [
      {
        id: 'SINV-T1',
        invoiceNumber: 'SINV-TEST-01',
        invoiceDate: '2025-06-01',
        dueDate: '2025-06-30',
        customerId: 'CUST-1',
        customerName: 'Test Customer',
        lines: [],
        netAmount: 2000,
        vatAmount: 0,
        grossAmount: 2000,
        paidAmount: 0,
        tdsDeductedAmount: 0,
        vdsDeductedAmount: 0,
        creditNoteAmount: 0,
        outstandingAmount: 2000,
        cogsAmount: 0,
        revenueGlCode: '4010',
        arGlCode: '1120',
        vatGlCode: '2070',
        status: 'Posted',
        postedToGl: true,
        notes: '',
        updatedAt: '2025-06-01T00:00:00Z',
      },
    ];

    assert.throws(() => {
      applyPaymentAllocationsToInvoices(state, [
        { invoiceId: 'PINV-T1', invoiceNo: 'PINV-TEST-01', allocatedAmount: 1500 },
      ]);
    }, /Over-allocation blocked/i);

    assert.throws(() => {
      applyReceiptAllocationsToSalesInvoices(state, [
        { invoiceId: 'SINV-T1', invoiceNo: 'SINV-TEST-01', allocatedAmount: 2500 },
      ]);
    }, /Over-collection blocked/i);

    applyPaymentAllocationsToInvoices(state, [
      { invoiceId: 'PINV-T1', invoiceNo: 'PINV-TEST-01', allocatedAmount: 1000 },
    ]);
    assert.equal(state.purchaseInvoices[0].status, 'Paid');
    assert.equal(state.purchaseInvoices[0].outstandingAmount, 0);
  });

  it('provisions control accounts (1135 Retention, AP, GRNI, TDS/VDS) and default NBR tax rules', () => {
    const state = createSamplePopulatedLedgerState();
    ensurePurchaseControlAccounts(state);
    ensureSalesControlAccounts(state);
    const rules = ensureDefaultTaxRules(state);

    const codes = new Set(state.accounts.map((a) => a.code));
    for (const reqCode of ['1135', '1140', '1250', '2080', '2090', '2110', '2120', '2200', '2210']) {
      assert.ok(codes.has(reqCode), `Expected control GL ${reqCode} to be provisioned`);
    }
    assert.ok(rules.length >= 5, 'Expected default Bangladesh NBR withholding rules');
  });

  it('rejects corrupted backup snapshots and accepts valid snapshots via validateBackupSnapshot', () => {
    assert.throws(() => validateBackupSnapshot(null), /Invalid backup file format/i);
    assert.throws(() => validateBackupSnapshot('corrupt'), /Invalid backup file format/i);
    assert.throws(
      () => validateBackupSnapshot({ accounts: 'not-an-array' }),
      /accounts must be an array/i
    );

    const state = createSamplePopulatedLedgerState();
    const validated = validateBackupSnapshot(state);
    assert.ok(Array.isArray(validated.accounts));
  });
});

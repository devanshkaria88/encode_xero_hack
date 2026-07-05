import {
  bucketInvoicesOwed,
  bucketProposalsOwed,
  groupPaymentsByMonth,
  groupProposalCashInByMonth,
  lastNMonthKeys,
  monthKey,
} from './charts.util';
import type { XeroInvoice, XeroPayment } from '../xero/xero-api';

// Fixed clock: 2026-07-04 (UTC) so due-date maths never drifts with real time.
const TODAY = new Date('2026-07-04T10:00:00.000Z');

function msDate(iso: string): string {
  return `/Date(${new Date(iso).getTime()}+0000)/`;
}

function invoice(over: Partial<XeroInvoice>): XeroInvoice {
  return { Type: 'ACCREC', Status: 'AUTHORISED', AmountDue: 100, Total: 100, ...over };
}

describe('lastNMonthKeys / monthKey', () => {
  it('returns the last 6 months oldest-first, including the current month', () => {
    expect(lastNMonthKeys(TODAY, 6)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
  });

  it('crosses a year boundary correctly', () => {
    expect(lastNMonthKeys(new Date('2026-02-15T00:00:00Z'), 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('keys months in UTC with zero padding', () => {
    expect(monthKey(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03');
  });
});

describe('bucketInvoicesOwed (live Xero)', () => {
  it('merges DRAFT and SUBMITTED into the DRAFT bucket', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ Status: 'DRAFT', AmountDue: 50 }),
        invoice({ Status: 'SUBMITTED', AmountDue: 70 }),
      ],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'DRAFT')).toEqual({
      key: 'DRAFT',
      count: 2,
      amountGbp: 120,
    });
  });

  it('splits AUTHORISED on DueDate: past due is OVERDUE, due today or later is AWAITING', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ DueDate: msDate('2026-07-03'), AmountDue: 200 }), // yesterday
        invoice({ DueDate: msDate('2026-07-04'), AmountDue: 300 }), // due today
        invoice({ DueDate: msDate('2026-07-20'), AmountDue: 400 }), // future
      ],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'OVERDUE')).toEqual({
      key: 'OVERDUE',
      count: 1,
      amountGbp: 200,
    });
    expect(buckets.find((b) => b.key === 'AWAITING')).toEqual({
      key: 'AWAITING',
      count: 2,
      amountGbp: 700,
    });
  });

  it('treats a missing or unparseable DueDate as AWAITING, never OVERDUE', () => {
    const buckets = bucketInvoicesOwed(
      [invoice({ DueDate: undefined }), invoice({ DueDate: 'garbage' })],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'AWAITING')?.count).toBe(2);
    expect(buckets.find((b) => b.key === 'OVERDUE')?.count).toBe(0);
  });

  it('ignores ACCPAY bills and non-owed statuses (PAID / VOIDED)', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ Type: 'ACCPAY', Status: 'AUTHORISED', AmountDue: 999 }),
        invoice({ Status: 'PAID', AmountDue: 0, Total: 500 }),
        invoice({ Status: 'VOIDED' }),
      ],
      TODAY,
    );
    for (const b of buckets) {
      expect(b.count).toBe(0);
      expect(b.amountGbp).toBe(0);
    }
  });

  it('skips AUTHORISED invoices with nothing left to pay (fully credited or paid down)', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ DueDate: msDate('2026-06-01'), AmountDue: 0, Total: 500 }), // past due but settled
        invoice({ DueDate: msDate('2026-07-20'), AmountDue: -25, Total: 100 }), // credited past zero
        invoice({ DueDate: msDate('2026-06-01'), AmountDue: 120 }), // genuinely overdue
      ],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'OVERDUE')).toEqual({
      key: 'OVERDUE',
      count: 1,
      amountGbp: 120,
    });
    expect(buckets.find((b) => b.key === 'AWAITING')?.count).toBe(0);
  });

  it('falls back to Total when AmountDue is missing: zero skips, positive counts', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ DueDate: msDate('2026-06-01'), AmountDue: undefined, Total: 0 }),
        invoice({ DueDate: msDate('2026-06-01'), AmountDue: undefined, Total: 80 }),
      ],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'OVERDUE')).toEqual({
      key: 'OVERDUE',
      count: 1,
      amountGbp: 80,
    });
  });

  it('still counts DRAFT and SUBMITTED invoices at zero amount (unchanged)', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ Status: 'DRAFT', AmountDue: 0, Total: 0 }),
        invoice({ Status: 'SUBMITTED', AmountDue: 0, Total: 0 }),
      ],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'DRAFT')).toEqual({
      key: 'DRAFT',
      count: 2,
      amountGbp: 0,
    });
  });

  it('sums AmountDue (not Total) and rounds to 2dp', () => {
    const buckets = bucketInvoicesOwed(
      [
        invoice({ DueDate: msDate('2026-08-01'), AmountDue: 10.005, Total: 999 }),
        invoice({ DueDate: msDate('2026-08-01'), AmountDue: 0.1, Total: 999 }),
      ],
      TODAY,
    );
    expect(buckets.find((b) => b.key === 'AWAITING')?.amountGbp).toBe(10.11);
  });

  it('always returns all three buckets in stable order', () => {
    expect(bucketInvoicesOwed([], TODAY).map((b) => b.key)).toEqual([
      'DRAFT',
      'AWAITING',
      'OVERDUE',
    ]);
  });
});

describe('groupPaymentsByMonth (live Xero)', () => {
  const MONTHS = lastNMonthKeys(TODAY, 6);

  function payment(over: Partial<XeroPayment>): XeroPayment {
    return { Status: 'AUTHORISED', PaymentType: 'ACCRECPAYMENT', Amount: 100, ...over };
  }

  it('zero-fills every month and sums payments into the right one', () => {
    const rows = groupPaymentsByMonth(
      [
        payment({ Date: msDate('2026-05-10'), Amount: 150 }),
        payment({ Date: msDate('2026-05-28'), Amount: 50 }),
        payment({ Date: msDate('2026-07-01'), Amount: 25 }),
      ],
      MONTHS,
    );
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.month === '2026-05')?.amountGbp).toBe(200);
    expect(rows.find((r) => r.month === '2026-07')?.amountGbp).toBe(25);
    expect(rows.find((r) => r.month === '2026-02')?.amountGbp).toBe(0);
  });

  it('excludes deleted payments, AP-side payment types and out-of-window dates', () => {
    const rows = groupPaymentsByMonth(
      [
        payment({ Date: msDate('2026-06-01'), Status: 'DELETED', Amount: 500 }),
        payment({ Date: msDate('2026-06-01'), PaymentType: 'ACCPAYPAYMENT', Amount: 500 }),
        payment({ Date: msDate('2025-06-01'), Amount: 500 }), // a year ago
        payment({ Date: undefined, Amount: 500 }), // unparseable
        payment({ Date: msDate('2026-06-01'), Amount: 75 }),
      ],
      MONTHS,
    );
    expect(rows.find((r) => r.month === '2026-06')?.amountGbp).toBe(75);
    expect(rows.reduce((s, r) => s + r.amountGbp, 0)).toBe(75);
  });

  it('keeps payments with no PaymentType field (older API shapes)', () => {
    const rows = groupPaymentsByMonth(
      [payment({ Date: msDate('2026-06-01'), PaymentType: undefined, Amount: 40 })],
      MONTHS,
    );
    expect(rows.find((r) => r.month === '2026-06')?.amountGbp).toBe(40);
  });
});

describe('bucketProposalsOwed (local fallback)', () => {
  it('maps DRAFT+IN_REVIEW to DRAFT and APPROVED+SENT to AWAITING; OVERDUE stays empty', () => {
    const buckets = bucketProposalsOwed([
      { state: 'DRAFT', total: '100.00', createdAt: '2026-06-01' },
      { state: 'IN_REVIEW', total: 200, createdAt: '2026-06-02' },
      { state: 'APPROVED', total: 300, createdAt: '2026-06-03' },
      { state: 'SENT', total: '400.50', createdAt: '2026-06-04' },
      { state: 'REJECTED', total: 999, createdAt: '2026-06-05' },
    ]);
    expect(buckets).toEqual([
      { key: 'DRAFT', count: 2, amountGbp: 300 },
      { key: 'AWAITING', count: 2, amountGbp: 700.5 },
      { key: 'OVERDUE', count: 0, amountGbp: 0 },
    ]);
  });
});

describe('groupProposalCashInByMonth (local fallback)', () => {
  const MONTHS = lastNMonthKeys(TODAY, 6);

  it('sums only APPROVED/SENT proposals by createdAt month, zero-filling the rest', () => {
    const rows = groupProposalCashInByMonth(
      [
        { state: 'SENT', total: '120.00', createdAt: new Date('2026-04-15T09:00:00Z') },
        { state: 'APPROVED', total: 80, createdAt: '2026-04-20T00:00:00Z' },
        { state: 'DRAFT', total: 999, createdAt: '2026-04-21T00:00:00Z' },
        { state: 'SENT', total: 60, createdAt: '2025-01-01T00:00:00Z' }, // out of window
      ],
      MONTHS,
    );
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.month === '2026-04')?.amountGbp).toBe(200);
    expect(rows.reduce((s, r) => s + r.amountGbp, 0)).toBe(200);
  });
});

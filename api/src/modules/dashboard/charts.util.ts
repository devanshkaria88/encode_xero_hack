// Pure chart math for GET /dashboard/charts. No I/O, no LLM, no Nest — the
// service fetches rows (live Xero or local Postgres) and these functions
// bucket them. Deterministic and unit-tested like the engine.

import { parseXeroDate, XeroInvoice, XeroPayment } from '../xero/xero-api';

// ---- Shared shapes ---------------------------------------------------------

export type InvoicesOwedBucketKey = 'DRAFT' | 'AWAITING' | 'OVERDUE';

export const INVOICES_OWED_BUCKET_KEYS: InvoicesOwedBucketKey[] = [
  'DRAFT',
  'AWAITING',
  'OVERDUE',
];

export interface OwedBucketShape {
  key: InvoicesOwedBucketKey;
  count: number;
  amountGbp: number;
}

export interface CashInMonthShape {
  month: string; // "2026-02"
  amountGbp: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---- Month keys (UTC) ------------------------------------------------------

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last n calendar months including the current one, oldest first. */
export function lastNMonthKeys(now: Date, n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

// ---- Live Xero: invoices owed ----------------------------------------------

// Buckets live ACCREC invoices: DRAFT+SUBMITTED are drafts, AUTHORISED splits
// on DueDate vs today (due today still counts as awaiting; a missing DueDate
// is treated as awaiting — never guessed overdue). Owed £ is AmountDue.
// An AUTHORISED invoice with nothing left to pay (fully credited or paid
// down, AmountDue <= 0) is skipped entirely — nothing is owed on it, so it
// belongs in neither count nor amount.
export function bucketInvoicesOwed(
  invoices: XeroInvoice[],
  today: Date,
): OwedBucketShape[] {
  const acc: Record<InvoicesOwedBucketKey, { count: number; amount: number }> = {
    DRAFT: { count: 0, amount: 0 },
    AWAITING: { count: 0, amount: 0 },
    OVERDUE: { count: 0, amount: 0 },
  };
  const todayUtcStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  for (const inv of invoices) {
    if (inv.Type !== 'ACCREC') continue; // Statuses filter returns bills too
    const status = inv.Status ?? '';
    let key: InvoicesOwedBucketKey;
    if (status === 'DRAFT' || status === 'SUBMITTED') {
      key = 'DRAFT';
    } else if (status === 'AUTHORISED') {
      if (toNumber(inv.AmountDue ?? inv.Total) <= 0) continue; // fully credited/paid down — nothing owed
      const due = parseXeroDate(inv.DueDate);
      key = due && due.getTime() < todayUtcStart ? 'OVERDUE' : 'AWAITING';
    } else {
      continue; // PAID / VOIDED / DELETED — nothing owed
    }
    acc[key].count += 1;
    acc[key].amount += toNumber(inv.AmountDue ?? inv.Total);
  }

  return INVOICES_OWED_BUCKET_KEYS.map((key) => ({
    key,
    count: acc[key].count,
    amountGbp: round2(acc[key].amount),
  }));
}

// ---- Live Xero: cash in per month ------------------------------------------

// Sums ACCREC payments received into the given month keys (zero-filled so the
// chart always has a bar per month). Deleted payments and AP-side payment
// types are excluded; an unparseable date drops the row rather than guessing.
export function groupPaymentsByMonth(
  payments: XeroPayment[],
  months: string[],
): CashInMonthShape[] {
  const sums = new Map<string, number>(months.map((m) => [m, 0]));
  for (const p of payments) {
    if (p.Status === 'DELETED') continue;
    if (p.PaymentType && p.PaymentType !== 'ACCRECPAYMENT') continue;
    const d = parseXeroDate(p.Date);
    if (!d) continue;
    const key = monthKey(d);
    if (!sums.has(key)) continue; // outside the charted window
    sums.set(key, (sums.get(key) ?? 0) + toNumber(p.Amount));
  }
  return months.map((month) => ({ month, amountGbp: round2(sums.get(month) ?? 0) }));
}

// ---- Local fallback: invoices owed + cash in from InvoiceProposal rows ------

// Minimal proposal shape so these stay pure (the service passes entity rows).
export interface ProposalChartRow {
  state: string; // InvoiceProposalState
  total: number | string; // numeric column arrives as string
  createdAt: Date | string;
}

// Local mapping when Xero is down: engine drafts + human review queue read as
// drafts; approved/sent proposals read as awaiting payment. There is no local
// due-date signal, so OVERDUE is honestly zero rather than invented.
const LOCAL_DRAFT_STATES = new Set(['DRAFT', 'IN_REVIEW']);
const LOCAL_AWAITING_STATES = new Set(['APPROVED', 'SENT']);

export function bucketProposalsOwed(rows: ProposalChartRow[]): OwedBucketShape[] {
  const acc: Record<InvoicesOwedBucketKey, { count: number; amount: number }> = {
    DRAFT: { count: 0, amount: 0 },
    AWAITING: { count: 0, amount: 0 },
    OVERDUE: { count: 0, amount: 0 },
  };
  for (const row of rows) {
    const key: InvoicesOwedBucketKey | null = LOCAL_DRAFT_STATES.has(row.state)
      ? 'DRAFT'
      : LOCAL_AWAITING_STATES.has(row.state)
        ? 'AWAITING'
        : null;
    if (!key) continue; // REJECTED — not owed
    acc[key].count += 1;
    acc[key].amount += toNumber(row.total);
  }
  return INVOICES_OWED_BUCKET_KEYS.map((key) => ({
    key,
    count: acc[key].count,
    amountGbp: round2(acc[key].amount),
  }));
}

/** Approximate cash in from APPROVED/SENT proposals, keyed by createdAt month. */
export function groupProposalCashInByMonth(
  rows: ProposalChartRow[],
  months: string[],
): CashInMonthShape[] {
  const sums = new Map<string, number>(months.map((m) => [m, 0]));
  for (const row of rows) {
    if (!LOCAL_AWAITING_STATES.has(row.state)) continue;
    const created =
      row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const key = monthKey(created);
    if (!sums.has(key)) continue;
    sums.set(key, (sums.get(key) ?? 0) + toNumber(row.total));
  }
  return months.map((month) => ({ month, amountGbp: round2(sums.get(month) ?? 0) }));
}

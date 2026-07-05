/**
 * Number formatting for the charts board. Everything money is GBP with a pound
 * sign and thousands separators (never a bare number on an axis or tooltip).
 */

const GBP_WHOLE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GBP_COMPACT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});

const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short" });

/** "£1,850" — full figure for tooltips, headlines and row labels. */
export function gbpWhole(value: number | string | null | undefined): string {
  const n = value == null || value === "" ? NaN : Number(value);
  if (Number.isNaN(n)) return "—";
  return GBP_WHOLE.format(n);
}

/** "£1.9K" — short figure for axis ticks where space is tight. */
export function gbpCompact(value: number): string {
  if (Number.isNaN(value)) return "—";
  return GBP_COMPACT.format(value);
}

/** "2026-02" → "Feb". Falls back to the raw key if it doesn't parse. */
export function monthShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return MONTH_SHORT.format(new Date(y, m - 1, 1));
}

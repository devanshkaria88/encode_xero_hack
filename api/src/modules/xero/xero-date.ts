// Xero Accounting API JSON responses carry Microsoft-JSON dates:
//   "/Date(1718150400000+0000)/"  (epoch ms, optional display offset)
// The epoch is already UTC — the trailing offset is presentational only and
// must be ignored. Some fields (and anything we wrote ourselves) can come back
// as plain ISO ("2026-06-14" or a full datetime), so we accept that too.
// Returns null for anything unparseable — callers decide the fallback.

const MS_JSON_DATE = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//;

export function parseXeroDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = MS_JSON_DATE.exec(value);
  if (m) {
    const ms = Number(m[1]);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

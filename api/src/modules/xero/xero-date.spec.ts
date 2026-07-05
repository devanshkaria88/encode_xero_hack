import { parseXeroDate } from './xero-date';

// 1718150400000 ms = 2024-06-12T00:00:00.000Z
const EPOCH_MS = 1718150400000;

describe('parseXeroDate (Microsoft-JSON and ISO dates)', () => {
  it('parses the /Date(ms+0000)/ envelope', () => {
    const d = parseXeroDate(`/Date(${EPOCH_MS}+0000)/`);
    expect(d?.toISOString()).toBe('2024-06-12T00:00:00.000Z');
  });

  it('parses the envelope without an offset', () => {
    const d = parseXeroDate(`/Date(${EPOCH_MS})/`);
    expect(d?.toISOString()).toBe('2024-06-12T00:00:00.000Z');
  });

  it('ignores the display offset — the epoch is already UTC', () => {
    const plus = parseXeroDate(`/Date(${EPOCH_MS}+0100)/`);
    const minus = parseXeroDate(`/Date(${EPOCH_MS}-0500)/`);
    expect(plus?.getTime()).toBe(EPOCH_MS);
    expect(minus?.getTime()).toBe(EPOCH_MS);
  });

  it('parses a negative epoch (pre-1970)', () => {
    const d = parseXeroDate('/Date(-86400000+0000)/');
    expect(d?.toISOString()).toBe('1969-12-31T00:00:00.000Z');
  });

  it('parses a plain ISO date as UTC midnight', () => {
    const d = parseXeroDate('2026-06-14');
    expect(d?.toISOString()).toBe('2026-06-14T00:00:00.000Z');
  });

  it('parses a full ISO datetime', () => {
    const d = parseXeroDate('2026-06-14T09:30:00.000Z');
    expect(d?.toISOString()).toBe('2026-06-14T09:30:00.000Z');
  });

  it('returns null for garbage, empty and missing values', () => {
    expect(parseXeroDate('not a date')).toBeNull();
    expect(parseXeroDate('')).toBeNull();
    expect(parseXeroDate(null)).toBeNull();
    expect(parseXeroDate(undefined)).toBeNull();
  });
});

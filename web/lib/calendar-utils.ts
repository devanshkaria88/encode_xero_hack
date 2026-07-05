/**
 * Pure date math for the calendar surface. Ported from the reference week-view
 * implementation, with two deliberate changes for Robyn:
 *   - Weeks start on Monday (UK product).
 *   - Day bucketing and clock positions are computed in Europe/London via Intl,
 *     so an evening UTC event lands on the right London day and the right row
 *     even during BST.
 * Zero dependencies — plain Date + Intl only.
 */

export const HOUR_HEIGHT = 48;
export const HOURS_IN_DAY = 24;

export const LONDON_TZ = "Europe/London";

// en-CA gives YYYY-MM-DD, which sorts and compares lexicographically.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: LONDON_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const clockPartsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** Day bucket key (YYYY-MM-DD) in the org timezone. */
export function toDateKey(date: Date): string {
  return dayKeyFmt.format(date);
}

/** "09:30" in London time, from an ISO string or Date. */
export function londonTime(value: string | Date): string {
  return timeFmt.format(typeof value === "string" ? new Date(value) : value);
}

/** Minutes since London midnight for an instant — drives chip top/height. */
export function minutesOfDay(date: Date): number {
  let hour = 0;
  let minute = 0;
  for (const part of clockPartsFmt.formatToParts(date)) {
    if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return hour * 60 + minute;
}

/** Current London hour (0-23) — drives the auto-scroll target. */
export function londonHourNow(): number {
  return Math.floor(minutesOfDay(new Date()) / 60);
}

/**
 * Anchor a day at local noon. Noon-anchored Dates keep the same London day key
 * across DST shifts and for viewers within a few hours of London.
 */
export function dayAnchor(date: Date): Date {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Monday 12:00 of the week containing `date`. */
export function getWeekStart(date: Date): Date {
  const start = dayAnchor(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** The 7 days (Mon-Sun) of the week containing `date`, noon-anchored. */
export function getWeekDays(date: Date): Date[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** The week of `date` padded by `bufferDays` each side, as YYYY-MM-DD keys. */
export function getWeekDateRange(date: Date, bufferDays = 14) {
  const weekStart = getWeekStart(date);
  const weekEnd = addDays(weekStart, 6);
  return {
    startDate: toDateKey(addDays(weekStart, -bufferDays)),
    endDate: toDateKey(addDays(weekEnd, bufferDays)),
  };
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** Gutter labels: 12 AM, 1 AM ... 12 PM, 1 PM ... */
export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * The chip's time line for one rendered day. Multi-day events show an arrow on
 * the terminal days and "All day" in between.
 */
export function formatEventTimeRange(
  start: string,
  end: string,
  day: Date,
): string {
  const dateKey = toDateKey(day);
  const startKey = toDateKey(new Date(start));
  const endKey = toDateKey(new Date(end));

  if (dateKey === startKey && dateKey === endKey) {
    return `${londonTime(start)} – ${londonTime(end)}`;
  }
  if (dateKey === startKey) {
    return `${londonTime(start)} →`;
  }
  if (dateKey === endKey) {
    return `→ ${londonTime(end)}`;
  }
  return "All day";
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "July 6 – 12, 2026" or "June 29 – July 5, 2026". */
export function getWeekTitle(date: Date): string {
  const weekDays = getWeekDays(date);
  const start = weekDays[0];
  const end = weekDays[6];

  if (start.getMonth() === end.getMonth()) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

/** "Friday 3 July 2026" for the day view title. */
export function getDayTitle(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

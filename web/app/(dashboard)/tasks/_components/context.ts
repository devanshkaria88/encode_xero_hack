import type { Schemas } from "@/lib/api";
import { LONDON_TZ } from "@/lib/calendar-utils";

/**
 * Helpers for reading a Task's free-form `context` (jsonb) safely. The OpenAPI
 * spec types `context` as `{ [k: string]: unknown }` and loosely types a few
 * string fields (summary, clause text) as `object | null`, so every read here
 * is defensive: wrong shapes fall back to undefined, never throw.
 */
export type TaskDto = Schemas["TaskDto"];
export type Ctx = Record<string, unknown>;

export function ctxOf(task: TaskDto): Ctx {
  return (task.context ?? {}) as Ctx;
}

/** Render a value the spec loosely typed as object|null but is a string live. */
export function asText(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

export function readStr(ctx: Ctx, key: string): string | undefined {
  return asText(ctx[key]);
}

export function readNum(ctx: Ctx, key: string): number | undefined {
  const v = ctx[key];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return undefined;
}

export function readStrArray(ctx: Ctx, key: string): string[] {
  const v = ctx[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

export function readBool(ctx: Ctx, key: string): boolean {
  return ctx[key] === true;
}

export interface CtxAttendee {
  name?: string;
  email?: string;
  organizer?: boolean;
}

/** Attendees can arrive as `{name,email,organizer}[]` or as a `string[]`. */
export function readAttendees(ctx: Ctx): CtxAttendee[] {
  const v = ctx["attendees"];
  if (!Array.isArray(v)) return [];
  return v.map((a): CtxAttendee => {
    if (typeof a === "string") return { email: a };
    if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      return {
        name: asText(o.name),
        email: asText(o.email),
        organizer: o.organizer === true,
      };
    }
    return {};
  });
}

// Always format in the org timezone so weekdays and clock times stay right
// for viewers (and CI browsers) outside the UK.
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: LONDON_TZ,
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: LONDON_TZ,
});

/** "Mon 16 Jun · 14:00 to 15:30" — plain, no em-dashes. */
export function formatWhen(start?: string, end?: string): string | undefined {
  if (!start) return undefined;
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return undefined;
  let out = `${DATE_FMT.format(s)} · ${TIME_FMT.format(s)}`;
  if (end) {
    const e = new Date(end);
    if (!Number.isNaN(e.getTime())) out += ` to ${TIME_FMT.format(e)}`;
  }
  return out;
}

/** "1 hr" / "1.5 hrs". */
export function formatHours(h?: number): string | undefined {
  if (h == null || Number.isNaN(h)) return undefined;
  const n = Math.round(h * 100) / 100;
  return `${n} ${n === 1 ? "hr" : "hrs"}`;
}

export function attendeeLabel(a: CtxAttendee): string {
  return a.name ?? a.email ?? "Attendee";
}

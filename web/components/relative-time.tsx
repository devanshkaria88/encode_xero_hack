"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const RTF = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const ABS = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

function relative(from: Date, now: Date): string {
  const seconds = Math.round((from.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  for (const [unit, secs] of STEPS) {
    if (abs >= secs) {
      return RTF.format(Math.round(seconds / secs), unit);
    }
  }
  return "just now";
}

export interface RelativeTimeProps
  extends React.HTMLAttributes<HTMLTimeElement> {
  /** ISO string or Date. */
  value: string | Date | null | undefined;
}

/**
 * Renders a relative time ("2 hours ago") with the absolute time on hover.
 * Computes on the client after mount to avoid hydration mismatch.
 */
export function RelativeTime({ value, className, ...props }: RelativeTimeProps) {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!value) return <span className={className}>—</span>;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime()))
    return <span className={className}>—</span>;

  return (
    <time
      dateTime={date.toISOString()}
      title={ABS.format(date)}
      className={cn(className)}
      suppressHydrationWarning
      {...props}
    >
      {now ? relative(date, now) : ABS.format(date)}
    </time>
  );
}

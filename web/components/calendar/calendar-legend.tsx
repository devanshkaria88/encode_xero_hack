import * as React from "react";

import { STATE_LEGEND, TONE_DOT } from "@/lib/states";
import { cn } from "@/lib/utils";

export interface CalendarLegendProps {
  /** Vertical list for a narrow sidebar; default is a wrapping row. */
  stacked?: boolean;
  className?: string;
}

/** The five-colour legend that makes the calendar readable at a glance. */
export function CalendarLegend({ stacked = false, className }: CalendarLegendProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3",
        stacked
          ? "flex flex-col gap-2.5"
          : "flex flex-wrap items-center gap-x-4 gap-y-2",
        className,
      )}
    >
      {STATE_LEGEND.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", TONE_DOT[item.tone])}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

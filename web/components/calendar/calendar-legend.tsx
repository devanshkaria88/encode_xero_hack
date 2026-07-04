import * as React from "react";

import { STATE_LEGEND, TONE_DOT } from "@/lib/states";
import { cn } from "@/lib/utils";

/** The five-colour legend that makes the calendar readable at a glance. */
export function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {STATE_LEGEND.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span
            className={cn("h-2.5 w-2.5 rounded-full", TONE_DOT[item.tone])}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

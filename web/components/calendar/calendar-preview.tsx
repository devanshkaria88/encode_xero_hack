"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";

import { SurfacePreview } from "@/components/surface-preview";
import type { Schemas } from "@/lib/api";

/** Current-month range for the calendar feed. */
function monthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Live-wired scaffold for the calendar surface. */
export function CalendarPreview() {
  const { from, to } = React.useMemo(monthRange, []);
  const endpoint = `/dashboard/calendar?from=${encodeURIComponent(
    from,
  )}&to=${encodeURIComponent(to)}`;

  return (
    <SurfacePreview<Schemas["CalendarEventDto"][]>
      endpoint={endpoint}
      emptyIcon={CalendarClock}
      emptyTitle="No events this month"
      emptyDescription="When Robyn syncs your calendar, every work block shows up here, colour-coded by whether it's been billed."
      labelsOf={(events) =>
        events.map((e) => e.title).filter((t): t is string => Boolean(t))
      }
      note="The full week and month grid, with an evidence side panel per event, is coming next."
    />
  );
}

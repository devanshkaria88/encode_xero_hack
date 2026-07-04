import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { CalendarSurface } from "./_components/calendar-surface";

export const metadata: Metadata = {
  title: "Calendar",
};

/** Your calendar, but every block knows whether it's been paid for. */
export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Every work block, colour-coded by whether it's been billed."
      />
      <CalendarSurface />
    </div>
  );
}

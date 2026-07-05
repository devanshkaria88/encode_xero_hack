"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { colorKeyToTone } from "@/lib/states";
import {
  addDays,
  dayAnchor,
  getDayTitle,
  getWeekDateRange,
  getWeekDays,
  getWeekTitle,
  toDateKey,
} from "@/lib/calendar-utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { CalendarLegend } from "@/components/calendar/calendar-legend";

import { TimeGrid, type GridEvent } from "./week-view";
import { MiniMonth } from "./mini-month";
import { EventSheet } from "./event-sheet";

type CalendarEvent = Schemas["CalendarEventDto"];
type ViewType = "week" | "day";

/**
 * Fetch window each side of the visible week. Wide enough that paging a few
 * weeks in either direction filters the same client-side array instead of
 * refetching, and that the seeded demo month is always in the first load.
 */
const BUFFER_DAYS = 31;

/** Grid height: fills the viewport under the header, never collapses. */
const GRID_HEIGHT = "h-[calc(100dvh-21rem)] min-h-[480px]";

// openapi-typescript renders nullable strings as `string | Record<string,never>`.
function txt(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function CalendarSurface() {
  const [currentDate, setCurrentDate] = React.useState<Date>(() => new Date());
  const [viewType, setViewType] = React.useState<ViewType>("week");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // The fetch window is anchored separately from the visible week so paging
  // between adjacent weeks reuses the loaded events instead of refetching.
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());
  const jumpedRef = React.useRef(false);

  // Phones get the single-day timeline by default; set after mount so the
  // server and first client render agree.
  React.useEffect(() => {
    if (window.innerWidth < 768) setViewType("day");
  }, []);

  const range = React.useMemo(
    () => getWeekDateRange(anchor, BUFFER_DAYS),
    [anchor],
  );
  const { data, error, isLoading, refetch } = useApi<CalendarEvent[]>(
    `/dashboard/calendar?from=${range.startDate}T00:00:00.000Z&to=${range.endDate}T23:59:59.999Z`,
  );

  // Re-anchor the window when the visible week walks out of it.
  React.useEffect(() => {
    const week = getWeekDateRange(currentDate, 0);
    if (week.startDate < range.startDate || week.endDate > range.endDate) {
      setAnchor(currentDate);
    }
  }, [currentDate, range.startDate, range.endDate]);

  // First load only: if this week is blank but events exist elsewhere in the
  // window (the seeded demo lives in June 2026), jump to the nearest one.
  React.useEffect(() => {
    if (!data || jumpedRef.current) return;
    jumpedRef.current = true;
    if (data.length === 0) return;
    const weekKeys = new Set(getWeekDays(currentDate).map(toDateKey));
    const hasEventsThisWeek = data.some((e) =>
      weekKeys.has(toDateKey(new Date(e.start))),
    );
    if (hasEventsThisWeek) return;
    const nowMs = Date.now();
    let nearest = data[0];
    for (const e of data) {
      if (
        Math.abs(+new Date(e.start) - nowMs) <
        Math.abs(+new Date(nearest.start) - nowMs)
      ) {
        nearest = e;
      }
    }
    setCurrentDate(new Date(nearest.start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const gridEvents: GridEvent[] = React.useMemo(
    () =>
      (data ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        tone: colorKeyToTone(e.colorKey),
        subtitle: txt(e.clientName),
      })),
    [data],
  );

  const days = React.useMemo(
    () =>
      viewType === "week" ? getWeekDays(currentDate) : [dayAnchor(currentDate)],
    [viewType, currentDate],
  );

  const title =
    viewType === "week" ? getWeekTitle(currentDate) : getDayTitle(currentDate);
  const step = viewType === "week" ? 7 : 1;
  const unit = viewType === "week" ? "week" : "day";

  return (
    <div className="space-y-4">
      {/* Toolbar: Today, joined prev/next, range title, view tabs. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={() => setCurrentDate(new Date())}
        >
          Today
        </Button>
        <div className="flex">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 cursor-pointer rounded-r-none"
            onClick={() => setCurrentDate((d) => addDays(d, -step))}
            aria-label={`Previous ${unit}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 cursor-pointer rounded-l-none border-l-0"
            onClick={() => setCurrentDate((d) => addDays(d, step))}
            aria-label={`Next ${unit}`}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">
          {title}
        </h2>
        <div className="ml-auto">
          <Tabs
            value={viewType}
            onValueChange={(v) => setViewType(v as ViewType)}
          >
            <TabsList>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex items-start gap-4">
        {/* Sidebar: mini month + billing legend (desktop only). */}
        <aside className="hidden w-60 shrink-0 space-y-4 lg:block">
          <MiniMonth currentDate={currentDate} onDateChange={setCurrentDate} />
          <div className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Billing states
            </h3>
            <CalendarLegend stacked />
          </div>
        </aside>

        {/* Main surface. Stale events stay visible during background loads. */}
        <div className="min-w-0 flex-1 space-y-3">
          {error && data && (
            <ErrorState
              compact
              title="Couldn't refresh the calendar"
              error={error}
              onRetry={refetch}
            />
          )}
          {isLoading && !data ? (
            <CalendarSkeleton cols={viewType === "week" ? 7 : 1} />
          ) : error && !data ? (
            <ErrorState
              title="Couldn't load the calendar"
              error={error}
              onRetry={refetch}
            />
          ) : (
            <TimeGrid
              days={days}
              events={gridEvents}
              onEventClick={(e) => setSelectedId(e.id)}
              emptyLabel={
                viewType === "week"
                  ? "No meetings this week."
                  : "No meetings on this day."
              }
              className={GRID_HEIGHT}
            />
          )}
        </div>
      </div>

      {/* Legend for small screens, where the sidebar is hidden. */}
      <div className="lg:hidden">
        <CalendarLegend />
      </div>

      <EventSheet
        meetingId={selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onChanged={() => {
          refetch();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Loading skeleton — a ghost of the week grid so nothing jumps.              */
/* -------------------------------------------------------------------------- */

// Deterministic chip layout (no randomness — server and client must agree).
const GHOST_CHIPS: Array<Array<{ top: number; height: number }>> = [
  [{ top: 48, height: 56 }, { top: 176, height: 40 }],
  [{ top: 96, height: 40 }],
  [{ top: 64, height: 72 }, { top: 224, height: 40 }],
  [{ top: 144, height: 48 }],
  [{ top: 32, height: 40 }, { top: 192, height: 64 }],
  [],
  [{ top: 112, height: 40 }],
];

function CalendarSkeleton({ cols }: { cols: number }) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-border bg-card ${GRID_HEIGHT}`}
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        Loading the calendar
      </span>
      <div className="flex shrink-0 border-b border-border bg-muted/30">
        <div className="w-10 shrink-0 border-r border-border md:w-14" />
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, i) => (
            <div
              key={i}
              className="border-r border-border px-2 py-2 text-center last:border-r-0"
            >
              <Skeleton className="mx-auto h-3 w-8" />
              <Skeleton className="mx-auto mt-1.5 h-8 w-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-10 shrink-0 border-r border-border md:w-14" />
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, col) => (
            <div
              key={col}
              className="relative border-r border-border last:border-r-0"
            >
              {(GHOST_CHIPS[col % GHOST_CHIPS.length] ?? []).map((chip, i) => (
                <Skeleton
                  key={i}
                  className="absolute left-1 right-1 rounded-md"
                  style={{ top: chip.top, height: chip.height }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

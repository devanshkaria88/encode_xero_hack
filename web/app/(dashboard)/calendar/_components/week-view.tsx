"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TONE_CLASS, type BadgeTone } from "@/lib/states";
import {
  HOUR_HEIGHT,
  HOURS_IN_DAY,
  formatEventTimeRange,
  formatHourLabel,
  isToday,
  londonHourNow,
  minutesOfDay,
  toDateKey,
} from "@/lib/calendar-utils";

/** The view model one chip needs. The surface adapts CalendarEventDto to this. */
export interface GridEvent {
  id: string;
  title: string;
  /** ISO datetime. */
  start: string;
  /** ISO datetime. */
  end: string;
  tone: BadgeTone;
  /** Client name line, empty when unmatched. */
  subtitle: string;
}

/** Saturated left-edge colour per tone — the Google-Calendar chip accent. */
const TONE_EDGE: Record<BadgeTone, string> = {
  billed: "border-l-teal-500",
  proposal: "border-l-amber-500",
  awaiting: "border-l-amber-400",
  unknown: "border-l-violet-500",
  skipped: "border-l-slate-400",
  neutral: "border-l-slate-400",
  info: "border-l-indigo-500",
  success: "border-l-teal-500",
  attention: "border-l-rose-500",
};

interface PositionedEvent {
  event: GridEvent;
  top: number;
  height: number;
  left: number;
  width: number;
}

/* -------------------------------------------------------------------------- */
/*  Positioning engine — ported verbatim from the reference week view, with    */
/*  minutes computed in Europe/London instead of the browser's local zone.     */
/* -------------------------------------------------------------------------- */

function calculateTimedEventPosition(
  event: GridEvent,
  date: Date,
): { top: number; height: number; startTime: number; endTime: number } | null {
  const dateKey = toDateKey(date);
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);
  const eventStartKey = toDateKey(eventStart);
  const eventEndKey = toDateKey(eventEnd);

  if (dateKey < eventStartKey || dateKey > eventEndKey) {
    return null;
  }

  let startMinutes = 0;
  let endMinutes = HOURS_IN_DAY * 60;

  if (dateKey === eventStartKey) {
    startMinutes = minutesOfDay(eventStart);
  }
  if (dateKey === eventEndKey) {
    endMinutes = minutesOfDay(eventEnd);
  }

  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 22);

  return { top, height, startTime: startMinutes, endTime: endMinutes };
}

function layoutTimedEvents(dayEvents: GridEvent[], date: Date): PositionedEvent[] {
  type TimedEvent = PositionedEvent & { startTime: number; endTime: number };

  const positioned: TimedEvent[] = dayEvents
    .map((event) => {
      const pos = calculateTimedEventPosition(event, date);
      if (!pos) return null;
      return {
        event,
        top: pos.top,
        height: pos.height,
        left: 0,
        width: 100,
        startTime: pos.startTime,
        endTime: pos.endTime,
      };
    })
    .filter((entry): entry is TimedEvent => entry !== null)
    .sort((a, b) => a.startTime - b.startTime);

  // Build transitively-overlapping groups; an event that bridges several
  // groups merges them into one.
  const groups: TimedEvent[][] = [];

  positioned.forEach((event) => {
    const overlappingIndices: number[] = [];

    groups.forEach((group, index) => {
      const overlaps = group.some(
        (item) => event.startTime < item.endTime && event.endTime > item.startTime,
      );
      if (overlaps) overlappingIndices.push(index);
    });

    if (overlappingIndices.length === 0) {
      groups.push([event]);
      return;
    }

    if (overlappingIndices.length === 1) {
      groups[overlappingIndices[0]].push(event);
      return;
    }

    const mergedGroup = [event];
    overlappingIndices.forEach((index) => {
      mergedGroup.push(...groups[index]);
    });
    overlappingIndices
      .sort((a, b) => b - a)
      .forEach((index) => groups.splice(index, 1));
    groups.push(mergedGroup);
  });

  const result: PositionedEvent[] = [];

  groups.forEach((group) => {
    if (group.length === 1) {
      result.push({
        event: group[0].event,
        top: group[0].top,
        height: group[0].height,
        left: 0,
        width: 100,
      });
      return;
    }

    // Greedy first-fit column assignment within the group.
    const columns: TimedEvent[][] = [];

    group.forEach((event) => {
      let placed = false;
      for (const column of columns) {
        const hasOverlap = column.some(
          (item) => event.startTime < item.endTime && event.endTime > item.startTime,
        );
        if (!hasOverlap) {
          column.push(event);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([event]);
    });

    const totalColumns = columns.length;
    columns.forEach((column, columnIndex) => {
      column.forEach((event) => {
        result.push({
          event: event.event,
          top: event.top,
          height: event.height,
          left: (columnIndex * 100) / totalColumns,
          width: 100 / totalColumns,
        });
      });
    });
  });

  return result;
}

function eventOverlapsDate(event: GridEvent, date: Date): boolean {
  const dateKey = toDateKey(date);
  const eventStartKey = toDateKey(new Date(event.start));
  const eventEndKey = toDateKey(new Date(event.end));
  return dateKey >= eventStartKey && dateKey <= eventEndKey;
}

/* -------------------------------------------------------------------------- */
/*  The time grid — renders 7 columns for the week view or 1 for the day view. */
/* -------------------------------------------------------------------------- */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface TimeGridProps {
  days: Date[];
  events: GridEvent[];
  onEventClick: (event: GridEvent) => void;
  /** Shown as a floating hint when the visible days have no events. */
  emptyLabel: string;
  /** Optional action under the empty hint (e.g. jump to the demo week). */
  emptyAction?: { label: string; onClick: () => void };
  className?: string;
}

export function TimeGrid({
  days,
  events,
  onEventClick,
  emptyLabel,
  emptyAction,
  className,
}: TimeGridProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const daysKey = days.map(toDateKey).join("|");

  // Tick every minute so the now-line and today ring stay honest during a
  // long-running demo.
  const [, setMinuteTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const showNowIndicator = days.some((day) => isToday(day));
  const nowTop = (minutesOfDay(now) / 60) * HOUR_HEIGHT;

  // Auto-scroll to just above now (today visible) or to the working morning.
  // The hour labels straddle their grid line (they sit 8px above it), so back
  // off the exact hour boundary by 12px — otherwise the top label is clipped.
  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const targetHour = showNowIndicator ? Math.max(londonHourNow() - 2, 6) : 8;
    container.scrollTop = Math.max(targetHour * HOUR_HEIGHT - 12, 0);
  }, [daysKey, showNowIndicator]);

  const visibleCount = React.useMemo(
    () => events.filter((event) => days.some((day) => eventOverlapsDate(event, day))).length,
    [events, daysKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const columnsStyle = {
    gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
  };

  const renderEventBlock = (day: Date, positioned: PositionedEvent) => {
    const { event } = positioned;
    const timeRange = formatEventTimeRange(event.start, event.end, day);

    return (
      <button
        key={`${event.id}-${toDateKey(day)}`}
        type="button"
        className={cn(
          "absolute overflow-hidden rounded-md border px-1.5 py-1 text-left",
          "cursor-pointer pointer-events-auto border-l-[3px] transition-opacity duration-fast hover:opacity-80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          TONE_CLASS[event.tone],
          TONE_EDGE[event.tone],
        )}
        style={{
          top: `${positioned.top}px`,
          height: `${positioned.height}px`,
          left: `calc(${positioned.left}% + 2px)`,
          width: `calc(${positioned.width}% - 4px)`,
        }}
        onClick={() => onEventClick(event)}
        title={`${event.title}\n${timeRange}`}
      >
        <div className="truncate text-xs font-semibold leading-tight">
          {event.title}
        </div>
        {positioned.height > 28 && (
          <div className="truncate text-[11px] leading-tight opacity-80">
            {timeRange}
          </div>
        )}
        {event.subtitle && positioned.height > 44 && (
          <div className="mt-0.5 truncate text-[10px] leading-tight opacity-70">
            {event.subtitle}
          </div>
        )}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {/* Day header row — outside the scroll container so it never scrolls away. */}
      <div className="flex shrink-0 border-b border-border bg-muted/30">
        <div className="w-10 shrink-0 border-r border-border md:w-14" />
        <div className="grid flex-1" style={columnsStyle}>
          {days.map((day) => (
            <div
              key={toDateKey(day)}
              className={cn(
                "border-r border-border px-2 py-2 text-center last:border-r-0",
                isToday(day) && "bg-primary/5",
              )}
            >
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {DAY_NAMES[day.getDay()]}
              </div>
              <div
                className={cn(
                  "mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold text-foreground",
                  isToday(day) && "bg-primary text-primary-foreground",
                )}
              >
                {day.getDate()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quiet empty hint, floating over the grid so the surface stays useful. */}
      {visibleCount === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-20 flex flex-col items-center gap-2">
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
            {emptyLabel}
          </span>
          {emptyAction && (
            <Button
              variant="outline"
              size="sm"
              className="pointer-events-auto cursor-pointer bg-card shadow-sm"
              onClick={emptyAction.onClick}
            >
              {emptyAction.label}
            </Button>
          )}
        </div>
      )}

      {/* One scroll container holds gutter + grid + now-line, so everything
          scrolls together. */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="flex">
          <div className="sticky left-0 z-20 w-10 shrink-0 border-r border-border bg-card md:w-14">
            {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
              <div
                key={hour}
                className="relative border-b border-border text-right text-[10px] text-muted-foreground md:text-[11px]"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {hour > 0 && (
                  <span className="absolute -top-2 right-1 md:right-2">
                    {formatHourLabel(hour)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="relative grid flex-1" style={columnsStyle}>
            {days.map((day) => {
              const timedEvents = events.filter((event) =>
                eventOverlapsDate(event, day),
              );
              const positionedEvents = layoutTimedEvents(timedEvents, day);

              return (
                <div
                  key={toDateKey(day)}
                  className={cn(
                    "relative border-r border-border last:border-r-0",
                    isToday(day) && "bg-primary/[0.03]",
                  )}
                  style={{ minHeight: `${HOUR_HEIGHT * HOURS_IN_DAY}px` }}
                >
                  {/* Hour slot lines. Read-only surface, so plain divs. */}
                  {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
                    <div
                      key={hour}
                      className="border-b border-border"
                      style={{ height: `${HOUR_HEIGHT}px` }}
                    />
                  ))}

                  {/* Event overlay: the layer ignores the pointer, each chip
                      re-enables it, so grid lines never block a click. */}
                  <div className="pointer-events-none absolute inset-0 z-10">
                    {positionedEvents.map((positioned) =>
                      renderEventBlock(day, positioned),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Red now-line with the gutter dot, spanning all columns. */}
        {showNowIndicator && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
            style={{ top: `${nowTop}px` }}
          >
            <div className="flex w-10 shrink-0 justify-end pr-1 md:w-14">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            </div>
            <div className="h-px flex-1 bg-red-500" />
          </div>
        )}
      </div>
    </div>
  );
}

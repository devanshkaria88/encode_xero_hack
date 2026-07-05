"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getWeekDays, isToday, toDateKey } from "@/lib/calendar-utils";

// Monday-first, matching the main week grid.
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
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

export interface MiniMonthProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
}

/**
 * The hand-rolled mini month for the calendar sidebar. Its displayed month is
 * derived from `currentDate`, so paging it moves the main week view too — one
 * state, no drift. Clicking a day jumps the week view to that week.
 */
export function MiniMonth({ currentDate, onDateChange }: MiniMonthProps) {
  const miniMonth = currentDate.getMonth();
  const miniYear = currentDate.getFullYear();

  const miniDays = React.useMemo(() => {
    const firstDay = new Date(miniYear, miniMonth, 1);
    const lastDay = new Date(miniYear, miniMonth + 1, 0);
    const days: (Date | null)[] = [];

    // Leading blanks up to the first weekday (Monday-first offset).
    for (let i = 0; i < (firstDay.getDay() + 6) % 7; i++) {
      days.push(null);
    }
    // Noon-anchored so the London day key is stable.
    for (let day = 1; day <= lastDay.getDate(); day++) {
      days.push(new Date(miniYear, miniMonth, day, 12));
    }
    return days;
  }, [miniMonth, miniYear]);

  const weekDayKeys = React.useMemo(
    () => getWeekDays(currentDate).map(toDateKey),
    [currentDate],
  );

  const shiftMiniMonth = (delta: number) => {
    onDateChange(new Date(miniYear, miniMonth + delta, 1, 12));
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {MONTH_NAMES[miniMonth]} {miniYear}
        </h3>
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => shiftMiniMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => shiftMiniMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className="py-1 text-center text-[10px] font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {miniDays.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="h-8" />;
          }

          const inCurrentWeek = weekDayKeys.includes(toDateKey(date));

          return (
            <button
              key={toDateKey(date)}
              type="button"
              onClick={() => onDateChange(date)}
              aria-label={`Go to ${date.toDateString()}`}
              aria-current={isToday(date) ? "date" : undefined}
              className={cn(
                "h-8 w-full cursor-pointer rounded-full text-xs font-medium text-foreground transition-colors duration-fast",
                "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                inCurrentWeek && !isToday(date) && "bg-accent/60",
                isToday(date) &&
                  "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

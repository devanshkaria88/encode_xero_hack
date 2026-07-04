"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TrendingUp, Check, RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useApi, type Schemas } from "@/lib/api";
import { Money } from "@/components/money";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

function humanizeSource(source: string): string {
  const known: Record<string, string> = {
    QUOTE_NOT_INVOICED: "Quotes not invoiced",
    RETAINER_STOPPED: "Lapsed retainers",
    EXPENSE_NOT_RECHARGED: "Unrecharged expenses",
    proposals: "In review",
    detections: "Detected leaks",
    unbilled: "Unbilled meetings",
  };
  if (known[source]) return known[source];
  return source
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The persistent leak strip: the recoverable money Robyn has found this month,
 * with a breakdown by source. This is the "money is walking away" headline made
 * calm and specific. Wired to GET /dashboard/leak-strip.
 */
export function LeakStrip() {
  const reduce = useReducedMotion();
  const { data, error, isLoading, refetch, isValidating } = useApi<
    Schemas["LeakStripDto"]
  >("/dashboard/leak-strip", { refreshMs: 60_000 });

  if (isLoading) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 shadow-xs sm:px-5">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="hidden h-6 w-64 rounded-full sm:block" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-xs sm:px-5">
        <span>Couldn&apos;t load this month&apos;s recoverable total.</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={refetch}
          disabled={isValidating}
        >
          <RotateCw className={cn("h-3.5 w-3.5", isValidating && "animate-spin")} />
          Retry
        </Button>
      </div>
    );
  }

  const recoverable = Number(data?.recoverableGbp ?? 0);
  const monthLabel = data?.monthLabel ?? "this month";
  const breakdown = (data?.breakdown ?? []).filter((b) => Number(b.gbp) > 0);

  // Positive empty state — nothing is leaking.
  if (recoverable <= 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm shadow-xs dark:border-teal-500/25 dark:bg-teal-500/5 sm:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
          <Check className="h-4 w-4" />
        </span>
        <div>
          <p className="font-medium text-foreground">
            Everything billable is accounted for
          </p>
          <p className="text-muted-foreground">
            Nothing is leaking in {monthLabel}. Robyn is watching.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:gap-5 sm:px-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <TrendingUp className="h-[1.1rem] w-[1.1rem]" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recoverable in {monthLabel}
          </p>
          <p className="text-lg font-semibold leading-tight text-foreground">
            <Money amount={recoverable} whole />
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              waiting to be billed
            </span>
          </p>
        </div>
      </div>

      {breakdown.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
          {breakdown.map((b, i) => (
            <span
              key={`${b.source}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs"
            >
              <span className="text-muted-foreground">
                {humanizeSource(b.source)}
              </span>
              <span className="tabular font-medium text-foreground">
                <Money amount={b.gbp} whole />
              </span>
              {Number(b.count) > 0 && (
                <span className="tabular text-[0.625rem] text-muted-foreground">
                  ·{b.count}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

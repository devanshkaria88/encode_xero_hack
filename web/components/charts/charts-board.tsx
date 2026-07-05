"use client";

import * as React from "react";
import { CloudOff } from "lucide-react";

import type { Schemas, UseApiState } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/error-state";
import { CHART_VARS } from "./palette";
import { ChartCardSkeleton } from "./chart-card";
import { InvoicesOwedCard } from "./invoices-owed-card";
import { CashInCard } from "./cash-in-card";
import { MoneyFoundCard } from "./money-found-card";
import { UnbilledPipelineCard } from "./unbilled-pipeline-card";

type ChartsDto = Schemas["DashboardChartsDto"];

/**
 * The Xero-style charts board: four compact money cards fed by
 * GET /dashboard/charts. The parent owns the query so one refresh button can
 * refetch charts, stats and tasks together. CHART_VARS on the wrapper defines
 * the chart colour tokens for both themes.
 */
export function ChartsBoard({ query }: { query: UseApiState<ChartsDto> }) {
  const { data, error, isLoading, isValidating, refetch } = query;

  return (
    <section className={cn("space-y-3", CHART_VARS)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Money at a glance
        </h2>
        {data?.meta.source === "local-fallback" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[0.6875rem] font-medium text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
            <CloudOff className="h-3 w-3" aria-hidden="true" />
            Live Xero unavailable. Showing local data.
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ChartCardSkeleton />
          <ChartCardSkeleton />
          <ChartCardSkeleton />
          <ChartCardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          compact
          title="Couldn't load the money charts"
          error={error}
          onRetry={refetch}
          retrying={isValidating}
        />
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <InvoicesOwedCard buckets={data.invoicesOwed} />
          <CashInCard cashIn={data.cashIn} />
          <MoneyFoundCard buckets={data.moneyFound} />
          <UnbilledPipelineCard pipeline={data.unbilledPipeline} />
        </div>
      ) : null}
    </section>
  );
}

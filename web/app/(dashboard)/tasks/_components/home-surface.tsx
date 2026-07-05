"use client";

import * as React from "react";
import { CheckCircle2, RotateCw } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ChartsBoard } from "@/components/charts/charts-board";
import { SummaryRow } from "./summary-row";
import { TaskTileBoard, TileGridSkeleton } from "./task-tile-board";
import type { TaskDto } from "./context";

/**
 * The dashboard home: headline stats, the Xero-style money charts board, then
 * the compact task inbox. One refresh path — resolving a task in the dialog
 * refetches tasks, stats and charts together, so an approved invoice moves the
 * "Invoices owed" card in the same beat.
 */
export function HomeSurface() {
  const tasksQ = useApi<TaskDto[]>("/tasks", { refreshMs: 20_000 });
  const summaryQ = useApi<Schemas["DashboardSummaryDto"]>(
    "/dashboard/summary",
    { refreshMs: 60_000 },
  );
  const chartsQ = useApi<Schemas["DashboardChartsDto"]>("/dashboard/charts", {
    refreshMs: 60_000,
  });

  const refetchAll = React.useCallback(() => {
    tasksQ.refetch();
    summaryQ.refetch();
    chartsQ.refetch();
  }, [tasksQ.refetch, summaryQ.refetch, chartsQ.refetch]);

  const tasks = tasksQ.data ?? [];
  const refreshing =
    tasksQ.isValidating || summaryQ.isValidating || chartsQ.isValidating;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="What's owed, what's coming in, and what needs you."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refetchAll}
            disabled={refreshing}
            aria-label="Refresh dashboard"
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <SummaryRow
        data={summaryQ.data}
        isLoading={summaryQ.isLoading}
        error={summaryQ.error}
        refetch={summaryQ.refetch}
      />

      <ChartsBoard query={chartsQ} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Waiting on you
          </h2>
          {tasks.length > 0 && (
            <span className="tabular text-xs text-muted-foreground">
              {tasks.length} open
            </span>
          )}
        </div>

        {tasksQ.isLoading ? (
          <TileGridSkeleton size="sm" count={6} />
        ) : tasksQ.error ? (
          <ErrorState
            title="Couldn't load your tasks"
            error={tasksQ.error}
            onRetry={tasksQ.refetch}
            retrying={tasksQ.isValidating}
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="All caught up"
            description="Robyn's watching your calendar, inbox and contracts. Anything that needs you will show up here."
          />
        ) : (
          <TaskTileBoard tasks={tasks} refetchAll={refetchAll} size="sm" />
        )}
      </section>
    </div>
  );
}

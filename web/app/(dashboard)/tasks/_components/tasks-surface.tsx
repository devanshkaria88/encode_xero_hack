"use client";

import * as React from "react";
import { CheckCircle2, RotateCw } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { SummaryRow } from "./summary-row";
import { TaskList } from "./task-list";
import type { TaskDto } from "./context";

/**
 * The Tasks inbox — Robyn's home screen and primary resolution surface. Reads
 * GET /tasks and GET /dashboard/summary, and refetches both after every
 * resolution so a resolved card leaves and the headline numbers update at once.
 */
export function TasksSurface() {
  const tasksQ = useApi<TaskDto[]>("/tasks", { refreshMs: 20_000 });
  const summaryQ = useApi<Schemas["DashboardSummaryDto"]>(
    "/dashboard/summary",
    { refreshMs: 60_000 },
  );

  const refetchAll = React.useCallback(() => {
    tasksQ.refetch();
    summaryQ.refetch();
  }, [tasksQ.refetch, summaryQ.refetch]);

  const tasks = tasksQ.data ?? [];
  const refreshing = tasksQ.isValidating || summaryQ.isValidating;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks inbox"
        description="Everything Robyn couldn't decide on its own. Resolve each one right here."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refetchAll}
            disabled={refreshing}
            aria-label="Refresh tasks"
          >
            <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
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
          <LoadingState rows={3} />
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
          <TaskList tasks={tasks} refetchAll={refetchAll} />
        )}
      </section>
    </div>
  );
}

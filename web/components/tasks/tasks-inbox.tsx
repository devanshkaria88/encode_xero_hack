"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { TaskCard } from "@/components/tasks/task-card";

/**
 * The Tasks inbox body. Every open Task Robyn couldn't decide alone lands here.
 * Reads GET /tasks. Loading / empty / error all handled. The zero-state copy is
 * the one from the product: "All caught up — Robyn's watching."
 */
export function TasksInbox() {
  const reduce = useReducedMotion();
  const { data, error, isLoading, refetch, isValidating } = useApi<
    Schemas["TaskDto"][]
  >("/tasks", { refreshMs: 20_000 });

  if (isLoading) return <LoadingState rows={3} />;

  if (error)
    return (
      <ErrorState
        title="Couldn't load your tasks"
        error={error}
        onRetry={refetch}
        retrying={isValidating}
      />
    );

  const tasks = data ?? [];

  if (tasks.length === 0)
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All caught up"
        description="Robyn's watching your calendar, inbox and contracts. Anything that needs you will show up here."
      />
    );

  return (
    <div className="space-y-3">
      {tasks.map((task, i) => (
        <motion.div
          key={task.id}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.22,
            ease: [0.22, 1, 0.36, 1],
            delay: reduce ? 0 : Math.min(i * 0.04, 0.24),
          }}
        >
          <TaskCard task={task} />
        </motion.div>
      ))}
    </div>
  );
}

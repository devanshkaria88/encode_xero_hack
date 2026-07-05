"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { TASK_META } from "@/lib/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskTile } from "@/components/tasks/task-tile";
import { taskCaption } from "@/components/tasks/task-caption";
import type { TaskDto } from "./context";
import { TaskRouter } from "./task-router";

/**
 * The compact inbox: a grid of small task tiles. Clicking a tile opens a
 * dialog that hosts the EXISTING full resolution card from TaskRouter —
 * same components, same actions, zero behaviour change. When the card
 * resolves (it calls refetchAll), the dialog closes and the list refetches;
 * closing the dialog by hand also refetches so a half-finished resolution
 * never leaves a stale tile behind.
 */
export function TaskTileBoard({
  tasks,
  refetchAll,
  size = "md",
}: {
  tasks: TaskDto[];
  refetchAll: () => void;
  size?: "sm" | "md";
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = React.useState<TaskDto | null>(null);
  // Keep the last task rendered through the dialog's exit animation.
  const [last, setLast] = React.useState<TaskDto | null>(null);

  const open = React.useCallback((task: TaskDto) => {
    setActive(task);
    setLast(task);
  }, []);

  const onResolved = React.useCallback(() => {
    setActive(null);
    refetchAll();
  }, [refetchAll]);

  const onOpenChange = React.useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setActive(null);
        refetchAll();
      }
    },
    [refetchAll],
  );

  const shown = active ?? last;

  return (
    <>
      <div
        className={
          size === "sm"
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "grid gap-3 md:grid-cols-2"
        }
      >
        <AnimatePresence initial={false} mode="popLayout">
          {tasks.map((task, i) => (
            <motion.div
              key={task.id}
              layout="position"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }
              }
              transition={{
                duration: 0.24,
                ease: [0.22, 1, 0.36, 1],
                delay: reduce ? 0 : Math.min(i * 0.03, 0.15),
              }}
            >
              <TaskTile task={task} size={size} onOpen={() => open(task)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Dialog open={active !== null} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          {shown && (
            <>
              <div className="border-b border-border px-5 py-4 pr-12">
                <DialogTitle className="text-[0.95rem]">
                  {TASK_META[shown.type]?.label ?? shown.type}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {taskCaption(shown)}
                </DialogDescription>
              </div>
              <div className="max-h-[72vh] overflow-y-auto bg-canvas/60 p-4 sm:p-5">
                <TaskRouter task={shown} refetchAll={onResolved} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Skeleton tiles so the inbox loads at its final size without jumping. */
export function TileGridSkeleton({
  size = "md",
  count = 4,
}: {
  size?: "sm" | "md";
  count?: number;
}) {
  return (
    <div
      className={
        size === "sm"
          ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          : "grid gap-3 md:grid-cols-2"
      }
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={
            "flex items-center gap-3 rounded-lg border border-border bg-card shadow-xs " +
            (size === "sm" ? "p-3" : "p-4")
          }
        >
          <Skeleton
            className={size === "sm" ? "h-9 w-9 rounded-md" : "h-10 w-10 rounded-md"}
          />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

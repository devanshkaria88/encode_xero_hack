"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { TaskDto } from "./context";
import { TaskRouter } from "./task-router";

/**
 * The stack of resolvable cards. New tasks animate in; a resolved task animates
 * out (via AnimatePresence) once the refetch drops it, and the rest settle up.
 */
export function TaskList({
  tasks,
  refetchAll,
}: {
  tasks: TaskDto[];
  refetchAll: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false} mode="popLayout">
        {tasks.map((task, i) => (
          <motion.div
            key={task.id}
            layout="position"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: -6, scale: 0.985 }
            }
            transition={{
              duration: 0.24,
              ease: [0.22, 1, 0.36, 1],
              delay: reduce ? 0 : Math.min(i * 0.04, 0.2),
            }}
          >
            <TaskRouter task={task} refetchAll={refetchAll} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

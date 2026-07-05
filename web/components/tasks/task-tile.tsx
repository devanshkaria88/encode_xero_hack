"use client";

import * as React from "react";
import {
  ChevronRight,
  FileSignature,
  FileText,
  Receipt,
  UserCheck,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TASK_META, TONE_CLASS, TONE_DOT } from "@/lib/states";
import { RelativeTime } from "@/components/relative-time";
import { taskCaption } from "./task-caption";

type TaskDto = Schemas["TaskDto"];

const TYPE_ICON: Record<TaskDto["type"], LucideIcon> = {
  PROVIDE_TRANSCRIPT: FileText,
  CONFIRM_CLIENT_MATCH: UserCheck,
  REVIEW_INVOICE: Receipt,
  CONFIRM_AGREEMENT: UserPlus,
  ATTACH_CONTRACT: FileSignature,
};

/**
 * A compact task tile: type icon, one-line caption of what needs doing, and a
 * small state + age hint. Clicking it opens the full resolution card in a
 * dialog (progressive disclosure) — the tile itself never mutates anything.
 */
export function TaskTile({
  task,
  size = "md",
  onOpen,
}: {
  task: TaskDto;
  size?: "sm" | "md";
  onOpen: () => void;
}) {
  const meta = TASK_META[task.type] ?? {
    label: task.type,
    blurb: "",
    tone: "neutral" as const,
  };
  const Icon = TYPE_ICON[task.type] ?? FileText;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${meta.label}: ${taskCaption(task)}`}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card text-left shadow-xs",
        "transition-all duration-fast ease-out-quiet hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        size === "sm" ? "p-3" : "p-4",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border",
          TONE_CLASS[meta.tone],
          size === "sm" ? "h-9 w-9" : "h-10 w-10",
        )}
        aria-hidden="true"
      >
        <Icon className={size === "sm" ? "h-4 w-4" : "h-[1.1rem] w-[1.1rem]"} />
      </span>

      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          className={cn(
            "block truncate font-medium text-foreground",
            size === "sm" ? "text-sm" : "text-[0.95rem]",
          )}
        >
          {taskCaption(task)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[meta.tone])}
            aria-hidden="true"
          />
          <span className="truncate">{meta.label}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime value={task.createdAt} className="shrink-0" />
        </span>
      </span>

      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

import * as React from "react";
import { ChevronRight } from "lucide-react";

import type { Schemas } from "@/lib/api";
import { TASK_META } from "@/lib/states";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { StateBadge } from "@/components/state-badge";
import { RelativeTime } from "@/components/relative-time";

/**
 * A single Task rendered as a resolvable-looking card. In this foundation it is
 * read-only; the inline resolve controls (paste transcript, confirm match,
 * approve invoice) are wired by the surface-owning agents against the module
 * endpoints. The card chrome, badge and provenance are final.
 */
export function TaskCard({ task }: { task: Schemas["TaskDto"] }) {
  const meta = TASK_META[task.type] ?? {
    label: task.type,
    blurb: "",
    tone: "neutral" as const,
  };

  return (
    <Card className="group flex items-center gap-4 p-4 transition-colors duration-fast hover:border-primary/30 hover:bg-accent/40">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge tone={meta.tone} label={meta.label} size="sm" />
          <span className="text-[0.6875rem] text-muted-foreground">
            <RelativeTime value={task.createdAt} />
          </span>
        </div>
        <p className="truncate text-sm font-medium text-foreground">
          {task.title}
        </p>
        {meta.blurb && (
          <p className="truncate text-sm text-muted-foreground">{meta.blurb}</p>
        )}
      </div>
      <ChevronRight
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-muted-foreground",
        )}
        aria-hidden="true"
      />
    </Card>
  );
}

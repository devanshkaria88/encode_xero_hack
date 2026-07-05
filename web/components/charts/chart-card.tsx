import * as React from "react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The frame every chart on the board shares: quiet uppercase title, a GBP
 * headline, an optional one-line hint, then the plot. A fixed min-height keeps
 * the grid stable across loading, empty and loaded states.
 */
export function ChartCard({
  title,
  headline,
  hint,
  children,
  className,
}: {
  title: string;
  headline?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-h-[248px] flex-col gap-4 p-5", className)}>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {headline != null && (
          <p className="tabular text-2xl font-semibold leading-tight text-foreground">
            {headline}
          </p>
        )}
        {hint != null && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-4">
        {children}
      </div>
    </Card>
  );
}

/** Skeleton twin of ChartCard so loading never jumps the grid. */
export function ChartCardSkeleton() {
  return (
    <Card className="flex min-h-[248px] flex-col gap-4 p-5" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </Card>
  );
}

/** Calm in-card empty note that fills the plot area at the same height. */
export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

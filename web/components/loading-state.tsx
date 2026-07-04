import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** A single skeleton card, used to hold layout while a surface loads. */
export function LoadingCard({ className }: { className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-3 w-64" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
    </Card>
  );
}

export interface LoadingStateProps {
  /** Number of skeleton cards to render. */
  rows?: number;
  className?: string;
  label?: string;
}

/**
 * Default loading surface for a data view: a stack of skeleton cards that
 * reserves layout so nothing jumps when real data arrives.
 */
export function LoadingState({
  rows = 3,
  className,
  label = "Loading",
}: LoadingStateProps) {
  return (
    <div className={cn("space-y-4", className)} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: rows }).map((_, i) => (
        <LoadingCard key={i} />
      ))}
    </div>
  );
}

/** A row of stat-tile skeletons for dashboard summaries. */
export function LoadingStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

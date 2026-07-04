"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { useApi } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export interface SurfacePreviewProps<T> {
  endpoint: string;
  /** Reads the count from the response (array length by default). */
  countOf?: (data: T) => number;
  /** Best-effort labels for a small preview list. */
  labelsOf?: (data: T) => string[];
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  /** One-line note about the full surface arriving next. */
  note: string;
  loadingRows?: number;
}

/**
 * A live-wired scaffold body for a surface whose full view is built by a later
 * agent. It proves the API contract and shows the loading / empty / error
 * states in the real design language, so navigation and data flow work today.
 */
export function SurfacePreview<T>({
  endpoint,
  countOf,
  labelsOf,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  note,
  loadingRows = 3,
}: SurfacePreviewProps<T>) {
  const { data, error, isLoading, refetch, isValidating } =
    useApi<T>(endpoint);

  if (isLoading) return <LoadingState rows={loadingRows} />;

  if (error)
    return (
      <ErrorState error={error} onRetry={refetch} retrying={isValidating} />
    );

  const count = data
    ? countOf
      ? countOf(data)
      : Array.isArray(data)
        ? data.length
        : 0
    : 0;

  if (count === 0)
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );

  const labels = data && labelsOf ? labelsOf(data).slice(0, 6) : [];

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-baseline gap-2">
          <span className="tabular text-2xl font-semibold text-foreground">
            {count}
          </span>
          <span className="text-sm text-muted-foreground">
            {count === 1 ? "item" : "items"} loaded from the live API
          </span>
        </div>
        {labels.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {labels.map((label, i) => (
              <li
                key={`${label}-${i}`}
                className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-foreground"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border pt-4 text-sm text-muted-foreground">
          {note}
        </p>
      </CardContent>
    </Card>
  );
}

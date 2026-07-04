"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useApi, type Schemas } from "@/lib/api";
import { connectionStatusMeta, TONE_DOT } from "@/lib/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Compact org + Xero connection health pill for the top bar. Reads
 * GET /connections and surfaces the XERO row. Always renders something, even
 * when the API is unreachable.
 */
export function OrgStatusPill() {
  const { data, isLoading, error } = useApi<Schemas["ConnectionRowDto"][]>(
    "/connections",
    { refreshMs: 60_000 },
  );

  if (isLoading) {
    return <Skeleton className="h-8 w-40 rounded-full" />;
  }

  const xero = data?.find((r) => r.kind === "XERO");
  const status = xero?.status ?? "DOWN";
  const meta = connectionStatusMeta(status);
  const orgName =
    xero && xero.label && xero.label.toUpperCase() !== "XERO"
      ? xero.label
      : "Xero org";
  const detail =
    xero?.detail ??
    (error ? "Robyn can't reach the API right now." : "Connection status");

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <div
          className="inline-flex cursor-default items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-xs"
          role="status"
          aria-label={`Xero connection: ${meta.label}`}
        >
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              TONE_DOT[meta.tone],
            )}
          />
          <span className="max-w-[10rem] truncate text-xs font-medium text-foreground">
            {orgName}
          </span>
          <span className="hidden text-[0.6875rem] font-medium text-muted-foreground sm:inline">
            {meta.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium text-foreground">Xero — {meta.label}</p>
        <p className="mt-0.5 text-muted-foreground">{detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}

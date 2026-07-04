"use client";

import * as React from "react";
import { Plug, RotateCw } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

import { ConnectionCard } from "./connection-card";

type Row = Schemas["ConnectionRowDto"];

/** Canonical top-to-bottom order, independent of API ordering. */
const ORDER: Row["kind"][] = ["XERO", "CALENDAR", "EMAIL"];

/**
 * The Connections screen. Reads GET /connections and renders one health card
 * per integration. Auto-refreshes every 60s; each card can also be checked on
 * demand. Loading, empty and error states are all handled and recoverable.
 */
export function ConnectionsSurface() {
  const { data, error, isLoading, isValidating, refetch } = useApi<Row[]>(
    "/connections",
    { refreshMs: 60_000 },
  );

  const rows = React.useMemo(() => {
    if (!data) return [];
    const rank = (k: Row["kind"]) => {
      const i = ORDER.indexOf(k);
      return i === -1 ? ORDER.length : i;
    };
    return [...data].sort((a, b) => rank(a.kind) - rank(b.kind));
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="The live health of Robyn's links to Xero, your calendar and your inbox. Nothing here is faked — if a link is running on demo data, it says so."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            disabled={isLoading || isValidating}
            aria-label="Refresh connection health"
          >
            <RotateCw
              className={cn(
                "h-3.5 w-3.5",
                isValidating && "animate-spin",
              )}
            />
            {isValidating ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {isLoading ? (
        <LoadingState rows={3} label="Loading connection health" />
      ) : error ? (
        <ErrorState
          title="Couldn't load connection health"
          error={error}
          onRetry={refetch}
          retrying={isValidating}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No connections configured yet"
          description="Robyn links to Xero, your calendar and your inbox. Once they're set up, their live health shows here."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <ConnectionCard key={row.kind} row={row} onChanged={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

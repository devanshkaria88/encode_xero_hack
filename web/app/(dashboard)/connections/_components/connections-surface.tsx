"use client";

import * as React from "react";
import { Plug, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { useApi, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

import { ConnectionCard } from "./connection-card";

type Row = Schemas["ConnectionRowDto"];
type GoogleStatus = Schemas["GoogleStatusDto"];

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

  // One Google status shared by the Calendar and Email cards.
  const google = useApi<GoogleStatus>("/google/status");
  const googleRefetch = google.refetch;

  // While the post-connect sync runs, poll status so the cards flip to
  // "connected + synced" without a manual refresh.
  const syncStatus = google.data?.syncStatus;
  React.useEffect(() => {
    if (syncStatus !== "SYNCING" && syncStatus !== "PENDING") return;
    const id = setInterval(() => googleRefetch(), 4_000);
    return () => clearInterval(id);
  }, [syncStatus, googleRefetch]);

  // Handle the OAuth return redirect: ?google=connected | ?google=error&reason=...
  // Toast once, clear the query params, refetch everything. The root <Toaster>
  // hydrates in its own task, and a toast fired before it subscribes is
  // silently dropped, so the toast retries until it actually shows. The
  // outcome lives in a ref so the URL is only read and cleaned once.
  const redirectOutcome = React.useRef<{
    outcome: string;
    reason: string | null;
  } | null>(null);
  React.useEffect(() => {
    if (!redirectOutcome.current) {
      const params = new URLSearchParams(window.location.search);
      const outcome = params.get("google");
      if (!outcome) return;
      redirectOutcome.current = { outcome, reason: params.get("reason") };
      params.delete("google");
      params.delete("reason");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
      refetch();
      googleRefetch();
    }

    const pending = redirectOutcome.current;
    if (!pending) return;
    let cancelled = false;
    let attemptsLeft = 8;
    const fire = () => {
      if (cancelled) return;
      // A stable id means re-issuing updates the same toast instead of
      // stacking duplicates, and restores it if a late hydration pass
      // remounted the <Toaster> and wiped its list.
      if (pending.outcome === "connected") {
        toast.success("Google connected", {
          id: "google-redirect",
          description: "Robyn is running the first sync now.",
        });
      } else if (pending.outcome === "error") {
        toast.error("Google connection failed", {
          id: "google-redirect",
          description: pending.reason || "Please try connecting again.",
        });
      }
      if (attemptsLeft-- > 0) {
        window.setTimeout(fire, 500);
      } else {
        redirectOutcome.current = null;
      }
    };
    fire();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <ConnectionCard
              key={row.kind}
              row={row}
              onChanged={refetch}
              googleStatus={google.data}
              googleStatusLoading={google.isLoading}
              googleStatusError={google.error}
              onGoogleStatusRefresh={googleRefetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

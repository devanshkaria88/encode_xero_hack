"use client";

import * as React from "react";
import {
  UserPlus,
  Quote,
  Check,
  X,
  RefreshCw,
  Eye,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import {
  post,
  useAction,
  type UseApiState,
  type Schemas,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/state-badge";
import { RelativeTime } from "@/components/relative-time";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import type { BadgeTone } from "@/lib/states";

import { prospectStateLabel } from "./format";

type Prospect = Schemas["PotentialClientDto"];
type PromoteResult = Schemas["PromoteResultDto"];

const STATE_TONE: Record<Prospect["state"], BadgeTone> = {
  QUEUED: "neutral",
  WATCHING: "info",
  AGREEMENT_DETECTED: "unknown",
  PROMOTED: "success",
  DISMISSED: "skipped",
};

/**
 * Robyn's pipeline: unknown attendees she is watching, and the ones whose inbox
 * said yes. On an agreement she shows the verbatim quote and offers to onboard
 * them into Xero in one tap. This is Loop 2, made visible.
 */
export function PotentialClientsRail({
  query,
  onConfirmed,
  onOpenClient,
}: {
  query: UseApiState<Prospect[]>;
  onConfirmed: () => void;
  onOpenClient: (clientId: string) => void;
}) {
  const { data, error, isLoading, isValidating, refetch } = query;

  const prospects = (data ?? []).filter((p) => p.state !== "DISMISSED");

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Potential clients
          </h2>
          <p className="text-sm text-muted-foreground">
            People who showed up on your calendar but aren&apos;t clients yet.
            Robyn watches their inbox and onboards them when they agree.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={isValidating}
          className="shrink-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isValidating && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <LoadingState rows={2} />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={refetch}
          retrying={isValidating}
          compact
        />
      ) : prospects.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No prospects in the pipeline"
          description="When someone new appears on your calendar, Robyn queues them here and starts watching for a yes."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {prospects.map((p) => (
            <ProspectCard
              key={p.id}
              prospect={p}
              onConfirmed={onConfirmed}
              onDismissed={refetch}
              onOpenClient={onOpenClient}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProspectCard({
  prospect,
  onConfirmed,
  onDismissed,
  onOpenClient,
}: {
  prospect: Prospect;
  onConfirmed: () => void;
  onDismissed: () => void;
  onOpenClient: (clientId: string) => void;
}) {
  const confirm = useAction(() =>
    post<PromoteResult>(`/potential-clients/${prospect.id}/confirm`),
  );
  const dismiss = useAction(() =>
    post<Prospect>(`/potential-clients/${prospect.id}/dismiss`, {}),
  );

  const busy = confirm.isPending || dismiss.isPending;
  const isAgreement = prospect.state === "AGREEMENT_DETECTED";
  const isPromoted = prospect.state === "PROMOTED";

  async function onConfirm() {
    try {
      const result = await confirm.run();
      toast.success(`${result.clientName} is now a client`, {
        description: result.xeroError
          ? "Added locally. The Xero contact will sync when the connection is live."
          : "Robyn created the Xero contact and asked for their contract.",
      });
      onConfirmed();
    } catch {
      toast.error("Couldn't onboard this client. Please try again.");
    }
  }

  async function onDismiss() {
    try {
      await dismiss.run();
      toast.success(`Dismissed ${prospect.displayName}`);
      onDismissed();
    } catch {
      toast.error("Couldn't dismiss this prospect. Please try again.");
    }
  }

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-4",
        isAgreement && "border-violet-300/70 dark:border-violet-500/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {prospect.displayName}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {prospect.emails.join(", ")}
          </p>
        </div>
        <StateBadge
          tone={STATE_TONE[prospect.state]}
          label={prospectStateLabel(prospect.state)}
          size="sm"
        />
      </div>

      {isAgreement && prospect.evidenceQuote ? (
        <blockquote className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/25 dark:bg-violet-500/10">
          <Quote className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {prospect.evidenceQuote}
          </p>
          {prospect.evidenceFrom && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              from {prospect.evidenceFrom}
            </p>
          )}
        </blockquote>
      ) : isPromoted ? (
        <p className="text-sm text-muted-foreground">
          Robyn onboarded this client. She is billing them now.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Robyn is watching this inbox for a yes.
          {prospect.lastPolledAt && (
            <>
              {" "}
              Last checked <RelativeTime value={prospect.lastPolledAt} />.
            </>
          )}
        </p>
      )}

      {isAgreement ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onConfirm} disabled={busy} className="flex-1">
            {confirm.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Creating
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Confirm and create client
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDismiss}
            disabled={busy}
            aria-label={`Dismiss ${prospect.displayName}`}
          >
            {dismiss.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Dismiss
          </Button>
        </div>
      ) : isPromoted && prospect.promotedClientId ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onOpenClient(prospect.promotedClientId as string)}
        >
          Open client
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          Watching — no action needed yet
        </div>
      )}
    </Card>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { Quote, UserPlus, Mail } from "lucide-react";

import { post, useApi, useAction, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  TaskShell,
  TaskHeading,
  Chips,
  SuccessPanel,
  PendingPanel,
  InlineReason,
  CardActions,
} from "./bits";
import { ctxOf, readStr, readStrArray, asText } from "./context";
import { useDeferredResolve, type CardProps } from "./use-resolve";

type PromoteResult = Schemas["PromoteResultDto"];

/** Beat 3: an email said yes. Confirm to onboard the client into Xero. */
export function ConfirmAgreementCard({ task, refetchAll }: CardProps) {
  const ctx = ctxOf(task);
  const potentialId = task.refId;

  const ctxQuote = readStr(ctx, "evidenceQuote");
  const ctxName = readStr(ctx, "displayName");

  // Fall back to the queue only when the card context lacks the quote.
  const { data: queue } = useApi<Schemas["PotentialClientDto"][]>(
    ctxQuote ? null : "/potential-clients",
  );
  const matched = queue?.find((p) => p.id === potentialId);

  const displayName = ctxName ?? matched?.displayName ?? "New client";
  const quote = ctxQuote ?? asText(matched?.evidenceQuote);
  const from = readStr(ctx, "evidenceFrom") ?? asText(matched?.evidenceFrom);
  const emails =
    readStrArray(ctx, "emails").length > 0
      ? readStrArray(ctx, "emails")
      : (matched?.emails ?? []);
  const firstSeen = readStr(ctx, "firstSeenMeeting");

  const [result, setResult] = React.useState<PromoteResult | null>(null);
  const resolve = useDeferredResolve(refetchAll);

  const confirm = useAction(() =>
    post<PromoteResult>(`/potential-clients/${potentialId}/confirm`),
  );
  const dismiss = useAction((reason: string) =>
    post<Schemas["PotentialClientDto"]>(
      `/potential-clients/${potentialId}/dismiss`,
      { reason: reason || undefined },
    ),
  );

  const busy = confirm.isPending || dismiss.isPending || result !== null;

  async function onConfirm() {
    try {
      const res = await confirm.run();
      setResult(res);
      toast.success(`${res.clientName} is now a client`, {
        description: res.xeroContactCreated
          ? "Contact created in Xero. Next, attach their contract."
          : "Onboarded. Next, attach their contract.",
      });
      resolve(2200);
    } catch (err) {
      toast.error("Couldn't confirm this client", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function onDismiss(reason: string) {
    try {
      await dismiss.run(reason);
      toast.success("Prospect dismissed", {
        description: `${displayName} left the pipeline.`,
      });
      resolve(400);
    } catch (err) {
      toast.error("Couldn't dismiss this prospect", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <TaskShell task={task}>
      <div className="space-y-4">
        <TaskHeading
          title={`Confirm new client ${displayName}`}
          subtitle={
            firstSeen
              ? `First met on "${firstSeen}". Robyn has been watching their inbox.`
              : "Robyn has been watching this prospect's inbox for a go-ahead."
          }
        />

        {quote ? (
          <figure className="rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/25 dark:bg-violet-500/10">
            <div className="flex gap-2.5">
              <Quote className="mt-0.5 h-4 w-4 shrink-0 text-violet-500 dark:text-violet-300" />
              <div className="min-w-0 space-y-1">
                <blockquote className="text-sm font-medium text-violet-900 dark:text-violet-100">
                  “{quote}”
                </blockquote>
                {from ? (
                  <figcaption className="flex items-center gap-1.5 text-xs text-violet-700/80 dark:text-violet-300/70">
                    <Mail className="h-3 w-3" aria-hidden="true" />
                    From {from}
                  </figcaption>
                ) : null}
              </div>
            </div>
          </figure>
        ) : null}

        {emails.length > 0 && <Chips items={emails} />}

        {result ? (
          <div className="space-y-2">
            <SuccessPanel title={`${result.clientName} added to your clients`}>
              <p>
                {result.xeroContactCreated
                  ? "Robyn created the contact in Xero and filed this prospect as promoted."
                  : "Robyn promoted this prospect to a client."}{" "}
                A task to attach their contract is waiting for you.
              </p>
            </SuccessPanel>
            {asText(result.xeroError) ? (
              <PendingPanel title="Xero connection pending">
                <p>
                  The contact will be created in Xero the moment the connection
                  is live. Nothing is lost.
                </p>
              </PendingPanel>
            ) : null}
          </div>
        ) : (
          <CardActions>
            <InlineReason
              triggerLabel="Dismiss"
              confirmLabel="Dismiss prospect"
              placeholder="Reason (optional)"
              pending={dismiss.isPending}
              onConfirm={onDismiss}
            />
            <Button type="button" onClick={onConfirm} disabled={busy}>
              <UserPlus className="h-4 w-4" />
              {confirm.isPending ? "Creating client" : "Confirm and create client"}
            </Button>
          </CardActions>
        )}
      </div>
    </TaskShell>
  );
}

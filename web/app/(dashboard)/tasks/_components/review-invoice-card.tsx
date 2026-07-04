"use client";

import * as React from "react";
import { toast } from "sonner";
import { Send, ChevronDown, ShieldCheck, ScrollText } from "lucide-react";

import { post, useApi, useAction, type Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/money";
import { ProvenanceChip } from "@/components/provenance-chip";
import { ErrorState } from "@/components/error-state";
import {
  TaskShell,
  TaskHeading,
  SuccessPanel,
  PendingPanel,
  InlineReason,
  CardActions,
} from "./bits";
import { ctxOf, readStr, asText } from "./context";
import { useDeferredResolve, type CardProps } from "./use-resolve";

type ProposalDetail = Schemas["ProposalDetailDto"];
type ProposalActionResult = Schemas["ProposalActionResultDto"];

/** Review a proposal line by line, then approve it into Xero or reject it. */
export function ReviewInvoiceCard({ task, refetchAll }: CardProps) {
  const ctx = ctxOf(task);
  const proposalId = readStr(ctx, "proposalId") ?? task.refId;
  const clientName = readStr(ctx, "clientName");
  const meetingTitle = readStr(ctx, "meetingTitle");

  const {
    data: proposal,
    error,
    isLoading,
    refetch,
    isValidating,
  } = useApi<ProposalDetail>(`/proposals/${proposalId}`);

  const [showEvidence, setShowEvidence] = React.useState(false);
  const [done, setDone] = React.useState<ProposalActionResult | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const resolve = useDeferredResolve(refetchAll);

  const approve = useAction(() =>
    post<ProposalActionResult>(`/proposals/${proposalId}/approve`),
  );
  const reject = useAction((reason: string) =>
    post<ProposalActionResult>(`/proposals/${proposalId}/reject`, { reason }),
  );

  const busy = approve.isPending || reject.isPending || done !== null;

  async function onApprove() {
    try {
      const res = await approve.run();
      const xeroError = asText(res.xeroError);
      if (xeroError) {
        // Not a failure — the invoice is ready to send the moment Xero connects.
        setPending(xeroError);
        toast.warning("Invoice ready. Xero connection pending", {
          description: "It will send the moment Xero connects.",
        });
        void refetch();
        return;
      }
      setDone(res);
      toast.success("Approved and sent to Xero", {
        description: res.message || undefined,
      });
      resolve(1800);
    } catch (err) {
      toast.error("Couldn't send this invoice", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function onReject(reason: string) {
    try {
      await reject.run(reason);
      toast.success("Proposal rejected", {
        description: "Robyn won't invoice this one.",
      });
      resolve(400);
    } catch (err) {
      toast.error("Couldn't reject this proposal", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const heading = `Invoice for ${clientName ?? proposal?.clientName ?? "client"}`;

  return (
    <TaskShell task={task}>
      <div className="space-y-4">
        <TaskHeading
          title={heading}
          subtitle={meetingTitle ?? "Robyn drafted this for your approval."}
        />

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : error ? (
          <ErrorState
            compact
            title="Couldn't load this proposal"
            error={error}
            onRetry={refetch}
            retrying={isValidating}
          />
        ) : proposal ? (
          <>
            {/* Line items with provenance */}
            <ul className="divide-y divide-border rounded-md border border-border">
              {proposal.lines.map((line, i) => (
                <li key={i} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {line.description}
                      </p>
                      <p className="tabular text-xs text-muted-foreground">
                        {line.quantity} ×{" "}
                        <Money amount={line.unit_amount} />
                      </p>
                    </div>
                    <Money
                      amount={line.line_amount}
                      className="shrink-0 text-sm font-medium text-foreground"
                    />
                  </div>
                  {line.provenance.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {line.provenance.map((p, j) => (
                        <ProvenanceChip
                          key={j}
                          kind={p.kind}
                          label={p.label}
                          detail={asText(p.detail)}
                        />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* Totals */}
            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <dt>Subtotal</dt>
                <dd>
                  <Money amount={proposal.subtotal} currency={proposal.currency} />
                </dd>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <dt>VAT</dt>
                <dd>
                  <Money amount={proposal.taxTotal} currency={proposal.currency} />
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-1.5 text-foreground">
                <dt className="font-medium">Total</dt>
                <dd className="font-semibold">
                  <Money amount={proposal.total} currency={proposal.currency} />
                </dd>
              </div>
            </dl>

            {/* Why this needs a human */}
            {proposal.policyResult?.reasons?.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Why Robyn is asking you
                </p>
                <ul className="space-y-1">
                  {proposal.policyResult.reasons.map((reason, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm text-foreground/80"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Evidence drill-down */}
            {(asText(proposal.evidence?.contract?.clauseText) ||
              proposal.evidence?.transcript?.excerpt) && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowEvidence((v) => !v)}
                  aria-expanded={showEvidence}
                  className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-fast",
                      showEvidence && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                  {showEvidence ? "Hide evidence" : "Show evidence"}
                </button>
                {showEvidence && (
                  <div className="mt-2 space-y-2.5 rounded-md border border-border bg-muted/30 p-3 text-sm">
                    {asText(proposal.evidence?.contract?.clauseText) && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <ScrollText className="h-3 w-3" aria-hidden="true" />
                          {asText(proposal.evidence?.contract?.clauseLabel) ??
                            "Contract clause"}
                        </p>
                        <p className="text-foreground/80">
                          {asText(proposal.evidence?.contract?.clauseText)}
                        </p>
                      </div>
                    )}
                    {proposal.evidence?.transcript?.excerpt && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          Transcript excerpt
                        </p>
                        <p className="whitespace-pre-line text-foreground/80">
                          {proposal.evidence.transcript.excerpt}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}

        {done ? (
          <SuccessPanel title="Invoice sent to Xero">
            <p>{done.message || "The invoice is now in Xero."}</p>
          </SuccessPanel>
        ) : pending ? (
          <PendingPanel title="Xero connection pending">
            <p>{pending}</p>
            <p className="mt-1">
              The invoice is ready and will send the moment Xero connects.
            </p>
          </PendingPanel>
        ) : null}

        {!done && (
          <CardActions>
            <InlineReason
              triggerLabel="Reject"
              confirmLabel="Reject invoice"
              placeholder="Reason for rejecting"
              required
              pending={reject.isPending}
              onConfirm={onReject}
            />
            <Button
              type="button"
              onClick={onApprove}
              disabled={busy || isLoading || !!error}
            >
              <Send className="h-4 w-4" />
              {approve.isPending
                ? "Sending to Xero"
                : pending
                  ? "Retry send to Xero"
                  : "Approve & send to Xero"}
            </Button>
          </CardActions>
        )}
      </div>
    </TaskShell>
  );
}

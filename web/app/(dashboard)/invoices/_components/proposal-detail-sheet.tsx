"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Receipt,
  ScrollText,
  Send,
  ShieldCheck,
} from "lucide-react";

import { post, useApi, useAction, type Schemas } from "@/lib/api";
import { LONDON_TZ } from "@/lib/calendar-utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/money";
import { StateBadge, ProposalStateBadge } from "@/components/state-badge";
import { ProvenanceChip } from "@/components/provenance-chip";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

import { InlineReason, PendingPanel, SuccessPanel } from "./bits";
import { asText, sourceMeta } from "./util";

type ProposalDetail = Schemas["ProposalDetailDto"];
type ProposalActionResult = Schemas["ProposalActionResultDto"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

/**
 * The full proposal record in a side panel: every line with its provenance
 * chips (hover reveals the verbatim source), the policy reasons, the totals,
 * and the source evidence chain. An in-review proposal can be approved into
 * Xero, saved as a draft, or rejected right here.
 */
export function ProposalDetailSheet({
  proposalId,
  onOpenChange,
  onChanged,
}: {
  proposalId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { data, error, isLoading, refetch, isValidating } =
    useApi<ProposalDetail>(proposalId ? `/proposals/${proposalId}` : null);

  // Only trust data for the currently-selected proposal so a fast switch never
  // flashes the previous record.
  const d = data && data.id === proposalId ? data : undefined;

  const [showEvidence, setShowEvidence] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  // Reset transient UI whenever the sheet points at a different proposal.
  React.useEffect(() => {
    setShowEvidence(false);
    setPending(null);
  }, [proposalId]);

  const approve = useAction(() =>
    post<ProposalActionResult>(`/proposals/${proposalId}/approve`),
  );
  const saveDraft = useAction(() =>
    post<ProposalActionResult>(`/proposals/${proposalId}/save-draft`),
  );
  const reject = useAction((reason: string) =>
    post<ProposalActionResult>(`/proposals/${proposalId}/reject`, { reason }),
  );

  const busy = approve.isPending || saveDraft.isPending || reject.isPending;
  const isReview = d?.state === "IN_REVIEW";

  function afterAction() {
    void refetch();
    onChanged();
  }

  async function onApprove() {
    try {
      const res = await approve.run();
      const xeroError = asText(res.xeroError);
      if (xeroError) {
        // Not a failure — the invoice is ready the moment Xero connects.
        setPending(xeroError);
        toast.warning("Invoice ready. Xero connection pending", {
          description: "It will send the moment Xero connects.",
        });
        afterAction();
        return;
      }
      setPending(null);
      toast.success("Approved and sent to Xero", {
        description: res.message || undefined,
      });
      afterAction();
    } catch (err) {
      toast.error("Couldn't send this invoice", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function onSaveDraft() {
    try {
      const res = await saveDraft.run();
      const xeroError = asText(res.xeroError);
      if (xeroError) {
        setPending(xeroError);
        toast.warning("Draft ready. Xero connection pending", {
          description: "It will save the moment Xero connects.",
        });
      } else {
        setPending(null);
        toast.success("Saved as a draft in Xero", {
          description: res.message || undefined,
        });
      }
      afterAction();
    } catch (err) {
      toast.error("Couldn't save this draft", {
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
      afterAction();
    } catch (err) {
      toast.error("Couldn't reject this proposal", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const deepLink = asText(d?.xeroDeepLink);
  const invoiceNumber = asText(d?.xeroInvoiceNumber);
  const evidence = d?.evidence;
  const meeting = evidence?.meeting;
  const transcript = evidence?.transcript;
  const detection = evidence?.detection;
  const clauseText = asText(evidence?.contract?.clauseText);
  const source = d ? sourceMeta(d.source) : null;

  return (
    <Sheet open={proposalId != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {isLoading || (proposalId != null && !d && !error) ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Invoice proposal</SheetTitle>
            <LoadingState rows={3} />
          </div>
        ) : error ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Invoice proposal</SheetTitle>
            <ErrorState
              error={error}
              onRetry={refetch}
              retrying={isValidating}
            />
          </div>
        ) : d ? (
          <>
            <SheetHeader className="space-y-3 border-b border-border p-6 pr-12">
              <div className="space-y-1">
                <SheetTitle>{d.clientName}</SheetTitle>
                {source && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <source.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {source.label}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ProposalStateBadge state={d.state} size="sm" />
                {d.autoSent && (
                  <StateBadge tone="success" label="Auto-sent" size="sm" />
                )}
                {invoiceNumber && (
                  <StateBadge tone="billed" label={invoiceNumber} size="sm" />
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {/* Line items with provenance */}
              <section className="space-y-3">
                <SectionTitle>Invoice lines</SectionTitle>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {d.lines.map((line, i) => (
                    <li key={i} className="space-y-2 bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {line.description}
                          </p>
                          <p className="tabular text-xs text-muted-foreground">
                            {line.quantity} × <Money amount={line.unit_amount} />
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
                <dl className="space-y-1 px-1 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <dt>Subtotal</dt>
                    <dd>
                      <Money amount={d.subtotal} currency={d.currency} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <dt>VAT</dt>
                    <dd>
                      <Money amount={d.taxTotal} currency={d.currency} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5 text-foreground">
                    <dt className="font-medium">Total</dt>
                    <dd className="font-semibold">
                      <Money amount={d.total} currency={d.currency} />
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Policy reasons */}
              {d.policyResult?.reasons?.length > 0 && (
                <section className="space-y-2">
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {d.policyResult.auto
                        ? "Why Robyn could send this on its own"
                        : "Why Robyn is asking you"}
                    </p>
                    <ul className="space-y-1">
                      {d.policyResult.reasons.map((reason, i) => (
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
                </section>
              )}

              {/* Source evidence */}
              {(meeting || transcript || detection || clauseText) && (
                <section className="space-y-3">
                  <SectionTitle>Source evidence</SectionTitle>
                  <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                    {meeting && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <CalendarClock
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Calendar block
                        </p>
                        <p className="text-sm text-foreground/90">
                          {meeting.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat("en-GB", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: LONDON_TZ,
                          }).format(new Date(meeting.start))}
                          {" · "}
                          {meeting.durationHours}h
                        </p>
                      </div>
                    )}

                    {clauseText && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                          {asText(evidence?.contract?.clauseLabel) ??
                            "Contract clause"}
                        </p>
                        <p className="text-sm text-foreground/80">{clauseText}</p>
                      </div>
                    )}

                    {detection && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                          Ledger detection
                        </p>
                        <p className="text-sm text-foreground/80">
                          {detection.summary}
                        </p>
                      </div>
                    )}

                    {transcript && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setShowEvidence((v) => !v)}
                          aria-expanded={showEvidence}
                          className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          {showEvidence
                            ? "Hide transcript excerpt"
                            : "Show transcript excerpt"}
                        </button>
                        {showEvidence && transcript.excerpt && (
                          <p className="whitespace-pre-line rounded-md border border-border bg-card p-3 text-sm text-foreground/80">
                            {transcript.excerpt}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Xero result / connection state */}
              {pending ? (
                <PendingPanel title="Xero connection pending">
                  <p>{pending}</p>
                  <p className="mt-1">
                    The invoice is ready and will send the moment Xero connects.
                  </p>
                </PendingPanel>
              ) : d.state === "SENT" ? (
                <SuccessPanel title="Sent to Xero">
                  <p>This invoice has been written to Xero.</p>
                  {deepLink && (
                    <a
                      href={deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 font-medium text-teal-800 underline-offset-4 hover:underline dark:text-teal-200"
                    >
                      Open in Xero
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </SuccessPanel>
              ) : null}
            </div>

            {/* Actions — only while a proposal is in review */}
            {isReview && (
              <div className="border-t border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <InlineReason
                    triggerLabel="Reject"
                    confirmLabel="Reject invoice"
                    placeholder="Reason for rejecting"
                    required
                    pending={reject.isPending}
                    onConfirm={onReject}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onSaveDraft}
                      disabled={busy}
                    >
                      {saveDraft.isPending ? "Saving draft" : "Save as draft"}
                    </Button>
                    <Button type="button" onClick={onApprove} disabled={busy}>
                      <Send className="h-4 w-4" />
                      {approve.isPending
                        ? "Sending to Xero"
                        : pending
                          ? "Retry send to Xero"
                          : "Approve & send to Xero"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

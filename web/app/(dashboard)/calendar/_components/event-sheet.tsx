"use client";

import * as React from "react";
import { toast } from "sonner";

import { useApi, post, useAction, type Schemas } from "@/lib/api";
import { meetingStateMeta, proposalStateMeta } from "@/lib/states";
import { LONDON_TZ, londonTime } from "@/lib/calendar-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/money";
import { StateBadge } from "@/components/state-badge";
import { ProvenanceChip } from "@/components/provenance-chip";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

type MeetingDetail = Schemas["MeetingDetailDto"];

// openapi-typescript renders nullable strings as `string | Record<string,never>`.
// Read them through this so the value is always a plain string.
function txt(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

/* -------------------------------------------------------------------------- */
/*  Event side panel — the full evidence chain for one meeting.                */
/* -------------------------------------------------------------------------- */

export function EventSheet({
  meetingId,
  onOpenChange,
  onChanged,
}: {
  meetingId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const detail = useApi<MeetingDetail>(meetingId ? `/meetings/${meetingId}` : null);
  const [transcript, setTranscript] = React.useState("");

  const m = detail.data && detail.data.id === meetingId ? detail.data : undefined;

  const attach = useAction(async (id: string, rawText: string) => {
    return post(`/meetings/${id}/transcript`, { rawText });
  });
  const skip = useAction(async (id: string) => {
    return post(`/meetings/${id}/skip`, { reason: "Not billable" });
  });

  React.useEffect(() => {
    setTranscript("");
  }, [meetingId]);

  const stateMeta = m ? meetingStateMeta(m.state) : null;

  return (
    <Sheet open={meetingId != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {detail.isLoading || (meetingId && !m && !detail.error) ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Meeting detail</SheetTitle>
            <LoadingState rows={3} />
          </div>
        ) : detail.error ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Meeting detail</SheetTitle>
            <ErrorState error={detail.error} onRetry={detail.refetch} />
          </div>
        ) : m ? (
          <>
            <SheetHeader className="space-y-3 border-b border-border p-6 pr-12">
              <div className="space-y-1">
                <SheetTitle>{m.title}</SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {new Date(m.start).toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: LONDON_TZ,
                  })}
                  {"  ·  "}
                  {londonTime(m.start)}–{londonTime(m.end)} · {Number(m.durationHours)}h
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {stateMeta && <StateBadge tone={stateMeta.tone} label={stateMeta.label} size="sm" />}
                {m.clientName ? (
                  <StateBadge tone="info" label={txt(m.clientName)} size="sm" />
                ) : (
                  <StateBadge tone="unknown" label="No client yet" size="sm" />
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {/* Attendees */}
              <section className="space-y-2">
                <SectionTitle>Attendees</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {(m.attendees ?? []).map((a) => (
                    <span
                      key={a.email}
                      className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {a.name ? `${a.name} · ` : ""}
                      {a.email}
                    </span>
                  ))}
                  {(m.attendees ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">No attendees recorded.</span>
                  )}
                </div>
              </section>

              {/* Transcript scope */}
              {m.transcript?.parsed && (
                <>
                  <Separator />
                  <section className="space-y-2">
                    <SectionTitle>Transcript scope</SectionTitle>
                    {m.transcript.parsed.scope_items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No extra billable scope found beyond the meeting time.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {m.transcript.parsed.scope_items.map((s, idx) => (
                          <li
                            key={idx}
                            className="rounded-lg border border-border bg-card p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{s.description}</span>
                              <StateBadge
                                tone={s.billable ? "proposal" : "neutral"}
                                label={s.billable ? `${s.est_hours}h billable` : "Not billed"}
                                size="sm"
                              />
                            </div>
                            <p className="mt-1 border-l-2 border-amber-300 pl-2 text-xs italic text-muted-foreground">
                              &ldquo;{s.evidence_quote}&rdquo;
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}

              {/* Proposal */}
              {m.proposal && (
                <>
                  <Separator />
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <SectionTitle>Invoice proposal</SectionTitle>
                      <StateBadge {...proposalStateMeta(m.proposal.state)} size="sm" />
                    </div>
                    <div className="space-y-2">
                      {m.proposal.lines.map((l, idx) => (
                        <div key={idx} className="rounded-lg border border-border bg-card p-3">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm text-foreground">{l.description}</span>
                            <Money
                              amount={l.line_amount}
                              currency={m.proposal!.currency}
                              className="shrink-0 text-sm font-medium"
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {l.provenance.map((p, pi) => (
                              <ProvenanceChip
                                key={pi}
                                kind={p.kind}
                                label={p.label}
                                detail={p.detail}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
                      <span className="text-muted-foreground">
                        Total (incl. VAT)
                      </span>
                      <Money
                        amount={m.proposal.total}
                        currency={m.proposal.currency}
                        className="font-semibold text-foreground"
                      />
                    </div>
                    {m.proposal.policyResult?.reasons?.length ? (
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Why Robyn {m.proposal.autoSent ? "auto-sent" : "held this for review"}
                        </p>
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                          {m.proposal.policyResult.reasons.map((r, ri) => (
                            <li key={ri}>· {r}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {m.proposal.xeroDeepLink && (
                      <a
                        href={txt(m.proposal.xeroDeepLink)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block cursor-pointer text-sm font-medium text-primary hover:underline"
                      >
                        Open in Xero →
                      </a>
                    )}
                  </section>
                </>
              )}

              {/* Actions */}
              {m.state === "AWAITING_TRANSCRIPT" && (
                <>
                  <Separator />
                  <section className="space-y-2">
                    <SectionTitle>Add the transcript</SectionTitle>
                    <Textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      placeholder="Paste the meeting transcript here…"
                      className="min-h-[120px]"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        className="cursor-pointer"
                        disabled={attach.isPending || transcript.trim().length < 10}
                        onClick={async () => {
                          try {
                            await attach.run(m.id, transcript.trim());
                            toast.success("Transcript attached. Robyn built the proposal.");
                            setTranscript("");
                            detail.refetch();
                            onChanged();
                          } catch {
                            toast.error("Could not attach the transcript. Try again.");
                          }
                        }}
                      >
                        {attach.isPending ? "Working…" : "Attach transcript"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="cursor-pointer"
                        disabled={skip.isPending}
                        onClick={async () => {
                          try {
                            await skip.run(m.id);
                            toast.success("Meeting skipped.");
                            detail.refetch();
                            onChanged();
                          } catch {
                            toast.error("Could not skip the meeting.");
                          }
                        }}
                      >
                        Skip this meeting
                      </Button>
                    </div>
                  </section>
                </>
              )}

              {m.state === "UNKNOWN_ATTENDEE" && (
                <>
                  <Separator />
                  <EmptyState
                    title="In the pipeline"
                    description="This meeting has an unknown attendee. Robyn is watching their email for a yes — confirm it from the Clients pipeline to onboard them."
                  />
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

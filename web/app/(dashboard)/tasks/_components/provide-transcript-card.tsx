"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileText, Users } from "lucide-react";

import { post, useAction, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import {
  TaskShell,
  TaskHeading,
  FieldLabel,
  Textarea,
  Chips,
  SuccessPanel,
  InlineReason,
  CardActions,
} from "./bits";
import {
  ctxOf,
  readStr,
  readNum,
  readAttendees,
  attendeeLabel,
  formatWhen,
  formatHours,
} from "./context";
import { useDeferredResolve, type CardProps } from "./use-resolve";

type MeetingResult = Schemas["MeetingActionResultDto"];

/** Beat 2: paste a transcript and watch Robyn turn it into an invoice. */
export function ProvideTranscriptCard({ task, refetchAll }: CardProps) {
  const ctx = ctxOf(task);
  const meetingId = readStr(ctx, "meetingId") ?? task.refId;
  const meetingTitle =
    readStr(ctx, "meetingTitle") ?? "Meeting missing its transcript";
  const clientName = readStr(ctx, "clientName");
  const when = formatWhen(readStr(ctx, "start"), readStr(ctx, "end"));
  const hours = formatHours(readNum(ctx, "durationHours"));
  const attendees = readAttendees(ctx).filter(
    (a) => a.email !== "me@robyn.dev",
  );

  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<MeetingResult | null>(null);
  const resolve = useDeferredResolve(refetchAll);

  const attach = useAction((rawText: string) =>
    post<MeetingResult>(`/meetings/${meetingId}/transcript`, {
      rawText,
      source: "PASTED",
    }),
  );
  const skip = useAction((reason: string) =>
    post<Schemas["MeetingDetailDto"]>(`/meetings/${meetingId}/skip`, {
      reason: reason || undefined,
    }),
  );

  const busy = attach.isPending || skip.isPending || result !== null;

  async function onAttach() {
    const rawText = text.trim();
    if (!rawText) return;
    try {
      const res = await attach.run(rawText);
      setResult(res);
      const p = res.proposal;
      if (p) {
        toast.success("Robyn built an invoice from the transcript", {
          description: `${clientName ?? "Client"} · ${p.lines.length} line${
            p.lines.length === 1 ? "" : "s"
          }, now in review.`,
        });
      } else {
        toast.success("Transcript attached", {
          description: "Robyn is matching it to a client.",
        });
      }
      resolve(2000);
    } catch (err) {
      toast.error("Couldn't attach the transcript", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function onSkip(reason: string) {
    try {
      await skip.run(reason);
      toast.success("Meeting skipped", {
        description: "Robyn won't invoice this one.",
      });
      resolve(400);
    } catch (err) {
      toast.error("Couldn't skip the meeting", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <TaskShell task={task}>
      <div className="space-y-4">
        <TaskHeading
          title={meetingTitle}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {clientName ? (
                <span className="font-medium text-foreground/80">
                  {clientName}
                </span>
              ) : null}
              {when ? <span>· {when}</span> : null}
              {hours ? <span>· {hours}</span> : null}
            </span>
          }
        />

        {attendees.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <Chips items={attendees.map((a) => attendeeLabel(a))} />
          </div>
        )}

        {result ? (
          <SuccessPanel title="Transcript in. Robyn did the maths.">
            {result.proposal ? (
              <p>
                Drafted a{" "}
                <Money
                  amount={result.proposal.total}
                  className="font-medium text-teal-800 dark:text-teal-200"
                />{" "}
                invoice across {result.proposal.lines.length} line
                {result.proposal.lines.length === 1 ? "" : "s"}. It has moved to
                your review queue.
              </p>
            ) : (
              <p>Robyn is matching this meeting to a client.</p>
            )}
          </SuccessPanel>
        ) : (
          <div>
            <FieldLabel htmlFor={`transcript-${task.id}`}>
              Paste the transcript
            </FieldLabel>
            <Textarea
              id={`transcript-${task.id}`}
              value={text}
              disabled={busy}
              placeholder="Paste the meeting transcript here. Robyn reads it for billable scope and cites each line back to its source."
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}

        {!result && (
          <CardActions>
            <InlineReason
              triggerLabel="Skip this meeting"
              confirmLabel="Skip meeting"
              placeholder="Reason (optional)"
              pending={skip.isPending}
              onConfirm={onSkip}
            />
            <Button
              type="button"
              onClick={onAttach}
              disabled={busy || text.trim().length === 0}
            >
              <FileText className="h-4 w-4" />
              {attach.isPending ? "Reading transcript" : "Attach transcript"}
            </Button>
          </CardActions>
        )}
      </div>
    </TaskShell>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { UserCheck, Sparkles, Users } from "lucide-react";

import { post, useApi, useAction, type Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TaskShell,
  TaskHeading,
  Chips,
  SuccessPanel,
  CardActions,
} from "./bits";
import {
  ctxOf,
  readStr,
  readAttendees,
  attendeeLabel,
  formatWhen,
} from "./context";
import { useDeferredResolve, type CardProps } from "./use-resolve";

type MeetingDetail = Schemas["MeetingDetailDto"];
type MeetingResult = Schemas["MeetingActionResultDto"];
type ClientItem = Schemas["ClientListItemDto"];

/** Robyn couldn't be sure which client this meeting belongs to. Pick one. */
export function ConfirmClientCard({ task, refetchAll }: CardProps) {
  const ctx = ctxOf(task);
  const meetingId = readStr(ctx, "meetingId") ?? task.refId;
  const meetingTitle = readStr(ctx, "meetingTitle") ?? "this meeting";
  const when = formatWhen(readStr(ctx, "start"), readStr(ctx, "end"));
  const ctxAttendees = readAttendees(ctx).filter(
    (a) => a.email !== "me@robyn.dev",
  );

  const { data: meeting } = useApi<MeetingDetail>(`/meetings/${meetingId}`);
  const { data: clients, isLoading: clientsLoading } =
    useApi<ClientItem[]>("/clients");

  const suggestions = meeting?.matchProposals ?? [];
  const suggestionIds = new Set(suggestions.map((s) => s.client_id));
  const others = (clients ?? []).filter((c) => !suggestionIds.has(c.id));

  const [selected, setSelected] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const resolve = useDeferredResolve(refetchAll);

  const confirm = useAction((clientId: string) =>
    post<MeetingResult>(`/meetings/${meetingId}/confirm-client`, { clientId }),
  );

  const attendees =
    ctxAttendees.length > 0
      ? ctxAttendees
      : (meeting?.attendees ?? [])
          .filter((a) => a.email !== "me@robyn.dev")
          .map((a) => ({ name: a.name, email: a.email }));

  async function onConfirm() {
    if (!selected) return;
    try {
      const res = await confirm.run(selected);
      setDone(true);
      toast.success("Client confirmed", {
        description: res.proposal
          ? "Robyn built an invoice and moved it to your review queue."
          : "Robyn linked the meeting to this client.",
      });
      resolve(1600);
    } catch (err) {
      toast.error("Couldn't confirm the client", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <TaskShell task={task}>
      <div className="space-y-4">
        <TaskHeading
          title={`Which client is "${meetingTitle}"?`}
          subtitle={when ?? "Pick the client Robyn should bill this to."}
        />

        {attendees.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <Chips items={attendees.map((a) => attendeeLabel(a))} />
          </div>
        )}

        {done ? (
          <SuccessPanel title="Meeting matched to a client">
            <p>Robyn is taking it from here.</p>
          </SuccessPanel>
        ) : (
          <>
            {suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Robyn's best guesses
                </p>
                <div className="space-y-2">
                  {suggestions.map((s) => (
                    <ClientOption
                      key={s.client_id}
                      selected={selected === s.client_id}
                      onSelect={() => setSelected(s.client_id)}
                      name={s.client_name}
                      confidence={s.confidence}
                      reason={s.reason}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {suggestions.length > 0 && (
                <p className="text-xs font-medium text-muted-foreground">
                  All clients
                </p>
              )}
              {clientsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="h-12 w-full rounded-md" />
                </div>
              ) : (
                <div className="space-y-2">
                  {others.map((c) => (
                    <ClientOption
                      key={c.id}
                      selected={selected === c.id}
                      onSelect={() => setSelected(c.id)}
                      name={c.name}
                      reason={c.emails[0]}
                    />
                  ))}
                </div>
              )}
            </div>

            <CardActions>
              <Button
                type="button"
                onClick={onConfirm}
                disabled={!selected || confirm.isPending}
              >
                <UserCheck className="h-4 w-4" />
                {confirm.isPending ? "Confirming" : "Confirm client"}
              </Button>
            </CardActions>
          </>
        )}
      </div>
    </TaskShell>
  );
}

function ClientOption({
  selected,
  onSelect,
  name,
  confidence,
  reason,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  confidence?: number;
  reason?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/30 hover:bg-accent/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary" : "border-muted-foreground/40",
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {typeof confidence === "number" && (
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {Math.round(confidence * 100)}% match
            </span>
          )}
        </span>
        {reason ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {reason}
          </span>
        ) : null}
      </span>
    </button>
  );
}

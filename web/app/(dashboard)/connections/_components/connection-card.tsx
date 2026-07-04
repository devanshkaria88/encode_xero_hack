"use client";

import * as React from "react";
import {
  Building2,
  Calendar,
  Mail,
  Plug,
  RefreshCw,
  ChevronDown,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { post, useAction, type Schemas } from "@/lib/api";
import { connectionStatusMeta } from "@/lib/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/state-badge";
import { RelativeTime } from "@/components/relative-time";

import { IcsImport } from "./ics-import";

type Row = Schemas["ConnectionRowDto"];

const KIND: Record<
  Row["kind"],
  { name: string; icon: LucideIcon; checkLabel: string }
> = {
  XERO: { name: "Xero", icon: Building2, checkLabel: "Check now" },
  CALENDAR: { name: "Google Calendar", icon: Calendar, checkLabel: "Check now" },
  EMAIL: { name: "Email inbox", icon: Mail, checkLabel: "Check now" },
};

/** Count with a correctly pluralised noun ("1 message", "3 messages"). */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A calm, human sentence for each connection state — never the raw error. */
function leadLine(row: Row): string {
  const org = row.label && row.label.toUpperCase() !== "XERO" ? row.label : null;
  switch (row.kind) {
    case "XERO":
      if (row.status === "LIVE")
        return org
          ? `Connected to ${org}. Robyn can read your ledger and write invoices.`
          : "Connected to Xero. Robyn can read your ledger and write invoices.";
      if (row.status === "FALLBACK")
        return "Running on cached Xero data. Reconnect to write invoices live.";
      return "Not connected yet. Robyn has your invoices ready and will send them the moment Xero credentials are added.";
    case "CALENDAR":
      if (row.status === "LIVE")
        return "Connected to Google Calendar. Robyn syncs your events automatically.";
      if (row.status === "FALLBACK")
        return "No calendar connected yet, reading the seeded .ics file. Connect Google Calendar to go live, or paste an .ics below.";
      return "Not connected. Connect Google Calendar, or import an .ics file below to get started.";
    case "EMAIL":
      if (row.status === "LIVE")
        return "Connected over IMAP. Robyn checks for replies every 30 minutes, only from queued prospects.";
      if (row.status === "FALLBACK")
        return "No mailbox connected yet, reading the demo inbox. Robyn only reads messages from queued prospects. Add IMAP credentials to go live.";
      return "Not connected. Add IMAP credentials so Robyn can watch for agreement emails from queued prospects.";
    default:
      return row.detail ? String(row.detail) : "";
  }
}

/** Short, friendly reason for a Xero recheck that came back not-live. */
function xeroReason(row: Row): string {
  const detail = row.detail ? String(row.detail) : "";
  if (/invalid_scope|Custom Connection/i.test(detail))
    return "The credentials aren't a Custom Connection with accounting scopes yet. Add them in api/.env and check again.";
  if (/invalid_client|unauthorized_client/i.test(detail))
    return "Xero rejected the credentials. Check the client id and secret in api/.env.";
  return "Robyn couldn't reach Xero. Check the credentials in api/.env and try again.";
}

/**
 * One integration health row. Renders truthfully from GET /connections and owns
 * its own "Check now" action:
 *   XERO     → POST /connections/xero/recheck
 *   CALENDAR → POST /meetings/sync
 *   EMAIL    → POST /email/poll
 * After any action it asks the parent to refetch so the row reflects reality.
 */
export function ConnectionCard({
  row,
  onChanged,
}: {
  row: Row;
  onChanged: () => void;
}) {
  const meta = KIND[row.kind] ?? {
    name: row.label || row.kind,
    icon: Plug,
    checkLabel: "Check now",
  };
  const Icon = meta.icon;
  const status = connectionStatusMeta(row.status);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const check = useAction(async () => {
    switch (row.kind) {
      case "XERO": {
        const res = await post<Row>("/connections/xero/recheck");
        onChanged();
        if (res.status === "LIVE") {
          toast.success("Xero is connected", {
            description:
              res.label && res.label.toUpperCase() !== "XERO"
                ? `Linked to ${res.label}. Robyn can write invoices.`
                : "Robyn can read your ledger and write invoices.",
          });
        } else {
          toast.warning("Xero is not connected yet", {
            description: xeroReason(res),
          });
        }
        return;
      }
      case "CALENDAR": {
        const res = await post<Schemas["SyncResultDto"]>("/meetings/sync");
        onChanged();
        toast.success("Calendar checked", {
          description: `${plural(res.imported, "new event")}, ${res.updated} updated.`,
        });
        return;
      }
      case "EMAIL": {
        const res = await post<Schemas["EmailPollResultDto"]>("/email/poll");
        onChanged();
        const desc = `Read ${plural(res.messagesRead, "message")}, found ${plural(
          res.agreementsDetected,
          "agreement",
        )}.`;
        if (res.agreementsDetected > 0) {
          toast.success("New agreement found", { description: desc });
        } else {
          toast.success("Inbox checked", { description: desc });
        }
        return;
      }
    }
  });

  const onCheck = async () => {
    try {
      await check.run();
    } catch (err) {
      toast.error("Couldn't check just now", {
        description:
          err instanceof Error && err.message
            ? err.message
            : "Please try again in a moment.",
      });
    }
  };

  const showXeroHint = row.kind === "XERO" && row.status !== "LIVE";

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{meta.name}</p>
              <StateBadge tone={status.tone} label={status.label} size="sm" />
            </div>
            <p className="text-sm text-muted-foreground">{leadLine(row)}</p>

            {/* Meta line: label chip + last sync / next check where present. */}
            {(row.label || row.lastSyncAt || row.nextPollAt) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[0.6875rem] text-muted-foreground">
                {row.label && (
                  <span className="inline-flex max-w-full items-center truncate rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                    {row.label}
                  </span>
                )}
                {row.lastSyncAt && (
                  <span>
                    Last checked <RelativeTime value={row.lastSyncAt} />
                  </span>
                )}
                {row.nextPollAt && (
                  <span>
                    Next check <RelativeTime value={row.nextPollAt} />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:pl-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCheck}
            disabled={check.isPending}
            aria-label={`Check ${meta.name} now`}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", check.isPending && "animate-spin")}
            />
            {check.isPending ? "Checking" : meta.checkLabel}
          </Button>
        </div>
      </div>

      {/* Actionable next step for a Xero link that isn't live. */}
      {showXeroHint && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            Add Custom Connection credentials to <code>api/.env</code>, then
            press Check now. Until then Robyn keeps every invoice ready to send
            and writes nothing to your books.
          </p>
        </div>
      )}

      {/* Calendar-only .ics fallback: paste or upload a calendar file. */}
      {row.kind === "CALENDAR" && (
        <div className="mt-4 border-t border-border pt-4">
          <IcsImport onImported={onChanged} />
        </div>
      )}

      {/* Verbatim backend detail, one click away — honest, never hidden. */}
      {row.detail && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-fast",
                detailOpen && "rotate-180",
              )}
            />
            {detailOpen ? "Hide connection detail" : "Show connection detail"}
          </button>
          {detailOpen && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
              {String(row.detail)}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}

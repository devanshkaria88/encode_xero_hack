"use client";

import * as React from "react";
import { Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  apiGet,
  del,
  post,
  useAction,
  type ApiError,
  type Schemas,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StateBadge } from "@/components/state-badge";
import { RelativeTime } from "@/components/relative-time";

type GoogleStatus = Schemas["GoogleStatusDto"];

// openapi-typescript renders nullable strings as `string | Record<string,never>`.
function txt(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface GoogleConnectProps {
  kind: "CALENDAR" | "EMAIL";
  status: GoogleStatus | undefined;
  statusLoading: boolean;
  statusError: ApiError | undefined;
  /** Refetch GET /google/status. */
  onStatusRefresh: () => void;
  /** Refetch GET /connections (the parent card list). */
  onChanged: () => void;
}

/**
 * The Google account block on the Calendar and Email connection cards.
 * Not connected: one button into the OAuth consent screen. Connected: the
 * account email, granted scopes, last sync, plus Sync now and Disconnect.
 */
export function GoogleConnect({
  kind,
  status,
  statusLoading,
  statusError,
  onStatusRefresh,
  onChanged,
}: GoogleConnectProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const connect = useAction(async () => {
    const res = await apiGet("/google/auth-url");
    window.location.href = res.url;
    // Keep the button in its in-flight state while the browser navigates.
    await new Promise(() => {});
  });

  const sync = useAction(() =>
    post<Schemas["GoogleSyncResultDto"]>("/google/sync"),
  );
  const disconnect = useAction(() =>
    del<Schemas["GoogleDisconnectResultDto"]>("/google/connection"),
  );

  const onConnect = async () => {
    try {
      await connect.run();
    } catch (err) {
      toast.error("Couldn't start the Google sign-in", {
        description:
          err instanceof Error && err.message
            ? err.message
            : "Please try again in a moment.",
      });
    }
  };

  const onSync = async () => {
    try {
      const res = await sync.run();
      onChanged();
      onStatusRefresh();
      const parts: string[] = [];
      if (res.calendar.synced) {
        parts.push(
          `Calendar: ${plural(res.calendar.imported, "new event")}, ${res.calendar.updated} updated.`,
        );
      }
      if (res.gmail.synced) {
        parts.push(
          `Gmail: ${plural(res.gmail.messagesRead, "message")} read, ${plural(
            res.gmail.agreementsDetected,
            "agreement",
          )} found.`,
        );
      }
      if (res.syncStatus === "ERROR") {
        toast.warning("Sync finished with a problem", {
          description: txt(res.syncError) || parts.join(" ") || "Check the connection and try again.",
        });
      } else {
        toast.success("Google synced", {
          description:
            parts.join(" ") || "Nothing to sync for the granted permissions.",
        });
      }
    } catch (err) {
      toast.error("Couldn't sync Google just now", {
        description:
          err instanceof Error && err.message
            ? err.message
            : "Please try again in a moment.",
      });
    }
  };

  const onDisconnect = async () => {
    try {
      await disconnect.run();
      setConfirmOpen(false);
      onChanged();
      onStatusRefresh();
      toast.success("Google disconnected", {
        description:
          "Robyn stopped syncing this Google account. The .ics import still works.",
      });
    } catch (err) {
      toast.error("Couldn't disconnect Google", {
        description:
          err instanceof Error && err.message
            ? err.message
            : "Please try again in a moment.",
      });
    }
  };

  if (statusLoading && !status) {
    return (
      <div className="flex items-center gap-2" aria-busy="true">
        <Skeleton className="h-8 w-36" />
        <span className="sr-only" role="status">
          Checking the Google connection
        </span>
      </div>
    );
  }

  if (statusError && !status) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Couldn't check the Google connection.</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onStatusRefresh}
          className="cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (!status) return null;

  const scopeGranted =
    kind === "CALENDAR" ? status.calendar.granted : status.gmail.granted;

  // Not connected at all, or connected without this card's permission:
  // one clear button into the consent screen.
  if (!status.connected || !scopeGranted) {
    const caption = !status.connected
      ? kind === "CALENDAR"
        ? "Connect Google to sync calendar events automatically."
        : "Connect Google so Robyn can watch Gmail for replies from queued prospects."
      : kind === "CALENDAR"
        ? "Google is connected, but the calendar permission wasn't granted. Reconnect and tick Calendar on the consent screen."
        : "Google is connected, but the Gmail permission wasn't granted. Reconnect and tick Gmail on the consent screen.";

    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{caption}</p>
        <Button
          size="sm"
          onClick={onConnect}
          disabled={connect.isPending}
          className="cursor-pointer"
        >
          {connect.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
          {connect.isPending
            ? "Opening Google"
            : status.connected
              ? "Reconnect Google"
              : "Connect Google"}
        </Button>
      </div>
    );
  }

  const syncing =
    status.syncStatus === "SYNCING" || status.syncStatus === "PENDING";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex max-w-full items-center truncate rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
          {txt(status.accountEmail) || "Google account"}
        </span>
        {status.calendar.granted && (
          <StateBadge tone="success" label="Calendar" size="sm" />
        )}
        {status.gmail.granted && (
          <StateBadge tone="success" label="Gmail" size="sm" />
        )}
        {status.syncStatus === "ERROR" && (
          <StateBadge tone="attention" label="Last sync failed" size="sm" />
        )}
        {status.lastSyncAt ? (
          <span className="text-[0.6875rem] text-muted-foreground">
            Last sync <RelativeTime value={txt(status.lastSyncAt)} />
          </span>
        ) : syncing ? (
          <span className="text-[0.6875rem] text-muted-foreground">
            First sync running
          </span>
        ) : null}
      </div>

      {status.syncStatus === "ERROR" && txt(status.syncError) && (
        <p className="text-xs text-muted-foreground">{txt(status.syncError)}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={sync.isPending || syncing}
          className="cursor-pointer"
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              (sync.isPending || syncing) && "animate-spin",
            )}
          />
          {sync.isPending ? "Syncing" : syncing ? "Sync running" : "Sync now"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={disconnect.isPending}
          className="cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <Unplug className="h-3.5 w-3.5" />
          Disconnect
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect Google?</DialogTitle>
            <DialogDescription>
              Robyn stops syncing Google Calendar and Gmail for{" "}
              {txt(status.accountEmail) || "this account"}. Events already
              imported stay where they are, and the .ics import keeps working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={disconnect.isPending}
              className="cursor-pointer"
            >
              Keep it connected
            </Button>
            <Button
              variant="destructive"
              onClick={onDisconnect}
              disabled={disconnect.isPending}
              className="cursor-pointer"
            >
              {disconnect.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="h-3.5 w-3.5" />
              )}
              {disconnect.isPending ? "Disconnecting" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

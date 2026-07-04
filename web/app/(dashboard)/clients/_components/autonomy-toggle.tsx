"use client";

import * as React from "react";
import { toast } from "sonner";

import { patch, useAction, type Schemas } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Client = Schemas["ClientListItemDto"];

/**
 * Per-client auto-send policy. Optimistic: the switch flips immediately, the
 * PATCH follows, and on failure it snaps back with a toast. ON means Robyn may
 * send invoices for this client on her own; OFF means everything reviews first.
 */
export function AutonomyToggle({
  client,
  onChanged,
}: {
  client: Client;
  onChanged?: () => void;
}) {
  const [enabled, setEnabled] = React.useState(client.autonomyEnabled);

  // Reconcile with the server value when the parent refetches.
  React.useEffect(() => {
    setEnabled(client.autonomyEnabled);
  }, [client.autonomyEnabled]);

  const { run, isPending } = useAction((next: boolean) =>
    patch<Client>(`/clients/${client.id}/autonomy`, { enabled: next }),
  );

  async function toggle(next: boolean) {
    setEnabled(next); // optimistic
    try {
      await run(next);
      toast.success(
        next
          ? `Robyn can auto-send for ${client.name}`
          : `Everything for ${client.name} reviews first`,
      );
      onChanged?.();
    } catch {
      setEnabled(!next); // revert
      toast.error("Couldn't update autonomy. Please try again.");
    }
  }

  const id = `autonomy-${client.id}`;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block cursor-pointer text-sm font-medium text-foreground"
        >
          {enabled ? "Robyn can auto-send" : "Everything reviews"}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {enabled
            ? "Invoices go out on their own, within contract terms."
            : "Robyn proposes; you approve before anything sends."}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={isPending}
        onCheckedChange={toggle}
        aria-label={`Auto-send for ${client.name}`}
        className={cn(isPending && "opacity-60")}
      />
    </div>
  );
}

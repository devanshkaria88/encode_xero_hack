"use client";

import * as React from "react";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";

import { post, useAction, type Schemas } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import { StateBadge } from "@/components/state-badge";

import { InlineReason } from "./bits";
import { DETECTION_META, detectionStateMeta } from "./util";

type Detection = Schemas["DetectionDto"];
type ProposeResult = Schemas["DetectionProposeResultDto"];
type DismissResult = Schemas["DetectionActionResultDto"];

/**
 * One recovered-money detection: the type of leak, the client, the value, and
 * the evidence. If it's still open, Robyn can turn it into an invoice proposal
 * or the operator can dismiss it with a reason.
 */
export function DetectionCard({
  detection,
  onChanged,
}: {
  detection: Detection;
  onChanged: () => void;
}) {
  const meta = DETECTION_META[detection.type] ?? {
    label: detection.type,
    blurb: "",
    tone: "neutral" as const,
    icon: FilePlus2,
  };
  const Icon = meta.icon;
  const stateBadge = detectionStateMeta(detection.state);
  const isOpen = detection.state === "OPEN";

  const propose = useAction(() =>
    post<ProposeResult>(`/detections/${detection.id}/propose`),
  );
  const dismiss = useAction((reason: string) =>
    post<DismissResult>(`/detections/${detection.id}/dismiss`, { reason }),
  );
  const busy = propose.isPending || dismiss.isPending;

  async function onPropose() {
    try {
      const res = await propose.run();
      toast.success("Invoice proposal created", {
        description:
          res.message || "Find it under In review, ready for your approval.",
      });
      onChanged();
    } catch (err) {
      toast.error("Couldn't create a proposal", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function onDismiss(reason: string) {
    try {
      const res = await dismiss.run(reason);
      toast.success("Detection dismissed", {
        description: res.message || "Robyn won't chase this one.",
      });
      onChanged();
    } catch (err) {
      toast.error("Couldn't dismiss this detection", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge tone={meta.tone} label={meta.label} size="sm" />
            {stateBadge && (
              <StateBadge
                tone={stateBadge.tone}
                label={stateBadge.label}
                size="sm"
              />
            )}
          </div>
          <p className="truncate text-sm font-medium text-foreground">
            {detection.clientName}
          </p>
        </div>
        <Money
          amount={detection.valueGbp}
          className="shrink-0 text-base font-semibold text-foreground"
        />
      </div>

      <p className="flex-1 text-sm text-muted-foreground">
        {detection.summary || meta.blurb}
      </p>

      {isOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <InlineReason
            triggerLabel="Dismiss"
            confirmLabel="Dismiss detection"
            placeholder="Reason (optional)"
            pending={dismiss.isPending}
            onConfirm={onDismiss}
          />
          <Button type="button" size="sm" onClick={onPropose} disabled={busy}>
            <FilePlus2 className="h-4 w-4" />
            {propose.isPending ? "Creating" : "Create invoice proposal"}
          </Button>
        </div>
      ) : detection.state === "PROPOSED" ? (
        <p className="text-xs text-muted-foreground">
          A proposal is waiting under In review.
        </p>
      ) : null}
    </Card>
  );
}

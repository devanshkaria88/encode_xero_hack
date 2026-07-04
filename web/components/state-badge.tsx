import * as React from "react";

import { cn } from "@/lib/utils";
import {
  type BadgeTone,
  TONE_CLASS,
  TONE_DOT,
  meetingStateMeta,
  proposalStateMeta,
} from "@/lib/states";

export interface StateBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
  label: string;
  /** Show a leading status dot. */
  dot?: boolean;
  size?: "sm" | "md";
}

/**
 * The one badge that renders every meeting / proposal / connection state in
 * Robyn's semantic colours. Colour is never the only signal — the label always
 * says the state in plain English.
 */
export function StateBadge({
  tone,
  label,
  dot = true,
  size = "md",
  className,
  ...props
}: StateBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-0.5 text-xs",
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}

/** Convenience: render a badge straight from a meeting state. */
export function MeetingStateBadge({
  state,
  ...props
}: { state: string } & Partial<StateBadgeProps>) {
  const meta = meetingStateMeta(state);
  return <StateBadge tone={meta.tone} label={meta.label} {...props} />;
}

/** Convenience: render a badge straight from a proposal state. */
export function ProposalStateBadge({
  state,
  ...props
}: { state: string } & Partial<StateBadgeProps>) {
  const meta = proposalStateMeta(state);
  return <StateBadge tone={meta.tone} label={meta.label} {...props} />;
}

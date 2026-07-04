import type { LucideIcon } from "lucide-react";
import { CalendarClock, FileText, Receipt, Repeat } from "lucide-react";

import type { Schemas } from "@/lib/api";
import type { BadgeTone } from "@/lib/states";

/**
 * Several nullable string fields (xeroDeepLink, clause text, reference, ...) are
 * loosely typed as `Record<string, never> | null` by openapi-typescript. Read
 * them defensively: a real string comes back, anything else becomes undefined.
 */
export function asText(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

type ProposalSource = Schemas["ProposalSummaryDto"]["source"];

/** Where a proposal came from, in plain English, with a matching icon. */
export function sourceMeta(source: ProposalSource): {
  label: string;
  icon: LucideIcon;
} {
  return source === "detection"
    ? { label: "From a ledger detection", icon: Receipt }
    : { label: "From a meeting", icon: CalendarClock };
}

type DetectionType = Schemas["DetectionDto"]["type"];
type DetectionState = Schemas["DetectionDto"]["state"];

/** Detection type → human label, one-line intent, tone and icon for its card. */
export const DETECTION_META: Record<
  DetectionType,
  { label: string; blurb: string; tone: BadgeTone; icon: LucideIcon }
> = {
  QUOTE_NOT_INVOICED: {
    label: "Accepted quote, never invoiced",
    blurb: "A quote the client accepted was never turned into an invoice.",
    tone: "proposal",
    icon: FileText,
  },
  RETAINER_STOPPED: {
    label: "Retainer gap",
    blurb: "A monthly retainer that usually bills has a gap this month.",
    tone: "attention",
    icon: Repeat,
  },
  EXPENSE_NOT_RECHARGED: {
    label: "Expense not recharged",
    blurb: "A billable cost was paid out but never passed on to the client.",
    tone: "proposal",
    icon: Receipt,
  },
};

/** Detection state → a small badge label + tone (for non-open detections). */
export function detectionStateMeta(
  state: DetectionState,
): { label: string; tone: BadgeTone } | null {
  switch (state) {
    case "PROPOSED":
      return { label: "Proposal created", tone: "info" };
    case "RESOLVED":
      return { label: "Invoiced", tone: "billed" };
    case "DISMISSED":
      return { label: "Dismissed", tone: "skipped" };
    case "OPEN":
    default:
      return null;
  }
}

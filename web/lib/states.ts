import type { Schemas } from "./api";

/**
 * The visual language for Robyn's states. Five semantic tones carry the whole
 * product story; a few neutral tones cover supporting UI. Every meeting,
 * proposal, calendar colour-key and task type resolves down to one tone here so
 * the same green means the same thing on every surface.
 */
export type BadgeTone =
  | "billed" // teal   — invoiced / sent / paid
  | "proposal" // amber  — proposal in review
  | "awaiting" // amber outline — awaiting transcript
  | "unknown" // violet — unknown attendee / pipeline
  | "skipped" // slate  — skipped / personal
  | "neutral" // slate soft — informational
  | "info" // indigo — matched / watching (accent family)
  | "success" // teal solid-ish — done
  | "attention"; // rose   — needs a human / rejected / error

/**
 * Tailwind class sets per tone, tuned for both themes. Soft tinted fills with a
 * readable foreground and a hairline border — calm, never neon.
 */
export const TONE_CLASS: Record<BadgeTone, string> = {
  billed:
    "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/25",
  proposal:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25",
  awaiting:
    "bg-transparent text-amber-700 border-amber-300 border-dashed dark:text-amber-300/90 dark:border-amber-500/40",
  unknown:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/25",
  skipped:
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20",
  neutral:
    "bg-muted text-muted-foreground border-border dark:bg-muted dark:text-muted-foreground",
  info: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/25",
  success:
    "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/25",
  attention:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25",
};

/** The dot colour used on calendar events / rails for each tone. */
export const TONE_DOT: Record<BadgeTone, string> = {
  billed: "bg-teal-500",
  proposal: "bg-amber-500",
  awaiting: "bg-amber-400 ring-1 ring-inset ring-amber-500/40 bg-transparent",
  unknown: "bg-violet-500",
  skipped: "bg-slate-400",
  neutral: "bg-slate-400",
  info: "bg-indigo-500",
  success: "bg-teal-500",
  attention: "bg-rose-500",
};

export interface StateMeta {
  tone: BadgeTone;
  label: string;
}

/** Calendar colour-key (from the API) → tone. Matches the brief's legend. */
export function colorKeyToTone(
  key: Schemas["CalendarEventDto"]["colorKey"] | string,
): BadgeTone {
  switch (key) {
    case "teal":
      return "billed";
    case "amber":
      return "proposal";
    case "amber-outline":
      return "awaiting";
    case "purple":
      return "unknown";
    case "gray":
    default:
      return "skipped";
  }
}

/** Meeting state → plain-English label + tone. */
export function meetingStateMeta(
  state: Schemas["MeetingState"] | string,
): StateMeta {
  switch (state) {
    case "SENT":
      return { tone: "billed", label: "Invoiced" };
    case "INVOICE_PROPOSED":
      return { tone: "proposal", label: "In review" };
    case "AWAITING_TRANSCRIPT":
      return { tone: "awaiting", label: "Awaiting transcript" };
    case "UNKNOWN_ATTENDEE":
      return { tone: "unknown", label: "Unknown attendee" };
    case "SKIPPED":
      return { tone: "skipped", label: "Skipped" };
    case "TRANSCRIPT_ATTACHED":
      return { tone: "info", label: "Transcript in" };
    case "CLIENT_MATCHED":
      return { tone: "info", label: "Client matched" };
    case "DETECTED":
    default:
      return { tone: "neutral", label: "Detected" };
  }
}

/** Invoice-proposal state → label + tone. */
export function proposalStateMeta(
  state: Schemas["InvoiceProposalState"] | string,
): StateMeta {
  switch (state) {
    case "SENT":
      return { tone: "billed", label: "Sent" };
    case "APPROVED":
      return { tone: "success", label: "Approved" };
    case "IN_REVIEW":
      return { tone: "proposal", label: "In review" };
    case "REJECTED":
      return { tone: "attention", label: "Rejected" };
    case "DRAFT":
    default:
      return { tone: "neutral", label: "Draft" };
  }
}

/** Connection health → label + tone. */
export function connectionStatusMeta(
  status: Schemas["ConnectionStatus"] | string,
): StateMeta {
  switch (status) {
    case "LIVE":
      return { tone: "success", label: "Live" };
    case "FALLBACK":
      return { tone: "proposal", label: "Fallback" };
    case "DOWN":
    default:
      return { tone: "attention", label: "Down" };
  }
}

/** Task type → card metadata (label, one-line intent, tone). */
export const TASK_META: Record<
  Schemas["TaskDto"]["type"],
  { label: string; blurb: string; tone: BadgeTone }
> = {
  PROVIDE_TRANSCRIPT: {
    label: "Provide transcript",
    blurb: "A meeting is missing its transcript.",
    tone: "awaiting",
  },
  CONFIRM_CLIENT_MATCH: {
    label: "Confirm client",
    blurb: "Robyn needs help matching this meeting to a client.",
    tone: "unknown",
  },
  REVIEW_INVOICE: {
    label: "Review invoice",
    blurb: "A proposal is ready for your approval.",
    tone: "proposal",
  },
  CONFIRM_AGREEMENT: {
    label: "Confirm agreement",
    blurb: "An email looks like a yes. Confirm to onboard the client.",
    tone: "unknown",
  },
  ATTACH_CONTRACT: {
    label: "Attach contract",
    blurb: "Add a contract so Robyn can cite the rate.",
    tone: "info",
  },
};

/** Provenance kind → short human label (for provenance chips). */
export function provenanceKindLabel(
  kind: Schemas["LineProvenanceDto"]["kind"] | string,
): string {
  switch (kind) {
    case "CONTRACT_CLAUSE":
      return "Contract";
    case "TRANSCRIPT_QUOTE":
      return "Transcript";
    case "CALENDAR_BLOCK":
      return "Calendar";
    case "LEDGER":
      return "Ledger";
    default:
      return "Source";
  }
}

/** The five-state legend for the calendar view. */
export const STATE_LEGEND: { tone: BadgeTone; label: string }[] = [
  { tone: "billed", label: "Invoiced" },
  { tone: "proposal", label: "In review" },
  { tone: "awaiting", label: "Awaiting transcript" },
  { tone: "unknown", label: "Unknown attendee" },
  { tone: "skipped", label: "Skipped / personal" },
];

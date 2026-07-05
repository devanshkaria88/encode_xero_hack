import type { Schemas } from "@/lib/api";

type TaskDto = Schemas["TaskDto"];
type Ctx = Record<string, unknown>;

/**
 * One-line plain-English captions for the compact task tiles. Each task type
 * has a rule that fills a sentence from the task's free-form context; when the
 * needed context is missing we fall back to the server-written task title,
 * then to a generic line. Reads are defensive — wrong shapes never throw.
 */

function str(ctx: Ctx, key: string): string | undefined {
  const v = ctx[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function num(ctx: Ctx, key: string): number | undefined {
  const v = ctx[key];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return undefined;
}

/** "£810" for whole amounts, "£810.50" when the pence matter. */
function gbp(amount: number): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

function fallback(task: TaskDto, generic: string): string {
  return task.title?.trim() ? task.title : generic;
}

/** The one-line caption of what needs doing, per task type. */
export function taskCaption(task: TaskDto): string {
  const ctx = (task.context ?? {}) as Ctx;

  switch (task.type) {
    case "PROVIDE_TRANSCRIPT": {
      const meeting = str(ctx, "meetingTitle");
      return meeting
        ? `Paste the transcript from ${meeting}`
        : fallback(task, "Paste the transcript from this meeting");
    }
    case "CONFIRM_CLIENT_MATCH": {
      const meeting = str(ctx, "meetingTitle");
      return meeting
        ? `Match ${meeting} to a client`
        : fallback(task, "Match this meeting to a client");
    }
    case "REVIEW_INVOICE": {
      const client = str(ctx, "clientName");
      const amount =
        num(ctx, "total") ??
        num(ctx, "totalGbp") ??
        num(ctx, "amountGbp") ??
        num(ctx, "amount");
      if (client && amount != null)
        return `Review the ${gbp(amount)} invoice for ${client}`;
      if (client) return `Review the invoice for ${client}`;
      return fallback(task, "Review this invoice before it goes to Xero");
    }
    case "CONFIRM_AGREEMENT": {
      const name = str(ctx, "displayName");
      return name
        ? `Confirm ${name} as a client`
        : fallback(task, "Confirm this new client");
    }
    case "ATTACH_CONTRACT": {
      const client = str(ctx, "clientName");
      return client
        ? `Add the contract for ${client}`
        : fallback(task, "Add a contract so Robyn can cite the rate");
    }
    default:
      return fallback(task, "Open this task");
  }
}

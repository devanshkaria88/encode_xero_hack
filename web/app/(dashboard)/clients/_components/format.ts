import type { Schemas } from "@/lib/api";

type BillingProfile = Schemas["BillingProfileDto"];

/**
 * The plain-English suffix that follows a rate figure, e.g. "150 / hour",
 * "900 / day", "1,200 · monthly retainer". Kept human — a plumber reads it.
 */
export function rateSuffix(profile: BillingProfile): string {
  switch (profile.rateUnit) {
    case "HOUR":
      return "per hour";
    case "DAY":
      return "per day";
    case "FIXED":
      return profile.cadence ?? "fixed fee";
    default:
      return profile.cadence ?? "";
  }
}

/** Watch-state → plain label for a prospect in the pipeline rail. */
export function prospectStateLabel(state: Schemas["PotentialClientDto"]["state"]): string {
  switch (state) {
    case "QUEUED":
      return "Queued";
    case "WATCHING":
      return "Watching inbox";
    case "AGREEMENT_DETECTED":
      return "Agreement found";
    case "PROMOTED":
      return "Onboarded";
    case "DISMISSED":
      return "Dismissed";
    default:
      return state;
  }
}

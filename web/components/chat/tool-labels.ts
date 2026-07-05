/**
 * Human labels for the tool events the chat stream emits. Tool names come
 * from the backend agent (api/src/modules/chat/chat-tools.service.ts) plus
 * `web_search` and `mcp:<tool>` for user-added MCP servers. Anything unknown
 * falls back to a readable version of the raw name, so a new backend tool
 * never renders as snake_case on stage.
 */

type Status = "running" | "done" | "error";

/** [running, done, error] */
const LABELS: Record<string, [string, string, string]> = {
  get_dashboard_summary: [
    "Checking the money summary",
    "Checked the money summary",
    "Could not check the money summary",
  ],
  get_leak_breakdown: [
    "Breaking down unbilled work",
    "Broke down unbilled work",
    "Could not break down unbilled work",
  ],
  list_proposals: [
    "Looking through invoice proposals",
    "Looked through invoice proposals",
    "Could not read invoice proposals",
  ],
  get_proposal: [
    "Opening a proposal",
    "Opened a proposal",
    "Could not open that proposal",
  ],
  list_detections: [
    "Checking recent detections",
    "Checked recent detections",
    "Could not check recent detections",
  ],
  list_open_tasks: [
    "Checking open tasks",
    "Checked open tasks",
    "Could not check open tasks",
  ],
  list_meetings: [
    "Looking through meetings",
    "Looked through meetings",
    "Could not read meetings",
  ],
  get_meeting_utilisation: [
    "Working out billed meeting time",
    "Worked out billed meeting time",
    "Could not work out billed meeting time",
  ],
  get_client_revenue: [
    "Checking client revenue",
    "Checked client revenue",
    "Could not check client revenue",
  ],
  list_unpaid_invoices: [
    "Checking unpaid invoices",
    "Checked unpaid invoices",
    "Could not check unpaid invoices",
  ],
  list_payments: [
    "Checking payments",
    "Checked payments",
    "Could not check payments",
  ],
  get_aged_receivables: [
    "Checking overdue balances",
    "Checked overdue balances",
    "Could not check overdue balances",
  ],
  get_audit_trail: [
    "Reading the audit trail",
    "Read the audit trail",
    "Could not read the audit trail",
  ],
  web_search: [
    "Searching the web",
    "Searched the web",
    "Web search failed",
  ],
  // The stream reports MCP completion under the generic name "mcp".
  mcp: ["Using an extra tool", "Used an extra tool", "Extra tool failed"],
};

function humanize(raw: string): string {
  return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function toolLabel(name: string, status: Status): string {
  const known = LABELS[name];
  if (known) {
    return status === "running" ? `${known[0]}…` : known[status === "done" ? 1 : 2];
  }
  if (name.startsWith("mcp:")) {
    const tool = humanize(name.slice(4)) || "an extra tool";
    if (status === "running") return `Using ${tool}…`;
    return status === "done" ? `Used ${tool}` : `${tool} failed`;
  }
  const tool = humanize(name) || "a tool";
  if (status === "running") return `Running ${tool}…`;
  return status === "done" ? `Finished ${tool}` : `${tool} failed`;
}

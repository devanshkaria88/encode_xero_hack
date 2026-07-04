// .claude/skills/xero-auth/scripts/verify-auth.ts
//
// Gate G0 — proves the Xero Custom Connection works end to end, before any
// feature code is written. Run from repo root:
//
//   npx tsx .claude/skills/xero-auth/scripts/verify-auth.ts
//
// What it does:
//   1. Parses <repo-root>/.env itself (no dotenv dep); vars already in
//      process.env win over the file.
//   2. Asserts XERO_CLIENT_ID / XERO_CLIENT_SECRET non-empty (named errors —
//      an empty client id surfaces from the token endpoint as 400
//      invalid_request; unauthorized_client is the code-flow symptom).
//   3. Fetches a client_credentials token from identity.xero.com.
//      On 400 `invalid_scope` (granular-only app) it retries once with the
//      granular equivalents of the project's broad scopes.
//   4. GETs the connected organisation (name via GET /connections — our
//      scopes deliberately exclude accounting.settings, so GET /Organisation
//      would 403) and 1 invoice.
//   5. Prints org name, invoice count, and the rate-limit headers.
//
// No npm deps. Node 18+ (native fetch). Compiles standalone under
// strict / ES2022 / commonjs / types=["node"].

import * as fs from "node:fs";
import * as path from "node:path";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices?page=1&pageSize=1";

// The exact scopes this project needs — nothing more. See SKILL.md.
const PROJECT_SCOPES =
  "accounting.transactions accounting.contacts accounting.attachments accounting.reports.read";

// Granular equivalents (post-29-April-2026 custom connections may reject the
// broad scopes with 400 invalid_scope). Mapping per Xero's scope migration:
// accounting.transactions -> invoices+payments+banktransactions+manualjournals,
// accounting.reports.read -> the eight accounting.reports.*.read scopes.
const GRANULAR_FALLBACK_SCOPES = [
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.contacts",
  "accounting.attachments",
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.budgetsummary.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.taxreports.read",
].join(" ");

class MissingEnvError extends Error {
  constructor(varName: string) {
    super(
      `${varName} is empty — set it in .env at repo root. ` +
        `If an empty client id reaches Xero it surfaces as a misleading OAuth error ` +
        `(invalid_request on the token endpoint, unauthorized_client in code flow), ` +
        `which points away from the real cause.`,
    );
    this.name = "MissingEnv";
  }
}

class XeroTokenError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`token request failed with HTTP ${status}: ${body}`);
    this.name = "XeroTokenError";
  }
}

class XeroApiError extends Error {
  constructor(
    public readonly status: number,
    url: string,
    body: string,
  ) {
    super(`GET ${url} failed with HTTP ${status}: ${body}`);
    this.name = "XeroApiError";
  }
}

// --- 1. Tiny .env parser (existing process.env wins; missing file tolerated) ---

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    console.warn(`[verify-auth] no .env at ${envPath} — relying on process.env only`);
    return;
  }
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    const existing = process.env[key];
    if (existing === undefined || existing === "") {
      process.env[key] = value;
    }
  }
}

// --- 2. Named env assertions (fail fast, never log the value itself) ---

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new MissingEnvError(name);
  }
  return v.trim();
}

// --- 3. client_credentials token (Basic auth + form-encoded body, never JSON) ---

interface TokenResult {
  accessToken: string;
  expiresIn: number;
  scopeSetUsed: "project (broad)" | "granular fallback";
}

async function requestToken(
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new XeroTokenError(res.status, text);
  }
  const parsed = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
  if (typeof parsed.access_token !== "string" || parsed.access_token === "") {
    throw new XeroTokenError(res.status, "response body had no access_token");
  }
  return {
    accessToken: parsed.access_token,
    expiresIn: typeof parsed.expires_in === "number" ? parsed.expires_in : 0,
  };
}

async function getTokenWithFallback(clientId: string, clientSecret: string): Promise<TokenResult> {
  const scopeOverride = process.env["XERO_SCOPES"];
  const scopes =
    scopeOverride !== undefined && scopeOverride.trim() !== "" ? scopeOverride.trim() : PROJECT_SCOPES;
  try {
    const t = await requestToken(clientId, clientSecret, scopes);
    return { ...t, scopeSetUsed: "project (broad)" };
  } catch (err) {
    if (err instanceof XeroTokenError && err.status === 400 && err.body.includes("invalid_scope")) {
      console.warn(
        "[verify-auth] broad scopes rejected (invalid_scope) — this app only has granular scopes. " +
          "Retrying with granular equivalents. Set XERO_SCOPES in .env to the granular set to silence this.",
      );
      const t = await requestToken(clientId, clientSecret, GRANULAR_FALLBACK_SCOPES);
      return { ...t, scopeSetUsed: "granular fallback" };
    }
    throw err;
  }
}

// --- 4. Organisation + one invoice ---

interface XeroConnection {
  tenantId?: string;
  tenantName?: string;
}

async function getJson(url: string, accessToken: string): Promise<{ body: unknown; res: Response }> {
  // Per the custom-connections docs, API calls need exactly these two headers.
  // No xero-tenant-id: a custom connection is bound to a single organisation.
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new XeroApiError(res.status, url, text);
  }
  return { body: JSON.parse(text) as unknown, res };
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(__dirname, "../../../../.env"));

  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  // Log lengths only — never the values.
  console.log(
    `[verify-auth] env ok (client_id_len: ${clientId.length}, client_secret_len: ${clientSecret.length})`,
  );

  const token = await getTokenWithFallback(clientId, clientSecret);
  console.log(
    `[verify-auth] token ok — scope set: ${token.scopeSetUsed}, expires_in: ${token.expiresIn}s`,
  );

  const { body: connectionsBody } = await getJson(CONNECTIONS_URL, token.accessToken);
  const connections = Array.isArray(connectionsBody) ? (connectionsBody as XeroConnection[]) : [];
  if (connections.length === 0) {
    throw new XeroApiError(
      200,
      CONNECTIONS_URL,
      "token issued but no organisation is connected. Has a Xero org admin authorised this " +
        "Custom Connection app in the developer portal? Tokens are useless until that is done.",
    );
  }
  const first = connections[0];
  const orgName = first?.tenantName ?? first?.tenantId ?? "(unnamed connection)";
  console.log(`[verify-auth] organisation: ${orgName}`);

  const { body: invoicesBody, res: invoicesRes } = await getJson(INVOICES_URL, token.accessToken);
  const inv = invoicesBody as { Invoices?: unknown[]; pagination?: { itemCount?: unknown } };
  const returned = Array.isArray(inv.Invoices) ? inv.Invoices.length : 0;
  const itemCount = typeof inv.pagination?.itemCount === "number" ? inv.pagination.itemCount : null;
  console.log(
    `[verify-auth] invoices returned: ${returned}` + (itemCount !== null ? ` (org total: ${itemCount})` : ""),
  );

  console.log(
    "[verify-auth] rate limits remaining — " +
      `minute: ${invoicesRes.headers.get("X-MinLimit-Remaining") ?? "n/a"}, ` +
      `day: ${invoicesRes.headers.get("X-DayLimit-Remaining") ?? "n/a"}, ` +
      `app-minute: ${invoicesRes.headers.get("X-AppMinLimit-Remaining") ?? "n/a"}`,
  );
  console.log("[verify-auth] G0 PASS");
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(`[verify-auth] FAIL — ${err.name}: ${err.message}`);
  } else {
    console.error("[verify-auth] FAIL —", err);
  }
  console.error("[verify-auth] see the error table in .claude/skills/xero-auth/SKILL.md");
  process.exit(1);
});

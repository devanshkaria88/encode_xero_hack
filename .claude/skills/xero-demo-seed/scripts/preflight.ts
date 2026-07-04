// .claude/skills/xero-demo-seed/scripts/preflight.ts
//
// Read-only pre-flight for the demo-org seed. Run BEFORE any seed write,
// from repo root:
//
//   npx tsx .claude/skills/xero-demo-seed/scripts/preflight.ts
//
// Compiles standalone: strict, target=ES2022, module=commonjs, esModuleInterop,
// types=["node"]. Node builtins only. Node 18+ (global fetch).
//
// Parses <repo-root>/.env itself (no dotenv dep): comments and blank lines
// skipped, leading `export ` tolerated, MATCHING single/double quotes
// stripped, and variables already set in process.env always win over the file.
//
// Asserts, in order:
//   1. XERO_CLIENT_ID / XERO_CLIENT_SECRET non-empty (named MissingEnv errors)
//   2. client_credentials token mints and its granted scope LISTS each seed
//      scope as a whole token — compared as a Set, never by substring: a
//      read-only grant like "accounting.contacts.read" must FAIL here, not
//      false-pass and 403 on the first create mid-seed (MissingScope)
//   3. GET https://api.xero.com/connections returns 200 — prints tenantName so
//      a human confirms this is the DEMO org before anything is written.
//      (GET /api.xro/2.0/Organisation needs accounting.settings[.read], which
//      this project's app does not carry — it 403s. Base currency GBP is
//      therefore a MANUAL check in the Xero UI, not automated here.)
//
// Custom Connections are bound to ONE Xero organisation, so there is no
// XERO_TENANT_ID env var and no xero-tenant-id header anywhere below.

import * as fs from "node:fs";
import * as path from "node:path";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";

// A strict SUBSET of the four scopes assigned to the project's single app
// (accounting.transactions accounting.contacts accounting.attachments
// accounting.reports.read). There is no separate seed app: requesting any
// scope outside the assigned set gets 400 invalid_scope from the token
// endpoint. accounting.transactions covers Invoices AND PurchaseOrders;
// accounting.contacts covers Contacts. Scopes must ALSO be enabled on the
// Custom Connection app config — they are configured at both ends.
const SEED_SCOPES = "accounting.transactions accounting.contacts";

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// Tiny .env parser: skip comments/blanks, tolerate leading `export `, strip
// MATCHING single/double quotes, never override existing process.env.
export function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    console.warn(`[seed:preflight] no .env at ${envPath} — relying on process.env only`);
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

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — an empty client id surfaces from the token ` +
        `endpoint as 400 invalid_request, which points away from the real cause. ` +
        `Set it in .env and retry.`,
    );
  }
  return v;
}

export async function getAccessToken(): Promise<TokenResponse> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");

  // Log the shape, never the secret.
  console.log("[seed:preflight] token request", {
    client_id_len: clientId.length,
    scope: SEED_SCOPES,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: SEED_SCOPES,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `TokenRequestFailed: HTTP ${res.status} from ${TOKEN_URL} — ${body}`,
    );
  }

  const token = (await res.json()) as TokenResponse;

  // Whole-token Set comparison — NEVER substring. String.includes would let
  // "accounting.contacts.read" satisfy "accounting.contacts", false-passing a
  // read-only misconfiguration that then 403s on the first create mid-seed.
  const granted = new Set(token.scope.split(/\s+/).filter((t) => t !== ""));
  for (const s of SEED_SCOPES.split(" ")) {
    if (!granted.has(s)) {
      throw new Error(
        `MissingScope: token granted "${token.scope}" but the seed needs the whole ` +
          `scope token "${s}" — enable it on the Custom Connection app config AND ` +
          `send it in the token request body (custom-connection scopes are ` +
          `configured at both ends). A ".read" variant does NOT count.`,
      );
    }
  }

  return token;
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(__dirname, "../../../../.env"));

  const token = await getAccessToken();
  console.log("[seed:preflight] token OK", {
    expires_in: token.expires_in,
    scope: token.scope,
  });

  // Org identity check via /connections — the same route xero-auth's
  // verify-auth.ts uses. GET /api.xro/2.0/Organisation would 403 here: it
  // needs accounting.settings[.read], which this app's scopes do not include.
  // NO xero-tenant-id header: a custom connection token is already bound to
  // exactly one organisation.
  const res = await fetch(CONNECTIONS_URL, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `OrgCheckFailed: HTTP ${res.status} from GET ${CONNECTIONS_URL} — ${body}`,
    );
  }

  const connections = JSON.parse(body) as Array<{
    tenantId?: string;
    tenantName?: string;
  }>;
  if (!Array.isArray(connections) || connections.length === 0) {
    throw new Error(
      `OrgCheckFailed: token issued but no organisation is connected — has a Xero ` +
        `org admin authorised this Custom Connection app in the developer portal?`,
    );
  }
  for (const c of connections) {
    console.log(
      `[seed:preflight] connected organisation: ${c.tenantName ?? c.tenantId ?? "(unnamed)"}`,
    );
  }
  console.log(
    "[seed:preflight] confirm the organisation above is the DEMO org before seeding. " +
      "Base currency must be GBP — check org settings in the Xero UI (an automated " +
      "BaseCurrency check needs accounting.settings.read, which this app does not carry).",
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

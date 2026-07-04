// .claude/skills/xero-mcp-usage/scripts/check-mcp-env.ts
//
// Smoke-test the Custom Connection env EXACTLY the way the Xero MCP server
// (@xeroapi/xero-mcp-server v0.0.16) consumes it on every tool call:
//   1. POST https://identity.xero.com/connect/token  (client_credentials,
//      HTTP Basic base64(clientId:clientSecret), form-encoded body)
//   2. GET  https://api.xero.com/connections          (server uses connections[0])
//
// Run from repo root:  npx tsx .claude/skills/xero-mcp-usage/scripts/check-mcp-env.ts
// No npm deps. Node 18+ (native fetch). Never logs secret values.

import * as fs from "node:fs";
import * as path from "node:path";
// `process` is the Node global. This script is run via tsx (which strips types
// without checking) and compiles under the project's strict check config —
// importing the namespace would make `process.exitCode` a read-only binding.

// Default = the XERO_SCOPES line in .env.example at the repo root (the four
// project scopes). Override with XERO_SCOPES in .env (recommended: always set
// it, so the MCP server skips its own scope-guessing fallback).
const DEFAULT_SCOPES =
  "accounting.transactions accounting.contacts accounting.attachments accounting.reports.read";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface XeroConnection {
  tenantId: string;
  tenantName?: string;
  tenantType?: string;
}

// Minimal .env loader — no dotenv dependency, but matches dotenv v16 parsing
// where it matters: skips comments/blanks, tolerates a leading `export `,
// strips MATCHING single/double quotes around the value, and never overrides
// vars already present in process.env. This keeps the smoke test faithful to
// what the MCP server (which loads .env via dotenv) will actually see.
function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../../.env"),
  ];
  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) {
    return; // vars may come from the shell; requireEnv() decides below
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  console.log(`[check-mcp-env] loaded ${envPath}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — this surfaces from the token endpoint as HTTP 400 invalid_request. ` +
        `Set it in .env at the repo root (see .env.example) and retry.`,
    );
  }
  return value.trim();
}

async function main(): Promise<void> {
  loadDotEnv();

  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");

  const rawScopes = process.env.XERO_SCOPES;
  const scope =
    rawScopes !== undefined && rawScopes.trim() !== "" ? rawScopes.trim() : DEFAULT_SCOPES;

  if (rawScopes === undefined || rawScopes.trim() === "") {
    console.warn(
      "[check-mcp-env] XERO_SCOPES is not set. This script defaults to the .env.example scope set, " +
        "but the MCP server would GUESS (legacy V1 set incl. payroll.*, then granular V2 on invalid_scope). " +
        "Set XERO_SCOPES explicitly to the app's assigned scopes.",
    );
  }

  if (process.env.XERO_CLIENT_BEARER_TOKEN !== undefined && process.env.XERO_CLIENT_BEARER_TOKEN !== "") {
    console.warn(
      "[check-mcp-env] XERO_CLIENT_BEARER_TOKEN is set — the MCP server would use bearer mode and " +
        "IGNORE XERO_CLIENT_ID/XERO_CLIENT_SECRET. Unset it unless that is intended.",
    );
  }

  // Log lengths, never values.
  console.log("[check-mcp-env] token request", {
    client_id_len: clientId.length,
    client_secret_len: clientSecret.length,
    scope,
  });

  // 1. client_credentials grant — Basic auth header, form-encoded body.
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(
      `TokenGrantFailed: HTTP ${tokenRes.status} from ${TOKEN_URL} — body: ${body}. ` +
        `invalid_request = empty/missing client id or malformed request; ` +
        `invalid_client = wrong client id or secret; ` +
        `unauthorized_client = the app is not a Custom Connection (client_credentials not enabled); ` +
        `invalid_scope = a requested scope is not assigned to the Custom Connection app.`,
    );
  }

  const token = (await tokenRes.json()) as TokenResponse;
  console.log(
    `[check-mcp-env] token grant OK (token_type=${token.token_type}, expires_in=${token.expires_in}s)`,
  );

  // 2. GET /connections — the MCP server silently uses connections[0].tenantId.
  const connRes = await fetch(CONNECTIONS_URL, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });

  if (!connRes.ok) {
    const body = await connRes.text();
    throw new Error(
      `ConnectionsFailed: HTTP ${connRes.status} from ${CONNECTIONS_URL} — body: ${body}.`,
    );
  }

  const connections = (await connRes.json()) as XeroConnection[];

  if (connections.length === 0) {
    throw new Error(
      "NoConnections: token grant succeeded but GET /connections returned 0 orgs — " +
        "the org admin has not authorised the Custom Connection yet. " +
        "The MCP server would boot, then every tool call would fail.",
    );
  }

  const first = connections[0];
  console.log(
    `[check-mcp-env] ${connections.length} connection(s). ` +
      `MCP server will use connections[0]: tenantId=${first.tenantId} (${first.tenantName ?? "unnamed"})`,
  );

  if (connections.length > 1) {
    console.warn(
      "[check-mcp-env] WARNING: /connections returned more than one org. A Custom Connection " +
        "maps to a single organisation, so this is unexpected — and the MCP server always uses " +
        "the FIRST with no selection mechanism (wrong-books risk). Investigate before writing.",
    );
  }

  console.log("[check-mcp-env] OK — this env is safe to hand to `npx -y @xeroapi/xero-mcp-server@latest`.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

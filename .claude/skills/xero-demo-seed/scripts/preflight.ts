// .claude/skills/xero-demo-seed/scripts/preflight.ts
//
// Read-only pre-flight for the demo-org seed. Run BEFORE any seed write.
// Compiles standalone: strict, target=ES2022, module=commonjs, esModuleInterop,
// types=["node"]. Node builtins only. Node 18+ (global fetch).
//
// .env is loaded by the runner (e.g. `node --env-file=.env` on Node 20.6+);
// this script only reads process.env and asserts.
//
// Asserts, in order:
//   1. XERO_CLIENT_ID / XERO_CLIENT_SECRET non-empty (named MissingEnv errors)
//   2. client_credentials token mints and carries the seed scopes (MissingScope)
//   3. GET /Organisations returns 200 — prints the raw body so a human confirms
//      this is the DEMO org before anything is written into it.
//
// Custom Connections are bound to ONE Xero organisation, so there is no
// XERO_TENANT_ID env var and no xero-tenant-id header anywhere below.

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";

// Granular scopes only. accounting.invoices covers Invoices AND PurchaseOrders;
// accounting.contacts covers Contacts. Scopes must ALSO be enabled on the
// Custom Connection app config — they are configured at both ends.
const SEED_SCOPES = "accounting.contacts accounting.invoices";

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — this surfaces from Xero as unauthorized_client, ` +
        `which points away from the real cause. Set it in .env and retry.`,
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

  for (const s of SEED_SCOPES.split(" ")) {
    if (!token.scope.includes(s)) {
      throw new Error(
        `MissingScope: token granted "${token.scope}" but the seed needs "${s}" — ` +
          `enable it on the Custom Connection app config AND send it in the token ` +
          `request body (custom-connection scopes are configured at both ends).`,
      );
    }
  }

  return token;
}

async function main(): Promise<void> {
  const token = await getAccessToken();
  console.log("[seed:preflight] token OK", {
    expires_in: token.expires_in,
    scope: token.scope,
  });

  // Smoke test + org identity check. NO xero-tenant-id header: a custom
  // connection token is already bound to exactly one organisation.
  const res = await fetch(`${API_BASE}/Organisations`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `OrgCheckFailed: HTTP ${res.status} from GET /Organisations — ${body}`,
    );
  }

  // Print raw JSON, don't parse: a human must confirm this is the DEMO org
  // (and that the base currency is GBP) before any seed write.
  console.log(
    "[seed:preflight] GET /Organisations 200 — confirm this is the DEMO org before seeding:",
  );
  console.log(body);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

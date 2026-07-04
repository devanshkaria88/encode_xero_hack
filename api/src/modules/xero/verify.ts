// Live Xero Custom Connection check. Re-run after fixing api/.env creds:
//   pnpm --filter robyn-api verify:xero    (or: cd api && npx tsx src/modules/xero/verify.ts)
// Prints org name + a real invoice read + the working scope string, or a named
// failure. Exits non-zero on failure so it can gate the seed.

import {
  getAccessToken,
  resolveTenant,
  xeroFetch,
  XeroHttpError,
  loadDotEnv,
} from './xero-http';

async function main() {
  loadDotEnv();
  const idLen = (process.env.XERO_CLIENT_ID ?? '').trim().length;
  const secretLen = (process.env.XERO_CLIENT_SECRET ?? '').trim().length;
  console.log(`[verify] env: client_id_len=${idLen} client_secret_len=${secretLen}`);
  if (!idLen || !secretLen) {
    console.error('[verify] FAIL — XERO_CLIENT_ID / XERO_CLIENT_SECRET empty in api/.env');
    process.exit(1);
  }

  let token: string;
  try {
    token = await getAccessToken();
    console.log(`[verify] token OK (len ${token.length})`);
  } catch (e) {
    console.error('[verify] FAIL — token grant:', e instanceof Error ? e.message : e);
    console.error(
      '[verify] If invalid_scope: the app is not a Custom Connection with accounting ' +
        'scopes. Create a fresh Custom Connection bound to the Demo Company (see HANDOFF.md).',
    );
    process.exit(1);
  }

  const tenant = await resolveTenant();
  if (tenant) {
    console.log(`[verify] tenant: ${tenant.name} (${tenant.id})`);
  } else {
    console.warn('[verify] no tenant from /connections — a clean Custom Connection may still work.');
  }

  try {
    const res = await xeroFetch<{ Invoices?: unknown[]; pagination?: { itemCount?: number } }>(
      '/Invoices',
      { query: { page: 1, pageSize: 1 } },
    );
    const count = res.pagination?.itemCount ?? res.Invoices?.length ?? 0;
    console.log(`[verify] /Invoices OK — ${count} invoice(s) visible`);
    console.log('[verify] G0 PASS — live Xero Accounting API reachable.');
    process.exit(0);
  } catch (e) {
    if (e instanceof XeroHttpError) {
      console.error(`[verify] FAIL — /Invoices ${e.status}: ${e.message}`);
      if (e.status === 403) {
        console.error('[verify] 403 = token lacks accounting scope OR no org connected. Fix the Custom Connection.');
      }
    } else {
      console.error('[verify] FAIL — /Invoices:', e instanceof Error ? e.message : e);
    }
    process.exit(1);
  }
}

main();

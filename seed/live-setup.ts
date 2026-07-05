// seed/live-setup.ts — scenario-A prep for the LIVE demo run. Idempotent;
// run it AFTER `pnpm drain:live` (and re-run it freely — every step upserts).
//
// What it does:
//   (a) upserts the existing client "CivicPulse-DevanshKaria"
//       (kariadevansh08@gmail.com, autonomy ON),
//   (b) attaches the Technical Advisory Agreement by POSTing its plain text to
//       the RUNNING API (real LLM clause parse — picks up whatever billing
//       profile extraction the engine ships), from
//       demo-assets/civicpulse-agreement.txt,
//   (c) ensures the matching Xero contact and stores its ContactID — tolerant
//       of Xero 429/timeouts (the first invoice write ensures contacts anyway),
//   (d) writes audit rows for everything it did,
//   (e) prints the final checklist state.
//
// Run:  pnpm setup:live     (root script: npx --prefix api tsx seed/live-setup.ts)
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv } from '../api/src/modules/xero/xero-http';
import * as xero from '../api/src/modules/xero/xero-api';
import type { Queryable } from './tables';

// pg lives in api/node_modules (pnpm workspace, not hoisted). Anchor the require
// to the api package so this resolves under `pnpm run`, `pnpm exec`, npx and tsx.
const apiRequire = createRequire(join(__dirname, '..', 'api', 'package.json'));
const { Client } = apiRequire('pg') as typeof import('pg');

const API_ROOT = process.env.ROBYN_API_URL ?? 'http://localhost:3000';
const CLIENT_NAME = 'CivicPulse-DevanshKaria';
const CLIENT_EMAIL = 'kariadevansh08@gmail.com';
const CONTRACT_TITLE = 'CivicPulse-DevanshKaria Technical Advisory Agreement (2026)';
const CONTRACT_TXT_PATH = join(__dirname, '..', 'demo-assets', 'civicpulse-agreement.txt');

interface ContractResponse {
  id: string;
  clauses: Array<{ ref: string; text: string }>;
  rate: number | null;
  rateUnit: string | null;
  paymentTerms: string | null;
}

async function audit(
  db: Queryable,
  action: string,
  summary: string,
  subjectType: string | null,
  subjectId: string | null,
  inputs: Record<string, unknown> | null,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (id, actor, action, summary, "subjectType", "subjectId", inputs)
     VALUES ($1, 'SYSTEM', $2, $3, $4, $5, $6)`,
    [randomUUID(), action, summary, subjectType, subjectId, inputs ? JSON.stringify(inputs) : null],
  );
}

async function assertApiUp(): Promise<void> {
  try {
    const res = await fetch(`${API_ROOT}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`GET /health returned ${res.status}`);
  } catch (e) {
    throw new Error(
      `ApiUnreachable: the Robyn API is not answering at ${API_ROOT} (${(e as Error).message}). ` +
        'Start it (pnpm dev:api) and re-run pnpm setup:live. Nothing was seeded.',
    );
  }
}

async function upsertClient(db: Queryable): Promise<{ id: string; created: boolean }> {
  const existing = (await db.query('SELECT id FROM clients WHERE name = $1', [CLIENT_NAME])) as {
    rows: Array<{ id: string }>;
  };
  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await db.query(
      'UPDATE clients SET emails = $1, "autonomyEnabled" = true WHERE id = $2',
      [JSON.stringify([CLIENT_EMAIL]), id],
    );
    return { id, created: false };
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO clients (id, "xeroContactId", name, emails, "autonomyEnabled", "billingProfile", "unbilledExposureGbp")
     VALUES ($1, NULL, $2, $3, true, NULL, 0)`,
    [id, CLIENT_NAME, JSON.stringify([CLIENT_EMAIL])],
  );
  return { id, created: true };
}

async function attachContract(clientId: string): Promise<ContractResponse> {
  const rawText = readFileSync(CONTRACT_TXT_PATH, 'utf8');
  if (!rawText.trim()) {
    throw new Error(`EmptyContract: ${CONTRACT_TXT_PATH} is empty.`);
  }
  const res = await fetch(`${API_ROOT}/api/clients/${clientId}/contract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: CONTRACT_TITLE, rawText }),
    // Real LLM parse on the other end — give it room.
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `ContractAttachFailed: POST /api/clients/${clientId}/contract returned ${res.status}. ` +
        `Body: ${body.slice(0, 500)}. The LLM parse may have failed — re-run pnpm setup:live to retry.`,
    );
  }
  return (await res.json()) as ContractResponse;
}

async function ensureXeroContact(db: Queryable, clientId: string): Promise<string | null> {
  try {
    const { contact, created } = await xero.ensureContact(CLIENT_NAME, CLIENT_EMAIL);
    await db.query('UPDATE clients SET "xeroContactId" = $1 WHERE id = $2', [contact.ContactID, clientId]);
    console.log(`[setup-live] Xero contact ${created ? 'created' : 'reused'}: ${contact.ContactID}`);
    return contact.ContactID;
  } catch (e) {
    console.warn(
      `[setup-live] WARN: Xero contact deferred, the first invoice write will create it. (${(e as Error).message})`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('MissingEnv: DATABASE_URL is empty — set it in api/.env.');
  }

  // Fail fast BEFORE touching the DB — no half-seeded state.
  await assertApiUp();
  const db = new Client({ connectionString });
  await db.connect();

  try {
    // (a) the client, autonomy ON
    const { id: clientId, created } = await upsertClient(db);
    console.log(`[setup-live] client ${created ? 'created' : 'updated'}: ${CLIENT_NAME} (${clientId}), autonomy ON.`);
    await audit(
      db,
      'setup.live.client',
      `${created ? 'Created' : 'Updated'} client ${CLIENT_NAME} (${CLIENT_EMAIL}) with autonomy ON for the live run.`,
      'client',
      clientId,
      { name: CLIENT_NAME, emails: [CLIENT_EMAIL], autonomyEnabled: true },
    );

    // (b) the contract, through the running API (real LLM clause parse)
    console.log('[setup-live] attaching the Technical Advisory Agreement via the running API (LLM parse, ~10-60s)...');
    const contract = await attachContract(clientId);
    console.log(`[setup-live] contract filed: ${contract.id} (${contract.clauses.length} clauses parsed).`);

    // (c) the Xero contact — best effort, deferrable
    const xeroContactId = await ensureXeroContact(db, clientId);
    await audit(
      db,
      'setup.live.xero_contact',
      xeroContactId
        ? `Ensured Xero contact for ${CLIENT_NAME}: ${xeroContactId}.`
        : `Xero contact for ${CLIENT_NAME} deferred (rate limit or Xero down); the first invoice write will create it.`,
      'client',
      clientId,
      { xeroContactId },
    );

    // (e) checklist
    const after = (await db.query(
      'SELECT "xeroContactId", "billingProfile" FROM clients WHERE id = $1',
      [clientId],
    )) as { rows: Array<{ xeroContactId: string | null; billingProfile: Record<string, unknown> | null }> };
    const row = after.rows[0];

    console.log('');
    console.log('[setup-live] ============ LIVE CHECKLIST ============');
    console.log(`  client:          ${CLIENT_NAME}`);
    console.log(`  client id:       ${clientId}`);
    console.log(`  emails:          ${CLIENT_EMAIL}`);
    console.log('  autonomy:        ON');
    console.log(`  contract id:     ${contract.id}`);
    console.log(`  parsed clauses:  ${contract.clauses.length}`);
    console.log(`  billing profile: ${row?.billingProfile ? JSON.stringify(row.billingProfile) : 'NOT SET (check the contract parse)'}`);
    console.log(`  xero contact:    ${row?.xeroContactId ?? 'DEFERRED (first invoice write will create it)'}`);
    console.log('[setup-live] ========================================');
    console.log('[setup-live] done. Next: add the calendar events (see demo-assets/RUNBOOK-live-litmus.md).');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[setup-live] failed:', err);
  process.exit(1);
});

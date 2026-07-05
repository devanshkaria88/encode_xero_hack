// seed/drain-live.ts — drain the local DB for the LIVE demo run.
//
// Truncates every local domain table (same set as seed/reset.ts) but PRESERVES
// the rows that keep the live integrations alive:
//   - google_connections  (the Google OAuth grant — losing it means re-consent)
//   - agent_settings      (operator preferences)
// It then clears the calendar sync watermark on the surviving Google
// connection (calendarSyncToken, lastSyncAt, syncStatus -> PENDING, syncError)
// so the very next sync is a fresh FULL sync under the current time window.
//
// Never touches Xero.
//
// Run:  pnpm drain:live              (real drain)
//       pnpm drain:live --dry-run    (print the plan only, change nothing)
// (root scripts use: npx --prefix api tsx seed/drain-live.ts)
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadDotEnv } from '../api/src/modules/xero/xero-http';
import { truncateLocal, LOCAL_TABLES, type Queryable } from './tables';

// pg lives in api/node_modules (pnpm workspace, not hoisted). Anchor the require
// to the api package so this resolves under `pnpm run`, `pnpm exec`, npx and tsx.
const apiRequire = createRequire(join(__dirname, '..', 'api', 'package.json'));
const { Client } = apiRequire('pg') as typeof import('pg');

const PRESERVED_TABLES = ['google_connections', 'agent_settings'] as const;

interface GoogleConnectionSummary {
  id: string;
  accountEmail: string | null;
  syncStatus: string;
  hasSyncToken: boolean;
  lastSyncAt: string | null;
}

async function countRows(db: Queryable, table: string): Promise<number> {
  const res = (await db.query(`SELECT count(*)::int AS n FROM ${table}`)) as {
    rows: Array<{ n: number }>;
  };
  return res.rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('MissingEnv: DATABASE_URL is empty — set it in api/.env.');
  }

  const db = new Client({ connectionString });
  await db.connect();
  try {
    // Take stock before touching anything so the summary is honest.
    const wipeCounts = new Map<string, number>();
    for (const t of LOCAL_TABLES) {
      wipeCounts.set(t, await countRows(db, t));
    }
    const keepCounts = new Map<string, number>();
    for (const t of PRESERVED_TABLES) {
      keepCounts.set(t, await countRows(db, t));
    }

    const gcRes = (await db.query(
      `SELECT id, "accountEmail", "syncStatus",
              ("calendarSyncToken" IS NOT NULL) AS "hasSyncToken",
              "lastSyncAt"
         FROM google_connections`,
    )) as { rows: GoogleConnectionSummary[] };
    const connections = gcRes.rows;

    const header = dryRun ? '[drain-live] DRY RUN — nothing will change.' : '[drain-live] draining the local DB for the live run.';
    console.log(header);
    console.log('');
    console.log(`  WIPE  (${LOCAL_TABLES.length} tables, TRUNCATE ... RESTART IDENTITY CASCADE):`);
    for (const t of LOCAL_TABLES) {
      console.log(`    - ${t.padEnd(18)} ${wipeCounts.get(t)} row(s)`);
    }
    console.log('');
    console.log('  KEEP  (never truncated):');
    for (const t of PRESERVED_TABLES) {
      console.log(`    - ${t.padEnd(18)} ${keepCounts.get(t)} row(s)`);
    }
    console.log('');
    console.log('  RESET (google_connections sync watermark -> fresh full sync):');
    if (connections.length === 0) {
      console.log('    - no google_connections rows found (nothing to reset; connect Google first).');
    }
    for (const c of connections) {
      console.log(
        `    - ${c.accountEmail ?? c.id}: calendarSyncToken ${c.hasSyncToken ? 'SET -> NULL' : 'already NULL'}, ` +
          `lastSyncAt ${c.lastSyncAt ? `${new Date(c.lastSyncAt).toISOString()} -> NULL` : 'already NULL'}, ` +
          `syncStatus ${c.syncStatus} -> PENDING, syncError -> NULL`,
      );
    }
    console.log('');

    if (dryRun) {
      console.log('[drain-live] dry run complete. Re-run without --dry-run to execute.');
      return;
    }

    await truncateLocal(db);
    await db.query(
      `UPDATE google_connections
          SET "calendarSyncToken" = NULL,
              "lastSyncAt"        = NULL,
              "syncStatus"        = 'PENDING',
              "syncError"         = NULL`,
    );

    // First row of the fresh audit trail: the drain itself is on the record.
    await db.query(
      `INSERT INTO audit_events (id, actor, action, summary, "subjectType", "subjectId", inputs)
       VALUES ($1, 'SYSTEM', 'seed.drain_live', $2, NULL, NULL, $3)`,
      [
        randomUUID(),
        `Drained ${LOCAL_TABLES.length} local tables for the live run; kept google_connections (${keepCounts.get('google_connections')}) and agent_settings (${keepCounts.get('agent_settings')}); reset the calendar sync watermark for a fresh full sync.`,
        JSON.stringify({
          truncated: LOCAL_TABLES,
          preserved: PRESERVED_TABLES,
          rowsWipedByTable: Object.fromEntries(wipeCounts),
        }),
      ],
    );

    const totalWiped = [...wipeCounts.values()].reduce((a, b) => a + b, 0);
    console.log(`[drain-live] done. Wiped ${totalWiped} row(s) across ${LOCAL_TABLES.length} tables.`);
    console.log(`[drain-live] kept: google_connections (${keepCounts.get('google_connections')} row(s)), agent_settings (${keepCounts.get('agent_settings')} row(s)).`);
    console.log('[drain-live] calendar sync watermark cleared — the next sync is a fresh full sync.');
    console.log('[drain-live] next: pnpm setup:live');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[drain-live] failed:', err);
  process.exit(1);
});

// seed/reset.ts — TRUNCATE the local Robyn tables. Never touches Xero.
// Run: pnpm --filter robyn-api seed:reset   (or)  npx --prefix api tsx seed/reset.ts
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadDotEnv } from '../api/src/modules/xero/xero-http';
import { truncateLocal, LOCAL_TABLES } from './tables';

// pg lives in api/node_modules (pnpm workspace, not hoisted). Anchor the require
// to the api package so this resolves under `pnpm run`, `pnpm exec`, npx and tsx.
const apiRequire = createRequire(join(__dirname, '..', 'api', 'package.json'));
const { Client } = apiRequire('pg') as typeof import('pg');

async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('MissingEnv: DATABASE_URL is empty — set it in api/.env.');
  }
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await truncateLocal(db);
    console.log(`[reset] Truncated ${LOCAL_TABLES.length} local tables: ${LOCAL_TABLES.join(', ')}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[reset] failed:', err);
  process.exit(1);
});

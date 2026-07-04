// The local Postgres tables the seed owns. Order is child->parent for readable
// truncation; there are no FK constraints in the schema (TypeORM synchronize
// created plain indexes, not foreign keys), so CASCADE + any order is safe.
export const LOCAL_TABLES = [
  'audit_events',
  'tasks',
  'detections',
  'invoice_proposals',
  'transcripts',
  'meetings',
  'potential_clients',
  'contracts',
  'connection_states',
  'clients',
] as const;

// A pg Client-shaped thing with query(). Kept structural so tables.ts imports no
// runtime deps (pg is resolved from api/node_modules by the callers).
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** TRUNCATE every local table. Never touches Xero. Safe to re-run. */
export async function truncateLocal(db: Queryable): Promise<void> {
  await db.query(
    `TRUNCATE TABLE ${LOCAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

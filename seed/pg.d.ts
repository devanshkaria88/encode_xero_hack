// Minimal ambient types for 'pg' — the runtime package ships no .d.ts and the
// repo does not depend on @types/pg. Only the surface the seed scripts touch.
// tsx ignores .d.ts files at runtime; this exists purely for `tsc --noEmit`
// (see seed/tsconfig.json).
declare module 'pg' {
  export interface QueryResult<R = Record<string, unknown>> {
    rows: R[];
    rowCount: number | null;
  }
  export class Client {
    constructor(config?: { connectionString?: string });
    connect(): Promise<void>;
    end(): Promise<void>;
    query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
  }
}

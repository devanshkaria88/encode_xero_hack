// Side-effectful lifecycle hooks (cron registration, eager Xero syncs, IMAP
// connect) must only run when the server actually listens — never during the
// OpenAPI export (which instantiates the module graph but never serves).
// main.ts sets ROBYN_SERVE=1; openapi.ts leaves it unset.

export function isServing(): boolean {
  return process.env.ROBYN_SERVE === '1';
}

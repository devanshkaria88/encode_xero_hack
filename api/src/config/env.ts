// Central env access. Required secrets are asserted non-empty at boot with
// named errors so a misconfigured process dies at startup, not mid-demo.
// Values are read from api/.env (loaded by @nestjs/config in AppModule).

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `MissingEnv: ${name} is empty — set it in api/.env. Robyn refuses to boot ` +
        `without it rather than fail obscurely later.`,
    );
    this.name = 'MissingEnvError';
  }
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new MissingEnvError(name);
  return v.trim();
}

function opt(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export interface RobynConfig {
  port: number;
  databaseUrl: string;
  anthropicApiKey: string;
  xero: {
    clientId: string;
    clientSecret: string;
    scopes: string; // XERO_SCOPES override (empty => broad-then-granular fallback)
    paymentAccountCode: string; // optional; needed only for Payments writes
  };
  imap: {
    host: string;
    port: number;
    user: string;
    password: string;
    configured: boolean;
  };
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string; // must match a URI registered in Google Cloud Console
    configured: boolean;
    // Calendar full-sync window. The connected account is a REAL personal
    // calendar/inbox — the product only looks back a day (and ahead two) so a
    // demo sync never trawls months of personal history.
    calendarLookbackHours: number;
    calendarLookaheadHours: number;
  };
}

let cached: RobynConfig | null = null;

// Assert the hard-required secrets. Xero + Anthropic + DB are mandatory; IMAP
// and Google are optional (documented .ics / fixture-mailbox fallbacks exist).
export function loadConfig(): RobynConfig {
  if (cached) return cached;
  const imapHost = opt('IMAP_HOST');
  const imapUser = opt('IMAP_USER');
  const imapPassword = opt('IMAP_PASSWORD');
  const googleClientId = opt('GOOGLE_CLIENT_ID');
  const googleClientSecret = opt('GOOGLE_CLIENT_SECRET');

  cached = {
    // 3000 mirrors the reference stack: the API owns :3000, the web app :3001.
    port: Number(opt('PORT', '3000')),
    databaseUrl: req('DATABASE_URL'),
    anthropicApiKey: req('ANTHROPIC_API_KEY'),
    xero: {
      clientId: req('XERO_CLIENT_ID'),
      clientSecret: req('XERO_CLIENT_SECRET'),
      scopes: opt('XERO_SCOPES'),
      paymentAccountCode: opt('XERO_PAYMENT_ACCOUNT_CODE'),
    },
    imap: {
      host: imapHost,
      port: Number(opt('IMAP_PORT', '993')),
      user: imapUser,
      password: imapPassword,
      configured: Boolean(imapHost && imapUser && imapPassword),
    },
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      // Default mirrors the URI registered in Google Cloud Console for this
      // client: a FRONTEND page (web app, :3001) that receives Google's
      // redirect and hands the code to this API, which authorises the token.
      redirectUri: opt(
        'GOOGLE_REDIRECT_URI',
        'http://localhost:3001/calendar/callback',
      ),
      configured: Boolean(googleClientId && googleClientSecret),
      calendarLookbackHours: Number(opt('GOOGLE_CAL_LOOKBACK_HOURS', '24')),
      calendarLookaheadHours: Number(opt('GOOGLE_CAL_LOOKAHEAD_HOURS', '48')),
    },
  };
  return cached;
}

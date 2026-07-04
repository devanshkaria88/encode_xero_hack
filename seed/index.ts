// seed/index.ts — Robyn demo SEED.
//
//   seedLocal()  always: fills Postgres so the dashboard is demo-rich on first
//                boot (3 clients, contracts, 6 months of invoice history, June
//                calendar, potential-client queue, 3 detections, 3 open tasks).
//   seedXero()   only if a Xero health check passes: mirrors the story into the
//                demo org (contacts, AUTHORISED ACCREC invoices, an accepted
//                quote, Halcyon payment cadence) and backfills xeroContactId /
//                xeroInvoiceId locally. Idempotent (check-by-reference). If Xero
//                is not live it prints exactly what would run once creds land.
//
// Run:  pnpm --filter robyn-api seed      (or)  npx --prefix api tsx seed/index.ts
// Product is ACCREC — Robyn invoices the freelancer's CLIENTS.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadDotEnv, xeroHealthCheck, xeroFetch } from '../api/src/modules/xero/xero-http';
import * as xero from '../api/src/modules/xero/xero-api';
import { truncateLocal, LOCAL_TABLES, type Queryable } from './tables';

// pg lives in api/node_modules (pnpm workspace, not hoisted). Anchor the require
// to the api package so this resolves under `pnpm run`, `pnpm exec`, npx and tsx.
const apiRequire = createRequire(join(__dirname, '..', 'api', 'package.json'));
const { Client } = apiRequire('pg') as typeof import('pg');

const OWNER = { email: 'me@robyn.dev', name: 'Devansh Karia', organizer: true } as const;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const money = (n: number) => Math.round(n * 100) / 100;
const withTax = (net: number) => {
  const subtotal = money(net);
  const taxTotal = money(net * 0.2);
  return { subtotal, taxTotal, total: money(subtotal + taxTotal) };
};
const j = (v: unknown) => JSON.stringify(v);
const nowIso = () => new Date().toISOString();
const plusMinutes = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Row {
  [col: string]: unknown;
}

async function insertMany(db: Queryable, table: string, columns: string[], rows: Row[]): Promise<void> {
  for (const row of rows) {
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const vals = columns.map((c) => row[c] ?? null);
    await db.query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, vals);
  }
}

// ---------------------------------------------------------------------------
// build the full seed graph (ids generated up front so cross-references hold)
// ---------------------------------------------------------------------------
type LineProvenance = { kind: string; label: string; detail: string; source_ref?: string };
type ProposalLine = {
  description: string;
  quantity: number;
  unit_amount: number;
  account_code?: string;
  line_amount: number;
  provenance: LineProvenance[];
};
const line = (
  description: string,
  quantity: number,
  unit: number,
  provenance: LineProvenance[],
): ProposalLine => ({
  description,
  quantity,
  unit_amount: unit,
  account_code: '200',
  line_amount: money(quantity * unit),
  provenance,
});

function buildSeed() {
  // --- ids -----------------------------------------------------------------
  const halcyonId = randomUUID();
  const fenwickId = randomUUID();
  const marshId = randomUUID();
  const halcyonContractId = randomUUID();
  const fenwickContractId = randomUUID();
  const priyaId = randomUUID();

  // June meetings (gcalEventId == the .ics UIDs so live re-sync is idempotent)
  const mWorkshop = randomUUID();
  const mHalcyonSync = randomUUID();
  const mMarshDay = randomUUID();
  const mKitchen = randomUUID(); // no transcript -> PROVIDE_TRANSCRIPT
  const mPriya = randomUUID(); // unknown attendee -> potential client
  const mSnagging = randomUUID(); // proposed -> REVIEW_INVOICE

  const trWorkshop = randomUUID();
  const trSnagging = randomUUID();

  const pM3 = randomUUID();
  const pM4 = randomUUID();
  const pM6 = randomUUID();

  // --- clients -------------------------------------------------------------
  const clients: Row[] = [
    {
      id: halcyonId,
      xeroContactId: null,
      name: 'Halcyon Retail Ltd',
      emails: j(['accounts@halcyonretail.co.uk', 'ops@halcyonretail.co.uk']),
      autonomyEnabled: true,
      billingProfile: j({
        rate: 1200,
        rate_unit: 'FIXED',
        currency: 'GBP',
        cadence: 'monthly retainer',
        terms: 'Net 14',
        source: 'CONTRACT',
        provenance: 'Clause 3.1',
      }),
      unbilledExposureGbp: 1200,
    },
    {
      id: fenwickId,
      xeroContactId: null,
      name: 'Fenwick Interiors',
      emails: j(['hello@fenwickinteriors.co.uk', 'claire@fenwickinteriors.co.uk']),
      autonomyEnabled: false,
      billingProfile: j({
        rate: 150,
        rate_unit: 'HOUR',
        currency: 'GBP',
        cadence: 'per-project',
        terms: 'Net 14',
        source: 'CONTRACT',
        provenance: 'Clause 3.1',
      }),
      unbilledExposureGbp: 930,
    },
    {
      id: marshId,
      xeroContactId: null,
      name: 'Marsh & Co',
      emails: j(['finance@marshandco.co.uk']),
      autonomyEnabled: false,
      billingProfile: j({
        rate: 900,
        rate_unit: 'DAY',
        currency: 'GBP',
        cadence: 'per-project',
        terms: 'Net 30',
        source: 'INFERRED',
        provenance: 'Inferred from 5 prior invoices',
      }),
      unbilledExposureGbp: 1200,
    },
  ];

  // --- contracts -----------------------------------------------------------
  const halcyonRaw = [
    'CONSULTANCY RETAINER AGREEMENT',
    '',
    'This agreement is made between Halcyon Retail Ltd ("the Client") and Devansh Karia ("the Consultant").',
    '',
    '1. Term',
    '1.1 This agreement commences on 1 January 2026 and continues on a rolling monthly basis until terminated by either party on 30 days written notice.',
    '',
    '2. Scope',
    '2.1 The retainer covers up to eight (8) advisory hours per calendar month across retail e-commerce strategy and store operations. Additional hours are billed at GBP 150 per hour.',
    '',
    '3. Fees',
    '3.1 The Client shall pay the Consultant a fixed monthly retainer of GBP 1,200 (one thousand two hundred pounds), invoiced on the first business day of each month.',
    '3.2 All fees are exclusive of VAT, which is added where applicable.',
    '',
    '4. Payment',
    '4.1 Invoices are payable within fourteen (14) days of the invoice date (Net 14).',
  ].join('\n');

  const fenwickRaw = [
    'CONSULTANCY AGREEMENT',
    '',
    'This agreement is made between Fenwick Interiors ("the Client") and Devansh Karia ("the Consultant").',
    '',
    '1. Services',
    '1.1 The Consultant provides interior design consultancy on a time and materials basis.',
    '',
    '3. Fees',
    '3.1 The Consultant shall be paid at an hourly rate of GBP 150 (one hundred and fifty pounds) for all work performed.',
    '3.2 Any additional scope agreed during a session is billable at the same hourly rate.',
    '',
    '4. Payment',
    '4.1 Invoices are payable within fourteen (14) days of the invoice date (Net 14).',
  ].join('\n');

  const contracts: Row[] = [
    {
      id: halcyonContractId,
      clientId: halcyonId,
      fileRef: 'contracts/halcyon-retainer-2026.pdf',
      title: 'Halcyon Retail Monthly Retainer Agreement (2026)',
      rawText: halcyonRaw,
      parsed: j({
        rate: 1200,
        rate_unit: 'FIXED',
        currency: 'GBP',
        payment_terms: 'Net 14',
        scope_summary: 'Ongoing monthly retainer for retail e-commerce advisory and store operations support.',
        clauses: [
          { ref: 'Clause 2.1', text: 'The retainer covers up to eight (8) advisory hours per calendar month. Additional hours are billed at GBP 150 per hour.' },
          { ref: 'Clause 3.1', text: 'The Client shall pay the Consultant a fixed monthly retainer of GBP 1,200, invoiced on the first business day of each month.' },
          { ref: 'Clause 4.1', text: 'Invoices are payable within fourteen (14) days of the invoice date (Net 14).' },
        ],
      }),
    },
    {
      id: fenwickContractId,
      clientId: fenwickId,
      fileRef: 'contracts/fenwick-consultancy-2026.pdf',
      title: 'Fenwick Interiors Consultancy Agreement (2026)',
      rawText: fenwickRaw,
      parsed: j({
        rate: 150,
        rate_unit: 'HOUR',
        currency: 'GBP',
        payment_terms: 'Net 14',
        scope_summary: 'Time and materials interior design consultancy billed at an hourly rate.',
        clauses: [
          { ref: 'Clause 3.1', text: 'The Consultant shall be paid at an hourly rate of GBP 150 for all work performed.' },
          { ref: 'Clause 3.2', text: 'Any additional scope agreed during a session is billable at the same hourly rate.' },
          { ref: 'Clause 4.1', text: 'Invoices are payable within fourteen (14) days of the invoice date (Net 14).' },
        ],
      }),
    },
  ];

  // --- transcripts (for the two Fenwick meetings that carry evidence) -------
  const transcripts: Row[] = [
    {
      id: trWorkshop,
      meetingId: mWorkshop,
      rawText:
        'Devansh: Right, let us map the kitchen layout end to end.\n' +
        'Claire: Perfect. We spent the full two hours mapping the layout and the appliance runs.\n' +
        'Devansh: Good, I will write up the plan and send it across.',
      source: 'GRANOLA',
      parsed: j({
        summary: 'Two hour design workshop mapping the kitchen layout and appliance runs.',
        action_points: ['Write up the layout plan', 'Confirm appliance specifications'],
        scope_items: [
          {
            description: 'Design workshop for kitchen layout',
            est_hours: 2,
            evidence_quote: 'We spent the full two hours mapping the layout and the appliance runs.',
            billable: true,
          },
        ],
      }),
    },
    {
      id: trSnagging,
      meetingId: mSnagging,
      rawText:
        'Devansh: Quick hour on site to walk the snag list.\n' +
        'Claire: Great. While we are here, can you also redo the lighting spec, it was not in the original brief?\n' +
        'Devansh: Sure, I will re-spec the lighting circuit and send the revised plan.',
      source: 'GRANOLA',
      parsed: j({
        summary: 'Snagging walkthrough on site plus an unplanned lighting re-spec.',
        action_points: ['Send revised lighting plan', 'Order replacement handles'],
        scope_items: [
          {
            description: 'Snagging site visit',
            est_hours: 1,
            evidence_quote: 'Quick hour on site to walk the snag list.',
            billable: true,
          },
          {
            description: 'Extra: re-spec kitchen lighting circuit',
            est_hours: 1.5,
            evidence_quote: 'While we are here, can you also redo the lighting spec, it was not in the original brief?',
            billable: true,
          },
        ],
      }),
    },
  ];

  // --- meetings (June 2026) ------------------------------------------------
  const attendee = (email: string, name: string) => ({ email, name, organizer: false });
  const meetings: Row[] = [
    {
      id: mWorkshop,
      gcalEventId: 'robyn-fenwick-workshop-0608@robyn.dev',
      title: 'Fenwick Interiors - design workshop',
      start: '2026-06-08T10:00:00Z',
      end: '2026-06-08T12:00:00Z',
      durationHours: 2,
      attendees: j([OWNER, attendee('claire@fenwickinteriors.co.uk', 'Claire Fenwick')]),
      clientId: fenwickId,
      state: 'SENT',
      transcriptId: trWorkshop,
      skipReason: null,
      matchProposals: null,
      isPersonal: false,
      source: 'ics',
    },
    {
      id: mHalcyonSync,
      gcalEventId: 'robyn-halcyon-sync-0605@robyn.dev',
      title: 'Halcyon Retail - monthly retainer sync',
      start: '2026-06-05T15:00:00Z',
      end: '2026-06-05T15:30:00Z',
      durationHours: 0.5,
      attendees: j([OWNER, attendee('ops@halcyonretail.co.uk', 'Sarah Okoye')]),
      clientId: halcyonId,
      state: 'SENT',
      transcriptId: null,
      skipReason: null,
      matchProposals: null,
      isPersonal: false,
      source: 'ics',
    },
    {
      id: mMarshDay,
      gcalEventId: 'robyn-marsh-advisory-0611@robyn.dev',
      title: 'Marsh & Co - advisory day',
      start: '2026-06-11T09:30:00Z',
      end: '2026-06-11T17:30:00Z',
      durationHours: 8,
      attendees: j([OWNER, attendee('finance@marshandco.co.uk', 'David Marsh')]),
      clientId: marshId,
      state: 'SENT',
      transcriptId: null,
      skipReason: null,
      matchProposals: null,
      isPersonal: false,
      source: 'ics',
    },
    {
      id: mKitchen,
      gcalEventId: 'robyn-fenwick-kitchen-0616@robyn.dev',
      title: 'Fenwick Interiors - kitchen fit-out review',
      start: '2026-06-16T14:00:00Z',
      end: '2026-06-16T15:30:00Z',
      durationHours: 1.5,
      attendees: j([OWNER, attendee('claire@fenwickinteriors.co.uk', 'Claire Fenwick')]),
      clientId: fenwickId,
      state: 'AWAITING_TRANSCRIPT',
      transcriptId: null,
      skipReason: null,
      matchProposals: null,
      isPersonal: false,
      source: 'ics',
    },
    {
      id: mPriya,
      gcalEventId: 'robyn-priya-discovery-0624@robyn.dev',
      title: 'Discovery call - Priya Nair',
      start: '2026-06-24T11:00:00Z',
      end: '2026-06-24T11:45:00Z',
      durationHours: 0.75,
      attendees: j([OWNER, attendee('priya.nair88@gmail.com', 'Priya Nair')]),
      clientId: null,
      state: 'UNKNOWN_ATTENDEE',
      transcriptId: null,
      skipReason: null,
      matchProposals: j([]),
      isPersonal: false,
      source: 'ics',
    },
    {
      id: mSnagging,
      gcalEventId: 'robyn-fenwick-snagging-0627@robyn.dev',
      title: 'Fenwick Interiors - snagging site visit',
      start: '2026-06-27T13:00:00Z',
      end: '2026-06-27T14:00:00Z',
      durationHours: 1,
      attendees: j([OWNER, attendee('claire@fenwickinteriors.co.uk', 'Claire Fenwick')]),
      clientId: fenwickId,
      state: 'INVOICE_PROPOSED',
      transcriptId: trSnagging,
      skipReason: null,
      matchProposals: null,
      isPersonal: false,
      source: 'ics',
    },
  ];

  // --- proposals -----------------------------------------------------------
  const MONTHS = [
    { n: '01', label: 'January', date: '2026-01-05' },
    { n: '02', label: 'February', date: '2026-02-05' },
    { n: '03', label: 'March', date: '2026-03-05' },
    { n: '04', label: 'April', date: '2026-04-05' },
    { n: '05', label: 'May', date: '2026-05-05' },
  ];
  const FEN_HOURS = [8, 6, 10, 7, 12];
  const MARSH_DAYS = [1, 2, 1, 2, 1];

  const proposals: Row[] = [];
  const histProposal = (opts: {
    id: string;
    ref: string;
    clientId: string;
    date: string;
    net: number;
    lines: ProposalLine[];
    autoSent: boolean;
    reasons: string[];
    state?: string;
    meetingId?: string | null;
  }) => {
    const t = withTax(opts.net);
    proposals.push({
      id: opts.id,
      createdAt: `${opts.date}T09:00:00Z`,
      meetingId: opts.meetingId ?? null,
      detectionId: null,
      clientId: opts.clientId,
      lines: j(opts.lines),
      currency: 'GBP',
      subtotal: t.subtotal,
      taxTotal: t.taxTotal,
      total: t.total,
      policyResult: j({ auto: opts.autoSent, reasons: opts.reasons }),
      state: opts.state ?? 'SENT',
      xeroInvoiceId: null,
      xeroInvoiceNumber: null,
      xeroDeepLink: null,
      reference: opts.ref,
      autoSent: opts.autoSent,
    });
  };

  // Halcyon retainer history: Jan..May SENT + auto. June intentionally MISSING
  // (that gap is the RETAINER_STOPPED detection / leak-strip line).
  MONTHS.forEach((m) =>
    histProposal({
      id: randomUUID(),
      ref: `ROBYN-HAL-2026-${m.n}`,
      clientId: halcyonId,
      date: m.date,
      net: 1200,
      autoSent: true,
      reasons: [
        'Autonomy ON for Halcyon Retail Ltd',
        'Contract on file (Clause 3.1)',
        'Exact contact match',
        'Amount within retainer terms',
        'No unreviewed transcript scope',
      ],
      lines: [
        line(`Monthly retainer - ${m.label} 2026`, 1, 1200, [
          { kind: 'CONTRACT_CLAUSE', label: 'Clause 3.1', detail: 'Fixed monthly retainer of GBP 1,200', source_ref: halcyonContractId },
        ]),
      ],
    }),
  );

  // Fenwick hourly history: Jan..May SENT (autonomy OFF, human approved).
  MONTHS.forEach((m, i) => {
    const h = FEN_HOURS[i];
    histProposal({
      id: randomUUID(),
      ref: `ROBYN-FEN-2026-${m.n}`,
      clientId: fenwickId,
      date: m.date,
      net: h * 150,
      autoSent: false,
      reasons: [
        'Autonomy OFF for Fenwick Interiors',
        'Contract on file (Clause 3.1)',
        'Reviewed and approved by operator',
      ],
      lines: [
        line(`Consultancy - ${m.label} 2026 (${h} hours)`, h, 150, [
          { kind: 'CONTRACT_CLAUSE', label: 'Clause 3.1', detail: 'GBP 150 per hour', source_ref: fenwickContractId },
          { kind: 'CALENDAR_BLOCK', label: `${m.label} sessions`, detail: `${h} hours across the month` },
        ]),
      ],
    });
  });

  // Marsh day-rate history: Jan..May SENT (autonomy OFF, inferred profile).
  MONTHS.forEach((m, i) => {
    const d = MARSH_DAYS[i];
    histProposal({
      id: randomUUID(),
      ref: `ROBYN-MAR-2026-${m.n}`,
      clientId: marshId,
      date: m.date,
      net: d * 900,
      autoSent: false,
      reasons: [
        'Autonomy OFF for Marsh & Co',
        'Billing profile inferred from prior invoices',
        'Reviewed and approved by operator',
      ],
      lines: [
        line(`Advisory - ${m.label} 2026 (${d} day${d > 1 ? 's' : ''})`, d, 900, [
          { kind: 'CALENDAR_BLOCK', label: `${m.label} advisory`, detail: `${d} day${d > 1 ? 's' : ''} on site` },
          { kind: 'LEDGER', label: 'Day rate GBP 900', detail: 'Inferred from prior invoices' },
        ]),
      ],
    });
  });

  // June meeting-linked proposals.
  histProposal({
    id: pM3,
    ref: `ROBYN-${mWorkshop.slice(0, 8)}`,
    clientId: fenwickId,
    date: '2026-06-08',
    net: 300,
    autoSent: false,
    state: 'SENT',
    meetingId: mWorkshop,
    reasons: ['Autonomy OFF for Fenwick Interiors', 'Reviewed and approved by operator'],
    lines: [
      line('Design workshop - kitchen layout', 2, 150, [
        { kind: 'CALENDAR_BLOCK', label: 'Mon 8 Jun', detail: '2h design workshop', source_ref: 'robyn-fenwick-workshop-0608@robyn.dev' },
        { kind: 'CONTRACT_CLAUSE', label: 'Clause 3.1', detail: 'GBP 150 per hour', source_ref: fenwickContractId },
        { kind: 'TRANSCRIPT_QUOTE', label: 'Transcript', detail: 'We spent the full two hours mapping the layout.', source_ref: trWorkshop },
      ]),
    ],
  });

  histProposal({
    id: pM4,
    ref: `ROBYN-${mMarshDay.slice(0, 8)}`,
    clientId: marshId,
    date: '2026-06-11',
    net: 900,
    autoSent: false,
    state: 'SENT',
    meetingId: mMarshDay,
    reasons: ['Autonomy OFF for Marsh & Co', 'Reviewed and approved by operator'],
    lines: [
      line('Advisory day - strategy on site', 1, 900, [
        { kind: 'CALENDAR_BLOCK', label: 'Thu 11 Jun', detail: 'Full advisory day', source_ref: 'robyn-marsh-advisory-0611@robyn.dev' },
        { kind: 'LEDGER', label: 'Day rate GBP 900', detail: 'Inferred from prior invoices' },
      ]),
    ],
  });

  // The in-review Fenwick snagging proposal (cold-opens the REVIEW_INVOICE task).
  histProposal({
    id: pM6,
    ref: `ROBYN-${mSnagging.slice(0, 8)}`,
    clientId: fenwickId,
    date: '2026-06-27',
    net: 375, // 1h @150 + 1.5h @150
    autoSent: false,
    state: 'IN_REVIEW',
    meetingId: mSnagging,
    reasons: [
      'Autonomy OFF for Fenwick Interiors',
      'Extra scope caught from transcript needs review',
      'Awaiting human approval',
    ],
    lines: [
      line('Snagging site visit', 1, 150, [
        { kind: 'CALENDAR_BLOCK', label: 'Fri 27 Jun', detail: '1h on site', source_ref: 'robyn-fenwick-snagging-0627@robyn.dev' },
        { kind: 'CONTRACT_CLAUSE', label: 'Clause 3.1', detail: 'GBP 150 per hour', source_ref: fenwickContractId },
      ]),
      line('Extra scope - re-spec kitchen lighting circuit', 1.5, 150, [
        { kind: 'TRANSCRIPT_QUOTE', label: 'Transcript', detail: 'While we are here, can you also redo the lighting spec, it was not in the original brief?', source_ref: trSnagging },
        { kind: 'CONTRACT_CLAUSE', label: 'Clause 3.2', detail: 'Additional scope billable at the same hourly rate', source_ref: fenwickContractId },
      ]),
    ],
  });

  // --- potential client (Priya) -------------------------------------------
  const potentialClients: Row[] = [
    {
      id: priyaId,
      emails: j(['priya.nair88@gmail.com']),
      displayName: 'Priya Nair',
      firstSeenMeetingId: mPriya,
      state: 'QUEUED',
      evidence: null,
      promotedClientId: null,
      lastPolledAt: null,
    },
  ];

  // --- detections (Loop 3) — sum to GBP 2,880 (the leak-strip headline) -----
  const detections: Row[] = [
    {
      id: randomUUID(),
      type: 'QUOTE_NOT_INVOICED',
      clientId: marshId,
      valueGbp: 1200,
      evidence: j({
        summary: 'Accepted quote QU-0042 for Marsh & Co (GBP 1,200) has no invoice raised against it.',
        source: 'seed',
        quote_number: 'QU-0042',
        quote_total: 1200,
        accepted_date: '2026-06-18',
      }),
      state: 'OPEN',
      xeroInvoiceId: null,
      dedupeKey: 'QUOTE_NOT_INVOICED:QU-0042',
    },
    {
      id: randomUUID(),
      type: 'RETAINER_STOPPED',
      clientId: halcyonId,
      valueGbp: 1200,
      evidence: j({
        summary: 'Halcyon Retail monthly retainer (GBP 1,200) has not been invoiced for June 2026.',
        source: 'seed',
        expected_gbp: 1200,
        cadence: 'monthly',
        last_invoiced: '2026-05',
        gap_month: '2026-06',
      }),
      state: 'OPEN',
      xeroInvoiceId: null,
      dedupeKey: 'RETAINER_STOPPED:HALCYON:2026-06',
    },
    {
      id: randomUUID(),
      type: 'EXPENSE_NOT_RECHARGED',
      clientId: fenwickId,
      valueGbp: 480,
      evidence: j({
        summary: 'Billable materials expense (GBP 480) for a Fenwick Interiors site visit was never recharged.',
        source: 'seed',
        expense_ref: 'EXP-0311',
        amount: 480,
        incurred: '2026-06-20',
        description: 'Replacement cabinet handles and materials',
      }),
      state: 'OPEN',
      xeroInvoiceId: null,
      dedupeKey: 'EXPENSE_NOT_RECHARGED:EXP-0311',
    },
  ];

  // --- tasks (the 3 cold-open cards) ---------------------------------------
  const tasks: Row[] = [
    {
      id: randomUUID(),
      type: 'PROVIDE_TRANSCRIPT',
      refType: 'MEETING',
      refId: mKitchen,
      state: 'OPEN',
      title: 'Provide the transcript for Fenwick Interiors kitchen fit-out review',
      summary: 'Robyn found a billable meeting on 16 June with no transcript. Paste it in or tell Robyn to skip it.',
      context: j({
        meetingTitle: 'Fenwick Interiors - kitchen fit-out review',
        clientName: 'Fenwick Interiors',
        start: '2026-06-16T14:00:00Z',
        durationHours: 1.5,
        action: { method: 'POST', path: `/meetings/${mKitchen}/transcript` },
      }),
      resolution: null,
      resolvedAt: null,
      dedupeKey: `PROVIDE_TRANSCRIPT:${mKitchen}`,
    },
    {
      id: randomUUID(),
      type: 'CONFIRM_AGREEMENT',
      refType: 'POTENTIAL_CLIENT',
      refId: priyaId,
      state: 'OPEN',
      title: 'Confirm new client Priya Nair',
      summary: 'Robyn met Priya Nair on a June discovery call and is watching her inbox for a go-ahead. Confirm once she agrees.',
      context: j({
        displayName: 'Priya Nair',
        emails: ['priya.nair88@gmail.com'],
        firstSeenMeeting: 'Discovery call - Priya Nair',
        watching: true,
        action: { method: 'POST', path: `/potential-clients/${priyaId}/confirm` },
      }),
      resolution: null,
      resolvedAt: null,
      dedupeKey: `CONFIRM_AGREEMENT:${priyaId}`,
    },
    {
      id: randomUUID(),
      type: 'REVIEW_INVOICE',
      refType: 'PROPOSAL',
      refId: pM6,
      state: 'OPEN',
      title: 'Review invoice for Fenwick Interiors snagging visit',
      summary: 'Robyn drafted a GBP 450 invoice with an extra-scope line caught from the transcript. Approve or edit the lines.',
      context: j({
        clientName: 'Fenwick Interiors',
        total: 450,
        currency: 'GBP',
        meetingTitle: 'Fenwick Interiors - snagging site visit',
        action: { method: 'POST', path: `/proposals/${pM6}/approve` },
      }),
      resolution: null,
      resolvedAt: null,
      dedupeKey: `REVIEW_INVOICE:${pM6}`,
    },
  ];

  // --- connection states ---------------------------------------------------
  const connectionStates: Row[] = [
    {
      id: randomUUID(),
      kind: 'XERO',
      status: 'DOWN',
      label: 'Xero Custom Connection',
      detail: 'creds pending',
      lastSyncAt: null,
      nextPollAt: null,
    },
    {
      id: randomUUID(),
      kind: 'CALENDAR',
      status: 'FALLBACK',
      label: 'ics: seed/data/calendar.ics',
      detail: 'Reading the seeded .ics calendar (Google OAuth pending).',
      lastSyncAt: nowIso(),
      nextPollAt: null,
    },
    {
      id: randomUUID(),
      kind: 'EMAIL',
      status: 'FALLBACK',
      label: 'fixture mailbox',
      detail: 'Polling the seeded fixture mailbox (IMAP pending). Only queued addresses are read.',
      lastSyncAt: nowIso(),
      nextPollAt: plusMinutes(30),
    },
  ];

  // --- audit events (so the audit screen is not empty) ---------------------
  const auditEvents: Row[] = [
    {
      id: randomUUID(),
      actor: 'SYSTEM',
      action: 'seed.local',
      summary: 'Seeded demo dataset: 3 clients, 2 contracts, 6 June meetings, 18 invoice history rows, 3 detections, 3 open tasks.',
      subjectType: null,
      subjectId: null,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'ROBYN',
      action: 'calendar.sync',
      summary: 'Imported 6 events from the .ics calendar fallback.',
      subjectType: 'ConnectionState',
      subjectId: null,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'ROBYN',
      action: 'meeting.awaiting_transcript',
      summary: 'Raised PROVIDE_TRANSCRIPT: Fenwick Interiors kitchen fit-out review has no transcript.',
      subjectType: 'Meeting',
      subjectId: mKitchen,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'ROBYN',
      action: 'potential_client.queued',
      summary: 'Queued potential client Priya Nair (priya.nair88@gmail.com) from a June discovery call.',
      subjectType: 'PotentialClient',
      subjectId: priyaId,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'ROBYN',
      action: 'invoice.auto_sent',
      summary: 'Auto-sent Halcyon Retail Ltd May retainer (GBP 1,200): autonomy ON, within contract terms.',
      subjectType: 'InvoiceProposal',
      subjectId: null,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'ROBYN',
      action: 'proposal.in_review',
      summary: 'Proposed a GBP 450 invoice for the Fenwick snagging visit with a transcript-sourced extra-scope line. Awaiting review.',
      subjectType: 'InvoiceProposal',
      subjectId: pM6,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'ROBYN',
      action: 'detection.opened',
      summary: 'Opened 3 leaks: unbilled retainer, accepted quote never invoiced, unrecharged expense (GBP 2,880 total).',
      subjectType: 'Detection',
      subjectId: null,
      inputs: null,
    },
    {
      id: randomUUID(),
      actor: 'SYSTEM',
      action: 'connection.state',
      summary: 'Calendar and email running on seeded fallbacks; Xero connection pending credentials.',
      subjectType: 'ConnectionState',
      subjectId: null,
      inputs: null,
    },
  ];

  return {
    ids: { halcyonId, fenwickId, marshId },
    clients,
    contracts,
    transcripts,
    meetings,
    proposals,
    potentialClients,
    detections,
    tasks,
    connectionStates,
    auditEvents,
  };
}

type Seed = ReturnType<typeof buildSeed>;

// ---------------------------------------------------------------------------
// seedLocal — truncate then insert everything (safe to re-run)
// ---------------------------------------------------------------------------
async function seedLocal(db: Queryable, seed: Seed): Promise<void> {
  await truncateLocal(db);

  await insertMany(db, 'clients', ['id', 'xeroContactId', 'name', 'emails', 'autonomyEnabled', 'billingProfile', 'unbilledExposureGbp'], seed.clients);
  await insertMany(db, 'contracts', ['id', 'clientId', 'fileRef', 'title', 'rawText', 'parsed'], seed.contracts);
  await insertMany(db, 'meetings', ['id', 'gcalEventId', 'title', 'start', 'end', 'durationHours', 'attendees', 'clientId', 'state', 'transcriptId', 'skipReason', 'matchProposals', 'isPersonal', 'source'], seed.meetings);
  await insertMany(db, 'transcripts', ['id', 'meetingId', 'rawText', 'source', 'parsed'], seed.transcripts);
  await insertMany(db, 'invoice_proposals', ['id', 'createdAt', 'meetingId', 'detectionId', 'clientId', 'lines', 'currency', 'subtotal', 'taxTotal', 'total', 'policyResult', 'state', 'xeroInvoiceId', 'xeroInvoiceNumber', 'xeroDeepLink', 'reference', 'autoSent'], seed.proposals);
  await insertMany(db, 'potential_clients', ['id', 'emails', 'displayName', 'firstSeenMeetingId', 'state', 'evidence', 'promotedClientId', 'lastPolledAt'], seed.potentialClients);
  await insertMany(db, 'detections', ['id', 'type', 'clientId', 'valueGbp', 'evidence', 'state', 'xeroInvoiceId', 'dedupeKey'], seed.detections);
  await insertMany(db, 'tasks', ['id', 'type', 'refType', 'refId', 'state', 'title', 'summary', 'context', 'resolution', 'resolvedAt', 'dedupeKey'], seed.tasks);
  await insertMany(db, 'connection_states', ['id', 'kind', 'status', 'label', 'detail', 'lastSyncAt', 'nextPollAt'], seed.connectionStates);
  await insertMany(db, 'audit_events', ['id', 'actor', 'action', 'summary', 'subjectType', 'subjectId', 'inputs'], seed.auditEvents);

  console.log('[seedLocal] inserted:');
  console.log(`  clients            ${seed.clients.length}`);
  console.log(`  contracts          ${seed.contracts.length}`);
  console.log(`  meetings           ${seed.meetings.length}`);
  console.log(`  transcripts        ${seed.transcripts.length}`);
  console.log(`  invoice_proposals  ${seed.proposals.length}`);
  console.log(`  potential_clients  ${seed.potentialClients.length}`);
  console.log(`  detections         ${seed.detections.length}`);
  console.log(`  tasks              ${seed.tasks.length}`);
  console.log(`  connection_states  ${seed.connectionStates.length}`);
  console.log(`  audit_events       ${seed.auditEvents.length}`);
}

// ---------------------------------------------------------------------------
// seedXero — mirror the story into the live demo org (idempotent). Only called
// when the health check passed. Backfills xeroContactId + xeroInvoiceId locally.
// ---------------------------------------------------------------------------
async function seedXero(db: Queryable, seed: Seed, orgName: string | null): Promise<void> {
  console.log(`[seedXero] Xero is LIVE (org: ${orgName ?? 'unknown'}). Mirroring the demo story...`);
  const accountCode = await xero.defaultSalesAccountCode().catch(() => '200');

  // 1. Contacts -> backfill clients.xeroContactId
  const nameToClientId = new Map<string, string>();
  for (const c of seed.clients) {
    nameToClientId.set(c.name as string, c.id as string);
  }
  const clientNameToContactId = new Map<string, string>();
  for (const c of seed.clients) {
    const emails = JSON.parse(c.emails as string) as string[];
    try {
      const { contact, created } = await xero.ensureContact(c.name as string, emails[0]);
      clientNameToContactId.set(c.name as string, contact.ContactID);
      await db.query('UPDATE clients SET "xeroContactId" = $1 WHERE id = $2', [contact.ContactID, c.id]);
      console.log(`  contact ${created ? 'created' : 'reused'}: ${c.name} -> ${contact.ContactID}`);
    } catch (e) {
      console.warn(`  contact FAILED for ${c.name}: ${(e as Error).message}`);
    }
  }

  // 2. SENT proposals -> AUTHORISED ACCREC invoices, backfill xeroInvoiceId.
  let invoicesWritten = 0;
  for (const p of seed.proposals) {
    if (p.state !== 'SENT') continue;
    const client = seed.clients.find((c) => c.id === p.clientId);
    if (!client) continue;
    const contactId = clientNameToContactId.get(client.name as string);
    if (!contactId) continue;
    const lines = JSON.parse(p.lines as string) as ProposalLine[];
    const date = (p.createdAt as string).slice(0, 10);
    try {
      const res = await xero.writeInvoice({
        clientName: client.name as string,
        existingContactId: contactId,
        reference: p.reference as string,
        lines: lines.map((l) => ({
          Description: l.description,
          Quantity: l.quantity,
          UnitAmount: l.unit_amount,
          AccountCode: accountCode,
        })),
        currency: 'GBP',
        date,
        dueDate: addDays(date, 14),
        authorise: true,
        decisionNote: `Robyn seed backfill: ${(JSON.parse(p.policyResult as string).reasons as string[]).join('; ')}`,
      });
      await db.query(
        'UPDATE invoice_proposals SET "xeroInvoiceId" = $1, "xeroInvoiceNumber" = $2, "xeroDeepLink" = $3 WHERE id = $4',
        [res.invoiceId, res.invoiceNumber, res.deepLink, p.id],
      );
      invoicesWritten += 1;
    } catch (e) {
      console.warn(`  invoice FAILED for ${p.reference}: ${(e as Error).message}`);
    }
  }
  console.log(`  AUTHORISED ACCREC invoices written/reused: ${invoicesWritten}`);

  // 3. One ACCEPTED quote for Marsh (the QUOTE_NOT_INVOICED detection), unlinked.
  const marshContact = clientNameToContactId.get('Marsh & Co');
  if (marshContact) {
    try {
      await xeroFetch('/Quotes', {
        method: 'POST',
        json: {
          Quotes: [
            {
              Contact: { ContactID: marshContact },
              Date: '2026-06-18',
              Status: 'ACCEPTED',
              Reference: 'QU-0042',
              LineAmountTypes: 'Exclusive',
              LineItems: [
                { Description: 'Brand and web project - scoped engagement', Quantity: 1, UnitAmount: 1200, AccountCode: accountCode },
              ],
            },
          ],
        },
        query: { summarizeErrors: 'false' },
      });
      console.log('  accepted quote QU-0042 created/reused for Marsh & Co (GBP 1,200).');
    } catch (e) {
      console.warn(`  quote QU-0042 FAILED: ${(e as Error).message}`);
    }
  }

  // 4. Halcyon payment cadence: pay the Jan..May retainers so listPayments shows
  //    a monthly rhythm with a June gap. Needs a bank/payments-enabled account.
  try {
    const accounts = await xero.listAccounts();
    const bank = accounts.find((a) => a.Type === 'BANK' || a.EnablePaymentsToAccount);
    if (bank) {
      let paid = 0;
      for (const p of seed.proposals) {
        if (!(p.autoSent === true && p.state === 'SENT')) continue; // Halcyon retainers
        const inv = await xero.findInvoiceByReference(p.reference as string).catch(() => null);
        if (!inv?.InvoiceID) continue;
        const date = (p.createdAt as string).slice(0, 10);
        try {
          await xero.createPayment({
            invoiceId: inv.InvoiceID,
            accountCode: bank.Code,
            amount: Number(p.total),
            date,
            reference: `PAY-${p.reference}`,
          });
          paid += 1;
        } catch {
          /* payment is best-effort cadence data */
        }
      }
      console.log(`  Halcyon retainer payments recorded: ${paid} (June deliberately unpaid = the gap).`);
    } else {
      console.log('  no bank/payments-enabled account found; skipping Halcyon payment cadence.');
    }
  } catch (e) {
    console.warn(`  payment cadence step skipped: ${(e as Error).message}`);
  }

  console.log('[seedXero] done.');
}

function printXeroPlan(seed: Seed, reason: string | null): void {
  const sent = seed.proposals.filter((p) => p.state === 'SENT');
  console.log('[seedXero] Xero is NOT live — skipping writes. Reason:');
  console.log(`  ${reason ?? 'health check failed'}`);
  console.log('[seedXero] Once creds land, this run will:');
  console.log(`  - ensureContact ${seed.clients.length} clients: ${seed.clients.map((c) => c.name).join(', ')}`);
  console.log(`  - create ${sent.length} AUTHORISED ACCREC invoices (references ${sent.map((p) => p.reference).slice(0, 3).join(', ')} ... )`);
  console.log('  - create 1 ACCEPTED quote QU-0042 for Marsh & Co (GBP 1,200), unlinked');
  console.log('  - record Halcyon retainer payments Jan..May 2026 (June left unpaid = the lapsed-retainer gap)');
  console.log('  - backfill clients.xeroContactId and invoice_proposals.xeroInvoiceId locally');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('MissingEnv: DATABASE_URL is empty — set it in api/.env.');
  }

  const db = new Client({ connectionString });
  await db.connect();

  try {
    const seed = buildSeed();
    await seedLocal(db, seed);

    // Only touch Xero if a health check succeeds.
    const health = await xeroHealthCheck();
    if (health.ok) {
      await seedXero(db, seed, health.orgName);
      // reflect live status on the XERO connection row
      await db.query(
        'UPDATE connection_states SET status = $1, label = $2, detail = $3, "lastSyncAt" = now() WHERE kind = $4',
        ['LIVE', health.orgName ?? 'Xero organisation', `Custom Connection healthy (scope: ${health.scope ?? 'accounting'})`, 'XERO'],
      );
    } else {
      printXeroPlan(seed, health.reason);
    }

    console.log('\n[seed] complete. Re-run any time with:  pnpm --filter robyn-api seed');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});

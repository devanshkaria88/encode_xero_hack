# Encode x Xero Hackathon — CONTEXT (FINAL v3 — ROBYN)

The agent is **Robyn** (as in Batman's Robin): the sidekick that turns a freelancer's calendar, inbox, contracts and transcripts into invoices in Xero. Read this, then `architecture.md`. `prompt.md` bootstraps the Xero skills.

## Event facts

- Encode Hub x Xero, London. Build deadline Sunday July 5. 3-minute live pitch, in person.
- Judges: Xero DevRel/product (Regan Ashworth — Agentic Toolkit owner, Annie Terry, Sharon Ball). They know JAX, Xero Projects, MinuteDock and the App Store.
- Track 3 — The Cash Flow Accelerator. Rubric: 50% real problem + strong Xero use, 30% Accounting/Payments API use, 20% production-ready architecture.

## The product — Robyn's three rules

1. **Every work block gets accounted for.** Robyn watches the calendar. Meeting without a transcript → task raised: provide it or tell Robyn to skip. Transcript in → client looked up in Xero → contract + transcript reviewed together → Robyn decides if and how it should be invoiced (rate cited from the contract, scope from the transcript) → invoice proposal lands in review.
2. **Unknown people become pipeline.** Attendee not in Xero contacts → potential-client queue. Robyn checks email every 30 minutes, ONLY messages from queued addresses. An email indicating agreement → Robyn promotes: creates the Xero contact, files the contract against it, and rule 1 now applies to that client. This runs over days; Robyn is patient.
3. **Ambiguity goes to the human.** Everything Robyn can't decide becomes a ticket in the Tasks section of the dashboard, resolvable in place: missing transcript, fuzzy client match, invoice review, agreement confirmation.

**Autonomy policy:** per-client toggle, default OFF (everything reviews per rule 1/3). Toggled ON for a trusted client (contract on file + exact match + within terms), Robyn sends without asking. Demo shows exactly one auto-send to keep the reps' "zero-touch" pitch alive.

One-liner:
> "Time trackers capture the future. Nobody audits the past. Robyn reads the calendar you already keep, the contracts you already signed, and the invoices you already sent — and turns the gap into money in Xero."

## Persona

Devansh as himself: freelance consultant, several clients, bills by time, never logged a timesheet. Founder-as-user on stage.

## Validated pain (cite in pitch)

- 42% of companies report revenue leakage; typically 1–5% of revenue (MGI). Services firms bill only ~90–95% of delivered hours (SPI Research).
- UK trades, July 2026 (Simply Business, n=408): 92% asked for extra work beyond the booking, ~1.8 hrs/week uncharged, ~£2,600/yr, 34% never paid for extras → the transcript beat.
- Scoped claim only: Robyn recovers the *detectable* slice (evidence exists in calendar/transcripts/quotes/ledger).

## Positioning counters (rehearse verbatim)

- MinuteDock/Xero Projects (field-tested on Xero reps July 4, it landed): "They work if you log time. Our user is the person who didn't — which is exactly the person leaking. Prospective capture vs retroactive audit." Reps' framing to reuse: auto-onboard from calls and emails, auto-detect billable minutes, invoice without manual effort.
- JAX: "JAX answers questions about your books. Robyn puts money back in them. Dashboard-first, the agent is the engine, not the interface."
- Pricing advice: only as a nudge on a real draft, never a module.

## Demo script (3 min, build backwards from this)

1. **Open on the Tasks inbox (20s):** Robyn has been running. Three tickets waiting: a meeting missing its transcript, an agreement email awaiting confirmation, an invoice in review. "This is my back office now."
2. **Rule 1 live (70s):** open the transcript task → paste the Granola transcript → Robyn matches the client, pulls the contract, proposes the invoice: hours from the calendar block, rate cited from clause 3, extra scope caught from the transcript with the verbatim quote. Approve → invoice in Xero, evidence note + attachment on it.
3. **Rule 2 live (50s):** the potential-clients queue: an unknown attendee from Tuesday's call. Robyn's 30-min email check found "let's go ahead" from them → tap confirm → contact created in Xero, contract filed. New client onboarded from a calendar event and an email, zero forms.
4. **Auto-send + close (40s):** the retainer client with autonomy ON: this month's invoice went out on its own, shown inside Xero. Leak strip: "June: £2,880 was walking away." Rubric map, done.

## Scope decisions (closed)

- Web only, dashboard-first with Tasks inbox. NOT chat-first.
- One calendar (owner's). Email monitoring reads ONLY queued potential-client addresses — say this on stage, it's the privacy answer.
- IMAP polling on the demo mailbox (no Gmail OAuth verification risk). 30-min cron + "check now" button for the demo.
- Accept transcripts, never build transcription. Missing transcript is a task state, not a feature.
- Cash-flow prediction, services analytics: CUT. WhatsApp: stretch after G6. No quote-app UI anywhere.
- Contact auto-creation on confirmed agreement is allowed (low-risk write, audited); invoices follow rule 1 review unless the client's autonomy toggle is ON.

## Sponsor visibility

Xero MCP + raw Accounting API + Payments named on the architecture slide.

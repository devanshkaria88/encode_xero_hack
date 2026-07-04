# Encode x Xero Hackathon — CONTEXT

Read this first. This is the why. `architecture.md` is the how. `prompt.md` bootstraps the Xero skills.

## Event facts

- Encode Hub x Xero, London. Build deadline Sunday July 5. 3-minute live pitch to judges, in person.
- Judges are Xero DevRel/product people (Regan Ashworth owns the Agentic Toolkit, Annie Terry, Sharon Ball). They know JAX, the App Store, and every incumbent. Do not pitch anything JAX or ApprovalMax already does without naming the difference first.
- £3,000 per track. Target track: **The Vibe Integrator** (Track 2) — "agent monitors a second app and intelligently syncs the bones of the data into Xero."

## Judging rubric (drives every decision)

| Weight | Criterion | Our answer |
|---|---|---|
| 50% | Xero Connection: real problem + strong use of Xero | "Can I pay this?" — the one question every AP process exists to answer. Xero is both the source of truth and the write target. |
| 30% | API Integration: effective use of Accounting/Payments APIs | Bills + aged payables via MCP tools, Purchase Orders via raw Accounting API (not in MCP — shows range), evidence archived via Attachments API, approved bills get real Payments created. Reads and writes, both APIs. |
| 20% | Architecture: reliable, production-ready design | Deterministic match engine in Postgres. LLM only at the edges (document parsing, validated JSON out, clamped). Full audit trail per decision. OpenAPI contract between apps. |

## The product

**Payables control agent.** For every bill that lands in Xero (or in the inbox), it assembles the three-way match — purchase order, goods receipt, invoice — from wherever the evidence already lives: Gmail/Outlook, Google Sheets, Drive. Complete match: auto-approve, create the payment in Xero, archive the evidence, log the trail. Broken match: WhatsApp the owner with exactly what's missing and buttons to act (chase supplier / confirm received / hold).

One-liner (locked, use verbatim in the pitch):
> "Every business asks one question before paying a bill: did we actually order this, and did it actually arrive? We built the agent that answers it from the mess you already have, and only texts you when the answer is no."

## Why this wins (the arguments, rehearsed)

- **vs ApprovalMax / Zahara / Lightyear / ProcureDesk** (judges WILL ask): they sell a workflow the whole company must adopt — POs raised in their app, deliveries receipted in their app, £118–220/mo. We sell the answer to AP's only question and need read access, not behaviour change. Their architecture is the rigid if-this-then-that thing Track 2 exists to replace.
- **vs JAX**: JAX lives inside one Xero org and won't decide what's safe to pay (liability asymmetry — Xero captures no upside from the call and all the blame). We assemble evidence from outside Xero and take a position, with the audit trail to back it.
- **vs "ChatGPT could do this"**: opinions are free, accountability is the product. Deterministic matching, evidence chain, approval controls, write-back.

## Human story (pitch opening)

The site manager never logs into anything. The PO is an email thread. The delivery proof is a photo of a signed note on someone's phone. The invoice is a PDF in a shared inbox. Every incumbent's answer is "make all these people use our app." Ours is "leave everyone alone, we'll read what's already there."

## Demo script (3 min, build backwards from this)

1. Dashboard: bills in Xero, most already green (matched, auto-approved, payment created) — the product is the silence. ~30s
2. Live: supplier invoice email arrives (Make catches it, or direct IMAP fallback). Agent parses PDF, finds the PO in the sheet, finds NO goods receipt. Bill goes amber with the gap named. ~45s
3. Judge's/our phone buzzes on WhatsApp: "Bill from Thameside Timber, £4,200 — no delivery confirmation. Chase / Confirm / Hold." Tap chase. Agent emails the site contact. ~45s
4. Reply sent live from a phone with a delivery-note photo. Agent reads it, closes the match, bill flips green in OUR ui, then show the approved bill + payment + attached evidence INSIDE Xero. ~45s
5. Close on rubric mapping + the ApprovalMax line. ~15s

## Scope cuts (already decided, do not reopen)

- No multi-org, no accountant view. One demo org.
- No quotes anywhere in the demo (Xero's own Lovable example is a quote system; judges are numb to it).
- No user management, no settings pages. One hardcoded business.
- WhatsApp via Twilio sandbox, built LAST. Numbered-reply fallback if buttons misbehave.
- Make.com is plumbing only (OAuth + email trigger + webhook to us). Zero business logic in Make. Direct IMAP poll on the demo mailbox as the stage fallback if Make's trigger latency can't be made instant.
- Seed the demo Xero org tonight: ~15 bills, matching POs for most, deliberate gaps for the demo path. Data must tell a story (real supplier names, plausible amounts).

## Sponsor visibility (free points)

Make (workshop sponsor) used visibly as the connector layer. Lovable/Replit not used — fine. Xero MCP + raw API + Attachments + Payments named explicitly on the architecture slide.

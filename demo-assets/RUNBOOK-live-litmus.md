# Live litmus run sheet

Everything in order, top to bottom. Two live scenarios:

- **Scenario A (zero-click invoice):** existing client CivicPulse-DevanshKaria (kariadevansh08@gmail.com) has autonomy ON and a contract on file. A real calendar meeting syncs in, you paste the transcript, Robyn spots 15 minutes of uninvoiced repo review, prices it from the contract and sends the invoice through Xero with no clicks.
- **Scenario B (auto-onboard):** new prospect Northbeam-DKaria (devansh8801@gmail.com) appears in a meeting, then emails a signed agreement PDF. Robyn reads the inbox, parses the PDF and onboards them on its own.

All commands run from the repo root. The API must already be running (`pnpm dev:api`).

---

## Step 0. One-time switches (do these first)

1. **Enable the Gmail API** for the Google Cloud project. One click on Enable here:

   https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=136424631749

   Without this Robyn cannot read the inbox and Scenario B will not fire.

2. **Check OWNER_EMAILS** in `api/.env` contains your own address, so Robyn knows which meeting attendee is you and not a prospect:

   ```
   OWNER_EMAILS=devansh88karia@gmail.com
   ```

   If you have to add it, restart the API afterwards (the value is read at boot). If it is missing, the Northbeam meeting will queue YOU as a potential client alongside the real prospect.

## Step 1. Drain the database

Preview first if you want (changes nothing):

```
pnpm drain:live --dry-run
```

Then the real drain:

```
pnpm drain:live
```

This wipes all clients, meetings, proposals, detections, tasks and audit rows, but keeps your Google connection and agent settings. It also clears the calendar sync watermark so the next sync is a fresh full sync under the live window. Xero is not touched.

## Step 2. Set up Scenario A

```
pnpm setup:live
```

This creates the CivicPulse-DevanshKaria client (autonomy ON), files the Technical Advisory Agreement through the running API (real LLM clause parse) and tries to create the matching Xero contact. If Xero is rate limited you will see "Xero contact deferred" - that is fine, the invoice write creates the contact later. The script is safe to re-run.

Check the printed checklist: client id, contract id, clause count, billing profile, Xero contact.

## Step 3. Add the two calendar events

In Google Calendar on **devansh88karia@gmail.com** (the connected account), create two events **within the last 24 hours**. Past events are fine and are what you want. The attendees do not need to accept.

| Event | Title | Guest | Length | Example time (adjust to earlier today) |
|---|---|---|---|---|
| A | CivicPulse advisory call | kariadevansh08@gmail.com | 30 minutes | today 10:00 to 10:30 |
| B | Northbeam intro call | devansh8801@gmail.com | 30 minutes | today 11:30 to 12:00 |

Keep both events at least 15 minutes in the past when the sync runs.

## Step 4. Sync the calendar

Either wait for the cron (calendar sync runs at :00, :15, :30, :45 past the hour; the Google sync at :05, :20, :35, :50), or trigger it now:

```
curl -X POST http://localhost:3000/api/google/sync
curl -X POST http://localhost:3000/api/meetings/sync
```

Expected on the dashboard:

- The CivicPulse meeting matches the client by attendee email and waits for a transcript (a "Provide the transcript" task appears).
- The Northbeam meeting has an unknown attendee, so Robyn queues devansh8801@gmail.com as a potential client and starts watching that sender.

## Step 5. Scenario A: paste the CivicPulse transcript

Open the "Provide the transcript" task for the CivicPulse advisory call and paste this:

```
Devansh: Morning Arjun, how did the council pilot go this week?
Arjun: Good news, three more boroughs signed up. The dashboard held up fine.
Devansh: Great. Before we dig in, I went through the consultation-flow pull request you sent over after our last call. Took me about fifteen minutes to review it properly.
Arjun: Brilliant, I was hoping you would get to that. Did the queue change look right?
Devansh: Mostly. The retry logic is fine but you are swallowing the webhook errors, I left comments on the diff. That review never made it onto an invoice, by the way.
Arjun: Noted, add it to this week. So the main thing today is the reporting module.
Devansh: Right. For reporting I would keep the aggregation in Postgres and skip the warehouse for now.
Arjun: That matches what we hoped. And the resident notification piece?
Devansh: Batch it nightly, do not stream it. You will save yourselves a whole service.
Arjun: Understood. Anything you need from us before next week?
Devansh: Send me the schema for the reporting tables once it is sketched. I will look at it on our next call rather than offline.
Arjun: Will do. Thanks Devansh, speak next week.
```

The one billable extra in there: a 15 minute code review of their pull request, done after the last call and never invoiced.

Watch what happens, with zero further clicks:

- Robyn prices the 15 minutes as one 30 minute minimum block at 50 pounds per hour (25 pounds), citing Clause 3 of the agreement, on top of the meeting time itself.
- Autonomy is ON and the client matched exactly, so the invoice goes straight to Xero as AUTHORISED, and the invoice email goes to kariadevansh08@gmail.com.
- Open the audit trail: match, parse, policy decision and Xero write are all on the record.

If Xero is still rate limited the proposal drops to review with a task instead. Approve it once the Xero window resets; nothing is lost.

One known wrinkle on the email step: the Demo Company org has returned a Xero-side 500 on the invoice email endpoint even with everything valid (AUTHORISED invoice, contact with an email address, correct request). The invoice itself is safely AUTHORISED either way, the failure is audited as xero.invoice.email_failed, and Robyn retries the email on its sync cycle (at most once per 45 minutes per invoice) until it lands. If it keeps failing on demo day, the honest audit trail IS the story, and the email can be sent from the Xero UI in one click.

## Step 6. Scenario B: paste the Northbeam transcript

Open the Northbeam intro call meeting (it is the one with the unknown attendee) and paste this transcript:

```
Devansh: Hi Maya, thanks for making the time. Tell me where Northbeam is at.
Maya: We are a logistics analytics platform, about eight people. Freight brokers use us to track carrier performance.
Devansh: And the engineering side, what does the stack look like?
Maya: Node and Postgres, one big service. It is creaking. Ingest volume has doubled since March.
Devansh: What breaks first, the ingest pipeline or the query side?
Maya: Queries. Carrier scorecards take thirty seconds to load for the bigger brokers.
Devansh: That is usually aggregation done at read time. There are much cheaper fixes than a rewrite.
Maya: That is exactly the kind of judgement we are missing in the team.
Devansh: The way I work is weekly advisory sessions, plus code review between calls when you need it. I will send the agreement over after this.
Maya: Sounds right. If the terms look fine I will sign it and send it back this week.
Devansh: Perfect. Once that is in place we can set up a standing weekly slot.
Maya: Great, speak soon.
```

No invoice comes out of this one. It is a discovery call with a prospect, and Robyn is now watching devansh8801@gmail.com for a go-ahead.

## Step 7. Send the signed agreement from the prospect

From **devansh8801@gmail.com**, send an email to **devansh88karia@gmail.com**:

- **Attachment:** `demo-assets/Northbeam-DKaria-Technical-Advisory-Agreement.pdf`
- **Subject (verbatim):**

  ```
  Signed advisory agreement - Northbeam
  ```

- **Body (verbatim):**

  ```
  Hi Devansh,

  Good speaking with you earlier. The terms all look right to us, so I have attached the signed advisory agreement.

  We are happy to go ahead from this week. Send over the invite for the standing weekly slot when you are ready.

  Best,
  Maya
  Northbeam
  ```

## Step 8. Watch the auto-onboard

Wait for the next poll, or trigger it:

```
curl -X POST http://localhost:3000/api/google/sync
curl -X POST http://localhost:3000/api/email/poll
```

Expected:

- Robyn reads the new email (it only reads senders it is already watching), detects the agreement, and pulls the attached PDF.
- The agreement is parsed into clauses, Northbeam-DKaria becomes a real client with the contract on file, and a Xero contact is created.
- Everything shows in the audit trail with the quoted evidence line from the email.

## If something stalls

- **No meetings after sync:** check the events are on the devansh88karia@gmail.com calendar, in the past 24 hours, with the guest added. Then re-run the sync curls.
- **Gmail poll finds nothing:** confirm Step 0.1 (Gmail API enabled) and that the email landed in the inbox, not spam. The sender must be devansh8801@gmail.com exactly, because Robyn only reads watched senders.
- **Xero writes failing:** the daily API budget may still be cooling down. Contacts and invoices are all idempotent, so re-running or approving the review task later completes cleanly with no duplicates.
- **Need a clean slate mid-rehearsal:** run `pnpm drain:live` then `pnpm setup:live` again. Both are re-runnable. Calendar events can stay, the fresh sync picks them up again.

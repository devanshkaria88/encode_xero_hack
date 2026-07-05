import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { loadConfig } from '../../config/env';
import {
  TranscriptParsedSchema,
  TranscriptParsedLLM,
  ContractParsedSchema,
  ContractParsedLLM,
  AgreementClassificationSchema,
  AgreementClassificationLLM,
  AgreementPdfParsedSchema,
  AgreementPdfParsedLLM,
  MatchProposalsSchema,
  MatchProposalsLLM,
} from './schemas';

// The LLM edge. Parses documents into strict JSON and PROPOSES fuzzy matches.
// It never decides billed/unbilled and never sends. Every output is zod-validated
// here; malformed output is retried once, then surfaced as an error the caller
// turns into a Task (never a silent guess).
const MODEL = 'claude-sonnet-5';

@Injectable()
export class LlmService {
  private readonly log = new Logger('LlmService');
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: loadConfig().anthropicApiKey });
  }

  private extractJson(text: string): unknown {
    // Tolerate ```json fences or prose around the object.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('LLM returned no JSON object');
    return JSON.parse(raw.slice(start, end + 1));
  }

  private async complete<S extends z.ZodTypeAny>(
    system: string,
    user: string,
    schema: S,
    maxTokens = 2000,
  ): Promise<z.infer<S>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? user
                : `${user}\n\nYour previous reply was not valid JSON for the schema. Reply with ONLY the JSON object, no prose, no code fences.`,
          },
        ],
      });
      const block = res.content.find((c) => c.type === 'text');
      const text = block && block.type === 'text' ? block.text : '';
      try {
        return schema.parse(this.extractJson(text));
      } catch (e) {
        lastErr = e;
        this.log.warn(`LLM output failed validation (attempt ${attempt + 1}): ${String(e).slice(0, 200)}`);
      }
    }
    throw new Error(`LLM output invalid after retry: ${String(lastErr).slice(0, 300)}`);
  }

  // Same parse/retry contract as complete(), but the user turn carries a PDF
  // document block alongside the instruction text.
  private async completeWithPdf<S extends z.ZodTypeAny>(
    system: string,
    user: string,
    pdf: Buffer,
    schema: S,
    maxTokens = 2000,
  ): Promise<z.infer<S>> {
    const document: Anthropic.DocumentBlockParam = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdf.toString('base64'),
      },
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: 'user',
            content: [
              document,
              {
                type: 'text',
                text:
                  attempt === 0
                    ? user
                    : `${user}\n\nYour previous reply was not valid JSON for the schema. Reply with ONLY the JSON object, no prose, no code fences.`,
              },
            ],
          },
        ],
      });
      const block = res.content.find((c) => c.type === 'text');
      const text = block && block.type === 'text' ? block.text : '';
      try {
        return schema.parse(this.extractJson(text));
      } catch (e) {
        lastErr = e;
        this.log.warn(`LLM PDF output failed validation (attempt ${attempt + 1}): ${String(e).slice(0, 200)}`);
      }
    }
    throw new Error(`LLM output invalid after retry: ${String(lastErr).slice(0, 300)}`);
  }

  // --- Agreement PDF -> onboarding facts ------------------------------------
  // Parses a PDF a prospective client emailed. isAgreement gates the
  // auto-onboard transition downstream; rawText feeds the SAME contract
  // pipeline the manual paste flow uses. Parse only — the email module
  // decides what to do with the result.
  async parseAgreementPdf(pdf: Buffer, filename: string): Promise<AgreementPdfParsedLLM> {
    const system =
      'You read a PDF that a prospective client emailed to a freelancer. Decide whether it is an ' +
      'AGREEMENT: a contract, engagement letter, advisory/consulting agreement, or statement of work ' +
      'that commits the client to an engagement. A brochure, invoice, receipt or generic attachment is ' +
      'NOT an agreement. Return strict JSON. contactName is the client/company name exactly as written ' +
      'in the document (the counterparty, not the freelancer); null if none is stated. rawText is the ' +
      'FULL text of the document extracted verbatim, preserving clause numbering — it feeds the contract ' +
      'parser downstream. summary is one or two plain sentences. Never invent text that is not in the PDF.';
    const user =
      `Attachment filename: ${filename.slice(0, 200)}\n\n` +
      'Return JSON: {"isAgreement": boolean, "contactName": string|null, "rawText": string, "summary": string}';
    return this.completeWithPdf(system, user, pdf, AgreementPdfParsedSchema, 8000);
  }

  // --- Transcript -> scope items + action points ----------------------------
  async parseTranscript(rawText: string): Promise<TranscriptParsedLLM> {
    const system =
      'You extract EXTRA billable scope from a freelancer consulting-meeting transcript. ' +
      'The meeting time itself is ALREADY billed separately from the calendar (do not re-bill it). ' +
      'So a scope_item is billable=true ONLY when it is ADDITIONAL work agreed BEYOND the meeting: ' +
      'a new deliverable, an out-of-scope request ("can you also…"), or follow-up work promised on ' +
      'the call. Anything that was simply discussed or reviewed DURING the meeting is covered by the ' +
      'meeting time — mark it billable=false. For every scope_item, evidence_quote MUST be the VERBATIM ' +
      'transcript line that agrees the extra work. Estimate est_hours conservatively. Never invent quotes. ' +
      'Return strict JSON. It is correct and common for scope_items to be empty.';
    const user =
      'Transcript:\n"""\n' +
      rawText.slice(0, 45000) +
      '\n"""\n\nReturn JSON: {"summary": string|null, "action_points": string[], ' +
      '"scope_items": [{"description": string, "est_hours": number, "evidence_quote": string, "billable": boolean}]}. ' +
      'Only extra work agreed BEYOND the meeting is billable=true.';
    return this.complete(system, user, TranscriptParsedSchema, 2500);
  }

  // --- Contract -> rate/terms/clauses with citations ------------------------
  async parseContract(rawText: string): Promise<ContractParsedLLM> {
    const system =
      'You extract billing terms from a consulting contract. Return strict JSON. ' +
      'Cite each clause by its reference (e.g. "Clause 3.1") and quote its verbatim text. ' +
      'rate_unit is HOUR, DAY or FIXED. currency is an ISO code. If a value is absent, use null.';
    const user =
      'Contract:\n"""\n' +
      rawText.slice(0, 45000) +
      '\n"""\n\nReturn JSON: {"rate": number|null, "rate_unit": "HOUR"|"DAY"|"FIXED"|null, ' +
      '"currency": string, "payment_terms": string|null, "scope_summary": string|null, ' +
      '"clauses": [{"ref": string, "text": string}]}';
    return this.complete(system, user, ContractParsedSchema, 2500);
  }

  // --- Email -> agreement classification (ONLY queued addresses) ------------
  async classifyAgreement(
    from: string,
    subject: string,
    body: string,
  ): Promise<AgreementClassificationLLM> {
    const system =
      'You decide whether an email from a prospective client indicates they AGREE to ' +
      'proceed with an engagement (e.g. "let\'s go ahead", "happy to proceed", "send the ' +
      'contract"). Return strict JSON. If agreement is true, evidence_quote MUST be a ' +
      'verbatim sentence from the email. If false, evidence_quote is an empty string. ' +
      'Be conservative: pleasantries or "let me think" are NOT agreement.';
    const user =
      `From: ${from}\nSubject: ${subject}\n\nBody:\n"""\n${body.slice(0, 8000)}\n"""\n\n` +
      'Return JSON: {"agreement": boolean, "evidence_quote": string, "reasoning": string}';
    return this.complete(system, user, AgreementClassificationSchema, 800);
  }

  // --- Fuzzy client-match PROPOSALS (never decisions) -----------------------
  async proposeClientMatches(
    attendees: { email: string; name?: string }[],
    clients: { id: string; name: string; emails: string[] }[],
  ): Promise<MatchProposalsLLM> {
    const system =
      'You PROPOSE which known client a meeting\'s attendees might belong to, when there is ' +
      'no exact email match (e.g. a personal Gmail whose display name matches a client contact). ' +
      'Return strict JSON with a confidence 0..1 and a reason. Propose only plausible matches; ' +
      'an empty list is correct when nothing is plausible. You never decide — a human confirms.';
    const user =
      `Attendees: ${JSON.stringify(attendees)}\n\nKnown clients: ${JSON.stringify(clients)}\n\n` +
      'Return JSON: {"proposals": [{"client_id": string, "client_name": string, "confidence": number, "reason": string}]}';
    return this.complete(system, user, MatchProposalsSchema, 1200);
  }

  async health(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: MODEL,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
      return true;
    } catch (e) {
      this.log.warn(`Anthropic health check failed: ${String(e).slice(0, 160)}`);
      return false;
    }
  }
}

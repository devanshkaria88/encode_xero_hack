// .claude/skills/xero-accounting-api/scripts/attachments.ts
//
// Attachments — NOT in the Xero MCP server; raw Accounting API only.
// Upload = raw file bytes PUT/POST to /{Endpoint}/{Guid}/Attachments/{Filename}
// (NOT JSON). Content-Type must be the file's MIME type. 10 attachments per
// document, 10MB per file (documented cap on the Attachments page).

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { xeroFetch } from "./xero-fetch";

/** Filenames containing any of < > : " / \ | ? * NUL + are rejected as Bad Request. */
const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000+]/;

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachmentParent = "Invoices" | "PurchaseOrders" | "Contacts";

export interface Attachment {
  AttachmentID: string;
  FileName: string;
  Url: string;
  MimeType: string;
  ContentLength: number;
  IncludeOnline?: boolean;
}

export interface AttachmentsResponse {
  Attachments: Attachment[];
}

/**
 * Docs rule: filename characters "should not be encoded unless they're
 * brackets. Brackets must be encoded in order for the call to go through."
 */
function encodeAttachmentFileName(fileName: string): string {
  return fileName
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\[/g, "%5B")
    .replace(/\]/g, "%5D");
}

export async function uploadAttachment(options: {
  endpoint: AttachmentParent;
  guid: string; // e.g. the InvoiceID of the bill the evidence belongs to
  filePath: string;
  mimeType: string; // e.g. "application/pdf", "image/png"
  fileName?: string; // defaults to basename(filePath)
  /**
   * IncludeOnline=true shows the attachment on the online invoice. Xero
   * supports this for accounts RECEIVABLE invoices and AR credit notes only —
   * it does not apply to ACCPAY bills.
   */
  includeOnline?: boolean;
}): Promise<Attachment> {
  const fileName = options.fileName ?? basename(options.filePath);
  if (FORBIDDEN_FILENAME_CHARS.test(fileName)) {
    throw new Error(
      `BadFileName: "${fileName}" contains a character Xero rejects as Bad Request ` +
        String.raw`(< > : " / \ | ? * NUL +)`,
    );
  }

  const bytes = readFileSync(options.filePath);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `AttachmentTooLarge: ${bytes.byteLength} bytes — the Attachments page caps files at 10MB ` +
        `(max 10 attachments per document)`,
    );
  }

  // PUT and POST are identical here; uploading the same filename onto the
  // same document OVERWRITES the existing attachment.
  const res = await xeroFetch<AttachmentsResponse>(
    `/${options.endpoint}/${options.guid}/Attachments/${encodeAttachmentFileName(fileName)}`,
    {
      method: "PUT",
      body: new Uint8Array(bytes),
      contentType: options.mimeType,
      query: options.includeOnline ? { IncludeOnline: true } : undefined,
    },
  );
  const attachment = res.Attachments[0];
  if (!attachment) throw new Error("XeroEmptyResponse: upload returned no Attachments element");
  return attachment;
}

export async function listAttachments(
  endpoint: AttachmentParent,
  guid: string,
): Promise<Attachment[]> {
  const res = await xeroFetch<AttachmentsResponse>(`/${endpoint}/${guid}/Attachments/`);
  return res.Attachments;
}

// ---------------------------------------------------------------------------
// Demo entrypoint:
//   npx tsx attachments.ts <InvoiceID> <filePath> <mimeType>
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [guid, filePath, mimeType] = process.argv.slice(2);
  if (!guid || !filePath || !mimeType) {
    throw new Error("Usage: npx tsx attachments.ts <InvoiceID> <filePath> <mimeType>");
  }
  const uploaded = await uploadAttachment({ endpoint: "Invoices", guid, filePath, mimeType });
  console.log(`Uploaded ${uploaded.FileName} (${uploaded.ContentLength} bytes)`);
  const all = await listAttachments("Invoices", guid);
  console.log(`Document now has ${all.length}/10 attachments`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

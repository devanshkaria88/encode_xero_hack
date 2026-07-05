import { collectPdfAttachmentParts } from './google-client.service';

// The MIME walk that decides which Gmail parts get downloaded. Pinned here:
// only real attachments (body.attachmentId) that look like PDFs, size-capped
// BEFORE download, max 3 per message, found at any nesting depth.

function pdfPart(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filename: 'agreement.pdf',
    mimeType: 'application/pdf',
    body: { attachmentId: 'att-1', size: 120_000 },
    ...over,
  };
}

describe('collectPdfAttachmentParts', () => {
  it('collects a PDF nested inside multipart/alternative + multipart/mixed', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: 'aGk=', size: 2 } },
            { mimeType: 'text/html', body: { data: 'aGk=', size: 2 } },
          ],
        },
        pdfPart({ body: { attachmentId: 'deep-att', size: 5000 } }),
      ],
    };
    const parts = collectPdfAttachmentParts(payload);
    expect(parts).toEqual([
      {
        filename: 'agreement.pdf',
        mimeType: 'application/pdf',
        attachmentId: 'deep-att',
        size: 5000,
      },
    ]);
  });

  it('accepts a .pdf filename on application/octet-stream, rejects non-PDFs', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        pdfPart({ filename: 'Contract.PDF', mimeType: 'application/octet-stream' }),
        pdfPart({ filename: 'photo.png', mimeType: 'image/png', body: { attachmentId: 'x', size: 10 } }),
      ],
    };
    const parts = collectPdfAttachmentParts(payload);
    expect(parts.map((p) => p.filename)).toEqual(['Contract.PDF']);
  });

  it('skips inline parts without attachmentId and oversized parts', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        // Inline PDF data without an attachmentId is body content, not an attachment.
        { filename: 'inline.pdf', mimeType: 'application/pdf', body: { data: 'aGk=', size: 2 } },
        // Over the 5MB cap — dropped before any download.
        pdfPart({ filename: 'huge.pdf', body: { attachmentId: 'big', size: 6 * 1024 * 1024 } }),
      ],
    };
    expect(collectPdfAttachmentParts(payload)).toEqual([]);
  });

  it('caps at 3 PDFs per message', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [1, 2, 3, 4, 5].map((i) =>
        pdfPart({ filename: `a${i}.pdf`, body: { attachmentId: `att-${i}`, size: 100 } }),
      ),
    };
    const parts = collectPdfAttachmentParts(payload);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.attachmentId)).toEqual(['att-1', 'att-2', 'att-3']);
  });

  it('returns [] for a flat text-only payload', () => {
    expect(
      collectPdfAttachmentParts({ mimeType: 'text/plain', body: { data: 'aGk=', size: 2 } }),
    ).toEqual([]);
  });
});

"use client";

import * as React from "react";
import { FileText } from "lucide-react";

import { SurfacePreview } from "@/components/surface-preview";
import type { Schemas } from "@/lib/api";

/** Live-wired scaffold for the Invoices surface. */
export function InvoicesPreview() {
  return (
    <SurfacePreview<Schemas["ProposalSummaryDto"][]>
      endpoint="/proposals"
      emptyIcon={FileText}
      emptyTitle="No invoices yet"
      emptyDescription="When Robyn proposes an invoice from a meeting or a detected leak, it lands here for review."
      labelsOf={(proposals) =>
        proposals.map((p) => p.clientName).filter((n): n is string => Boolean(n))
      }
      note="The full invoice list with line-by-line provenance chips and Xero deep-links is coming next."
    />
  );
}

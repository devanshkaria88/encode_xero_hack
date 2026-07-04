import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { InvoicesSurface } from "./_components/invoices-surface";

export const metadata: Metadata = {
  title: "Invoices",
};

/** Proposals in review, sent and rejected, plus recovered-money detections. */
export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Every proposal Robyn has drafted, and the money it found in your ledger. Each line shows where the number came from."
      />
      <InvoicesSurface />
    </div>
  );
}

import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ClientsSurface } from "./_components/clients-surface";

export const metadata: Metadata = {
  title: "Clients",
};

/** One card per client: contract, billing profile, autonomy, exposure. */
export default function ClientsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Contracts on file, billing profiles, autonomy and unbilled exposure per client."
      />
      <ClientsSurface />
    </div>
  );
}

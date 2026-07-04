"use client";

import * as React from "react";
import { Users } from "lucide-react";

import { SurfacePreview } from "@/components/surface-preview";
import type { Schemas } from "@/lib/api";

/** Live-wired scaffold for the Clients surface. */
export function ClientsPreview() {
  return (
    <SurfacePreview<Schemas["ClientListItemDto"][]>
      endpoint="/clients"
      emptyIcon={Users}
      emptyTitle="No clients yet"
      emptyDescription="Clients appear here once they're matched from your calendar or promoted from the potential-clients queue."
      labelsOf={(clients) =>
        clients.map((c) => c.name).filter((n): n is string => Boolean(n))
      }
      note="The full client cards, clause viewer, autonomy toggle and potential-clients rail are coming next."
    />
  );
}

"use client";

import * as React from "react";
import { Users } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { Separator } from "@/components/ui/separator";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

import { ClientCard } from "./client-card";
import { ClientDetailSheet } from "./client-detail-sheet";
import { PotentialClientsRail } from "./potential-clients-rail";

type Client = Schemas["ClientListItemDto"];
type Prospect = Schemas["PotentialClientDto"];

/**
 * The Clients surface: a card per client (billing, autonomy, exposure, history)
 * over a distinct potential-clients pipeline rail. Clicking a client opens its
 * full record — contract clause viewer and invoice history — in a side panel.
 */
export function ClientsSurface() {
  const clients = useApi<Client[]>("/clients");
  const prospects = useApi<Prospect[]>("/potential-clients");

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  function refetchAll() {
    clients.refetch();
    prospects.refetch();
  }

  return (
    <div className="space-y-10">
      {/* Clients */}
      <section className="space-y-4">
        {clients.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <LoadingState rows={1} />
            <LoadingState rows={1} />
            <LoadingState rows={1} />
          </div>
        ) : clients.error ? (
          <ErrorState
            error={clients.error}
            onRetry={clients.refetch}
            retrying={clients.isValidating}
          />
        ) : (clients.data ?? []).length === 0 ? (
          <EmptyState
            icon={Users}
            title="No clients yet"
            description="Clients appear here once they're matched from your calendar or promoted from the potential-clients pipeline below."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(clients.data ?? []).map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                onOpen={() => setSelectedId(client.id)}
                onChanged={clients.refetch}
              />
            ))}
          </div>
        )}
      </section>

      <Separator />

      {/* Potential-clients pipeline */}
      <PotentialClientsRail
        query={prospects}
        onConfirmed={refetchAll}
        onOpenClient={(id) => setSelectedId(id)}
      />

      {/* Detail side panel */}
      <ClientDetailSheet
        clientId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onChanged={clients.refetch}
      />
    </div>
  );
}

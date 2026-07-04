"use client";

import * as React from "react";

import { useApi, type Schemas } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/money";
import { StateBadge } from "@/components/state-badge";
import { ProvenanceChip } from "@/components/provenance-chip";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

import { ContractViewer } from "./contract-viewer";
import { AttachContractForm } from "./attach-contract-form";
import { InvoiceHistory } from "./invoice-history";
import { rateSuffix } from "./format";

type ClientDetail = Schemas["ClientDetailDto"];
type Contract = Schemas["ContractDto"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

/**
 * The full client record in a side panel: billing profile with provenance, the
 * parsed contract clause viewer (or a paste box when none is on file), and the
 * complete invoice history.
 */
export function ClientDetailSheet({
  clientId,
  onOpenChange,
  onChanged,
}: {
  clientId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const detail = useApi<ClientDetail>(
    clientId ? `/clients/${clientId}` : null,
  );
  const contract = useApi<Contract>(
    clientId ? `/clients/${clientId}/contract` : null,
  );

  // Only trust loaded data that belongs to the currently-selected client, so a
  // fast switch between clients never flashes the previous record.
  const d =
    detail.data && detail.data.id === clientId ? detail.data : undefined;
  const profile = d?.billingProfile;

  // Whether a contract exists comes from the (already-loaded) detail; the clause
  // data prefers the dedicated /contract endpoint and falls back to the detail's
  // copy so the viewer renders instantly with no second spinner.
  const hasContract = d?.contract != null;
  const contractData: Contract | null =
    (contract.data && contract.data.clientId === clientId
      ? contract.data
      : null) ??
    d?.contract ??
    null;

  const showLoading =
    detail.isLoading || (clientId != null && !d && !detail.error);

  function afterContractSaved() {
    contract.refetch();
    detail.refetch();
    onChanged();
  }

  return (
    <Sheet open={clientId != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {showLoading ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Client detail</SheetTitle>
            <LoadingState rows={3} />
          </div>
        ) : detail.error ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Client detail</SheetTitle>
            <ErrorState
              error={detail.error}
              onRetry={detail.refetch}
              retrying={detail.isValidating}
            />
          </div>
        ) : d ? (
          <>
            <SheetHeader className="space-y-3 border-b border-border p-6 pr-12">
              <div className="space-y-1">
                <SheetTitle>{d.name}</SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {d.emails.join(", ") || "No email on file"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge
                  tone={d.autonomyEnabled ? "success" : "neutral"}
                  label={d.autonomyEnabled ? "Auto-send on" : "Reviews first"}
                  size="sm"
                />
                {d.contract ? (
                  <StateBadge tone="info" label="Contract on file" size="sm" />
                ) : (
                  <StateBadge tone="neutral" label="No contract yet" size="sm" />
                )}
                {d.xeroContactId ? (
                  <StateBadge tone="billed" label="In Xero" size="sm" />
                ) : (
                  <StateBadge
                    tone="awaiting"
                    label="Not synced to Xero"
                    size="sm"
                  />
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {/* Billing profile */}
              <section className="space-y-3">
                <SectionTitle>Billing profile</SectionTitle>
                {profile && profile.rate != null ? (
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-baseline gap-1.5">
                      <Money
                        amount={profile.rate}
                        currency={profile.currency}
                        className="text-2xl font-semibold text-foreground"
                      />
                      <span className="text-sm text-muted-foreground">
                        {rateSuffix(profile)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {profile.source === "CONTRACT" ? (
                        <ProvenanceChip
                          kind="CONTRACT_CLAUSE"
                          label={profile.provenance}
                        />
                      ) : (
                        <ProvenanceChip
                          kind="LEDGER"
                          label="Inferred rate"
                          detail={profile.provenance}
                        />
                      )}
                      {profile.terms && (
                        <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                          {profile.terms}
                        </span>
                      )}
                      {profile.cadence && (
                        <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                          {profile.cadence}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No billing profile yet. Attach a contract below and Robyn
                    will build one.
                  </p>
                )}
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    Unbilled exposure
                  </span>
                  <Money
                    amount={d.unbilledExposureGbp}
                    className="text-sm font-semibold text-foreground"
                  />
                </div>
              </section>

              <Separator />

              {/* Contract */}
              <section className="space-y-3">
                <SectionTitle>Contract</SectionTitle>
                {hasContract && contractData ? (
                  <ContractViewer contract={contractData} />
                ) : (
                  <AttachContractForm
                    clientId={d.id}
                    clientName={d.name}
                    onDone={afterContractSaved}
                  />
                )}
              </section>

              <Separator />

              {/* Invoice history */}
              <section className="space-y-3">
                <SectionTitle>
                  Invoice history ({d.invoiceHistory.length})
                </SectionTitle>
                <InvoiceHistory items={d.invoiceHistory} />
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

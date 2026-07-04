"use client";

import * as React from "react";
import { ChevronRight, Receipt } from "lucide-react";

import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/money";
import { StateBadge } from "@/components/state-badge";
import { ProvenanceChip } from "@/components/provenance-chip";

import { AutonomyToggle } from "./autonomy-toggle";
import { rateSuffix } from "./format";

type Client = Schemas["ClientListItemDto"];

/**
 * One client at a glance: contract status, billing profile with its provenance,
 * unbilled exposure and invoice history. The body opens the detail panel; the
 * autonomy toggle in the footer is its own control and never opens the panel.
 */
export function ClientCard({
  client,
  onOpen,
  onChanged,
}: {
  client: Client;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const profile = client.billingProfile;
  const hasContract = client.contract.hasContract;

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* Clickable body → detail panel */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`Open ${client.name} detail`}
        className="group flex-1 cursor-pointer p-5 text-left outline-none transition-colors duration-fast hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {client.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {client.emails[0] ?? "No email on file"}
              {client.emails.length > 1 && (
                <span className="text-muted-foreground/70">
                  {" "}
                  +{client.emails.length - 1} more
                </span>
              )}
            </p>
          </div>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
        </div>

        <div className="mt-3">
          {hasContract ? (
            <StateBadge tone="info" label="Contract on file" size="sm" />
          ) : (
            <StateBadge tone="neutral" label="No contract yet" size="sm" />
          )}
        </div>

        {/* Billing profile */}
        <div className="mt-4">
          {profile && profile.rate != null ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <Money
                  amount={profile.rate}
                  className="text-lg font-semibold text-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  {rateSuffix(profile)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
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
                  <span className="text-xs text-muted-foreground">
                    {profile.terms}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No billing profile yet.
            </p>
          )}
        </div>

        {/* Exposure + history */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              Unbilled exposure
            </p>
            <Money
              amount={client.unbilledExposureGbp}
              className={cn(
                "mt-0.5 text-sm font-medium",
                client.unbilledExposureGbp > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
              )}
            />
          </div>
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              Invoices sent
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-foreground">
              <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
              {client.invoiceHistoryCount}
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Autonomy footer — its own control, does not open the panel */}
      <div className="p-5 py-4">
        <AutonomyToggle client={client} onChanged={onChanged} />
      </div>
    </Card>
  );
}

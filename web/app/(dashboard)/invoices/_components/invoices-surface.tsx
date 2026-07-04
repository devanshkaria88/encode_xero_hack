"use client";

import * as React from "react";
import { FileText, Search, Sparkles } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

import { ProposalRow } from "./proposal-row";
import { ProposalDetailSheet } from "./proposal-detail-sheet";
import { DetectionCard } from "./detection-card";

type Proposal = Schemas["ProposalSummaryDto"];
type Detection = Schemas["DetectionDto"];
type ProposalState = Proposal["state"];

type TabKey = "IN_REVIEW" | "SENT" | "REJECTED" | "ALL";

const TABS: { key: TabKey; label: string; match: (s: ProposalState) => boolean }[] =
  [
    { key: "IN_REVIEW", label: "In review", match: (s) => s === "IN_REVIEW" },
    { key: "SENT", label: "Sent", match: (s) => s === "SENT" },
    { key: "REJECTED", label: "Rejected", match: (s) => s === "REJECTED" },
    { key: "ALL", label: "All", match: () => true },
  ];

const EMPTY: Record<TabKey, { title: string; description: string }> = {
  IN_REVIEW: {
    title: "Nothing in review",
    description:
      "When Robyn proposes an invoice from a meeting or a detected leak, it waits here for your approval.",
  },
  SENT: {
    title: "Nothing sent yet",
    description: "Approved invoices written to Xero will appear here.",
  },
  REJECTED: {
    title: "Nothing rejected",
    description: "Proposals you decline to invoice will be listed here.",
  },
  ALL: {
    title: "No invoices yet",
    description:
      "Robyn turns your meetings and detected leaks into invoice proposals. They land here for review.",
  },
};

/**
 * The Invoices surface: every proposal Robyn has drafted, tabbed by state, over
 * the recovered-money detections from the ledger. Each proposal opens a
 * line-by-line detail panel with full provenance and the approve / draft /
 * reject actions.
 */
export function InvoicesSurface() {
  const proposals = useApi<Proposal[]>("/proposals");
  const detections = useApi<Detection[]>("/detections");

  const [tab, setTab] = React.useState<TabKey>("IN_REVIEW");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  function refetchAll() {
    proposals.refetch();
    detections.refetch();
  }

  const list = proposals.data ?? [];
  const counts = React.useMemo(() => {
    const c: Record<TabKey, number> = {
      IN_REVIEW: 0,
      SENT: 0,
      REJECTED: 0,
      ALL: list.length,
    };
    for (const p of list) {
      if (p.state === "IN_REVIEW") c.IN_REVIEW += 1;
      else if (p.state === "SENT") c.SENT += 1;
      else if (p.state === "REJECTED") c.REJECTED += 1;
    }
    return c;
  }, [list]);

  const detectionList = detections.data ?? [];
  const openDetections = detectionList.filter((d) => d.state === "OPEN");
  const recoverable = openDetections.reduce(
    (sum, d) => sum + Number(d.valueGbp || 0),
    0,
  );

  return (
    <div className="space-y-10">
      {/* Proposals */}
      <section className="space-y-4">
        {proposals.isLoading ? (
          <LoadingState rows={4} />
        ) : proposals.error ? (
          <ErrorState
            error={proposals.error}
            onRetry={proposals.refetch}
            retrying={proposals.isValidating}
          />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                  <span className="tabular text-xs text-muted-foreground">
                    {counts[t.key]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {TABS.map((t) => {
              const rows = list.filter((p) => t.match(p.state));
              return (
                <TabsContent key={t.key} value={t.key}>
                  {rows.length === 0 ? (
                    <EmptyState
                      icon={FileText}
                      title={EMPTY[t.key].title}
                      description={EMPTY[t.key].description}
                    />
                  ) : (
                    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                      {rows.map((p) => (
                        <ProposalRow
                          key={p.id}
                          proposal={p}
                          onOpen={() => setSelectedId(p.id)}
                        />
                      ))}
                    </ul>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </section>

      <Separator />

      {/* Recovered-money detections (loop 3) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Money Robyn found
            </h2>
            <p className="text-sm text-muted-foreground">
              Leaks in the ledger: work delivered, quotes accepted and costs paid
              that never turned into an invoice.
            </p>
          </div>
          {openDetections.length > 0 && (
            <div className="text-right">
              <Money
                amount={recoverable}
                whole
                className="text-lg font-semibold text-foreground"
              />
              <p className="text-xs text-muted-foreground">still recoverable</p>
            </div>
          )}
        </div>

        {detections.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <LoadingState rows={1} />
            <LoadingState rows={1} />
          </div>
        ) : detections.error ? (
          <ErrorState
            error={detections.error}
            onRetry={detections.refetch}
            retrying={detections.isValidating}
          />
        ) : detectionList.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No leaks detected"
            description="When Robyn spots an accepted quote, a lapsed retainer or an unrecharged expense, it appears here as recoverable money."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {detectionList.map((d) => (
              <DetectionCard key={d.id} detection={d} onChanged={refetchAll} />
            ))}
          </div>
        )}
      </section>

      {/* Proposal detail panel */}
      <ProposalDetailSheet
        proposalId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onChanged={refetchAll}
      />
    </div>
  );
}

"use client";

import * as React from "react";
import { ChevronRight, ExternalLink, Sparkles } from "lucide-react";

import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Money } from "@/components/money";
import { RelativeTime } from "@/components/relative-time";
import { ProposalStateBadge } from "@/components/state-badge";

import { asText, sourceMeta } from "./util";

type Proposal = Schemas["ProposalSummaryDto"];

/**
 * A single invoice proposal in the list: who it's for, what it's worth, its
 * state, where it came from, and a jump into Xero when it's been written. The
 * whole row opens the line-by-line detail; the Xero link is its own target.
 */
export function ProposalRow({
  proposal,
  onOpen,
}: {
  proposal: Proposal;
  onOpen: () => void;
}) {
  const { label: sourceLabel, icon: SourceIcon } = sourceMeta(proposal.source);
  const deepLink = asText(proposal.xeroDeepLink);
  const invoiceNumber = asText(proposal.xeroInvoiceNumber);

  return (
    <li>
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
        className="group flex w-full cursor-pointer items-center gap-4 bg-card p-4 text-left transition-colors duration-fast hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* Client + provenance */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {proposal.clientName}
            </p>
            {proposal.autoSent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[0.625rem] font-medium text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300">
                <Sparkles className="h-2.5 w-2.5" />
                Auto-sent
              </span>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            <SourceIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{sourceLabel}</span>
            <span aria-hidden="true">·</span>
            <RelativeTime value={proposal.createdAt} />
            {invoiceNumber && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-muted-foreground/70">{invoiceNumber}</span>
              </>
            )}
          </p>
        </div>

        {/* State */}
        <ProposalStateBadge
          state={proposal.state}
          size="sm"
          className="hidden shrink-0 sm:inline-flex"
        />

        {/* Total */}
        <Money
          amount={proposal.total}
          currency={proposal.currency}
          className="shrink-0 text-sm font-semibold text-foreground"
        />

        {/* Xero deep link */}
        {deepLink ? (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${proposal.clientName} invoice in Xero`}
            title="Open in Xero"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden="true" />
        )}

        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors duration-fast group-hover:text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </div>
    </li>
  );
}

"use client";

import * as React from "react";
import { ExternalLink, Sparkles, Receipt } from "lucide-react";

import type { Schemas } from "@/lib/api";
import { Money } from "@/components/money";
import { RelativeTime } from "@/components/relative-time";
import { ProposalStateBadge } from "@/components/state-badge";
import { EmptyState } from "@/components/empty-state";

type InvoiceItem = Schemas["InvoiceHistoryItemDto"];

/** Every invoice raised for this client, newest first, each traceable to Xero. */
export function InvoiceHistory({ items }: { items: InvoiceItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No invoices yet"
        description="Invoices Robyn raises for this client will appear here."
        className="py-10"
      />
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 bg-card p-3"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ProposalStateBadge state={item.state} size="sm" />
              {item.autoSent && (
                <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[0.625rem] font-medium text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300">
                  <Sparkles className="h-2.5 w-2.5" />
                  Auto-sent
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <RelativeTime value={item.createdAt} />
              {item.xeroInvoiceNumber && (
                <span className="text-muted-foreground/70">
                  {" · "}
                  {item.xeroInvoiceNumber}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Money
              amount={item.total}
              currency={item.currency}
              className="text-sm font-medium text-foreground"
            />
            {item.xeroDeepLink && (
              <a
                href={item.xeroDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Open invoice in Xero"
                title="Open in Xero"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

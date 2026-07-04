"use client";

import * as React from "react";
import { Inbox, PoundSterling, Send, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useApi, type Schemas } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/money";
import { LoadingStats } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

interface Stat {
  label: string;
  icon: LucideIcon;
  render: (s: Schemas["DashboardSummaryDto"]) => React.ReactNode;
}

const STATS: Stat[] = [
  { label: "Open tasks", icon: Inbox, render: (s) => s.openTasks },
  {
    label: "Unbilled",
    icon: PoundSterling,
    render: (s) => <Money amount={s.unbilledGbp} whole />,
  },
  {
    label: "Sent this month",
    icon: Send,
    render: (s) => s.invoicesSentThisMonth,
  },
  { label: "Clients", icon: Users, render: (s) => s.clientsCount },
];

/** Headline numbers for the top of the Tasks inbox. */
export function SummaryStats() {
  const { data, error, isLoading, refetch } =
    useApi<Schemas["DashboardSummaryDto"]>("/dashboard/summary", {
      refreshMs: 60_000,
    });

  if (isLoading) return <LoadingStats count={4} />;
  if (error)
    return <ErrorState compact error={error} onRetry={refetch} />;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardContent className="flex items-start justify-between gap-3 p-5">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                <p className="tabular text-2xl font-semibold text-foreground">
                  {data ? stat.render(data) : "—"}
                </p>
              </div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="h-4 w-4" />
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

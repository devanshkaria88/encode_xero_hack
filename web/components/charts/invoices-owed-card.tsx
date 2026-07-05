"use client";

import * as React from "react";

import type { Schemas } from "@/lib/api";
import { ChartCard, ChartEmpty } from "./chart-card";
import { HStackBar, SegmentRows, type BarSegment } from "./hstack-bar";
import { CHART_COLOR } from "./palette";
import { gbpWhole } from "./format";

type Bucket = Schemas["InvoicesOwedBucketDto"];

const BUCKET_META: Record<
  Bucket["key"],
  { label: string; color: string }
> = {
  DRAFT: { label: "Draft", color: CHART_COLOR.neutral },
  AWAITING: { label: "Awaiting payment", color: CHART_COLOR.amber },
  OVERDUE: { label: "Overdue", color: CHART_COLOR.rose },
};

/** The three ACCREC buckets as a stacked meter. Overdue is the hottest hue. */
export function InvoicesOwedCard({ buckets }: { buckets: Bucket[] }) {
  const segments: BarSegment[] = (["DRAFT", "AWAITING", "OVERDUE"] as const).map(
    (key) => {
      const bucket = buckets.find((b) => b.key === key);
      return {
        key,
        label: BUCKET_META[key].label,
        color: BUCKET_META[key].color,
        value: Number(bucket?.amountGbp ?? 0),
        count: Number(bucket?.count ?? 0),
      };
    },
  );

  const totalAmount = segments.reduce((sum, s) => sum + s.value, 0);
  const totalCount = segments.reduce((sum, s) => sum + (s.count ?? 0), 0);
  const isEmpty = totalAmount <= 0 && totalCount === 0;

  return (
    <ChartCard
      title="Invoices owed to you"
      headline={gbpWhole(totalAmount)}
      hint={
        totalCount > 0
          ? `across ${totalCount} ${totalCount === 1 ? "invoice" : "invoices"}`
          : "no open invoices"
      }
    >
      {isEmpty ? (
        <ChartEmpty>
          Nothing owed to you right now. New invoices will show up here.
        </ChartEmpty>
      ) : (
        <div className="space-y-3">
          <HStackBar segments={segments} />
          <SegmentRows segments={segments} countNoun="invoice" />
        </div>
      )}
    </ChartCard>
  );
}

"use client";

import * as React from "react";

import type { Schemas } from "@/lib/api";
import { ChartCard, ChartEmpty } from "./chart-card";
import { HStackBar, SegmentRows, type BarSegment } from "./hstack-bar";
import { CHART_COLOR } from "./palette";
import { gbpWhole } from "./format";

type Bucket = Schemas["MoneyFoundBucketDto"];

const STATE_META: Record<
  Bucket["state"],
  { label: string; color: string }
> = {
  OPEN: { label: "Found, still open", color: CHART_COLOR.amber },
  PROPOSED: { label: "In a proposal", color: CHART_COLOR.indigo },
  RESOLVED: { label: "Recovered", color: CHART_COLOR.teal },
  DISMISSED: { label: "Dismissed", color: CHART_COLOR.neutral },
};

/** What Robyn's detections found, by lifecycle state. Headline = still open. */
export function MoneyFoundCard({ buckets }: { buckets: Bucket[] }) {
  const segments: BarSegment[] = (
    ["OPEN", "PROPOSED", "RESOLVED", "DISMISSED"] as const
  ).map((state) => {
    const bucket = buckets.find((b) => b.state === state);
    return {
      key: state,
      label: STATE_META[state].label,
      color: STATE_META[state].color,
      value: Number(bucket?.amountGbp ?? 0),
      count: Number(bucket?.count ?? 0),
    };
  });

  const openAmount = segments.find((s) => s.key === "OPEN")?.value ?? 0;
  const isEmpty = segments.every((s) => s.value <= 0 && (s.count ?? 0) === 0);

  return (
    <ChartCard
      title="Money Robyn found"
      headline={gbpWhole(openAmount)}
      hint="still open to recover"
    >
      {isEmpty ? (
        <ChartEmpty>
          No leaks found yet. Robyn is watching your quotes, retainers and
          expenses.
        </ChartEmpty>
      ) : (
        <div className="space-y-3">
          <HStackBar segments={segments} />
          <SegmentRows segments={segments} countNoun="item" />
        </div>
      )}
    </ChartCard>
  );
}

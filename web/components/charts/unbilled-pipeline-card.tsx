"use client";

import * as React from "react";

import type { Schemas } from "@/lib/api";
import { ChartCard, ChartEmpty } from "./chart-card";
import { HStackBar, SegmentRows, type BarSegment } from "./hstack-bar";
import { CHART_COLOR } from "./palette";
import { gbpWhole } from "./format";

/** One measure split by source, so one hue in fading steps (not a rainbow). */
const STEP_OPACITY = [1, 0.65, 0.42, 0.28];

function humanizeSource(source: string): string {
  const known: Record<string, string> = {
    QUOTE_NOT_INVOICED: "Quotes not invoiced",
    RETAINER_STOPPED: "Lapsed retainers",
    EXPENSE_NOT_RECHARGED: "Unrecharged expenses",
    proposals: "Invoices in review",
    detections: "Detected leaks",
    unbilled: "Unbilled meetings",
  };
  if (known[source]) return known[source];
  return source
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** The unbilled pipeline: where the not-yet-billed money is sitting. */
export function UnbilledPipelineCard({
  pipeline,
}: {
  pipeline: Schemas["UnbilledPipelineDto"];
}) {
  const segments: BarSegment[] = pipeline.items.map((item, i) => ({
    key: `${item.source}-${i}`,
    label: humanizeSource(item.source),
    color: CHART_COLOR.indigo,
    opacity: STEP_OPACITY[Math.min(i, STEP_OPACITY.length - 1)],
    value: Number(item.gbp ?? 0),
    count: Number(item.count ?? 0),
  }));

  const total = Number(pipeline.totalGbp ?? 0);
  const visible = segments.filter((s) => s.value > 0 || (s.count ?? 0) > 0);

  return (
    <ChartCard
      title="Unbilled pipeline"
      headline={gbpWhole(total)}
      hint="waiting to be billed"
    >
      {total <= 0 || visible.length === 0 ? (
        <ChartEmpty>
          Nothing unbilled right now. Everything billable is accounted for.
        </ChartEmpty>
      ) : (
        <div className="space-y-3">
          <HStackBar segments={visible} />
          <SegmentRows segments={visible} countNoun="item" />
        </div>
      )}
    </ChartCard>
  );
}

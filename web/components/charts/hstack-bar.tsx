"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { gbpWhole } from "./format";
import { TOOLTIP_STYLE } from "./palette";

export interface BarSegment {
  /** Stable key for the segment (bucket/state/source). */
  key: string;
  /** Plain-English label shown in the tooltip and the rows below. */
  label: string;
  /** GBP amount. Zero segments render nothing but keep their row. */
  value: number;
  /** CSS colour string (chart token). */
  color: string;
  /** Optional fill opacity for sequential one-hue steps. */
  opacity?: number;
  /** Optional item count shown in the rows. */
  count?: number;
}

/**
 * A single horizontal stacked bar (Xero-dashboard style meter) built on
 * recharts. Segments get a hairline card-coloured stroke so adjacent fills
 * keep a visible gap, and hovering shows a GBP tooltip for every segment.
 * Identity is never colour-alone: pair it with SegmentRows direct labels.
 */
export function HStackBar({
  segments,
  height = 40,
}: {
  segments: BarSegment[];
  height?: number;
}) {
  const datum: Record<string, number | string> = { name: "all" };
  for (const s of segments) datum[s.key] = s.value;

  return (
    <div style={{ height }} className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={[datum]}
          layout="vertical"
          margin={{ top: 4, right: 0, bottom: 4, left: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: "transparent" }}
            formatter={(value, name) => [gbpWhole(Number(value)), name]}
            labelFormatter={() => ""}
          />
          {segments.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="meter"
              fill={s.color}
              fillOpacity={s.opacity ?? 1}
              stroke="hsl(var(--card))"
              strokeWidth={1}
              radius={2}
              barSize={14}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Direct labels for the segments: dot, label, count, GBP amount. This carries
 * identity and the exact figures, so the bar never needs a legend and colour
 * is never the only signal.
 */
export function SegmentRows({
  segments,
  countNoun,
}: {
  segments: BarSegment[];
  /** Singular noun for counts, e.g. "invoice" → "3 invoices". */
  countNoun?: string;
}) {
  return (
    <ul className="space-y-1.5">
      {segments.map((s) => (
        <li key={s.key} className="flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: s.color, opacity: s.opacity ?? 1 }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {s.label}
          </span>
          {s.count != null && countNoun && (
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {s.count} {s.count === 1 ? countNoun : `${countNoun}s`}
            </span>
          )}
          <span className="tabular shrink-0 font-medium text-foreground">
            {gbpWhole(s.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

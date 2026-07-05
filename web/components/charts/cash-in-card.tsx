"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Schemas } from "@/lib/api";
import { ChartCard, ChartEmpty } from "./chart-card";
import { CHART_COLOR, TOOLTIP_STYLE } from "./palette";
import { gbpCompact, gbpWhole, monthShort } from "./format";

const TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

/** Payments received per month, last 6 months. One hue: this is magnitude. */
export function CashInCard({ cashIn }: { cashIn: Schemas["CashInDto"] }) {
  const data = cashIn.months.map((m) => ({
    label: monthShort(m.month),
    amount: Number(m.amountGbp ?? 0),
  }));
  const total = Number(cashIn.total6m ?? 0);

  return (
    <ChartCard
      title="Cash coming in"
      headline={gbpWhole(total)}
      hint="received over the last 6 months"
    >
      {total <= 0 ? (
        <ChartEmpty>
          No payments received in the last 6 months. Paid invoices will land
          here.
        </ChartEmpty>
      ) : (
        <div className="h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="hsl(var(--border))"
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={TICK}
                dy={4}
              />
              <YAxis
                width={44}
                tickCount={3}
                tickLine={false}
                axisLine={false}
                tick={TICK}
                tickFormatter={(v: number) => gbpCompact(v)}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
                formatter={(value) => [gbpWhole(Number(value)), "Received"]}
              />
              <Bar
                dataKey="amount"
                fill={CHART_COLOR.indigo}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

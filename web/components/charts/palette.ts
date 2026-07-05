import type * as React from "react";

/**
 * Chart colour tokens for the dashboard board.
 *
 * The chart colours are CSS custom properties defined by CHART_VARS (Tailwind
 * arbitrary properties) on the board wrapper, so every mark tracks the active
 * theme purely in CSS — no JS theme detection, no flash on toggle. Indigo
 * simply references the app's --primary token; the status hues (amber, rose,
 * teal) hold in both themes, and rose steps lighter in dark mode so it keeps
 * its heat against the dark card.
 *
 * The sets were run through the dataviz palette validator against both card
 * surfaces: light [#d97706, #e11d48, #0d9488, #4d5fc7] and dark [#d97706,
 * #f43f5e, #0d9488, #7888e3] pass lightness band, chroma floor, CVD separation
 * and 3:1 surface contrast. The slate neutral is a deliberate low-chroma
 * status colour (draft / dismissed) and is never the only signal — every
 * segment ships with a direct label, count and amount.
 */
export const CHART_VARS = [
  "[--chart-indigo:hsl(var(--primary))]",
  "[--chart-amber:#d97706]",
  "[--chart-teal:#0d9488]",
  "[--chart-rose:#e11d48]",
  "dark:[--chart-rose:#f43f5e]",
  "[--chart-neutral:#64748b]",
].join(" ");

/** Resolved colour strings for chart fills and row dots. */
export const CHART_COLOR = {
  /** Brand accent — single-series magnitude (cash in, pipeline). */
  indigo: "var(--chart-indigo)",
  /** Waiting / in review — awaiting payment, money found still open. */
  amber: "var(--chart-amber)",
  /** Done / recovered. */
  teal: "var(--chart-teal)",
  /** Needs attention — overdue. The hottest colour on the board. */
  rose: "var(--chart-rose)",
  /** Neutral status — draft, dismissed. */
  neutral: "var(--chart-neutral)",
} as const;

/**
 * Shared recharts Tooltip styling wired to theme tokens, so tooltips read
 * correctly in both light and dark. Spread onto <Tooltip {...TOOLTIP_STYLE} />.
 */
export const TOOLTIP_STYLE: {
  contentStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  itemStyle: React.CSSProperties;
} = {
  contentStyle: {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    boxShadow: "0 4px 12px hsl(var(--shadow-color) / 0.12)",
    padding: "8px 10px",
    fontSize: 12,
  },
  labelStyle: {
    color: "hsl(var(--muted-foreground))",
    marginBottom: 4,
  },
  itemStyle: {
    color: "hsl(var(--popover-foreground))",
    padding: 0,
  },
};

import * as React from "react";

import { cn } from "@/lib/utils";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const GBP_WHOLE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Amount in GBP major units (pounds). */
  amount: number | string | null | undefined;
  currency?: string;
  /** Drop the pence when the value is whole and large (e.g. leak headline). */
  whole?: boolean;
}

/**
 * Formats a GBP figure with tabular numerals so columns of money line up.
 * Coerces numeric-string TypeORM values. Renders a calm dash when empty.
 */
export function Money({
  amount,
  currency = "GBP",
  whole = false,
  className,
  ...props
}: MoneyProps) {
  const value =
    amount === null || amount === undefined || amount === ""
      ? null
      : Number(amount);

  let text: string;
  if (value === null || Number.isNaN(value)) {
    text = "—";
  } else if (currency === "GBP") {
    text = (whole ? GBP_WHOLE : GBP).format(value);
  } else {
    text = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
    }).format(value);
  }

  return (
    <span className={cn("tabular", className)} {...props}>
      {text}
    </span>
  );
}

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Robyn mark: a rounded badge with a ring + check — "every work block
 * accounted for". Calm, geometric, reads at 20px in the sidebar.
 */
export function RobynMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[9px] bg-primary text-primary-foreground shadow-xs",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-[62%] w-[62%]"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle
          cx="12"
          cy="12"
          r="8"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.45"
        />
        <path
          d="M8.5 12.2l2.4 2.4 4.6-5"
          stroke="currentColor"
          strokeWidth="2.2"
        />
      </svg>
    </span>
  );
}

export interface BrandProps {
  className?: string;
  /** Show the "Robyn" wordmark next to the mark. */
  showWordmark?: boolean;
  size?: "sm" | "md";
}

/** The Robyn brand lockup: mark + wordmark. */
export function Brand({
  className,
  showWordmark = true,
  size = "md",
}: BrandProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <RobynMark className={size === "sm" ? "h-7 w-7" : "h-8 w-8"} />
      {showWordmark && (
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            size === "sm" ? "text-base" : "text-[1.05rem]",
          )}
        >
          Robyn
        </span>
      )}
    </div>
  );
}

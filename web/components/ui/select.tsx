import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A styled native select. We deliberately use the platform element (no
 * radix-select dependency in this app): it is keyboard-perfect, mobile-native
 * and needs zero JS. Pass regular `<option>` children.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent pl-3 pr-9 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-card [&>option]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
  </div>
));
Select.displayName = "Select";

export { Select };

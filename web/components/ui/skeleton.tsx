import { cn } from "@/lib/utils";

/** A calm loading placeholder. Reserves layout to avoid content jumping. */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-md bg-muted/70", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };

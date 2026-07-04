"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a `resolve(delayMs)` that triggers the parent refetch after a short
 * beat, so a card can show its success/result panel before it animates out of
 * the inbox. Any pending timer is cleared on unmount.
 */
export function useDeferredResolve(refetchAll: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (delayMs = 1500) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => refetchAll(), delayMs);
    },
    [refetchAll],
  );
}

/** Props every task card receives. */
export interface CardProps {
  task: import("./context").TaskDto;
  /** Refetch /tasks + /dashboard/summary (the resolved card then leaves). */
  refetchAll: () => void;
}

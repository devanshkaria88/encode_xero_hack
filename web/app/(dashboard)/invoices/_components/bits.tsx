"use client";

import * as React from "react";
import { CheckCircle2, Clock3, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** A teal "done" confirmation panel. */
export function SuccessPanel({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm dark:border-teal-500/25 dark:bg-teal-500/10">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-teal-800 dark:text-teal-200">{title}</p>
        {children ? (
          <div className="text-teal-700/90 dark:text-teal-300/80">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** An amber "waiting on Xero" panel. Not an error — the work is ready. */
export function PendingPanel({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/25 dark:bg-amber-500/10">
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-200">
          {title}
        </p>
        {children ? (
          <div className="text-amber-700/90 dark:text-amber-300/80">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputClasses =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground shadow-xs transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A destructive/secondary action that reveals a reason field before confirming
 * (reject a proposal, dismiss a detection). Keeps the card calm until used.
 */
export function InlineReason({
  triggerLabel,
  confirmLabel,
  placeholder,
  required = false,
  pending = false,
  onConfirm,
}: {
  triggerLabel: string;
  confirmLabel: string;
  placeholder: string;
  required?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
    );
  }

  const disabled = pending || (required && reason.trim().length === 0);

  return (
    <div className="w-full space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <label className="block text-xs font-medium text-muted-foreground">
        {placeholder}
      </label>
      <input
        ref={inputRef}
        className={inputClasses}
        value={reason}
        placeholder={placeholder}
        disabled={pending}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !disabled) onConfirm(reason.trim());
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={disabled}
          onClick={() => onConfirm(reason.trim())}
        >
          {pending ? "Working" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

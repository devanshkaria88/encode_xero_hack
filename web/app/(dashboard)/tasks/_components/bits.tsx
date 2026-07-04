"use client";

import * as React from "react";
import { CheckCircle2, Clock3, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/state-badge";
import { RelativeTime } from "@/components/relative-time";
import { TASK_META } from "@/lib/states";
import type { TaskDto } from "./context";

/** The card chrome shared by every task type: type badge + age, then children. */
export function TaskShell({
  task,
  children,
  className,
}: {
  task: TaskDto;
  children: React.ReactNode;
  className?: string;
}) {
  const meta = TASK_META[task.type] ?? {
    label: task.type,
    blurb: "",
    tone: "neutral" as const,
  };
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <StateBadge tone={meta.tone} label={meta.label} size="sm" />
        <RelativeTime
          value={task.createdAt}
          className="shrink-0 text-[0.6875rem] text-muted-foreground"
        />
      </div>
      {children}
    </Card>
  );
}

/** Title + optional subtitle for the top of a card body. */
export function TaskHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-[0.95rem] font-semibold leading-snug text-foreground">
        {title}
      </h3>
      {subtitle ? (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

/** Small uppercase section label. */
export function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-medium text-muted-foreground"
    >
      {children}
    </label>
  );
}

const fieldClasses =
  "w-full rounded-md border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground shadow-xs transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClasses, "min-h-[120px] resize-y px-3 py-2", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(fieldClasses, "h-9 px-3", className)}
    {...props}
  />
));
TextInput.displayName = "TextInput";

/** A row of small neutral chips (attendees, emails). */
export function Chips({ items }: { items: React.ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="inline-flex max-w-full items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground"
        >
          <span className="truncate">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A teal "done" confirmation panel shown just before a card leaves. */
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

/**
 * A destructive secondary action that reveals an optional/required reason
 * before confirming (skip, reject, dismiss). Keeps the card calm until used.
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
      <FieldLabel>{placeholder}</FieldLabel>
      <TextInput
        ref={inputRef}
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

/** Footer wrapper: primary action on the right, secondary on the left. */
export function CardActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {children}
    </div>
  );
}

"use client";

import * as React from "react";
import { FileText, Calendar, Quote, Receipt, Link2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A single piece of evidence behind an invoice line: where the number came
 * from. Hover reveals the verbatim detail (the contract clause text, the
 * transcript quote, the calendar block). This is the trust surface — every
 * figure Robyn proposes can be traced back to a source.
 */
export interface ProvenanceChipProps {
  /** The provenance kind, drives the icon + accent. */
  kind: "CONTRACT_CLAUSE" | "TRANSCRIPT_QUOTE" | "CALENDAR_BLOCK" | "LEDGER" | string;
  /** Short label, e.g. "Clause 3.1" or "Tue 3 Jun". */
  label: string;
  /** Verbatim detail shown in the tooltip. */
  detail?: string;
  className?: string;
}

const KIND_STYLE: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; chip: string; name: string }
> = {
  CONTRACT_CLAUSE: {
    icon: FileText,
    chip: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300",
    name: "Contract",
  },
  TRANSCRIPT_QUOTE: {
    icon: Quote,
    chip: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300",
    name: "Transcript",
  },
  CALENDAR_BLOCK: {
    icon: Calendar,
    chip: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-300",
    name: "Calendar",
  },
  LEDGER: {
    icon: Receipt,
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300",
    name: "Ledger",
  },
};

export function ProvenanceChip({
  kind,
  label,
  detail,
  className,
}: ProvenanceChipProps) {
  const style = KIND_STYLE[kind] ?? {
    icon: Link2,
    chip: "border-border bg-muted text-muted-foreground",
    name: "Source",
  };
  const Icon = style.icon;

  const chip = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        detail && "cursor-help",
        style.chip,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );

  if (!detail) return chip;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
          {style.name}
        </p>
        <p className="leading-relaxed text-foreground">{detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}

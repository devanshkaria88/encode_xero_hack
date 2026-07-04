"use client";

import * as React from "react";
import { FileText, ChevronDown } from "lucide-react";

import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ProvenanceChip } from "@/components/provenance-chip";

type Contract = Schemas["ContractDto"];

/**
 * The parsed contract, made readable: what it covers, then every clause Robyn
 * cites, each keeping its reference beside its verbatim text. The original
 * document is one tap away so every number can be traced to the source.
 */
export function ContractViewer({ contract }: { contract: Contract }) {
  const [showOriginal, setShowOriginal] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {contract.title ?? "Contract"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {contract.fileRef}
          </p>
        </div>
      </div>

      {contract.scopeSummary && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            What this covers
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {contract.scopeSummary}
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Clauses Robyn cites
        </p>
        {contract.clauses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clauses were parsed from this document.
          </p>
        ) : (
          contract.clauses.map((clause, i) => (
            <div
              key={`${clause.ref}-${i}`}
              className="rounded-lg border border-border bg-card p-3"
            >
              <ProvenanceChip kind="CONTRACT_CLAUSE" label={clause.ref} />
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                {clause.text}
              </p>
            </div>
          ))
        )}
      </div>

      {contract.rawText && (
        <div>
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            aria-expanded={showOriginal}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-fast",
                showOriginal && "rotate-180",
              )}
            />
            {showOriginal ? "Hide original document" : "Show original document"}
          </button>
          {showOriginal && (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
                {contract.rawText}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { post, useAction, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Contract = Schemas["ContractDto"];

/**
 * When a client has no contract on file, paste the agreement here. Robyn parses
 * the rate, terms and clauses and cites each value back to its clause. Also
 * resolves any open "attach contract" task for this client.
 */
export function AttachContractForm({
  clientId,
  clientName,
  onDone,
}: {
  clientId: string;
  clientName: string;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [rawText, setRawText] = React.useState("");

  const { run, isPending } = useAction((body: { title?: string; rawText: string }) =>
    post<Contract>(`/clients/${clientId}/contract`, body),
  );

  const canSubmit = rawText.trim().length > 20 && !isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await run({
        title: title.trim() || undefined,
        rawText: rawText.trim(),
      });
      toast.success(`Contract saved for ${clientName}`, {
        description: "Robyn parsed the rate and terms and cited each clause.",
      });
      setTitle("");
      setRawText("");
      onDone();
    } catch {
      toast.error("Couldn't save the contract. Please try again.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FilePlus2 className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">
            No contract on file
          </p>
          <p className="text-xs text-muted-foreground">
            Paste the agreement so Robyn can cite the rate on every invoice.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`contract-title-${clientId}`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Title (optional)
        </label>
        <input
          id={`contract-title-${clientId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
          placeholder={`${clientName} — Consulting Agreement`}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors duration-fast placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`contract-text-${clientId}`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Contract text
        </label>
        <textarea
          id={`contract-text-${clientId}`}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          disabled={isPending}
          rows={7}
          placeholder="Paste the full contract. Robyn reads the fee clauses, payment terms and scope, and keeps a citation for each."
          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors duration-fast placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {rawText.trim().length > 0 && rawText.trim().length <= 20
            ? "Add a little more so Robyn can parse it."
            : "Robyn parses it the moment you save."}
        </p>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Parsing
            </>
          ) : (
            <>
              <FilePlus2 className="h-3.5 w-3.5" />
              Save contract
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

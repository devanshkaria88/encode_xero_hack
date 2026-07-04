"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileSignature } from "lucide-react";

import { post, useAction, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import {
  TaskShell,
  TaskHeading,
  FieldLabel,
  TextInput,
  Textarea,
  SuccessPanel,
  CardActions,
} from "./bits";
import { ctxOf, readStr } from "./context";
import { useDeferredResolve, type CardProps } from "./use-resolve";

type Contract = Schemas["ContractDto"];

const RATE_UNIT: Record<string, string> = {
  HOUR: "per hour",
  DAY: "per day",
  FIXED: "fixed",
};

/** File a contract so Robyn can cite the rate on every future invoice. */
export function AttachContractCard({ task, refetchAll }: CardProps) {
  const ctx = ctxOf(task);
  const clientId =
    readStr(ctx, "clientId") ?? readStr(ctx, "refId") ?? task.refId;
  const clientName = readStr(ctx, "clientName");

  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<Contract | null>(null);
  const resolve = useDeferredResolve(refetchAll);

  const attach = useAction((body: { title?: string; rawText: string }) =>
    post<Contract>(`/clients/${clientId}/contract`, body),
  );

  const busy = attach.isPending || result !== null;

  async function onAttach() {
    const rawText = text.trim();
    if (!rawText) return;
    try {
      const res = await attach.run({
        title: title.trim() || undefined,
        rawText,
      });
      setResult(res);
      toast.success("Contract filed", {
        description: "Robyn can now cite the rate on every invoice.",
      });
      resolve(2000);
    } catch (err) {
      toast.error("Couldn't file the contract", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <TaskShell task={task}>
      <div className="space-y-4">
        <TaskHeading
          title={
            clientName ? `Attach ${clientName}'s contract` : "Attach a contract"
          }
          subtitle="Paste the agreement. Robyn reads the rate, terms and clauses, and cites each one."
        />

        {result ? (
          <SuccessPanel title="Contract filed and parsed">
            <ul className="space-y-0.5">
              {result.rate != null && (
                <li>
                  Rate:{" "}
                  <Money
                    amount={result.rate}
                    currency={result.currency}
                    className="font-medium text-teal-800 dark:text-teal-200"
                  />{" "}
                  {RATE_UNIT[result.rateUnit ?? ""] ?? ""}
                </li>
              )}
              {result.paymentTerms && <li>Terms: {result.paymentTerms}</li>}
              {result.clauses.length > 0 && (
                <li>
                  {result.clauses.length} clause
                  {result.clauses.length === 1 ? "" : "s"} cited.
                </li>
              )}
            </ul>
          </SuccessPanel>
        ) : (
          <div className="space-y-3">
            <div>
              <FieldLabel htmlFor={`contract-title-${task.id}`}>
                Title (optional)
              </FieldLabel>
              <TextInput
                id={`contract-title-${task.id}`}
                value={title}
                disabled={busy}
                placeholder="e.g. Consulting Agreement 2026"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor={`contract-text-${task.id}`}>
                Contract text
              </FieldLabel>
              <Textarea
                id={`contract-text-${task.id}`}
                value={text}
                disabled={busy}
                placeholder="Paste the full contract here. Robyn will extract the rate, payment terms and clauses, keeping each citation."
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </div>
        )}

        {!result && (
          <CardActions>
            <Button
              type="button"
              onClick={onAttach}
              disabled={busy || text.trim().length === 0}
            >
              <FileSignature className="h-4 w-4" />
              {attach.isPending ? "Reading contract" : "Attach contract"}
            </Button>
          </CardActions>
        )}
      </div>
    </TaskShell>
  );
}

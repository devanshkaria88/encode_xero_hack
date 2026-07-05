"use client";

import * as React from "react";
import { toast } from "sonner";

import { patch, useAction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MODEL_OPTIONS,
  type AgentSettings,
  type UpdateAgentSettings,
} from "./shared";

/**
 * Agent tab: the system prompt and the model. Explicit save with dirty-state
 * detection; nothing writes until the button is pressed.
 */
export function AgentTab({
  settings,
  refetch,
}: {
  settings: AgentSettings;
  refetch: () => void;
}) {
  const [prompt, setPrompt] = React.useState(settings.systemPrompt);
  const [model, setModel] = React.useState<AgentSettings["model"]>(
    settings.model,
  );

  const dirty =
    prompt !== settings.systemPrompt || model !== settings.model;

  const save = useAction(async () => {
    const body: UpdateAgentSettings = { systemPrompt: prompt, model };
    await patch<AgentSettings>("/agent-settings", body);
  });

  const handleSave = async () => {
    if (prompt.trim().length === 0) {
      toast.error("The system prompt cannot be empty.");
      return;
    }
    try {
      await save.run();
      toast.success("Agent settings saved");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };

  const modelHint = MODEL_OPTIONS.find((m) => m.value === model)?.hint;

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="system-prompt">System prompt</Label>
        <Textarea
          id="system-prompt"
          rows={12}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="mt-1.5 font-mono text-xs leading-relaxed"
          placeholder="You are Robyn, a bookkeeping assistant for a small trade business..."
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Robyn reads this before every chat. It sets the tone, what to focus
          on, and any hard rules. Enabled skills are added underneath it.
        </p>
      </div>

      <div className="max-w-xs">
        <Label htmlFor="chat-model">Model</Label>
        <Select
          id="chat-model"
          value={model}
          onChange={(e) => setModel(e.target.value as AgentSettings["model"])}
          className="mt-1.5"
        >
          {MODEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {modelHint && (
          <p className="mt-1.5 text-xs text-muted-foreground">{modelHint}</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

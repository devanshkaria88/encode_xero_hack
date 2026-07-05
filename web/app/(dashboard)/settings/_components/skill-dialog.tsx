"use client";

import * as React from "react";
import { toast } from "sonner";

import { patch, useAction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  toSkillInputs,
  type AgentSettings,
  type SkillInput,
  type SkillItem,
  type UpdateAgentSettings,
} from "./shared";

/** Add or edit one skill: a named block of standing instructions. */
export function SkillDialog({
  skill,
  allSkills,
  onClose,
  onSaved,
}: {
  /** The skill being edited, or null when adding a new one. */
  skill: SkillItem | null;
  allSkills: SkillItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(skill?.name ?? "");
  const [instructions, setInstructions] = React.useState(
    skill?.instructions ?? "",
  );

  const save = useAction(async () => {
    const entry: SkillInput = {
      ...(skill ? { id: skill.id } : {}),
      name: name.trim(),
      instructions: instructions.trim(),
      enabled: skill?.enabled ?? true,
    };
    const current = toSkillInputs(allSkills);
    const skills = skill
      ? current.map((s) => (s.id === skill.id ? entry : s))
      : [...current, entry];
    const body: UpdateAgentSettings = { skills };
    await patch<AgentSettings>("/agent-settings", body);
  });

  const handleSave = async () => {
    if (name.trim().length === 0) {
      toast.error("Give the skill a name.");
      return;
    }
    if (instructions.trim().length === 0) {
      toast.error("Write the instructions Robyn should follow.");
      return;
    }
    try {
      await save.run();
      toast.success(skill ? "Skill updated" : "Skill added");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{skill ? "Edit skill" : "Add skill"}</DialogTitle>
          <DialogDescription>
            Short instructions Robyn follows in every chat while the skill is
            on.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Chasing late payers"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="skill-instructions">Instructions</Label>
            <Textarea
              id="skill-instructions"
              rows={8}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="When asked about late payers, always list the oldest unpaid invoice first and suggest a polite reminder."
              className="mt-1.5 font-mono text-xs leading-relaxed"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Added to the system prompt under this skill&apos;s name whenever
              it is enabled.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : skill ? "Save changes" : "Add skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { patch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import {
  toSkillInputs,
  type AgentSettings,
  type SkillItem,
  type UpdateAgentSettings,
} from "./shared";
import { SkillDialog } from "./skill-dialog";
import { ConfirmDialog } from "./confirm-dialog";

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim().length > 0) ?? "";
}

/**
 * Skills tab: named instruction snippets appended to the system prompt.
 * Toggles PATCH immediately; add/edit go through a dialog; delete confirms.
 * Every PATCH replaces the whole skills list per the contract.
 */
export function SkillsTab({
  settings,
  refetch,
}: {
  settings: AgentSettings;
  refetch: () => void;
}) {
  const [rowPendingId, setRowPendingId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<
    { mode: "add" } | { mode: "edit"; skill: SkillItem } | null
  >(null);
  const [deleting, setDeleting] = React.useState<SkillItem | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);

  const patchSettings = async (body: UpdateAgentSettings) => {
    await patch<AgentSettings>("/agent-settings", body);
    refetch();
  };

  const toggleSkill = async (skill: SkillItem, next: boolean) => {
    setRowPendingId(skill.id);
    try {
      const skills = toSkillInputs(settings.skills).map((s) =>
        s.id === skill.id ? { ...s, enabled: next } : s,
      );
      await patchSettings({ skills });
      toast.success(next ? `${skill.name} turned on` : `${skill.name} turned off`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setRowPendingId(null);
    }
  };

  const removeSkill = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      const skills = toSkillInputs(settings.skills).filter(
        (s) => s.id !== deleting.id,
      );
      await patchSettings({ skills });
      toast.success(`${deleting.name} removed`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Skills</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Standing instructions Robyn follows in every chat.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
            <Plus className="h-3.5 w-3.5" />
            Add skill
          </Button>
        </div>

        {settings.skills.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No skills yet."
            description="Skills are short instructions Robyn follows in every chat."
          />
        ) : (
          <div className="space-y-3">
            {settings.skills.map((skill) => (
              <Card key={skill.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {skill.name}
                      </p>
                      {!skill.enabled && (
                        <Badge variant="muted" className="text-[0.625rem]">
                          off
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {firstLine(skill.instructions)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={skill.enabled}
                      disabled={rowPendingId !== null}
                      onCheckedChange={(next) => toggleSkill(skill, next)}
                      aria-label={`Toggle ${skill.name}`}
                      className="mr-1.5"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => setDialog({ mode: "edit", skill })}
                      aria-label={`Edit ${skill.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(skill)}
                      aria-label={`Remove ${skill.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {dialog && (
        <SkillDialog
          key={dialog.mode === "edit" ? dialog.skill.id : "new"}
          skill={dialog.mode === "edit" ? dialog.skill : null}
          allSkills={settings.skills}
          onClose={() => setDialog(null)}
          onSaved={refetch}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="Remove this skill?"
        description={
          deleting
            ? `Robyn will stop following the ${deleting.name} instructions.`
            : ""
        }
        confirmLabel="Remove skill"
        pending={deletePending}
        onConfirm={removeSkill}
      />
    </div>
  );
}

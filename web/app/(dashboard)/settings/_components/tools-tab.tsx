"use client";

import * as React from "react";
import { Globe, Pencil, Plus, ServerCog, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { patch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import {
  toServerInputs,
  type AgentSettings,
  type McpServer,
  type UpdateAgentSettings,
} from "./shared";
import { McpServerDialog } from "./mcp-server-dialog";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Tools tab: the built-in web search toggle, then the user's MCP servers.
 * Toggles PATCH immediately; add/edit go through a dialog; delete confirms.
 * Every PATCH replaces the whole server list per the contract.
 */
export function ToolsTab({
  settings,
  refetch,
}: {
  settings: AgentSettings;
  refetch: () => void;
}) {
  const [webPending, setWebPending] = React.useState(false);
  const [rowPendingId, setRowPendingId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<
    { mode: "add" } | { mode: "edit"; server: McpServer } | null
  >(null);
  const [deleting, setDeleting] = React.useState<McpServer | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);

  const patchSettings = async (body: UpdateAgentSettings) => {
    await patch<AgentSettings>("/agent-settings", body);
    refetch();
  };

  const toggleWebSearch = async (next: boolean) => {
    setWebPending(true);
    try {
      await patchSettings({ webSearchEnabled: next });
      toast.success(next ? "Web search turned on" : "Web search turned off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setWebPending(false);
    }
  };

  const toggleServer = async (server: McpServer, next: boolean) => {
    setRowPendingId(server.id);
    try {
      const mcpServers = toServerInputs(settings.mcpServers).map((s) =>
        s.id === server.id ? { ...s, enabled: next } : s,
      );
      await patchSettings({ mcpServers });
      toast.success(
        next ? `${server.name} turned on` : `${server.name} turned off`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setRowPendingId(null);
    }
  };

  const removeServer = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      const mcpServers = toServerInputs(settings.mcpServers).filter(
        (s) => s.id !== deleting.id,
      );
      await patchSettings({ mcpServers });
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
      {/* Built-in: web search */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Globe className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Web search</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Lets Robyn look things up on the web, like current rates or
                filing deadlines.
              </p>
            </div>
          </div>
          <Switch
            checked={settings.webSearchEnabled}
            disabled={webPending}
            onCheckedChange={toggleWebSearch}
            aria-label="Toggle web search"
          />
        </CardContent>
      </Card>

      {/* MCP servers */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">MCP servers</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Extra tools Robyn can call, hosted anywhere you like.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
            <Plus className="h-3.5 w-3.5" />
            Add server
          </Button>
        </div>

        {settings.mcpServers.length === 0 ? (
          <EmptyState
            icon={ServerCog}
            title="No MCP servers yet."
            description="Add one to give Robyn extra tools."
          />
        ) : (
          <div className="space-y-3">
            {settings.mcpServers.map((server) => (
              <Card key={server.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {server.name}
                      </p>
                      {!server.enabled && (
                        <Badge variant="muted" className="text-[0.625rem]">
                          off
                        </Badge>
                      )}
                      {server.authConfigured && (
                        <Badge variant="outline" className="text-[0.625rem]">
                          token saved
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {server.url}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={server.enabled}
                      disabled={rowPendingId !== null}
                      onCheckedChange={(next) => toggleServer(server, next)}
                      aria-label={`Toggle ${server.name}`}
                      className="mr-1.5"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => setDialog({ mode: "edit", server })}
                      aria-label={`Edit ${server.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(server)}
                      aria-label={`Remove ${server.name}`}
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
        <McpServerDialog
          key={dialog.mode === "edit" ? dialog.server.id : "new"}
          server={dialog.mode === "edit" ? dialog.server : null}
          allServers={settings.mcpServers}
          onClose={() => setDialog(null)}
          onSaved={refetch}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="Remove this server?"
        description={
          deleting
            ? `Robyn will lose the tools from ${deleting.name}. You can add it back later.`
            : ""
        }
        confirmLabel="Remove server"
        pending={deletePending}
        onConfirm={removeServer}
      />
    </div>
  );
}

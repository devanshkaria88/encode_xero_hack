"use client";

import * as React from "react";
import { toast } from "sonner";

import { patch, post, useAction, type Schemas } from "@/lib/api";
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
import {
  asAuthToken,
  toServerInputs,
  type AgentSettings,
  type McpServer,
  type McpServerInput,
  type UpdateAgentSettings,
} from "./shared";

type TestResponse = Schemas["McpTestResponseDto"];

function isValidUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

/**
 * Add or edit one MCP server. Stored tokens never round-trip: when a token is
 * saved the field shows only a placeholder, and leaving it blank keeps the
 * stored value. Test connection probes the server without saving anything.
 */
export function McpServerDialog({
  server,
  allServers,
  onClose,
  onSaved,
}: {
  /** The server being edited, or null when adding a new one. */
  server: McpServer | null;
  allServers: McpServer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(server?.name ?? "");
  const [url, setUrl] = React.useState(server?.url ?? "");
  const [token, setToken] = React.useState("");
  const [testResult, setTestResult] = React.useState<TestResponse | null>(null);

  const test = useAction(async () => {
    const body: Schemas["McpTestRequestDto"] = { url: url.trim() };
    const typed = token.trim();
    if (typed) body.authToken = typed;
    return post<TestResponse>("/agent-settings/mcp/test", body);
  });

  const save = useAction(async () => {
    const entry: McpServerInput = {
      ...(server ? { id: server.id } : {}),
      name: name.trim(),
      url: url.trim(),
      enabled: server?.enabled ?? true,
    };
    const typed = token.trim();
    if (typed) entry.authToken = asAuthToken(typed);

    const current = toServerInputs(allServers);
    const mcpServers = server
      ? current.map((s) => (s.id === server.id ? entry : s))
      : [...current, entry];
    const body: UpdateAgentSettings = { mcpServers };
    await patch<AgentSettings>("/agent-settings", body);
  });

  const handleTest = async () => {
    if (!isValidUrl(url.trim())) {
      toast.error("Enter a full URL first, starting with http or https.");
      return;
    }
    setTestResult(null);
    try {
      const result = await test.run();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        tools: [],
        error: err instanceof Error ? err.message : "The test request failed.",
      });
    }
  };

  const handleSave = async () => {
    if (name.trim().length === 0) {
      toast.error("Give the server a name.");
      return;
    }
    if (!isValidUrl(url.trim())) {
      toast.error("The URL must start with http or https.");
      return;
    }
    try {
      await save.run();
      toast.success(server ? "Server updated" : "Server added");
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
          <DialogTitle>{server ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            An MCP server gives Robyn extra tools, like a booking system or a
            price list.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Parts catalogue"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              name="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              className="mt-1.5 font-mono text-xs"
              inputMode="url"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The server&apos;s streamable HTTP endpoint.
            </p>
          </div>

          <div>
            <Label htmlFor="mcp-token">Auth token</Label>
            <Input
              id="mcp-token"
              name="authToken"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                server?.authConfigured
                  ? "Stored. Leave blank to keep."
                  : "Optional"
              }
              className="mt-1.5 font-mono text-xs"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Sent as a bearer token. Stored securely and never shown again.
            </p>
          </div>

          {/* Test connection */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Connection</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={test.isPending || url.trim().length === 0}
              >
                {test.isPending ? "Testing…" : "Test connection"}
              </Button>
            </div>

            {server?.authConfigured && token.trim().length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                The test only uses what is typed above, not the stored token.
              </p>
            )}

            {testResult && testResult.ok && (
              <div className="mt-3">
                <p className="text-xs font-medium text-success">
                  Connected. {testResult.tools.length}{" "}
                  {testResult.tools.length === 1 ? "tool" : "tools"} found.
                </p>
                {testResult.tools.length > 0 && (
                  <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    {testResult.tools.map((tool) => (
                      <span
                        key={tool.name}
                        title={tool.description ?? undefined}
                        className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[0.6875rem] text-muted-foreground"
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {testResult && !testResult.ok && (
              <p className="mt-3 text-xs text-destructive">
                {testResult.error ?? "The server did not respond."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? "Saving…"
                : server
                  ? "Save changes"
                  : "Add server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";

import { useApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentSettings } from "./shared";
import { AgentTab } from "./agent-tab";
import { ToolsTab } from "./tools-tab";
import { SkillsTab } from "./skills-tab";

/**
 * Settings: one narrow column, three tabs. Every tab reads from the single
 * /agent-settings document and PATCHes back partial updates; the surface
 * refetches after each save so what you see is what the server holds.
 */
export function SettingsSurface() {
  const { data, error, isLoading, refetch, isValidating } =
    useApi<AgentSettings>("/agent-settings");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        description="Tune how Robyn thinks in chat: its instructions, model and tools."
      />

      {isLoading && <LoadingState rows={2} label="Loading settings" />}

      {!isLoading && error && (
        <ErrorState
          title="Couldn't load settings"
          error={error}
          onRetry={refetch}
          retrying={isValidating}
        />
      )}

      {!isLoading && !error && data && (
        <Tabs defaultValue="agent">
          <TabsList>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>
          <TabsContent value="agent">
            <AgentTab settings={data} refetch={refetch} />
          </TabsContent>
          <TabsContent value="tools">
            <ToolsTab settings={data} refetch={refetch} />
          </TabsContent>
          <TabsContent value="skills">
            <SkillsTab settings={data} refetch={refetch} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

import type { Schemas } from "@/lib/api";

export type AgentSettings = Schemas["AgentSettingsDto"];
export type McpServer = Schemas["McpServerDto"];
export type McpServerInput = Schemas["McpServerInputDto"];
export type SkillItem = Schemas["SkillDto"];
export type SkillInput = Schemas["SkillInputDto"];
export type UpdateAgentSettings = Schemas["UpdateAgentSettingsDto"];

/**
 * The generated spec models McpServerInputDto.authToken as an object type
 * (a codegen artifact of the nullable declaration in the backend Swagger DTO).
 * The wire contract is a plain string: a value stores a new token, "" or
 * omitted keeps the stored one, null clears it. This is the one sanctioned
 * cast; everything else uses the generated shapes as-is.
 */
export function asAuthToken(value: string | null): McpServerInput["authToken"] {
  return value as unknown as McpServerInput["authToken"];
}

/**
 * Map stored servers to the wholesale-replacement PATCH shape. Omitting
 * authToken keeps each server's stored token.
 */
export function toServerInputs(servers: McpServer[]): McpServerInput[] {
  return servers.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    enabled: s.enabled,
  }));
}

/** Map stored skills to the wholesale-replacement PATCH shape. */
export function toSkillInputs(skills: SkillItem[]): SkillInput[] {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    instructions: s.instructions,
    enabled: s.enabled,
  }));
}

/** Model options, constrained to the generated enum so drift fails typecheck. */
export const MODEL_OPTIONS: {
  value: AgentSettings["model"];
  label: string;
  hint: string;
}[] = [
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    hint: "Fast and sharp. The right choice for day-to-day questions.",
  },
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    hint: "The deepest thinker. Slower and pricier, best for tricky analysis.",
  },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "The quickest and cheapest. Fine for simple lookups.",
  },
];

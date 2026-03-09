import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { toonVersions, toonComponents } from "../formatter/toon.js";
import type {
  JiraVersion,
  JiraComponent,
} from "../client/types.js";

export function registerVersionAndComponentTools(server: McpServer): void {
  server.registerTool(
    "list_versions",
    {
      title: "List Versions",
      description:
        "List all versions (releases) for a project. Useful for release tracking and planning.",
      inputSchema: z.object({
        projectKey: z.string().describe("Project key, e.g. PROJ"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ projectKey }) => {
      const client = getClient();
      const cache = getCache();
      const raw = await client.call(
        () => client.api.projectVersions.getProjectVersionsPaginated({ projectIdOrKey: projectKey, maxResults: 200 }),
        { key: cache.buildKey("version", projectKey), entity: "version" }
      ) as unknown as { values: JiraVersion[] };

      const versions = raw.values ?? [];

      const text = toonVersions(versions, projectKey);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.registerTool(
    "list_components",
    {
      title: "List Components",
      description: "List all components for a project.",
      inputSchema: z.object({
        projectKey: z.string().describe("Project key, e.g. PROJ"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ projectKey }) => {
      const client = getClient();
      const cache = getCache();
      const raw = await client.call(
        () => client.api.projectComponents.getProjectComponentsPaginated({ projectIdOrKey: projectKey, maxResults: 200 }),
        { key: cache.buildKey("component", projectKey), entity: "component" }
      ) as unknown as { values: JiraComponent[] };

      const components = raw.values ?? [];

      const text = toonComponents(components, projectKey);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}

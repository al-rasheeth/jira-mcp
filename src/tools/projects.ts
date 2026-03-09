import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { toonProject, toonProjects } from "../formatter/toon.js";
import { textContent } from "./response.js";
import type { JiraProject } from "../client/types.js";

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List all accessible JIRA projects.",
      inputSchema: z.object({
        maxResults: z
          .coerce.number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max projects to return"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ maxResults }) => {
      const client = getClient();
      const cache = getCache();
      const raw = await client.call(async () => {
        const result = await client.api.projects.searchProjects({ maxResults });
        return result as unknown as { values: JiraProject[] };
      }, { key: cache.buildKey("project", "list", String(maxResults)), entity: "project" });

      const projects = raw.values ?? [];

      return textContent(toonProjects(projects));
    }
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Project",
      description: "Get detailed information about a JIRA project.",
      inputSchema: z.object({
        projectKey: z.string().describe("Project key, e.g. PROJ"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ projectKey }) => {
      const client = getClient();
      const cache = getCache();
      const project = await client.call(
        async () => {
          const raw = await client.api.projects.getProject({ projectIdOrKey: projectKey });
          return raw as unknown as JiraProject;
        },
        { key: cache.buildKey("project", projectKey), entity: "project" }
      );

      return textContent(toonProject(project));
    }
  );
}

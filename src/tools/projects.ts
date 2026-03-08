import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import type { JiraProject } from "../client/types.js";

function formatProject(p: JiraProject): string {
  return [
    `### ${p.key} — ${p.name}`,
    "",
    p.description ? p.description.trim() : "_No description_",
    "",
    `- **Type**: ${p.projectTypeKey ?? "unknown"}`,
    `- **Lead**: ${p.lead?.displayName ?? "None"}`,
  ].join("\n");
}

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List all accessible JIRA projects.",
      inputSchema: z.object({
        maxResults: z
          .number()
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
        const result = client.isCloud
          ? await client.v3.projects.searchProjects({ maxResults })
          : await client.v2.projects.searchProjects({ maxResults });
        return result as unknown as { values: JiraProject[] };
      }, { key: cache.buildKey("project", "list", String(maxResults)), entity: "project" });

      const projects = raw.values ?? [];

      if (projects.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No projects found." }],
        };
      }

      const text = projects
        .map(
          (p) =>
            `- **${p.key}** — ${p.name} (${p.projectTypeKey ?? "unknown"})`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found **${projects.length}** project(s):\n\n${text}`,
          },
        ],
      };
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
        () => client.v3.projects.getProject({ projectIdOrKey: projectKey }),
        { key: cache.buildKey("project", projectKey), entity: "project" }
      ) as unknown as JiraProject;

      return {
        content: [{ type: "text" as const, text: formatProject(project) }],
      };
    }
  );
}

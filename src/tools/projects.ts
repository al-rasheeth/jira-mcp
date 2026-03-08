import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
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
      const projects = await client.request<JiraProject[]>(
        `${client.apiBase}/project`,
        {
          query: { maxResults, expand: "lead" },
          cacheable: "project",
        }
      );

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
      const project = await client.request<JiraProject>(
        `${client.apiBase}/project/${projectKey}`,
        { cacheable: "project" }
      );

      return {
        content: [{ type: "text" as const, text: formatProject(project) }],
      };
    }
  );
}

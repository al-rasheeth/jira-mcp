import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
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
      const versions = await client.request<JiraVersion[]>(
        `${client.apiBase}/project/${projectKey}/versions`,
        { cacheable: "version" }
      );

      if (versions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No versions in project **${projectKey}**.`,
            },
          ],
        };
      }

      const lines = [`**${versions.length}** version(s) in **${projectKey}**:`, ""];

      for (const v of versions) {
        const status = v.released
          ? "Released"
          : v.archived
            ? "Archived"
            : v.overdue
              ? "**OVERDUE**"
              : "Unreleased";
        const dates = [
          v.startDate ? `start: ${v.startDate}` : null,
          v.releaseDate ? `release: ${v.releaseDate}` : null,
        ]
          .filter(Boolean)
          .join(", ");

        lines.push(
          `- **${v.name}** [${status}]${dates ? ` (${dates})` : ""}${v.description ? ` — ${v.description}` : ""}`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
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
      const components = await client.request<JiraComponent[]>(
        `${client.apiBase}/project/${projectKey}/components`,
        { cacheable: "component" }
      );

      if (components.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No components in project **${projectKey}**.`,
            },
          ],
        };
      }

      const text = components
        .map(
          (c) =>
            `- **${c.name}**${c.lead ? ` (Lead: ${c.lead.displayName})` : ""}${c.description ? ` — ${c.description}` : ""}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `**${components.length}** component(s) in **${projectKey}**:\n\n${text}`,
          },
        ],
      };
    }
  );
}

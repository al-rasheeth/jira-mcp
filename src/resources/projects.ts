import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import type { JiraProject } from "../client/types.js";

export function registerProjectResources(server: McpServer): void {
  server.registerResource(
    "jira-projects",
    "jira://projects",
    {
      title: "JIRA Projects",
      description: "List of all accessible JIRA projects",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const client = getClient();
      const cache = {
        key: getCache().buildKey("project", "all"),
        entity: "project" as const,
      };

      const result = await client.call(
        async () => {
          if (client.isCloud) {
            return await client.v3.projects.searchProjects({ maxResults: 200 });
          }
          return await client.v2.projects.searchProjects({ maxResults: 200 }) as unknown as Awaited<
            ReturnType<typeof client.v3.projects.searchProjects>
          >;
        },
        cache
      );

      const projects = (
        (result as { values?: unknown[] }).values ?? []
      ) as unknown as JiraProject[];

      const lines = ["# JIRA Projects", ""];
      for (const p of projects) {
        lines.push(
          `- **${p.key}** — ${p.name} (${p.projectTypeKey ?? "unknown"})${p.lead ? ` Lead: ${p.lead.displayName}` : ""}`
        );
      }

      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: lines.join("\n") }],
      };
    }
  );
}

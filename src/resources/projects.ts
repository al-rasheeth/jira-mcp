import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
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
      const projects = await client.request<JiraProject[]>(
        `${client.apiBase}/project`,
        { query: { maxResults: 200 }, cacheable: "project" }
      );

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

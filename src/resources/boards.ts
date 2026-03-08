import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import type { JiraBoardsResponse } from "../client/types.js";

export function registerBoardResources(server: McpServer): void {
  server.registerResource(
    "jira-boards",
    "jira://boards",
    {
      title: "JIRA Boards",
      description: "List of all agile boards (Scrum/Kanban)",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const client = getClient();
      const data = await client.request<JiraBoardsResponse>(
        `${client.agileBase}/board`,
        { query: { maxResults: 100 }, cacheable: "board" }
      );

      const lines = ["# JIRA Boards", ""];
      for (const b of data.values) {
        lines.push(
          `- **#${b.id}** ${b.name} (${b.type})${b.location?.projectKey ? ` — Project: ${b.location.projectKey}` : ""}`
        );
      }

      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: lines.join("\n") }],
      };
    }
  );
}

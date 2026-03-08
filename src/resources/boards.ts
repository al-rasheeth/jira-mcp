import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import type { JiraBoard } from "../client/types.js";

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
      const cache = {
        key: getCache().buildKey("board", "all"),
        entity: "board" as const,
      };

      const result = await client.call(
        () => client.agile.board.getAllBoards({ maxResults: 200 }),
        cache
      );

      const boards = (
        (result as { values?: unknown[] }).values ?? []
      ) as unknown as JiraBoard[];

      const lines = ["# JIRA Boards", ""];
      for (const b of boards) {
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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { toonBoards } from "../formatter/toon.js";
import type { JiraBoard } from "../client/types.js";

export function registerBoardResources(server: McpServer): void {
  server.registerResource(
    "jira-boards",
    "jira://boards",
    {
      title: "JIRA Boards",
      description: "List of all agile boards (Scrum/Kanban)",
      mimeType: "text/plain",
    },
    async (uri) => {
      const client = getClient();
      const cache = {
        key: getCache().buildKey("board", "all"),
        entity: "board" as const,
      };
      const maxResults = getConfig().maxResultsLimit;

      const result = await client.call(
        () => client.getAllBoardsPaginated({ maxResults }),
        cache
      );

      const boards = (
        (result as { values?: unknown[] }).values ?? []
      ) as unknown as JiraBoard[];

      const text = toonBoards(boards);
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text }],
      };
    }
  );
}

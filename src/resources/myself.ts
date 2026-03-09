import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { toonMyself } from "../formatter/toon.js";
import type { JiraMyself } from "../client/types.js";

export function registerMyselfResources(server: McpServer): void {
  server.registerResource(
    "jira-myself",
    "jira://myself",
    {
      title: "Current User",
      description: "The currently authenticated JIRA user",
      mimeType: "text/plain",
    },
    async (uri) => {
      const client = getClient();
      const cache = {
        key: getCache().buildKey("user", "myself"),
        entity: "user" as const,
      };

      const me = (await client.call(
        () => client.api.myself.getCurrentUser(),
        cache
      )) as unknown as JiraMyself;

      const text = toonMyself(me);
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text }],
      };
    }
  );
}

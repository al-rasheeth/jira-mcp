import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import type { JiraMyself } from "../client/types.js";

export function registerMyselfResources(server: McpServer): void {
  server.registerResource(
    "jira-myself",
    "jira://myself",
    {
      title: "Current User",
      description: "The currently authenticated JIRA user",
      mimeType: "text/markdown",
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

      const lines = [
        "# Current JIRA User",
        "",
        `- **Name**: ${me.displayName}`,
        `- **Email**: ${me.emailAddress ?? "N/A"}`,
        `- **Account ID**: ${me.accountId ?? me.key ?? "N/A"}`,
        `- **Active**: ${me.active ? "Yes" : "No"}`,
        `- **Timezone**: ${me.timeZone ?? "N/A"}`,
        `- **Locale**: ${me.locale ?? "N/A"}`,
      ];

      if (me.groups?.items?.length) {
        lines.push(
          `- **Groups**: ${me.groups.items.map((g) => g.name).join(", ")}`
        );
      }

      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: lines.join("\n") }],
      };
    }
  );
}

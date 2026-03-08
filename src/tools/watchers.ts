import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import type { JiraWatchersResponse } from "../client/types.js";

export function registerWatcherTools(server: McpServer): void {
  server.registerTool(
    "get_watchers",
    {
      title: "Get Watchers",
      description: "Get the list of users watching an issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ issueKey }) => {
      const client = getClient();
      const cache = getCache();
      const data = await client.call(
        () => client.api.issueWatchers.getIssueWatchers({ issueIdOrKey: issueKey }),
        { key: cache.buildKey("watcher", issueKey), entity: "watcher" }
      ) as unknown as JiraWatchersResponse;

      if (data.watchers.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No watchers on **${issueKey}**.`,
            },
          ],
        };
      }

      const text = data.watchers
        .map((w) => {
          const id = w.accountId ?? w.key ?? w.name ?? "";
          return `- **${w.displayName}** (${id})`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `**${data.watchCount}** watcher(s) on **${issueKey}**:\n\n${text}`,
          },
        ],
      };
    }
  );

  if (!getConfig().writeEnabled) return;

  server.registerTool(
    "add_watcher",
    {
      title: "Add Watcher",
      description: "Add a user as a watcher on an issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        accountId: z
          .string()
          .describe("Account ID (Cloud) or username (Data Center) to add as watcher"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ issueKey, accountId }) => {
      const client = getClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = { issueIdOrKey: issueKey, accountId } as any;
      await client.call(() => client.api.issueWatchers.addWatcher(params));

      getCache().invalidateEntity("watcher");

      return {
        content: [
          {
            type: "text" as const,
            text: `Added **${accountId}** as watcher on **${issueKey}**.`,
          },
        ],
      };
    }
  );
}

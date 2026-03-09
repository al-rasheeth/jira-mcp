import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { toonUsers, toonResult } from "../formatter/toon.js";
import { textContent } from "./response.js";
import type { JiraUser } from "../client/types.js";

export function registerUserTools(server: McpServer): void {
  const maxLimit = getConfig().maxResultsLimit;
  server.registerTool(
    "search_users",
    {
      title: "Search Users",
      description: "Search for JIRA users by display name or email.",
      inputSchema: z.object({
        query: z.string().describe("Search query (name or email)"),
        maxResults: z.coerce.number().int().min(1).max(maxLimit).default(10),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, maxResults }) => {
      const client = getClient();
      const cache = getCache();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchParams: any = client.isCloud
        ? { query, maxResults }
        : { username: query, maxResults };
      const users = await client.call(
        () => client.api.userSearch.findUsers(searchParams),
        { key: cache.buildKey("user", query, String(maxResults)), entity: "user" }
      ) as unknown as JiraUser[];

      return textContent(toonUsers(users));
    }
  );

  if (!getConfig().writeEnabled) return;

  server.registerTool(
    "assign_issue",
    {
      title: "Assign Issue",
      description: "Assign a JIRA issue to a user, or unassign it.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        assigneeId: z
          .string()
          .nullable()
          .describe(
            "Account ID (Cloud) or username (Data Center) to assign. Pass null to unassign."
          ),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ issueKey, assigneeId }) => {
      const client = getClient();
      const body = client.isCloud
        ? { accountId: assigneeId }
        : { name: assigneeId };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = { issueIdOrKey: issueKey, ...body } as any;
      await client.call(() => client.api.issues.assignIssue(params));

      getCache().invalidateIssue(issueKey);

      return textContent(toonResult("assigned", {
        issueKey,
        assigneeId: assigneeId ?? null,
      }));
    }
  );
}

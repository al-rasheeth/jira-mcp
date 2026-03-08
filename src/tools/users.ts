import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import type { JiraUser } from "../client/types.js";

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    "search_users",
    {
      title: "Search Users",
      description: "Search for JIRA users by display name or email.",
      inputSchema: z.object({
        query: z.string().describe("Search query (name or email)"),
        maxResults: z.number().int().min(1).max(50).default(10),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, maxResults }) => {
      const client = getClient();
      const endpoint = client.isCloud
        ? `${client.apiBase}/user/search`
        : `${client.apiBase}/user/search`;

      const users = await client.request<JiraUser[]>(endpoint, {
        query: { query, maxResults },
        cacheable: "user",
      });

      if (users.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No users matching "${query}".` },
          ],
        };
      }

      const text = users
        .map((u) => {
          const id = u.accountId ?? u.key ?? u.name ?? "unknown";
          return `- **${u.displayName}** (${id})${u.emailAddress ? ` — ${u.emailAddress}` : ""}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found **${users.length}** user(s):\n\n${text}`,
          },
        ],
      };
    }
  );

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

      await client.request<void>(
        `${client.apiBase}/issue/${issueKey}/assignee`,
        { method: "PUT", body }
      );

      getCache().invalidateIssue(issueKey);

      const assignText = assigneeId
        ? `assigned to **${assigneeId}**`
        : "unassigned";

      return {
        content: [
          {
            type: "text" as const,
            text: `Issue **${issueKey}** ${assignText}.`,
          },
        ],
      };
    }
  );
}

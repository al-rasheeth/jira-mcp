import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { adfToMarkdown, markdownToAdf } from "../client/adf-converter.js";
import type { JiraComment, AddCommentPayload } from "../client/types.js";

interface CommentsResponse {
  comments: JiraComment[];
  total: number;
  maxResults: number;
  startAt: number;
}

export function registerCommentTools(server: McpServer): void {
  server.registerTool(
    "get_comments",
    {
      title: "Get Comments",
      description: "Get comments on a JIRA issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        maxResults: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ issueKey, maxResults }) => {
      const client = getClient();
      const data = await client.request<CommentsResponse>(
        `${client.apiBase}/issue/${issueKey}/comment`,
        {
          query: { maxResults, orderBy: "-created" },
          cacheable: "comment",
        }
      );

      if (data.comments.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No comments on **${issueKey}**.`,
            },
          ],
        };
      }

      const lines = [
        `**${data.total}** comment(s) on **${issueKey}** (showing ${data.comments.length}):`,
        "",
      ];

      for (const c of data.comments) {
        const body =
          client.isCloud && typeof c.body === "object"
            ? adfToMarkdown(c.body)
            : (c.body as string);
        lines.push(
          `---`,
          `**${c.author.displayName}** — ${c.created}`,
          "",
          body.trim(),
          ""
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  if (!getConfig().writeEnabled) return;

  server.registerTool(
    "add_comment",
    {
      title: "Add Comment",
      description: "Add a comment to a JIRA issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        body: z.string().describe("Comment body in Markdown"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ issueKey, body }) => {
      const client = getClient();
      const payload: AddCommentPayload = {
        body: client.isCloud ? markdownToAdf(body) : body,
      };

      const result = await client.request<JiraComment>(
        `${client.apiBase}/issue/${issueKey}/comment`,
        { method: "POST", body: payload }
      );

      getCache().invalidateIssue(issueKey);
      getCache().invalidateEntity("comment");

      return {
        content: [
          {
            type: "text" as const,
            text: `Comment added to **${issueKey}** (ID: ${result.id}).`,
          },
        ],
      };
    }
  );
}

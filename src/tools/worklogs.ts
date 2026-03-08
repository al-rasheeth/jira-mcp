import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import type {
  JiraWorklog,
  JiraWorklogsResponse,
  AddWorklogPayload,
} from "../client/types.js";

export function registerWorklogTools(server: McpServer): void {
  server.registerTool(
    "get_worklogs",
    {
      title: "Get Worklogs",
      description: "Get time tracking worklogs for an issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        maxResults: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ issueKey, maxResults }) => {
      const client = getClient();
      const data = await client.request<JiraWorklogsResponse>(
        `${client.apiBase}/issue/${issueKey}/worklog`,
        {
          query: { maxResults },
          cacheable: "worklog",
        }
      );

      if (data.worklogs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No worklogs on **${issueKey}**.`,
            },
          ],
        };
      }

      const totalSeconds = data.worklogs.reduce(
        (sum, w) => sum + w.timeSpentSeconds,
        0
      );
      const totalHours = (totalSeconds / 3600).toFixed(1);

      const lines = [
        `**${data.total}** worklog(s) on **${issueKey}** (total: **${totalHours}h**):`,
        "",
      ];

      for (const w of data.worklogs) {
        const comment = w.comment
          ? typeof w.comment === "object"
            ? adfToMarkdown(w.comment).trim()
            : w.comment
          : "";
        lines.push(
          `- **${w.author.displayName}** — ${w.timeSpent} on ${w.started.split("T")[0]}${comment ? ` — _${comment.slice(0, 80)}_` : ""}`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  if (!getConfig().writeEnabled) return;

  server.registerTool(
    "add_worklog",
    {
      title: "Add Worklog",
      description: "Log time spent on an issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        timeSpent: z
          .string()
          .describe(
            'Time spent in JIRA format, e.g. "2h 30m", "1d", "45m"'
          ),
        started: z
          .string()
          .optional()
          .describe(
            "When the work was started (ISO date, defaults to now)"
          ),
        comment: z
          .string()
          .optional()
          .describe("Optional comment about the work done"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ issueKey, timeSpent, started, comment }) => {
      const client = getClient();
      const payload: AddWorklogPayload = { timeSpent };

      if (started) {
        payload.started = started;
      }

      if (comment) {
        payload.comment = client.isCloud
          ? {
              version: 1 as const,
              type: "doc" as const,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: comment }],
                },
              ],
            }
          : comment;
      }

      const result = await client.request<JiraWorklog>(
        `${client.apiBase}/issue/${issueKey}/worklog`,
        { method: "POST", body: payload }
      );

      getCache().invalidateEntity("worklog");

      return {
        content: [
          {
            type: "text" as const,
            text: `Worklog added to **${issueKey}**: ${result.timeSpent} (ID: ${result.id})`,
          },
        ],
      };
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import { toonWorklogs, toonResult } from "../formatter/toon.js";
import { textContent } from "./response.js";
import type {
  JiraWorklog,
  JiraWorklogsResponse,
} from "../client/types.js";

export function registerWorklogTools(server: McpServer): void {
  server.registerTool(
    "get_worklogs",
    {
      title: "Get Worklogs",
      description: "Get time tracking worklogs for an issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        maxResults: z.coerce.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ issueKey, maxResults }) => {
      const client = getClient();
      const cache = getCache();
      const data = await client.call(async () => {
        const result = await client.api.issueWorklogs.getIssueWorklog({ issueIdOrKey: issueKey, maxResults });
        return result as unknown as JiraWorklogsResponse;
      }, { key: cache.buildKey("worklog", issueKey, String(maxResults)), entity: "worklog" });

      const totalSeconds = data.worklogs.reduce(
        (sum, w) => sum + w.timeSpentSeconds,
        0
      );
      const totalHours = (totalSeconds / 3600).toFixed(1);
      const bodyTexts = data.worklogs.map((w) =>
        w.comment
          ? typeof w.comment === "object"
            ? adfToMarkdown(w.comment).trim()
            : (w.comment as string)
          : ""
      );
      return textContent(toonWorklogs(
        issueKey,
        data.worklogs,
        data.total,
        totalHours,
        bodyTexts
      ));
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        issueIdOrKey: issueKey,
        timeSpent,
      };

      if (started) {
        params.started = started;
      }

      if (comment) {
        params.comment = client.isCloud
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

      const result = await client.call(
        async () => await client.api.issueWorklogs.addWorklog(params) as unknown as JiraWorklog
      );

      getCache().invalidateEntity("worklog");

      return textContent(toonResult("worklog_added", {
        issueKey,
        timeSpent: result.timeSpent,
        id: result.id,
      }));
    }
  );
}

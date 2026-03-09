import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getConfig } from "../config.js";
import { toonStandupContext, toonResult, PROJECT_KEY_REQUIRED } from "../formatter/toon.js";

export function registerStandupSummaryPrompt(server: McpServer): void {
  const config = getConfig();

  server.registerPrompt(
    "standup-summary",
    {
      title: "Daily Standup Summary",
      description:
        "Generate a standup summary based on recent issue activity in a project.",
      argsSchema: {
        project: z
          .string()
          .optional()
          .describe(
            `Project key (default: ${config.defaultProject ?? "required"})`
          ),
        daysBack: z.coerce
          .number()
          .int()
          .min(1)
          .max(7)
          .default(1)
          .describe("Number of days to look back"),
      },
    },
    async ({ project, daysBack }) => {
      const projectKey = project ?? config.defaultProject;
      if (!projectKey) {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: toonResult("error", { message: PROJECT_KEY_REQUIRED }),
              },
            },
          ],
        };
      }

      const client = getClient();

      const recentlyUpdated = await client.search({
        jql: `project = "${projectKey}" AND updated >= -${daysBack}d ORDER BY updated DESC`,
        maxResults: 30,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "issuetype",
          "updated",
          "resolution",
        ],
      });

      const inProgress = recentlyUpdated.issues.filter(
        (i) => i.fields.status.statusCategory.key === "indeterminate"
      );
      const done = recentlyUpdated.issues.filter(
        (i) => i.fields.status.statusCategory.key === "done"
      );
      const todo = recentlyUpdated.issues.filter(
        (i) => i.fields.status.statusCategory.key === "new"
      );

      const toList = (issues: typeof recentlyUpdated.issues) =>
        issues.map((i) => ({
          key: i.key,
          summary: i.fields.summary,
          assignee: i.fields.assignee?.displayName ?? "Unassigned",
        }));

      const context = toonStandupContext({
        projectKey,
        daysBack,
        inProgress: toList(inProgress),
        done: toList(done),
        todo: toList(todo),
      });

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a scrum master assistant. Generate a concise daily standup summary from this JIRA data. Structure it as:

1. What was completed (done items)
2. What is in progress (active work)
3. What's coming up (to-do items with recent updates)
4. Blockers or concerns (high priority items stuck, unassigned work, etc.)

Keep it brief and actionable, suitable for a 5-minute standup.

${context}`,
            },
          },
        ],
      };
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getConfig } from "../config.js";
import type { JiraSearchResponse } from "../client/types.js";

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
                text: "Error: project key is required. Set JIRA_DEFAULT_PROJECT or provide `project`.",
              },
            },
          ],
        };
      }

      const client = getClient();

      const recentlyUpdated = await client.request<JiraSearchResponse>(
        `${client.apiBase}/search`,
        {
          method: "POST",
          body: {
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
          },
        }
      );

      const inProgress = recentlyUpdated.issues.filter(
        (i) => i.fields.status.statusCategory.key === "indeterminate"
      );
      const done = recentlyUpdated.issues.filter(
        (i) => i.fields.status.statusCategory.key === "done"
      );
      const todo = recentlyUpdated.issues.filter(
        (i) => i.fields.status.statusCategory.key === "new"
      );

      const formatList = (issues: typeof recentlyUpdated.issues) =>
        issues.length === 0
          ? "_None_"
          : issues
              .map(
                (i) =>
                  `- **${i.key}** ${i.fields.summary} (${i.fields.assignee?.displayName ?? "Unassigned"})`
              )
              .join("\n");

      const context = [
        `## Project: ${projectKey} (last ${daysBack} day(s))`,
        "",
        `### In Progress (${inProgress.length})`,
        formatList(inProgress),
        "",
        `### Recently Completed (${done.length})`,
        formatList(done),
        "",
        `### To Do / Updated (${todo.length})`,
        formatList(todo),
      ].join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a scrum master assistant. Generate a concise daily standup summary from this JIRA data. Structure it as:

1. **What was completed** (done items)
2. **What is in progress** (active work)
3. **What's coming up** (to-do items with recent updates)
4. **Blockers or concerns** (high priority items stuck, unassigned work, etc.)

Keep it brief and actionable, suitable for a 5-minute standup.

${context}`,
            },
          },
        ],
      };
    }
  );
}

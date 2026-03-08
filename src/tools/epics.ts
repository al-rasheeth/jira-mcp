import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import type {
  JiraEpic,
  JiraEpicsResponse,
  JiraEpicIssuesResponse,
  JiraIssue,
} from "../client/types.js";

export function registerEpicTools(server: McpServer): void {
  server.registerTool(
    "list_epics",
    {
      title: "List Epics",
      description:
        "List epics for a board. Returns epic ID, key, name, and done status.",
      inputSchema: z.object({
        boardId: z.number().int().describe("Board ID"),
        done: z
          .boolean()
          .optional()
          .describe("Filter by done status (true = closed epics)"),
        maxResults: z.number().int().min(1).max(100).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, done, maxResults }) => {
      const client = getClient();
      const data = await client.request<JiraEpicsResponse>(
        `${client.agileBase}/board/${boardId}/epic`,
        {
          query: { maxResults, done },
          cacheable: "epic",
        }
      );

      if (data.values.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No epics found." }],
        };
      }

      const text = data.values
        .map(
          (e: JiraEpic) =>
            `- **${e.key}** ${e.name ?? e.summary} ${e.done ? "~~done~~" : "[active]"}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found **${data.values.length}** epic(s):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_epic",
    {
      title: "Get Epic Details",
      description:
        "Get an epic and all its child issues. Returns epic metadata plus a breakdown of issues by status, priority, and assignee.",
      inputSchema: z.object({
        epicKey: z.string().describe("Epic issue key, e.g. PROJ-42"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Max child issues to return"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ epicKey, maxResults }) => {
      const client = getClient();

      const epicIssue = await client.request<JiraIssue>(
        `${client.apiBase}/issue/${epicKey}`,
        {
          query: {
            fields:
              "summary,status,priority,assignee,description,labels,created,updated,project,fixVersions",
          },
          cacheable: "epic",
        }
      );

      const childData = await client.request<JiraEpicIssuesResponse>(
        `${client.agileBase}/epic/${epicKey}/issue`,
        {
          query: {
            maxResults,
            fields:
              "summary,status,priority,assignee,issuetype,labels,created,updated",
          },
          cacheable: "epic",
        }
      );

      const issues = childData.issues;
      const total = childData.total;

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byAssignee: Record<string, number> = {};
      let doneCount = 0;

      for (const issue of issues) {
        const f = issue.fields;
        const statusName = f.status.name;
        byStatus[statusName] = (byStatus[statusName] ?? 0) + 1;
        if (f.status.statusCategory.key === "done") doneCount++;

        const priName = f.priority?.name ?? "None";
        byPriority[priName] = (byPriority[priName] ?? 0) + 1;

        const assigneeName = f.assignee?.displayName ?? "Unassigned";
        byAssignee[assigneeName] = (byAssignee[assigneeName] ?? 0) + 1;
      }

      const completionPct =
        total > 0 ? Math.round((doneCount / total) * 100) : 0;

      const ef = epicIssue.fields;
      const lines = [
        `## Epic: [${epicKey}] ${ef.summary}`,
        "",
        `| Metric | Value |`,
        `| --- | --- |`,
        `| Status | ${ef.status.name} |`,
        `| Priority | ${ef.priority?.name ?? "None"} |`,
        `| Assignee | ${ef.assignee?.displayName ?? "Unassigned"} |`,
        `| Total Issues | ${total} |`,
        `| Completion | **${completionPct}%** (${doneCount}/${total} done) |`,
        `| Labels | ${ef.labels?.join(", ") || "None"} |`,
        "",
        "### Status Breakdown",
        "",
        ...Object.entries(byStatus)
          .sort(([, a], [, b]) => b - a)
          .map(([status, count]) => `- ${status}: **${count}**`),
        "",
        "### Priority Breakdown",
        "",
        ...Object.entries(byPriority)
          .sort(([, a], [, b]) => b - a)
          .map(([pri, count]) => `- ${pri}: **${count}**`),
        "",
        "### Assignee Distribution",
        "",
        ...Object.entries(byAssignee)
          .sort(([, a], [, b]) => b - a)
          .map(([name, count]) => `- ${name}: **${count}**`),
        "",
        "### Child Issues",
        "",
        ...issues.map(
          (i) =>
            `- **${i.key}** ${i.fields.summary} — *${i.fields.status.name}* (${i.fields.priority?.name ?? "None"}) [${i.fields.assignee?.displayName ?? "Unassigned"}]`
        ),
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  if (!getConfig().writeEnabled) return;

  server.registerTool(
    "move_issues_to_epic",
    {
      title: "Move Issues to Epic",
      description:
        "Assign one or more issues to an epic. Pass the epic key and an array of issue keys.",
      inputSchema: z.object({
        epicKey: z.string().describe("Epic issue key, e.g. PROJ-42"),
        issueKeys: z
          .array(z.string())
          .min(1)
          .describe("Issue keys to move into this epic"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ epicKey, issueKeys }) => {
      const client = getClient();
      await client.request<void>(
        `${client.agileBase}/epic/${epicKey}/issue`,
        {
          method: "POST",
          body: { issues: issueKeys },
        }
      );

      getCache().invalidateEntity("epic");
      for (const key of issueKeys) {
        getCache().invalidateIssue(key);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Moved **${issueKeys.length}** issue(s) to epic **${epicKey}**: ${issueKeys.join(", ")}`,
          },
        ],
      };
    }
  );
}

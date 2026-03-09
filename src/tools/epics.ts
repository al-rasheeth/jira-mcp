import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { toonEpics, toonEpicDetail, toonResult } from "../formatter/toon.js";
import { textContent } from "./response.js";
import type {
  JiraEpic,
  JiraEpicsResponse,
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
      const cache = getCache();
      const data = await client.call(
        () => client.agile.board.getEpics({ boardId, maxResults, done: done !== undefined ? String(done) : undefined }),
        { key: cache.buildKey("epic", "list", String(boardId), String(done ?? ""), String(maxResults)), entity: "epic" }
      ) as unknown as JiraEpicsResponse;

      return textContent(toonEpics(data.values as JiraEpic[]));
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

      const epicIssue = await client.getIssue(epicKey, [
        "summary", "status", "priority", "assignee", "description",
        "labels", "created", "updated", "project", "fixVersions",
      ]);

      const childJql = client.isCloud
        ? `parent = ${epicKey} ORDER BY rank ASC`
        : `"Epic Link" = ${epicKey} ORDER BY rank ASC`;

      const childData = await client.search({
        jql: childJql,
        fields: [
          "summary", "status", "priority", "assignee",
          "issuetype", "labels", "created", "updated",
        ],
        maxResults,
      });

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

      const ef = epicIssue.fields;
      const childIssues = issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
        priority: i.fields.priority?.name ?? "None",
        assignee: i.fields.assignee?.displayName ?? "Unassigned",
      }));

      return textContent(toonEpicDetail(
        epicKey,
        ef.summary,
        ef.status.name,
        ef.priority?.name ?? "None",
        ef.assignee?.displayName ?? "Unassigned",
        ef.labels?.join(", ") || "None",
        total,
        doneCount,
        byStatus,
        byPriority,
        byAssignee,
        childIssues
      ));
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
      await client.call(() =>
        client.agile.epic.moveIssuesToEpic({ epicIdOrKey: epicKey, issues: issueKeys })
      );

      getCache().invalidateEntity("epic");
      for (const key of issueKeys) {
        getCache().invalidateIssue(key);
      }

      return textContent(toonResult("moved", { epicKey, issueKeys, count: issueKeys.length }));
    }
  );
}

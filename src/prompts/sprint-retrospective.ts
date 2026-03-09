import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { toonSprintRetroContext } from "../formatter/toon.js";
import type {
  JiraSprint,
  JiraSprintIssuesResponse,
  JiraIssue,
} from "../client/types.js";

export function registerSprintRetrospectivePrompt(server: McpServer): void {
  server.registerPrompt(
    "sprint-retrospective",
    {
      title: "Sprint Retrospective",
      description:
        "Analyze a completed sprint: what was delivered, what slipped, velocity analysis, and improvement suggestions.",
      argsSchema: {
        boardId: z.coerce.number().int().describe("Board ID"),
        sprintId: z.coerce.number().int().describe("Sprint ID (should be a closed sprint)"),
      },
    },
    async ({ boardId, sprintId }) => {
      const client = getClient();

      const sprint = await client.call(
        () => client.agile.sprint.getSprint({ sprintId })
      ) as unknown as JiraSprint;

      const issuesData = await client.call(
        () => client.agile.board.getBoardIssuesForSprint({
          boardId,
          sprintId,
          fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'labels', 'project', 'resolution', 'created', 'updated'],
          maxResults: 100,
        })
      ) as unknown as JiraSprintIssuesResponse;

      const issues = issuesData.issues;
      const completed: JiraIssue[] = [];
      const incomplete: JiraIssue[] = [];
      const byAssignee: Record<string, { done: number; notDone: number }> = {};
      const byType: Record<string, { done: number; notDone: number }> = {};

      for (const issue of issues) {
        const f = issue.fields;
        const isDone = f.status.statusCategory.key === "done";
        if (isDone) completed.push(issue);
        else incomplete.push(issue);

        const assignee = f.assignee?.displayName ?? "Unassigned";
        if (!byAssignee[assignee]) byAssignee[assignee] = { done: 0, notDone: 0 };
        byAssignee[assignee][isDone ? "done" : "notDone"]++;

        const type = f.issuetype.name;
        if (!byType[type]) byType[type] = { done: 0, notDone: 0 };
        byType[type][isDone ? "done" : "notDone"]++;
      }

      const completionRate =
        issues.length > 0
          ? Math.round((completed.length / issues.length) * 100)
          : 0;

      const toIssue = (i: JiraIssue) => ({
        key: i.key,
        summary: i.fields.summary,
        type: i.fields.issuetype.name,
        priority: i.fields.priority?.name ?? "None",
        assignee: i.fields.assignee?.displayName ?? "Unassigned",
      });

      const assigneeStats = Object.entries(byAssignee)
        .sort(([, a], [, b]) => b.done + b.notDone - (a.done + a.notDone))
        .map(([name, stats]) => {
          const total = stats.done + stats.notDone;
          const rate = total > 0 ? Math.round((stats.done / total) * 100) : 0;
          return { name, done: stats.done, notDone: stats.notDone, rate };
        });

      const context = toonSprintRetroContext({
        sprint: {
          name: sprint.name,
          state: sprint.state,
          startDate: sprint.startDate?.split("T")[0],
          endDate: sprint.endDate?.split("T")[0],
          completeDate: sprint.completeDate?.split("T")[0],
          goal: sprint.goal ?? undefined,
        },
        completionRate,
        completedCount: completed.length,
        totalCount: issues.length,
        completed: completed.map(toIssue),
        incomplete: incomplete.map(toIssue),
        byAssignee: assigneeStats,
        byType,
      });

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a scrum master facilitating a sprint retrospective. Analyze this sprint and provide:

1. Sprint Summary: What was the sprint about and did it meet its goal?
2. What Went Well: Highlight completed work, on-time delivery, good patterns
3. What Didn't Go Well: Incomplete items, patterns of failure, overcommitment signals
4. Velocity Analysis: Completion rate by assignee and type — who delivered, where were gaps
5. Carry-Over Impact: Assess the incomplete items — are they blockers? Should they be re-prioritized?
6. Action Items: 3-5 concrete improvement suggestions for the next sprint

${context}`,
            },
          },
        ],
      };
    }
  );
}

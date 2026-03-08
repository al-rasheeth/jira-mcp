import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
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

      const sprint = await client.request<JiraSprint>(
        `${client.agileBase}/sprint/${sprintId}`
      );

      const issuesData = await client.request<JiraSprintIssuesResponse>(
        `${client.agileBase}/sprint/${sprintId}/issue`,
        {
          query: {
            maxResults: 100,
            fields:
              "summary,status,priority,assignee,issuetype,labels,project,resolution,created,updated",
          },
        }
      );

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

      const formatIssueList = (list: JiraIssue[]) =>
        list.length === 0
          ? "_None_"
          : list
              .map(
                (i) =>
                  `- **${i.key}** ${i.fields.summary} (${i.fields.issuetype.name}, ${i.fields.priority?.name ?? "None"}) [${i.fields.assignee?.displayName ?? "Unassigned"}]`
              )
              .join("\n");

      const assigneeStats = Object.entries(byAssignee)
        .sort(([, a], [, b]) => b.done + b.notDone - (a.done + a.notDone))
        .map(
          ([name, stats]) =>
            `- ${name}: ${stats.done} done, ${stats.notDone} not done (${Math.round((stats.done / (stats.done + stats.notDone)) * 100)}% rate)`
        )
        .join("\n");

      const typeStats = Object.entries(byType)
        .map(
          ([type, stats]) =>
            `- ${type}: ${stats.done} done, ${stats.notDone} not done`
        )
        .join("\n");

      const context = [
        `## Sprint: ${sprint.name}`,
        `- **State**: ${sprint.state}`,
        sprint.startDate
          ? `- **Start**: ${sprint.startDate.split("T")[0]}`
          : null,
        sprint.endDate
          ? `- **End**: ${sprint.endDate.split("T")[0]}`
          : null,
        sprint.completeDate
          ? `- **Completed**: ${sprint.completeDate.split("T")[0]}`
          : null,
        sprint.goal ? `- **Goal**: ${sprint.goal}` : null,
        "",
        `## Results: **${completionRate}%** completion (${completed.length}/${issues.length})`,
        "",
        "### Completed Issues",
        formatIssueList(completed),
        "",
        "### Incomplete / Carried Over",
        formatIssueList(incomplete),
        "",
        "### By Assignee",
        assigneeStats,
        "",
        "### By Type",
        typeStats,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a scrum master facilitating a sprint retrospective. Analyze this sprint and provide:

1. **Sprint Summary**: What was the sprint about and did it meet its goal?
2. **What Went Well**: Highlight completed work, on-time delivery, good patterns
3. **What Didn't Go Well**: Incomplete items, patterns of failure, overcommitment signals
4. **Velocity Analysis**: Completion rate by assignee and type — who delivered, where were gaps
5. **Carry-Over Impact**: Assess the incomplete items — are they blockers? Should they be re-prioritized?
6. **Action Items**: 3-5 concrete improvement suggestions for the next sprint

${context}`,
            },
          },
        ],
      };
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { toonSprintContext } from "../formatter/toon.js";
import type {
  JiraSprint,
  JiraSprintIssuesResponse,
} from "../client/types.js";

export function registerSprintPlanningPrompt(server: McpServer): void {
  server.registerPrompt(
    "sprint-planning",
    {
      title: "Sprint Planning Analysis",
      description:
        "Analyze a sprint's issues and provide planning insights: workload distribution, risk areas, and recommendations.",
      argsSchema: {
        boardId: z.coerce.number().int().describe("Board ID"),
        sprintId: z.coerce.number().int().describe("Sprint ID"),
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
          fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'labels', 'project'],
          maxResults: 100,
        })
      ) as unknown as JiraSprintIssuesResponse;

      const issues = issuesData.issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        type: i.fields.issuetype.name,
        priority: i.fields.priority?.name ?? "None",
        status: i.fields.status.name,
        assignee: i.fields.assignee?.displayName ?? "Unassigned",
      }));

      const context = toonSprintContext({
        sprint: {
          name: sprint.name,
          state: sprint.state,
          startDate: sprint.startDate?.split("T")[0],
          endDate: sprint.endDate?.split("T")[0],
          goal: sprint.goal ?? undefined,
          boardId,
        },
        issues,
        total: issuesData.total,
      });

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a JIRA sprint planning assistant. Analyze the following sprint data and provide:

1. Workload Distribution: How work is distributed across team members
2. Risk Assessment: Issues that might be at risk (high priority unassigned, blockers, etc.)
3. Sprint Health: Overall assessment of whether the sprint goal is achievable
4. Recommendations: Concrete suggestions to improve the sprint outcome

${context}`,
            },
          },
        ],
      };
    }
  );
}

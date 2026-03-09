import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getConfig } from "../config.js";
import { toonWorkloadContext, toonResult, PROJECT_KEY_REQUIRED } from "../formatter/toon.js";
import type { JiraIssue } from "../client/types.js";

export function registerWorkloadBalancePrompt(server: McpServer): void {
  const config = getConfig();

  server.registerPrompt(
    "workload-balance",
    {
      title: "Workload Balance Analysis",
      description:
        "Analyze how work is distributed across team members in a project. Identifies overloaded and underutilized members.",
      argsSchema: {
        project: z
          .string()
          .optional()
          .describe(
            `Project key (default: ${config.defaultProject ?? "required"})`
          ),
      },
    },
    async ({ project }) => {
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

      const openIssues = await client.search({
        jql: `project = "${projectKey}" AND resolution = Unresolved ORDER BY assignee ASC, priority DESC`,
        maxResults: 100,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "issuetype",
          "created",
          "updated",
        ],
      });

      const issues = openIssues.issues;
      const total = openIssues.total;

      const byAssignee: Record<
        string,
        {
          issues: JiraIssue[];
          byPriority: Record<string, number>;
          byStatus: Record<string, number>;
          byType: Record<string, number>;
        }
      > = {};

      for (const issue of issues) {
        const f = issue.fields;
        const name = f.assignee?.displayName ?? "Unassigned";
        if (!byAssignee[name]) {
          byAssignee[name] = {
            issues: [],
            byPriority: {},
            byStatus: {},
            byType: {},
          };
        }
        const entry = byAssignee[name];
        entry.issues.push(issue);

        const pri = f.priority?.name ?? "None";
        entry.byPriority[pri] = (entry.byPriority[pri] ?? 0) + 1;

        const status = f.status.name;
        entry.byStatus[status] = (entry.byStatus[status] ?? 0) + 1;

        const type = f.issuetype.name;
        entry.byType[type] = (entry.byType[type] ?? 0) + 1;
      }

      const assignedMemberCount = Object.keys(byAssignee).filter(
        (n) => n !== "Unassigned"
      ).length;
      const avgLoad =
        assignedMemberCount > 0 ? Math.round(total / assignedMemberCount) : 0;

      const byMember = Object.entries(byAssignee)
        .sort(([, a], [, b]) => b.issues.length - a.issues.length)
        .map(([name, data]) => {
          const highPri =
            (data.byPriority["Highest"] ?? 0) +
            (data.byPriority["High"] ?? 0) +
            (data.byPriority["Critical"] ?? 0);
          return {
            name,
            issueCount: data.issues.length,
            highPriCount: highPri,
            byPriority: data.byPriority,
            byStatus: data.byStatus,
            issueKeys: data.issues.map((i) => i.key),
          };
        });

      const context = toonWorkloadContext({
        projectKey,
        totalOpen: total,
        teamMemberCount: assignedMemberCount,
        avgLoad,
        unassignedCount: byAssignee["Unassigned"]?.issues.length ?? 0,
        byMember,
      });

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a team lead analyzing workload distribution. Provide:

1. Balance Assessment: Is work evenly distributed? Who is overloaded vs underutilized?
2. Risk Identification: Team members with too many high-priority items, single points of failure
3. Unassigned Work: Triage the unassigned issues — who should pick them up?
4. Bottleneck Detection: Any patterns indicating bottlenecks (too many in-progress, blocked items)?
5. Rebalancing Recommendations: Specific suggestions to redistribute work more effectively

${context}`,
            },
          },
        ],
      };
    }
  );
}

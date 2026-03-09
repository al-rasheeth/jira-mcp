import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getConfig } from "../config.js";
import { toonEpicAnalysisContext } from "../formatter/toon.js";
import type { JiraIssue } from "../client/types.js";

export function registerEpicAnalysisPrompt(server: McpServer): void {
  server.registerPrompt(
    "epic-analysis",
    {
      title: "Epic Analysis",
      description:
        "Deep analysis of an epic: completion progress, risk assessment, timeline projection, blockers, and team load across its child issues.",
      argsSchema: {
        epicKey: z.string().describe("Epic issue key, e.g. PROJ-42"),
      },
    },
    async ({ epicKey }) => {
      const client = getClient();

      const epicIssue = await client.getIssue(epicKey, [
        "summary", "status", "priority", "assignee", "description",
        "labels", "created", "updated", "project", "fixVersions", "components",
      ]);

      const childJql = client.isCloud
        ? `parent = "${epicKey}" ORDER BY status ASC, priority DESC`
        : `"Epic Link" = "${epicKey}" ORDER BY status ASC, priority DESC`;

      const childData = await client.search({
        jql: childJql,
        maxResults: getConfig().maxResultsLimit,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "issuetype",
          "labels",
          "created",
          "updated",
          "resolution",
          "issuelinks",
          "fixVersions",
          "components",
        ],
      });

      const issues = childData.issues;
      const total = childData.total;

      const byStatus: Record<string, JiraIssue[]> = {};
      const byAssignee: Record<string, JiraIssue[]> = {};
      const byType: Record<string, number> = {};
      let doneCount = 0;
      let inProgressCount = 0;
      const blockers: string[] = [];
      const unassignedHighPri: string[] = [];
      const staleIssues: string[] = [];

      const now = Date.now();
      const STALE_DAYS = 14;

      for (const issue of issues) {
        const f = issue.fields;
        const statusName = f.status.name;
        const catKey = f.status.statusCategory.key;

        if (!byStatus[statusName]) byStatus[statusName] = [];
        byStatus[statusName].push(issue);

        if (catKey === "done") doneCount++;
        if (catKey === "indeterminate") inProgressCount++;

        const assigneeName = f.assignee?.displayName ?? "Unassigned";
        if (!byAssignee[assigneeName]) byAssignee[assigneeName] = [];
        byAssignee[assigneeName].push(issue);

        const typeName = f.issuetype.name;
        byType[typeName] = (byType[typeName] ?? 0) + 1;

        const priName = f.priority?.name ?? "";
        if (
          !f.assignee &&
          (priName === "Highest" || priName === "High" || priName === "Critical")
        ) {
          unassignedHighPri.push(`${issue.key} — ${f.summary} (${priName})`);
        }

        const links = (f.issuelinks ?? []) as Array<{
          type: { name: string };
          inwardIssue?: { key: string; fields?: { status: { statusCategory: { key: string } } } };
        }>;
        for (const link of links) {
          if (
            link.type.name === "Blocks" &&
            link.inwardIssue &&
            link.inwardIssue.fields?.status?.statusCategory?.key !== "done"
          ) {
            blockers.push(
              `${issue.key} blocked by ${link.inwardIssue.key}`
            );
          }
        }

        const updatedMs = new Date(f.updated).getTime();
        const daysSinceUpdate = (now - updatedMs) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate > STALE_DAYS && catKey !== "done") {
          staleIssues.push(
            `${issue.key} — ${f.summary} (${Math.round(daysSinceUpdate)}d stale)`
          );
        }
      }

      const completionPct =
        total > 0 ? Math.round((doneCount / total) * 100) : 0;

      const ef = epicIssue.fields;

      const byStatusCounts: Record<string, number> = {};
      for (const [k, items] of Object.entries(byStatus)) {
        byStatusCounts[k] = items.length;
      }

      const assigneeBreakdown = Object.entries(byAssignee)
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([name, items]) => ({
          name,
          total: items.length,
          done: items.filter((i) => i.fields.status.statusCategory.key === "done").length,
        }));

      const issuesList = issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        type: i.fields.issuetype.name,
        status: i.fields.status.name,
        priority: i.fields.priority?.name ?? "None",
        assignee: i.fields.assignee?.displayName ?? "Unassigned",
        updated: i.fields.updated.split("T")[0],
      }));

      const context = toonEpicAnalysisContext({
        epicKey,
        epicSummary: ef.summary,
        project: `${ef.project.key} — ${ef.project.name}`,
        status: ef.status.name,
        priority: ef.priority?.name ?? "None",
        assignee: ef.assignee?.displayName ?? "Unassigned",
        labels: ef.labels?.join(", ") || "None",
        fixVersions: ef.fixVersions?.length ? ef.fixVersions.map((v) => v.name).join(", ") : undefined,
        components: ef.components?.length ? ef.components.map((c) => c.name).join(", ") : undefined,
        completionPct,
        doneCount,
        total,
        inProgressCount,
        byStatus: byStatusCounts,
        byType,
        byAssignee: assigneeBreakdown,
        blockers,
        unassignedHighPri,
        staleIssues,
        issues: issuesList,
      });

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a JIRA epic analysis expert. Analyze this epic and provide a comprehensive report:

1. Health Score: Rate the epic's health (Healthy / At Risk / Critical) with justification
2. Completion Forecast: Based on current velocity and remaining work, estimate completion timeline
3. Risk Assessment: Identify blockers, unassigned high-priority issues, stale items, and dependency risks
4. Team Load: Analyze workload distribution across assignees — who is overloaded or has capacity
5. Recommendations: Concrete actionable steps to get this epic back on track or keep it healthy
6. Priority Ranking: Which remaining issues should be tackled first and why

${context}`,
            },
          },
        ],
      };
    }
  );
}

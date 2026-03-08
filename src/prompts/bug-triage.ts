import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import type { JiraSearchResponse } from "../client/types.js";

export function registerBugTriagePrompt(server: McpServer): void {
  server.registerPrompt(
    "bug-triage",
    {
      title: "Bug Triage",
      description:
        "Fetch bugs matching a JQL query and generate prioritization recommendations.",
      argsSchema: {
        jql: z
          .string()
          .default('issuetype = Bug AND resolution = Unresolved ORDER BY priority DESC, created DESC')
          .describe("JQL to find bugs (defaults to all unresolved bugs)"),
        maxResults: z.coerce.number().int().min(1).max(50).default(20),
      },
    },
    async ({ jql, maxResults }) => {
      const client = getClient();

      const data = await client.search({
        jql,
        maxResults,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "reporter",
          "created",
          "updated",
          "labels",
          "description",
          "project",
          "components",
        ],
      });

      const bugLines = data.issues
        .map((issue) => {
          const f = issue.fields;
          const desc =
            client.isCloud &&
            f.description &&
            typeof f.description === "object"
              ? adfToMarkdown(f.description).slice(0, 200)
              : ((f.description as string) ?? "").slice(0, 200);

          return [
            `### ${issue.key} — ${f.summary}`,
            `- Priority: ${f.priority?.name ?? "None"}`,
            `- Status: ${f.status.name}`,
            `- Assignee: ${f.assignee?.displayName ?? "Unassigned"}`,
            `- Reporter: ${f.reporter?.displayName ?? "Unknown"}`,
            `- Created: ${f.created}`,
            `- Components: ${f.components?.map((c) => c.name).join(", ") || "None"}`,
            `- Labels: ${f.labels?.join(", ") || "None"}`,
            desc ? `- Description preview: ${desc.trim()}...` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a JIRA bug triage specialist. Analyze these ${data.total} bug(s) and provide:

1. **Priority Ranking**: Rank the bugs by impact and urgency
2. **Quick Wins**: Bugs that appear easy to fix and should be addressed first
3. **Critical Issues**: Bugs that need immediate attention
4. **Patterns**: Any recurring themes, affected components, or systemic issues
5. **Triage Recommendations**: Suggested assignees or actions for unassigned bugs

## Bugs (${data.issues.length} of ${data.total} shown)

${bugLines}`,
            },
          },
        ],
      };
    }
  );
}

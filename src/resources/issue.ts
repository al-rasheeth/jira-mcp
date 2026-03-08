import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import type { JiraIssue } from "../client/types.js";

export function registerIssueResources(server: McpServer): void {
  server.registerResource(
    "jira-issue",
    new ResourceTemplate("jira://issue/{issueKey}", {
      list: undefined,
    }),
    {
      title: "JIRA Issue",
      description: "Detailed view of a single JIRA issue by key",
      mimeType: "text/markdown",
    },
    async (uri, { issueKey }) => {
      const client = getClient();
      const key = issueKey as string;

      const issue = await client.request<JiraIssue>(
        `${client.apiBase}/issue/${key}`,
        {
          query: {
            fields:
              "summary,status,priority,assignee,reporter,issuetype,description,labels,comment,created,updated,resolution,fixVersions,components,project,parent",
          },
          cacheable: "issue",
        }
      );

      const f = issue.fields;
      const desc =
        client.isCloud && f.description && typeof f.description === "object"
          ? adfToMarkdown(f.description)
          : (f.description as string) ?? "_No description_";

      const lines = [
        `# [${issue.key}] ${f.summary}`,
        "",
        "| Field | Value |",
        "| --- | --- |",
        `| Status | ${f.status.name} |`,
        `| Type | ${f.issuetype.name} |`,
        `| Priority | ${f.priority?.name ?? "None"} |`,
        `| Assignee | ${f.assignee?.displayName ?? "Unassigned"} |`,
        `| Reporter | ${f.reporter?.displayName ?? "Unknown"} |`,
        `| Labels | ${f.labels?.join(", ") || "None"} |`,
        `| Created | ${f.created} |`,
        `| Updated | ${f.updated} |`,
        `| Resolution | ${f.resolution?.name ?? "Unresolved"} |`,
        `| Project | ${f.project.key} — ${f.project.name} |`,
        "",
        "## Description",
        "",
        desc.trim() || "_No description_",
      ];

      if (f.comment?.comments?.length) {
        lines.push("", "## Comments", "");
        for (const c of f.comment.comments) {
          const body =
            client.isCloud && typeof c.body === "object"
              ? adfToMarkdown(c.body)
              : (c.body as string);
          lines.push(
            `### ${c.author.displayName} — ${c.created}`,
            "",
            body.trim(),
            ""
          );
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: lines.join("\n"),
          },
        ],
      };
    }
  );
}

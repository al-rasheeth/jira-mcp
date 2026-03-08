import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { adfToMarkdown, markdownToAdf } from "../client/adf-converter.js";
import { getConfig } from "../config.js";
import type {
  JiraSearchResponse,
  JiraIssue,
  CreateIssuePayload,
  UpdateIssuePayload,
} from "../client/types.js";

function formatIssue(issue: JiraIssue): string {
  const f = issue.fields;
  const client = getClient();
  const desc =
    client.isCloud && f.description && typeof f.description === "object"
      ? adfToMarkdown(f.description)
      : (f.description as string) ?? "No description";

  const lines = [
    `## [${issue.key}] ${f.summary}`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Status | ${f.status.name} |`,
    `| Type | ${f.issuetype.name} |`,
    `| Priority | ${f.priority?.name ?? "None"} |`,
    `| Assignee | ${f.assignee?.displayName ?? "Unassigned"} |`,
    `| Reporter | ${f.reporter?.displayName ?? "Unknown"} |`,
    `| Labels | ${f.labels?.join(", ") || "None"} |`,
    `| Created | ${f.created} |`,
    `| Updated | ${f.updated} |`,
    `| Resolution | ${f.resolution?.name ?? "Unresolved"} |`,
    `| Project | ${f.project.key} - ${f.project.name} |`,
  ];

  if (f.parent) {
    lines.push(`| Parent | ${f.parent.key} - ${f.parent.fields?.summary ?? ""} |`);
  }

  if (f.fixVersions?.length) {
    lines.push(
      `| Fix Versions | ${f.fixVersions.map((v) => v.name).join(", ")} |`
    );
  }

  if (f.components?.length) {
    lines.push(
      `| Components | ${f.components.map((c) => c.name).join(", ")} |`
    );
  }

  lines.push("", "### Description", "", desc.trim() || "_No description_");

  if (f.comment?.comments?.length) {
    lines.push("", "### Comments", "");
    for (const c of f.comment.comments.slice(-5)) {
      const body =
        client.isCloud && typeof c.body === "object"
          ? adfToMarkdown(c.body)
          : (c.body as string);
      lines.push(
        `**${c.author.displayName}** (${c.created}):`,
        body.trim(),
        ""
      );
    }
  }

  return lines.join("\n");
}

function formatSearchResults(issues: JiraIssue[], total: number): string {
  if (issues.length === 0) return "No issues found.";

  const lines = [`Found **${total}** issue(s):`, ""];
  for (const issue of issues) {
    const f = issue.fields;
    lines.push(
      `- **${issue.key}** ${f.summary} — *${f.status.name}* (${f.priority?.name ?? "None"}) [${f.assignee?.displayName ?? "Unassigned"}]`
    );
  }
  return lines.join("\n");
}

export function registerIssueTools(server: McpServer): void {
  const config = getConfig();

  server.registerTool(
    "search_issues",
    {
      title: "Search Issues (JQL)",
      description:
        "Search for JIRA issues using JQL. Returns a summary list of matching issues.",
      inputSchema: z.object({
        jql: z.string().describe("JQL query string"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Max results to return"),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated field names to include (default: summary,status,priority,assignee,issuetype,labels,project)"
          ),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ jql, maxResults, fields }) => {
      const client = getClient();
      const fieldList =
        fields ??
        "summary,status,priority,assignee,issuetype,labels,project,reporter";

      const data = await client.request<JiraSearchResponse>(
        `${client.apiBase}/search`,
        {
          method: "POST",
          body: { jql, maxResults, fields: fieldList.split(",").map((f) => f.trim()) },
          cacheable: "search",
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatSearchResults(data.issues, data.total),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_issue",
    {
      title: "Get Issue",
      description:
        "Get full details of a single JIRA issue by key, including description and recent comments.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ issueKey }) => {
      const client = getClient();
      const issue = await client.request<JiraIssue>(
        `${client.apiBase}/issue/${issueKey}`,
        {
          query: {
            fields:
              "summary,status,priority,assignee,reporter,issuetype,description,labels,comment,created,updated,resolution,fixVersions,components,project,parent,subtasks",
          },
          cacheable: "issue",
        }
      );

      return {
        content: [{ type: "text" as const, text: formatIssue(issue) }],
      };
    }
  );

  server.registerTool(
    "create_issue",
    {
      title: "Create Issue",
      description: "Create a new JIRA issue.",
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe(
            `Project key (default: ${config.defaultProject ?? "must be specified"})`
          ),
        summary: z.string().describe("Issue summary/title"),
        issueType: z
          .string()
          .default("Task")
          .describe("Issue type name (Task, Bug, Story, etc.)"),
        description: z
          .string()
          .optional()
          .describe("Issue description in Markdown"),
        priority: z
          .string()
          .optional()
          .describe("Priority name (Highest, High, Medium, Low, Lowest)"),
        assigneeId: z
          .string()
          .optional()
          .describe("Assignee account ID (Cloud) or username (Data Center)"),
        labels: z.array(z.string()).optional().describe("Array of labels"),
        parentKey: z.string().optional().describe("Parent issue key for sub-tasks"),
        customFields: z
          .record(z.unknown())
          .optional()
          .describe(
            "Custom fields map. Use friendly names if configured in JIRA_CUSTOM_FIELDS."
          ),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({
      project,
      summary,
      issueType,
      description,
      priority,
      assigneeId,
      labels,
      parentKey,
      customFields,
    }) => {
      const client = getClient();
      const projectKey = project ?? config.defaultProject;
      if (!projectKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: project key is required. Set JIRA_DEFAULT_PROJECT or pass `project`.",
            },
          ],
          isError: true,
        };
      }

      const payload: CreateIssuePayload = {
        fields: {
          project: { key: projectKey },
          summary,
          issuetype: { name: issueType },
        },
      };

      if (description) {
        payload.fields.description = client.isCloud
          ? markdownToAdf(description)
          : description;
      }

      if (priority) payload.fields.priority = { name: priority };

      if (assigneeId) {
        payload.fields.assignee = client.isCloud
          ? { accountId: assigneeId }
          : { name: assigneeId };
      }

      if (labels) payload.fields.labels = labels;
      if (parentKey) payload.fields.parent = { key: parentKey };

      if (customFields) {
        const resolved = client.resolveCustomFields(customFields);
        Object.assign(payload.fields, resolved);
      }

      const result = await client.request<JiraIssue>(
        `${client.apiBase}/issue`,
        { method: "POST", body: payload }
      );

      getCache().invalidateEntity("search");

      return {
        content: [
          {
            type: "text" as const,
            text: `Issue **${result.key}** created successfully.\n\nURL: ${getConfig().baseUrl}/browse/${result.key}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "update_issue",
    {
      title: "Update Issue",
      description: "Update fields on an existing JIRA issue.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        summary: z.string().optional().describe("New summary"),
        description: z.string().optional().describe("New description in Markdown"),
        priority: z.string().optional().describe("New priority name"),
        assigneeId: z.string().optional().describe("New assignee account ID or username"),
        labels: z.array(z.string()).optional().describe("Replace labels"),
        customFields: z
          .record(z.unknown())
          .optional()
          .describe("Custom fields to update"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({
      issueKey,
      summary,
      description,
      priority,
      assigneeId,
      labels,
      customFields,
    }) => {
      const client = getClient();
      const fields: Record<string, unknown> = {};

      if (summary) fields.summary = summary;
      if (description) {
        fields.description = client.isCloud
          ? markdownToAdf(description)
          : description;
      }
      if (priority) fields.priority = { name: priority };
      if (assigneeId) {
        fields.assignee = client.isCloud
          ? { accountId: assigneeId }
          : { name: assigneeId };
      }
      if (labels) fields.labels = labels;

      if (customFields) {
        Object.assign(fields, client.resolveCustomFields(customFields));
      }

      const payload: UpdateIssuePayload = { fields };
      await client.request<void>(
        `${client.apiBase}/issue/${issueKey}`,
        { method: "PUT", body: payload }
      );

      getCache().invalidateIssue(issueKey);

      return {
        content: [
          {
            type: "text" as const,
            text: `Issue **${issueKey}** updated successfully.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "delete_issue",
    {
      title: "Delete Issue",
      description:
        "Permanently delete a JIRA issue. This action cannot be undone.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key to delete"),
        deleteSubtasks: z
          .boolean()
          .default(false)
          .describe("Also delete sub-tasks"),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ issueKey, deleteSubtasks }) => {
      const client = getClient();
      await client.request<void>(
        `${client.apiBase}/issue/${issueKey}`,
        {
          method: "DELETE",
          query: { deleteSubtasks },
        }
      );

      getCache().invalidateIssue(issueKey);

      return {
        content: [
          {
            type: "text" as const,
            text: `Issue **${issueKey}** deleted permanently.`,
          },
        ],
      };
    }
  );
}

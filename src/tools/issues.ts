import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { adfToMarkdown, markdownToAdf } from "../client/adf-converter.js";
import { getConfig } from "../config.js";
import { toonIssue, toonSearchResults, toonResult, PROJECT_KEY_REQUIRED } from "../formatter/toon.js";
import { textContent } from "./response.js";
import type {
  JiraIssue,
  CreateIssuePayload,
  UpdateIssuePayload,
} from "../client/types.js";

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
          .coerce.number()
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

      const data = await client.search({
        jql,
        fields: fieldList.split(",").map((f) => f.trim()),
        maxResults,
      });

      const text = toonSearchResults(
        data.issues,
        data.total,
        data.nextPageToken
      );

      return textContent(text);
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
      const issue = await client.getIssue(issueKey, [
        "summary", "status", "priority", "assignee", "reporter",
        "issuetype", "description", "labels", "comment", "created",
        "updated", "resolution", "fixVersions", "components",
        "project", "parent", "subtasks",
      ]);
      const desc =
        client.isCloud && issue.fields.description && typeof issue.fields.description === "object"
          ? adfToMarkdown(issue.fields.description)
          : (issue.fields.description as string) ?? "";
      const comments = issue.fields.comment?.comments?.slice(-5).map((c) => ({
        author: c.author?.displayName ?? "Unknown",
        created: c.created,
        body:
          client.isCloud && typeof c.body === "object"
            ? adfToMarkdown(c.body)
            : (c.body as string) ?? "",
      }));

      return textContent(toonIssue(issue, desc, comments));
    }
  );

  if (!config.writeEnabled) return;

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
        return textContent(toonResult("error", { message: PROJECT_KEY_REQUIRED }), { isError: true });
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await client.call(
        async () => await client.api.issues.createIssue({ fields: payload.fields } as any) as unknown as { id: string; key: string; self: string }
      );

      getCache().invalidateEntity("search");

      return textContent(toonResult("created", {
        issueKey: result.key,
        url: `${client.baseUrl}/browse/${result.key}`,
      }));
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

      await client.call(() => client.api.issues.editIssue({ issueIdOrKey: issueKey, fields }));

      getCache().invalidateIssue(issueKey);

      return textContent(toonResult("updated", { issueKey }));
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
          .coerce.boolean()
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
      await client.call(() => client.api.issues.deleteIssue({ issueIdOrKey: issueKey, deleteSubtasks }));

      getCache().invalidateIssue(issueKey);

      return textContent(toonResult("deleted", { issueKey }));
    }
  );
}

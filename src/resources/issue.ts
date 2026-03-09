import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import { toonIssue } from "../formatter/toon.js";
import type { JiraIssue } from "../client/types.js";

const ISSUE_FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "reporter",
  "issuetype",
  "description",
  "labels",
  "comment",
  "created",
  "updated",
  "resolution",
  "fixVersions",
  "components",
  "project",
  "parent",
];

export function registerIssueResources(server: McpServer): void {
  server.registerResource(
    "jira-issue",
    new ResourceTemplate("jira://issue/{issueKey}", {
      list: undefined,
    }),
    {
      title: "JIRA Issue",
      description: "Detailed view of a single JIRA issue by key",
      mimeType: "text/plain",
    },
    async (uri, { issueKey }) => {
      const client = getClient();
      const key = issueKey as string;

      const cache = {
        key: getCache().buildKey("issue", key),
        entity: "issue" as const,
      };

      const issue: JiraIssue = await client.getIssue(key, ISSUE_FIELDS, cache);

      const f = issue.fields;
      const desc =
        client.isCloud && f.description && typeof f.description === "object"
          ? adfToMarkdown(f.description)
          : (f.description as string) ?? "";
      const comments = f.comment?.comments?.map((c) => ({
        author: c.author?.displayName ?? "Unknown",
        created: c.created,
        body:
          client.isCloud && typeof c.body === "object"
            ? adfToMarkdown(c.body)
            : (c.body as string) ?? "",
      }));

      const text = toonIssue(issue, desc, comments);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text,
          },
        ],
      };
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { toonLinks, toonResult } from "../formatter/toon.js";
import { textContent } from "./response.js";
import type {
  JiraIssue,
  JiraIssueLink,
} from "../client/types.js";

export function registerLinkTools(server: McpServer): void {
  server.registerTool(
    "get_issue_links",
    {
      title: "Get Issue Links",
      description:
        "Get all links for an issue — blockers, dependencies, duplicates, relations.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ issueKey }) => {
      const cache = getCache();
      const issue = await getClient().getIssue(
        issueKey,
        ["issuelinks", "summary"],
        { key: cache.buildKey("link", issueKey), entity: "link" }
      );

      const links = (issue.fields.issuelinks ?? []) as JiraIssueLink[];

      const linkRows: Array<{ type: string; key: string; summary: string; status: string }> = [];
      for (const link of links) {
        if (link.outwardIssue) {
          const oi = link.outwardIssue;
          linkRows.push({
            type: link.type.outward,
            key: oi.key,
            summary: oi.fields?.summary ?? "",
            status: oi.fields?.status?.name ?? "?",
          });
        }
        if (link.inwardIssue) {
          const ii = link.inwardIssue;
          linkRows.push({
            type: link.type.inward,
            key: ii.key,
            summary: ii.fields?.summary ?? "",
            status: ii.fields?.status?.name ?? "?",
          });
        }
      }
      return textContent(toonLinks(issueKey, issue.fields.summary, linkRows));
    }
  );

  if (!getConfig().writeEnabled) return;

  server.registerTool(
    "link_issues",
    {
      title: "Link Issues",
      description:
        'Create a link between two issues. Common link types: "Blocks" (inward blocks outward), "Duplicate", "Relates", "Cloners".',
      inputSchema: z.object({
        linkType: z
          .string()
          .describe(
            'Link type name, e.g. "Blocks", "Duplicate", "Relates", "Cloners"'
          ),
        inwardIssueKey: z
          .string()
          .describe("Inward issue key (e.g. the blocking issue)"),
        outwardIssueKey: z
          .string()
          .describe("Outward issue key (e.g. the blocked issue)"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ linkType, inwardIssueKey, outwardIssueKey }) => {
      const client = getClient();
      const params = {
        type: { name: linkType },
        inwardIssue: { key: inwardIssueKey },
        outwardIssue: { key: outwardIssueKey },
      };
      await client.call(() => client.api.issueLinks.linkIssues(params));

      getCache().invalidateIssue(inwardIssueKey);
      getCache().invalidateIssue(outwardIssueKey);
      getCache().invalidateEntity("link");

      return textContent(toonResult("linked", {
        linkType,
        inwardIssueKey,
        outwardIssueKey,
      }));
    }
  );
}

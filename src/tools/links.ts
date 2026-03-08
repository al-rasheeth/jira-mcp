import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import type {
  JiraIssue,
  JiraIssueLink,
  LinkIssuesPayload,
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
      const client = getClient();
      const issue = await client.request<JiraIssue>(
        `${client.apiBase}/issue/${issueKey}`,
        {
          query: { fields: "issuelinks,summary" },
          cacheable: "link",
        }
      );

      const links = (issue.fields.issuelinks ?? []) as JiraIssueLink[];

      if (links.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No links found for **${issueKey}**.`,
            },
          ],
        };
      }

      const lines = [`**${issueKey}** — ${issue.fields.summary}`, "", "### Links", ""];

      for (const link of links) {
        if (link.outwardIssue) {
          const oi = link.outwardIssue;
          lines.push(
            `- ${link.type.outward} **${oi.key}** ${oi.fields?.summary ?? ""} (*${oi.fields?.status?.name ?? "?"}*)`
          );
        }
        if (link.inwardIssue) {
          const ii = link.inwardIssue;
          lines.push(
            `- ${link.type.inward} **${ii.key}** ${ii.fields?.summary ?? ""} (*${ii.fields?.status?.name ?? "?"}*)`
          );
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
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
      const payload: LinkIssuesPayload = {
        type: { name: linkType },
        inwardIssue: { key: inwardIssueKey },
        outwardIssue: { key: outwardIssueKey },
      };

      await client.request<void>(`${client.apiBase}/issueLink`, {
        method: "POST",
        body: payload,
      });

      getCache().invalidateIssue(inwardIssueKey);
      getCache().invalidateIssue(outwardIssueKey);
      getCache().invalidateEntity("link");

      return {
        content: [
          {
            type: "text" as const,
            text: `Linked **${inwardIssueKey}** —[${linkType}]→ **${outwardIssueKey}**`,
          },
        ],
      };
    }
  );
}

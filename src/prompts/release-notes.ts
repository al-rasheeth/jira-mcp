import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import type { JiraSearchResponse } from "../client/types.js";

export function registerReleaseNotesPrompt(server: McpServer): void {
  server.registerPrompt(
    "release-notes",
    {
      title: "Release Notes Generator",
      description:
        "Generate release notes from resolved issues matching a JQL query (e.g., by fixVersion).",
      argsSchema: {
        jql: z
          .string()
          .describe(
            'JQL to find issues for the release, e.g.: fixVersion = "1.2.0" AND resolution IS NOT EMPTY'
          ),
        version: z.string().optional().describe("Version label for the header"),
      },
    },
    async ({ jql, version }) => {
      const client = getClient();

      const data = await client.request<JiraSearchResponse>(
        `${client.apiBase}/search`,
        {
          method: "POST",
          body: {
            jql,
            maxResults: 100,
            fields: [
              "summary",
              "issuetype",
              "priority",
              "status",
              "labels",
              "components",
              "fixVersions",
              "resolution",
            ],
          },
        }
      );

      const issuesByType: Record<string, string[]> = {};
      for (const issue of data.issues) {
        const typeName = issue.fields.issuetype.name;
        if (!issuesByType[typeName]) issuesByType[typeName] = [];
        issuesByType[typeName].push(
          `- **${issue.key}**: ${issue.fields.summary} (${issue.fields.priority?.name ?? "None"})`
        );
      }

      const groupedText = Object.entries(issuesByType)
        .map(([type, items]) => `### ${type}\n${items.join("\n")}`)
        .join("\n\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a technical writer. Generate professional release notes from the following JIRA issues. Format them in a user-friendly way suitable for sharing with stakeholders.

${version ? `**Version: ${version}**` : ""}

Include:
1. **Summary**: A high-level overview of the release
2. **New Features**: Group features and improvements
3. **Bug Fixes**: List fixed bugs
4. **Breaking Changes**: Flag any if apparent
5. **Known Issues**: Mention any unresolved items if relevant

## Issues (${data.total} total)

${groupedText}`,
            },
          },
        ],
      };
    }
  );
}

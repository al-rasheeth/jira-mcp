import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import type {
  JiraTransitionsResponse,
  TransitionIssuePayload,
} from "../client/types.js";

export function registerTransitionTools(server: McpServer): void {
  server.registerTool(
    "list_transitions",
    {
      title: "List Transitions",
      description:
        "List available workflow transitions for an issue (what statuses it can move to).",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ issueKey }) => {
      const client = getClient();
      const data = await client.request<JiraTransitionsResponse>(
        `${client.apiBase}/issue/${issueKey}/transitions`,
        { cacheable: "transition" }
      );

      if (data.transitions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No transitions available for **${issueKey}**.`,
            },
          ],
        };
      }

      const text = data.transitions
        .map((t) => `- **ID ${t.id}**: ${t.name} → *${t.to.name}*`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Available transitions for **${issueKey}**:\n\n${text}\n\nUse the transition ID with the \`transition_issue\` tool.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "transition_issue",
    {
      title: "Transition Issue",
      description:
        "Move an issue through a workflow transition (change its status). Use list_transitions first to get available transition IDs.",
      inputSchema: z.object({
        issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        transitionId: z
          .string()
          .describe("Transition ID from list_transitions"),
        comment: z
          .string()
          .optional()
          .describe("Optional comment to add with the transition"),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ issueKey, transitionId, comment }) => {
      const client = getClient();
      const payload: TransitionIssuePayload = {
        transition: { id: transitionId },
      };

      if (comment) {
        const body = client.isCloud
          ? {
              version: 1 as const,
              type: "doc" as const,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: comment }],
                },
              ],
            }
          : comment;

        payload.update = {
          comment: [{ add: { body } }],
        };
      }

      await client.request<void>(
        `${client.apiBase}/issue/${issueKey}/transitions`,
        { method: "POST", body: payload }
      );

      getCache().invalidateIssue(issueKey);
      getCache().invalidateEntity("transition");

      return {
        content: [
          {
            type: "text" as const,
            text: `Issue **${issueKey}** transitioned successfully.`,
          },
        ],
      };
    }
  );
}

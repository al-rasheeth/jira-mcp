import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { getConfig } from "../config.js";
import { toonTransitions, toonResult } from "../formatter/toon.js";
import type { JiraTransitionsResponse } from "../client/types.js";

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
      const cache = getCache();
      const data = await client.call(
        () => client.api.issues.getTransitions({ issueIdOrKey: issueKey }),
        { key: cache.buildKey("transition", issueKey), entity: "transition" }
      ) as unknown as JiraTransitionsResponse;

      const transitions = data.transitions.map((t) => ({
        id: t.id,
        name: t.name,
        to: t.to.name,
      }));
      const text = toonTransitions(issueKey, transitions);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  if (!getConfig().writeEnabled) return;

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

      const update = comment
        ? {
            comment: [{
              add: {
                body: client.isCloud
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
                  : comment,
              },
            }],
          }
        : undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = {
        issueIdOrKey: issueKey,
        transition: { id: transitionId },
        ...(update ? { update: update as any } : {}),
      };
      await client.call(() => client.api.issues.doTransition(params));

      getCache().invalidateIssue(issueKey);
      getCache().invalidateEntity("transition");

      return {
        content: [
          {
            type: "text" as const,
            text: toonResult("transitioned", { issueKey }),
          },
        ],
      };
    }
  );
}

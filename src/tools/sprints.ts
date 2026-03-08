import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import type {
  JiraBoard,
  JiraBoardsResponse,
  JiraSprint,
  JiraSprintsResponse,
  JiraSprintIssuesResponse,
  JiraIssue,
} from "../client/types.js";

export function registerSprintTools(server: McpServer): void {
  server.registerTool(
    "list_boards",
    {
      title: "List Boards",
      description: "List agile boards (Scrum/Kanban).",
      inputSchema: z.object({
        projectKeyOrId: z
          .string()
          .optional()
          .describe("Filter by project key or ID"),
        type: z
          .enum(["scrum", "kanban", "simple"])
          .optional()
          .describe("Board type filter"),
        maxResults: z.number().int().min(1).max(100).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ projectKeyOrId, type, maxResults }) => {
      const client = getClient();
      const data = await client.request<JiraBoardsResponse>(
        `${client.agileBase}/board`,
        {
          query: {
            projectKeyOrId,
            type,
            maxResults,
          },
          cacheable: "board",
        }
      );

      if (data.values.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No boards found." }],
        };
      }

      const text = data.values
        .map(
          (b: JiraBoard) =>
            `- **#${b.id}** ${b.name} (${b.type})${b.location?.projectKey ? ` — ${b.location.projectKey}` : ""}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found **${data.values.length}** board(s):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_sprints",
    {
      title: "List Sprints",
      description: "List sprints for a given board.",
      inputSchema: z.object({
        boardId: z.number().int().describe("Board ID"),
        state: z
          .enum(["active", "closed", "future"])
          .optional()
          .describe("Filter by sprint state"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, state }) => {
      const client = getClient();
      const data = await client.request<JiraSprintsResponse>(
        `${client.agileBase}/board/${boardId}/sprint`,
        {
          query: { state },
          cacheable: "sprint",
        }
      );

      if (data.values.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No sprints found." }],
        };
      }

      const text = data.values
        .map((s: JiraSprint) => {
          const dates =
            s.startDate && s.endDate
              ? ` (${s.startDate.split("T")[0]} → ${s.endDate.split("T")[0]})`
              : "";
          return `- **#${s.id}** ${s.name} [${s.state}]${dates}${s.goal ? ` — ${s.goal}` : ""}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found **${data.values.length}** sprint(s):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_sprint_issues",
    {
      title: "Get Sprint Issues",
      description: "Get all issues in a specific sprint.",
      inputSchema: z.object({
        sprintId: z.number().int().describe("Sprint ID"),
        maxResults: z.number().int().min(1).max(100).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ sprintId, maxResults }) => {
      const client = getClient();
      const data = await client.request<JiraSprintIssuesResponse>(
        `${client.agileBase}/sprint/${sprintId}/issue`,
        {
          query: {
            maxResults,
            fields:
              "summary,status,priority,assignee,issuetype,labels,project",
          },
          cacheable: "sprint",
        }
      );

      if (data.issues.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No issues in this sprint." },
          ],
        };
      }

      const text = data.issues
        .map(
          (issue: JiraIssue) =>
            `- **${issue.key}** ${issue.fields.summary} — *${issue.fields.status.name}* (${issue.fields.priority?.name ?? "None"}) [${issue.fields.assignee?.displayName ?? "Unassigned"}]`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Sprint has **${data.total}** issue(s):\n\n${text}`,
          },
        ],
      };
    }
  );
}

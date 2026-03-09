import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { getCache } from "../cache/cache.js";
import { toonBoards, toonSprints, toonSprintIssues } from "../formatter/toon.js";
import { textContent } from "./response.js";
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
      const cache = getCache();
      const data = await client.call(
        () => client.agile.board.getAllBoards({
          projectKeyOrId,
          type,
          maxResults,
        }),
        { key: cache.buildKey("board", "list", type ?? "", projectKeyOrId ?? "", String(maxResults)), entity: "board" }
      ) as unknown as JiraBoardsResponse;

      return textContent(toonBoards(data.values as JiraBoard[]));
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
      const cache = getCache();
      const data = await client.call(
        () => client.agile.board.getAllSprints({ boardId, state }),
        { key: cache.buildKey("sprint", String(boardId), state ?? ""), entity: "sprint" }
      ) as unknown as JiraSprintsResponse;

      return textContent(toonSprints(data.values as JiraSprint[]));
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
      const cache = getCache();
      const data = await client.call(
        () => client.agile.sprint.getIssuesForSprint({
          sprintId,
          fields: ["summary", "status", "priority", "assignee", "issuetype", "labels", "project"],
          maxResults,
        }),
        { key: cache.buildKey("sprint", "issues", String(sprintId), String(maxResults)), entity: "sprint" }
      ) as unknown as JiraSprintIssuesResponse;

      return textContent(toonSprintIssues(data.issues as JiraIssue[], data.total));
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerIssueTools } from "./tools/issues.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerSprintTools } from "./tools/sprints.js";
import { registerTransitionTools } from "./tools/transitions.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerUserTools } from "./tools/users.js";

import { registerProjectResources } from "./resources/projects.js";
import { registerBoardResources } from "./resources/boards.js";
import { registerMyselfResources } from "./resources/myself.js";
import { registerIssueResources } from "./resources/issue.js";

import { registerSprintPlanningPrompt } from "./prompts/sprint-planning.js";
import { registerBugTriagePrompt } from "./prompts/bug-triage.js";
import { registerReleaseNotesPrompt } from "./prompts/release-notes.js";
import { registerStandupSummaryPrompt } from "./prompts/standup-summary.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "jira-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Tools (14 tools across 6 modules)
  registerIssueTools(server);
  registerProjectTools(server);
  registerSprintTools(server);
  registerTransitionTools(server);
  registerCommentTools(server);
  registerUserTools(server);

  // Resources (4)
  registerProjectResources(server);
  registerBoardResources(server);
  registerMyselfResources(server);
  registerIssueResources(server);

  // Prompts (4)
  registerSprintPlanningPrompt(server);
  registerBugTriagePrompt(server);
  registerReleaseNotesPrompt(server);
  registerStandupSummaryPrompt(server);

  return server;
}

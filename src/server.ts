import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerIssueTools } from "./tools/issues.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerSprintTools } from "./tools/sprints.js";
import { registerTransitionTools } from "./tools/transitions.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerUserTools } from "./tools/users.js";
import { registerEpicTools } from "./tools/epics.js";
import { registerLinkTools } from "./tools/links.js";
import { registerWorklogTools } from "./tools/worklogs.js";
import { registerWatcherTools } from "./tools/watchers.js";
import { registerVersionAndComponentTools } from "./tools/versions.js";

import { registerProjectResources } from "./resources/projects.js";
import { registerBoardResources } from "./resources/boards.js";
import { registerMyselfResources } from "./resources/myself.js";
import { registerIssueResources } from "./resources/issue.js";

import { registerSprintPlanningPrompt } from "./prompts/sprint-planning.js";
import { registerBugTriagePrompt } from "./prompts/bug-triage.js";
import { registerReleaseNotesPrompt } from "./prompts/release-notes.js";
import { registerStandupSummaryPrompt } from "./prompts/standup-summary.js";
import { registerEpicAnalysisPrompt } from "./prompts/epic-analysis.js";
import { registerSprintRetrospectivePrompt } from "./prompts/sprint-retrospective.js";
import { registerWorkloadBalancePrompt } from "./prompts/workload-balance.js";
import { registerEpicDevPlanPrompt } from "./prompts/epic-dev-plan.js";

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

  // Tools (25 tools across 11 modules)
  registerIssueTools(server);
  registerProjectTools(server);
  registerSprintTools(server);
  registerTransitionTools(server);
  registerCommentTools(server);
  registerUserTools(server);
  registerEpicTools(server);
  registerLinkTools(server);
  registerWorklogTools(server);
  registerWatcherTools(server);
  registerVersionAndComponentTools(server);

  // Resources (4)
  registerProjectResources(server);
  registerBoardResources(server);
  registerMyselfResources(server);
  registerIssueResources(server);

  // Prompts (8)
  registerSprintPlanningPrompt(server);
  registerBugTriagePrompt(server);
  registerReleaseNotesPrompt(server);
  registerStandupSummaryPrompt(server);
  registerEpicAnalysisPrompt(server);
  registerSprintRetrospectivePrompt(server);
  registerWorkloadBalancePrompt(server);
  registerEpicDevPlanPrompt(server);

  return server;
}

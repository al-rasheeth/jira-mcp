import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import { toonEpicDevPlanContext } from "../formatter/toon.js";
import type {
  JiraIssue,
  JiraComment,
  JiraIssueLink,
  AdfDocument,
} from "../client/types.js";

const FIGMA_URL_RE = /https?:\/\/[\w.-]*figma\.com\/[\w/?=&#%-]+/g;

function extractFigmaUrls(text: string): string[] {
  return [...text.matchAll(FIGMA_URL_RE)].map((m) => m[0]);
}

function convertBody(
  body: string | AdfDocument | null | undefined,
  isCloud: boolean
): string {
  if (!body) return "";
  if (isCloud && typeof body === "object") return adfToMarkdown(body);
  return typeof body === "string" ? body : "";
}

export function registerEpicDevPlanPrompt(server: McpServer): void {
  server.registerPrompt(
    "epic-dev-plan",
    {
      title: "Epic Development Plan",
      description:
        "Generate a platform-specific development plan from an epic. Fetches all child issues with full descriptions and comments, extracts Figma design links, and produces an implementation roadmap that can drive autonomous development.",
      argsSchema: {
        epicKey: z.string().describe("Epic issue key, e.g. PROJ-42"),
        platform: z
          .enum(["web", "api", "mobile", "android", "ios", "desktop", "fullstack"])
          .describe("Target platform to filter and plan for"),
        intent: z
          .string()
          .optional()
          .describe(
            "Freeform user intent to focus the plan, e.g. 'focus on auth flows', 'build the dashboard module first', 'skip completed tickets'"
          ),
      },
    },
    async ({ epicKey, platform, intent }) => {
      const client = getClient();

      const epicIssue = await client.getIssue(epicKey, [
        "summary", "status", "priority", "assignee", "description",
        "labels", "created", "updated", "project", "fixVersions", "components",
      ]);

      const childJql = client.isCloud
        ? `parent = "${epicKey}" ORDER BY priority DESC, status ASC`
        : `"Epic Link" = "${epicKey}" ORDER BY priority DESC, status ASC`;

      const childData = await client.search({
        jql: childJql,
        maxResults: 100,
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "issuetype",
          "labels",
          "components",
          "description",
          "comment",
          "issuelinks",
          "fixVersions",
          "created",
          "updated",
          "resolution",
        ],
      });

      const ef = epicIssue.fields;
      const epicDesc = convertBody(ef.description, client.isCloud);
      const epicFigmaUrls = extractFigmaUrls(epicDesc);

      const figmaUrls: Array<{ ticketKey: string; url: string }> = [];
      for (const url of epicFigmaUrls) {
        figmaUrls.push({ ticketKey: epicKey, url });
      }

      const childIssues: Array<{
        key: string;
        summary: string;
        type: string;
        status: string;
        priority: string;
        assignee: string;
        labels: string;
        components: string;
        links?: string[];
        description: string;
        recentComments: Array<{ author: string; date: string; body: string }>;
      }> = [];
      let doneCount = 0;
      const totalCount = childData.total;

      for (const issue of childData.issues) {
        if (issue.fields.status.statusCategory.key === "done") doneCount++;

        const f = issue.fields;
        const desc = convertBody(f.description, client.isCloud);
        const issueFigmaUrls = extractFigmaUrls(desc);
        for (const url of issueFigmaUrls) {
          figmaUrls.push({ ticketKey: issue.key, url });
        }

        const issueLinks = (f.issuelinks ?? []) as JiraIssueLink[];
        const linkStrs = issueLinks
          .map((l) => {
            if (l.outwardIssue) return `${l.type.outward} ${l.outwardIssue.key}`;
            if (l.inwardIssue) return `${l.type.inward} ${l.inwardIssue.key}`;
            return "";
          })
          .filter(Boolean);

        const comments = (f.comment?.comments ?? []) as JiraComment[];
        const recentComments = comments.slice(-3).map((c) => ({
          author: c.author?.displayName ?? "Unknown",
          date: c.created.split("T")[0],
          body: convertBody(c.body, client.isCloud).trim().slice(0, 500),
        }));
        for (const c of recentComments) {
          for (const url of extractFigmaUrls(c.body)) {
            figmaUrls.push({ ticketKey: issue.key, url });
          }
        }

        childIssues.push({
          key: issue.key,
          summary: f.summary,
          type: f.issuetype.name,
          status: f.status.name,
          priority: f.priority?.name ?? "None",
          assignee: f.assignee?.displayName ?? "Unassigned",
          labels: f.labels?.join(", ") || "None",
          components: (f.components ?? []).map((c) => c.name).join(", ") || "None",
          links: linkStrs.length ? linkStrs : undefined,
          description: desc.trim() || "",
          recentComments,
        });
      }

      const completionPct =
        totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

      const context = toonEpicDevPlanContext({
        epic: {
          key: epicKey,
          summary: ef.summary,
          project: `${ef.project.key} — ${ef.project.name}`,
          status: ef.status.name,
          priority: ef.priority?.name ?? "None",
          assignee: ef.assignee?.displayName ?? "Unassigned",
          labels: ef.labels?.join(", ") || "None",
          components: ef.components?.length ? ef.components.map((c) => c.name).join(", ") : undefined,
          fixVersions: ef.fixVersions?.length ? ef.fixVersions.map((v) => v.name).join(", ") : undefined,
          progress: `${completionPct}% (${doneCount}/${totalCount})`,
          description: epicDesc.trim() || "",
        },
        figmaUrls,
        childIssues,
        totalCount,
      });

      const platformLabel: Record<string, string> = {
        web: "Web Frontend (React, Vue, Angular, HTML/CSS/JS)",
        api: "Backend API (REST, GraphQL, microservices)",
        mobile: "Cross-platform Mobile (React Native, Flutter)",
        android: "Android Native (Kotlin, Java)",
        ios: "iOS Native (Swift, SwiftUI)",
        desktop: "Desktop Application (Electron, Tauri, native)",
        fullstack: "Full-Stack (frontend + backend + any infrastructure)",
      };

      const intentClause = intent
        ? `\n\nUser Intent: "${intent}" — Honor this directive. Use it to prioritize, filter, or focus the plan as instructed.`
        : "";

      const figmaInstruction = figmaUrls.length > 0
        ? `

Figma Designs Found: The issues contain Figma URLs. Before building the implementation plan:
1. List each Figma URL with its associated ticket
2. Instruct the developer to use the figma-mcp tools (get_figma_data) to fetch these designs for visual reference, component inventory, and spacing/typography specs
3. Reference specific Figma frames in the per-ticket implementation notes where applicable`
        : "";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a senior software architect generating an actionable development plan from JIRA epic data.

Target Platform: ${platform} — ${platformLabel[platform] ?? platform}${intentClause}${figmaInstruction}

Analyze ALL the tickets below and produce the following:

---

### 1. Platform Ticket Filtering

From the full list of child issues, categorize each ticket:
- **Relevant** to ${platform}: tickets whose summary, description, labels, or components indicate work for this platform
- **Cross-platform dependency**: tickets on OTHER platforms that this platform depends on (e.g., a web ticket needing an API endpoint)
- **Not relevant**: tickets clearly for other platforms

For each ticket, state: TICKET_KEY — Relevant | Dependency | Excluded — reason

---

### 2. Architecture Overview

For the relevant tickets, outline:
- High-level component/module structure
- Data flow between components
- Key technical decisions and patterns to use
- External integrations or API contracts needed

---

### 3. Implementation Roadmap

Order the relevant tickets into implementation phases:
- **Phase 1 — Foundation**: Setup, scaffolding, core infrastructure
- **Phase 2 — Core Features**: Main functionality
- **Phase 3 — Polish**: Edge cases, error handling, UX refinement

For each phase, list tickets in dependency order with reasoning.

---

### 4. Per-Ticket Implementation Plan

For each relevant ticket (excluding completed ones), provide:
- **What to build**: Concrete deliverables
- **Key files/components**: What to create or modify
- **Acceptance criteria**: Extracted from the ticket description
- **Dependencies**: Which other tickets must be done first
- **Estimated complexity**: Low / Medium / High
- **Design reference**: Figma link if available

---

### 5. Cross-Platform Dependencies

List any tickets from other platforms that must be completed (or API contracts agreed upon) before ${platform} work can proceed. Flag any that are blockers or unstarted.

---

### 6. Risk & Recommendations

- Missing information or under-specified tickets
- Tickets that need design input but have no Figma references
- Suggested ticket breakdowns if any ticket is too large
- Recommended development sequence to unblock parallel work

---

${context}`,
            },
          },
        ],
      };
    }
  );
}

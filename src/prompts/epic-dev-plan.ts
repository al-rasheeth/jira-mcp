import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client/jira-client.js";
import { adfToMarkdown } from "../client/adf-converter.js";
import type {
  JiraIssue,
  JiraSearchResponse,
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

function formatIssueDeep(
  issue: JiraIssue,
  isCloud: boolean
): { text: string; figmaUrls: string[] } {
  const f = issue.fields;
  const desc = convertBody(f.description, isCloud);
  const figmaUrls = extractFigmaUrls(desc);

  const lines = [
    `### ${issue.key} — ${f.summary}`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Type | ${f.issuetype.name} |`,
    `| Status | ${f.status.name} (${f.status.statusCategory.key}) |`,
    `| Priority | ${f.priority?.name ?? "None"} |`,
    `| Assignee | ${f.assignee?.displayName ?? "Unassigned"} |`,
    `| Labels | ${f.labels?.join(", ") || "None"} |`,
    `| Components | ${(f.components ?? []).map((c) => c.name).join(", ") || "None"} |`,
  ];

  const issueLinks = (f.issuelinks ?? []) as JiraIssueLink[];
  if (issueLinks.length > 0) {
    const linkStrs = issueLinks.map((l) => {
      if (l.outwardIssue) return `${l.type.outward} ${l.outwardIssue.key}`;
      if (l.inwardIssue) return `${l.type.inward} ${l.inwardIssue.key}`;
      return "";
    }).filter(Boolean);
    if (linkStrs.length) {
      lines.push(`| Links | ${linkStrs.join("; ")} |`);
    }
  }

  lines.push("", "**Description:**", "", desc.trim() || "_No description_");

  const comments = (f.comment?.comments ?? []) as JiraComment[];
  if (comments.length > 0) {
    const recent = comments.slice(-3);
    lines.push("", "**Recent Comments:**", "");
    for (const c of recent) {
      const body = convertBody(c.body, isCloud);
      figmaUrls.push(...extractFigmaUrls(body));
      lines.push(
        `> **${c.author?.displayName ?? "Unknown"}** (${c.created.split("T")[0]}): ${body.trim().slice(0, 500)}`,
        ""
      );
    }
  }

  return { text: lines.join("\n"), figmaUrls };
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

      const childData = await client.search({
        jql: `"Epic Link" = "${epicKey}" OR parent = "${epicKey}" ORDER BY priority DESC, status ASC`,
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

      const allFigmaUrls: Map<string, string[]> = new Map();
      if (epicFigmaUrls.length > 0) {
        allFigmaUrls.set(epicKey, epicFigmaUrls);
      }

      const issueBlocks: string[] = [];
      let doneCount = 0;
      let totalCount = childData.total;

      for (const issue of childData.issues) {
        if (issue.fields.status.statusCategory.key === "done") doneCount++;

        const { text, figmaUrls } = formatIssueDeep(issue, client.isCloud);
        issueBlocks.push(text);

        if (figmaUrls.length > 0) {
          allFigmaUrls.set(issue.key, figmaUrls);
        }
      }

      const completionPct =
        totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

      // Build Figma references section
      let figmaSection = "";
      if (allFigmaUrls.size > 0) {
        const figmaLines = ["## Figma Design References", ""];
        for (const [key, urls] of allFigmaUrls) {
          for (const url of urls) {
            figmaLines.push(`- **${key}**: ${url}`);
          }
        }
        figmaSection = figmaLines.join("\n");
      }

      const context = [
        `## Epic: [${epicKey}] ${ef.summary}`,
        `- **Project**: ${ef.project.key} — ${ef.project.name}`,
        `- **Status**: ${ef.status.name}`,
        `- **Priority**: ${ef.priority?.name ?? "None"}`,
        `- **Assignee**: ${ef.assignee?.displayName ?? "Unassigned"}`,
        `- **Labels**: ${ef.labels?.join(", ") || "None"}`,
        ef.components?.length
          ? `- **Components**: ${ef.components.map((c) => c.name).join(", ")}`
          : null,
        ef.fixVersions?.length
          ? `- **Fix Versions**: ${ef.fixVersions.map((v) => v.name).join(", ")}`
          : null,
        `- **Progress**: ${completionPct}% (${doneCount}/${totalCount})`,
        "",
        "### Epic Description",
        "",
        epicDesc.trim() || "_No description_",
        "",
        figmaSection,
        "",
        `## Child Issues (${childData.issues.length} of ${totalCount})`,
        "",
        ...issueBlocks,
      ]
        .filter((line) => line !== null)
        .join("\n");

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
        ? `\n\n**User Intent**: "${intent}" — Honor this directive. Use it to prioritize, filter, or focus the plan as instructed.`
        : "";

      const figmaInstruction = allFigmaUrls.size > 0
        ? `

**Figma Designs Found**: The issues above contain Figma URLs. Before building the implementation plan:
1. List each Figma URL with its associated ticket
2. Instruct the developer to use the figma-mcp tools (\`get_figma_data\`) to fetch these designs for visual reference, component inventory, and spacing/typography specs
3. Reference specific Figma frames in the per-ticket implementation notes where applicable`
        : "";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a senior software architect generating an actionable development plan from JIRA epic data.

**Target Platform**: ${platform} — ${platformLabel[platform] ?? platform}${intentClause}${figmaInstruction}

Analyze ALL the tickets below and produce the following:

---

### 1. Platform Ticket Filtering

From the full list of child issues, categorize each ticket:
- **Relevant** to ${platform}: tickets whose summary, description, labels, or components indicate work for this platform
- **Cross-platform dependency**: tickets on OTHER platforms that this platform depends on (e.g., a web ticket needing an API endpoint)
- **Not relevant**: tickets clearly for other platforms

For each ticket, state: \`TICKET_KEY — Relevant | Dependency | Excluded — reason\`

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

import { encode } from "@toon-format/toon";
import type {
  JiraIssue,
  JiraProject,
  JiraComment,
  JiraWorklog,
  JiraEpic,
  JiraBoard,
  JiraSprint,
  JiraVersion,
  JiraComponent,
  JiraUser,
} from "../client/types.js";

export function toon(data: unknown): string {
  return encode(data, { indent: 2 });
}

export function toonIssue(
  issue: JiraIssue,
  description: string,
  comments?: Array<{ author: string; created: string; body: string }>
): string {
  const f = issue.fields;
  const obj: Record<string, unknown> = {
    key: issue.key,
    summary: f.summary,
    status: f.status.name,
    type: f.issuetype.name,
    priority: f.priority?.name ?? "None",
    assignee: f.assignee?.displayName ?? "Unassigned",
    reporter: f.reporter?.displayName ?? "Unknown",
    labels: f.labels?.join(", ") || "None",
    created: f.created,
    updated: f.updated,
    resolution: f.resolution?.name ?? "Unresolved",
    project: `${f.project.key} — ${f.project.name}`,
    description: description.trim() || null,
  };
  if (f.parent) {
    obj.parent = `${f.parent.key} — ${f.parent.fields?.summary ?? ""}`;
  }
  if (f.fixVersions?.length) {
    obj.fixVersions = f.fixVersions.map((v) => v.name).join(", ");
  }
  if (f.components?.length) {
    obj.components = f.components.map((c) => c.name).join(", ");
  }
  if (comments?.length) {
    obj.comments = comments;
  } else if (f.comment?.comments?.length) {
    obj.comments = f.comment.comments.slice(-5).map((c) => ({
      author: c.author?.displayName ?? "Unknown",
      created: c.created,
      body: typeof c.body === "string" ? c.body : "",
    }));
  }
  return toon({ issue: obj });
}

export function toonSearchResults(
  issues: JiraIssue[],
  total: number,
  nextPageToken?: string
): string {
  if (issues.length === 0) {
    return toon({ issues: [], total: 0, message: "No issues found" });
  }
  const rows = issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status.name,
    priority: i.fields.priority?.name ?? "None",
    assignee: i.fields.assignee?.displayName ?? "Unassigned",
  }));
  const out: Record<string, unknown> = { issues: rows, total };
  if (nextPageToken) out.moreAvailable = true;
  return toon(out);
}

export function toonProjects(projects: JiraProject[]): string {
  if (projects.length === 0) {
    return toon({ projects: [], message: "No projects found" });
  }
  const rows = projects.map((p) => ({
    key: p.key,
    name: p.name,
    type: p.projectTypeKey ?? "unknown",
  }));
  return toon({ projects: rows, count: projects.length });
}

export function toonProject(p: JiraProject): string {
  return toon({
    project: {
      key: p.key,
      name: p.name,
      type: p.projectTypeKey ?? "unknown",
      description: p.description?.trim() || null,
      lead: p.lead?.displayName ?? null,
    },
  });
}

export function toonEpics(epics: JiraEpic[]): string {
  if (epics.length === 0) {
    return toon({ epics: [], message: "No epics found" });
  }
  const rows = epics.map((e) => ({
    key: e.key,
    name: e.name ?? e.summary,
    done: e.done ?? false,
  }));
  return toon({ epics: rows, count: epics.length });
}

export function toonEpicDetail(
  epicKey: string,
  epicSummary: string,
  epicStatus: string,
  epicPriority: string,
  epicAssignee: string,
  epicLabels: string,
  total: number,
  doneCount: number,
  byStatus: Record<string, number>,
  byPriority: Record<string, number>,
  byAssignee: Record<string, number>,
  childIssues: Array<{ key: string; summary: string; status: string; priority: string; assignee: string }>
): string {
  const completionPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  return toon({
    epic: {
      key: epicKey,
      summary: epicSummary,
      status: epicStatus,
      priority: epicPriority,
      assignee: epicAssignee,
      labels: epicLabels,
      totalIssues: total,
      completion: `${completionPct}% (${doneCount}/${total} done)`,
      byStatus,
      byPriority,
      byAssignee,
      childIssues,
    },
  });
}

export function toonBoards(boards: JiraBoard[]): string {
  if (boards.length === 0) {
    return toon({ boards: [], message: "No boards found" });
  }
  const rows = boards.map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    projectKey: b.location?.projectKey ?? null,
  }));
  return toon({ boards: rows, count: boards.length });
}

export function toonSprints(sprints: JiraSprint[]): string {
  if (sprints.length === 0) {
    return toon({ sprints: [], message: "No sprints found" });
  }
  const rows = sprints.map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    startDate: s.startDate?.split("T")[0] ?? null,
    endDate: s.endDate?.split("T")[0] ?? null,
    goal: s.goal ?? null,
  }));
  return toon({ sprints: rows, count: sprints.length });
}

export function toonSprintIssues(
  issues: JiraIssue[],
  total: number
): string {
  if (issues.length === 0) {
    return toon({ issues: [], total: 0, message: "No issues in this sprint" });
  }
  const rows = issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status.name,
    priority: i.fields.priority?.name ?? "None",
    assignee: i.fields.assignee?.displayName ?? "Unassigned",
  }));
  return toon({ issues: rows, total });
}

export function toonComments(
  issueKey: string,
  comments: JiraComment[],
  total: number,
  bodyTexts: string[]
): string {
  if (comments.length === 0) {
    return toon({ issueKey, comments: [], total: 0, message: `No comments on ${issueKey}` });
  }
  const rows = comments.map((c, i) => ({
    author: c.author?.displayName ?? "Unknown",
    created: c.created,
    body: bodyTexts[i] ?? "",
  }));
  return toon({ issueKey, comments: rows, total, showing: comments.length });
}

export function toonWorklogs(
  issueKey: string,
  worklogs: JiraWorklog[],
  total: number,
  totalHours: string,
  bodyTexts: string[]
): string {
  if (worklogs.length === 0) {
    return toon({ issueKey, worklogs: [], total: 0, message: `No worklogs on ${issueKey}` });
  }
  const rows = worklogs.map((w, i) => ({
    author: w.author.displayName,
    timeSpent: w.timeSpent,
    started: w.started.split("T")[0],
    comment: bodyTexts[i] ?? null,
  }));
  return toon({ issueKey, worklogs: rows, total, totalHours });
}

export function toonVersions(versions: JiraVersion[], projectKey: string): string {
  if (versions.length === 0) {
    return toon({ projectKey, versions: [], message: `No versions in project ${projectKey}` });
  }
  const rows = versions.map((v) => ({
    name: v.name,
    status: v.released ? "Released" : v.archived ? "Archived" : v.overdue ? "OVERDUE" : "Unreleased",
    startDate: v.startDate ?? null,
    releaseDate: v.releaseDate ?? null,
    description: v.description ?? null,
  }));
  return toon({ projectKey, versions: rows, count: versions.length });
}

export function toonComponents(components: JiraComponent[], projectKey: string): string {
  if (components.length === 0) {
    return toon({ projectKey, components: [], message: `No components in project ${projectKey}` });
  }
  const rows = components.map((c) => ({
    name: c.name,
    lead: c.lead?.displayName ?? null,
    description: c.description ?? null,
  }));
  return toon({ projectKey, components: rows, count: components.length });
}

export function toonLinks(
  issueKey: string,
  summary: string,
  links: Array<{ type: string; key: string; summary: string; status: string }>
): string {
  if (links.length === 0) {
    return toon({ issueKey, summary, links: [], message: `No links found for ${issueKey}` });
  }
  return toon({ issueKey, summary, links });
}

export function toonWatchers(issueKey: string, watchers: JiraUser[], watchCount: number): string {
  if (watchers.length === 0) {
    return toon({ issueKey, watchers: [], watchCount: 0, message: `No watchers on ${issueKey}` });
  }
  const rows = watchers.map((w) => ({
    displayName: w.displayName,
    id: w.accountId ?? w.key ?? w.name ?? "",
  }));
  return toon({ issueKey, watchers: rows, watchCount });
}

export function toonTransitions(
  issueKey: string,
  transitions: Array<{ id: string; name: string; to: string }>
): string {
  if (transitions.length === 0) {
    return toon({ issueKey, transitions: [], message: `No transitions available for ${issueKey}` });
  }
  return toon({ issueKey, transitions });
}

export function toonUsers(users: JiraUser[]): string {
  if (users.length === 0) {
    return toon({ users: [], message: "No users found" });
  }
  const rows = users.map((u) => ({
    displayName: u.displayName,
    id: u.accountId ?? u.key ?? u.name ?? "unknown",
    email: u.emailAddress ?? null,
  }));
  return toon({ users: rows, count: users.length });
}

export function toonResult(
  action: string,
  data: Record<string, unknown>
): string {
  return toon({ result: { action, ...data } });
}

export function toonEpicAnalysisContext(data: {
  epicKey: string;
  epicSummary: string;
  project: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string;
  fixVersions?: string;
  components?: string;
  completionPct: number;
  doneCount: number;
  total: number;
  inProgressCount: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byAssignee: Array<{ name: string; total: number; done: number }>;
  blockers: string[];
  unassignedHighPri: string[];
  staleIssues: string[];
  issues: Array<{ key: string; summary: string; type: string; status: string; priority: string; assignee: string; updated: string }>;
}): string {
  return toon({
    epic: {
      key: data.epicKey,
      summary: data.epicSummary,
      project: data.project,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      labels: data.labels,
      fixVersions: data.fixVersions ?? null,
      components: data.components ?? null,
    },
    progress: {
      completionPct: data.completionPct,
      doneCount: data.doneCount,
      total: data.total,
      inProgressCount: data.inProgressCount,
    },
    byStatus: data.byStatus,
    byType: data.byType,
    byAssignee: data.byAssignee,
    blockers: data.blockers,
    unassignedHighPri: data.unassignedHighPri,
    staleIssues: data.staleIssues,
    issues: data.issues,
  });
}

export function toonEpicDevPlanContext(data: {
  epic: { key: string; summary: string; project: string; status: string; priority: string; assignee: string; labels: string; components?: string; fixVersions?: string; progress: string; description: string };
  figmaUrls: Array<{ ticketKey: string; url: string }>;
  childIssues: Array<{
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
  }>;
  totalCount: number;
}): string {
  return toon(data);
}

export function toonBugTriageContext(data: {
  bugs: Array<{
    key: string;
    summary: string;
    priority: string;
    status: string;
    assignee: string;
    reporter: string;
    created: string;
    components: string;
    labels: string;
    descriptionPreview?: string;
  }>;
  total: number;
  showing: number;
}): string {
  return toon(data);
}

export function toonReleaseNotesContext(data: {
  version?: string;
  issuesByType: Record<string, Array<{ key: string; summary: string; priority: string }>>;
  total: number;
}): string {
  return toon(data);
}

export function toonStandupContext(data: {
  projectKey: string;
  daysBack: number;
  inProgress: Array<{ key: string; summary: string; assignee: string }>;
  done: Array<{ key: string; summary: string; assignee: string }>;
  todo: Array<{ key: string; summary: string; assignee: string }>;
}): string {
  return toon(data);
}

export function toonSprintRetroContext(data: {
  sprint: { name: string; state: string; startDate?: string; endDate?: string; completeDate?: string; goal?: string };
  completionRate: number;
  completedCount: number;
  totalCount: number;
  completed: Array<{ key: string; summary: string; type: string; priority: string; assignee: string }>;
  incomplete: Array<{ key: string; summary: string; type: string; priority: string; assignee: string }>;
  byAssignee: Array<{ name: string; done: number; notDone: number; rate: number }>;
  byType: Record<string, { done: number; notDone: number }>;
}): string {
  return toon(data);
}

export function toonWorkloadContext(data: {
  projectKey: string;
  totalOpen: number;
  teamMemberCount: number;
  avgLoad: number;
  unassignedCount: number;
  byMember: Array<{
    name: string;
    issueCount: number;
    highPriCount: number;
    byPriority: Record<string, number>;
    byStatus: Record<string, number>;
    issueKeys: string[];
  }>;
}): string {
  return toon(data);
}

export function toonSprintContext(data: {
  sprint: { name: string; state: string; startDate?: string; endDate?: string; goal?: string; boardId: number };
  issues: Array<{ key: string; summary: string; type: string; priority: string; status: string; assignee: string }>;
  total: number;
}): string {
  return toon(data);
}

export function toonMyself(me: {
  displayName: string;
  emailAddress?: string;
  accountId?: string;
  key?: string;
  active?: boolean;
  timeZone?: string;
  locale?: string;
  groups?: { items?: Array<{ name: string }> };
}): string {
  const obj: Record<string, unknown> = {
    displayName: me.displayName,
    email: me.emailAddress ?? null,
    accountId: me.accountId ?? me.key ?? null,
    active: me.active ?? null,
    timeZone: me.timeZone ?? null,
    locale: me.locale ?? null,
  };
  if (me.groups?.items?.length) {
    obj.groups = me.groups.items.map((g) => g.name);
  }
  return toon({ user: obj });
}

// ─── Common ──────────────────────────────────────────────────────────────────

export interface JiraUser {
  accountId?: string;
  key?: string;
  name?: string;
  emailAddress?: string;
  displayName: string;
  active?: boolean;
  avatarUrls?: Record<string, string>;
  timeZone?: string;
}

export interface JiraStatusCategory {
  id: number;
  key: string;
  name: string;
  colorName: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  description?: string;
  statusCategory: JiraStatusCategory;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
  description?: string;
  iconUrl?: string;
}

export interface JiraResolution {
  id: string;
  name: string;
  description?: string;
}

// ─── ADF (Atlassian Document Format) ────────────────────────────────────────

export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
}

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfDocument {
  version: 1;
  type: "doc";
  content: AdfNode[];
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: string | AdfDocument;
  created: string;
  updated: string;
}

export interface JiraIssueFields {
  summary: string;
  description?: string | AdfDocument | null;
  status: JiraStatus;
  priority?: JiraPriority;
  issuetype: JiraIssueType;
  assignee?: JiraUser | null;
  reporter?: JiraUser;
  created: string;
  updated: string;
  labels?: string[];
  resolution?: JiraResolution | null;
  comment?: { comments: JiraComment[]; total: number };
  parent?: { key: string; fields?: { summary: string } };
  subtasks?: JiraIssue[];
  fixVersions?: Array<{ id: string; name: string; released: boolean }>;
  components?: Array<{ id: string; name: string }>;
  project: { id: string; key: string; name: string };
  [key: string]: unknown;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
  nextPageToken?: string;
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  projectTypeKey?: string;
  lead?: JiraUser;
  avatarUrls?: Record<string, string>;
  style?: string;
}

// ─── Board (Agile) ──────────────────────────────────────────────────────────

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  location?: {
    projectId?: number;
    projectKey?: string;
    projectName?: string;
  };
}

export interface JiraBoardsResponse {
  maxResults: number;
  startAt: number;
  total: number;
  isLast: boolean;
  values: JiraBoard[];
}

// ─── Sprint (Agile) ─────────────────────────────────────────────────────────

export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
  originBoardId?: number;
}

export interface JiraSprintsResponse {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraSprint[];
}

export interface JiraSprintIssuesResponse {
  maxResults: number;
  startAt: number;
  total: number;
  issues: JiraIssue[];
}

// ─── Transitions ────────────────────────────────────────────────────────────

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  isAvailable?: boolean;
}

export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

// ─── Create / Update payloads ───────────────────────────────────────────────

export interface CreateIssuePayload {
  fields: {
    project: { key: string };
    summary: string;
    issuetype: { name: string };
    description?: string | AdfDocument;
    priority?: { name: string };
    assignee?: { accountId: string } | { name: string };
    labels?: string[];
    parent?: { key: string };
    [key: string]: unknown;
  };
}

export interface UpdateIssuePayload {
  fields: Record<string, unknown>;
}

export interface TransitionIssuePayload {
  transition: { id: string };
  fields?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

export interface AddCommentPayload {
  body: string | AdfDocument;
}

// ─── Epic (Agile) ───────────────────────────────────────────────────────────

export interface JiraEpic {
  id: number;
  key: string;
  self: string;
  name: string;
  summary: string;
  done: boolean;
}

export interface JiraEpicsResponse {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraEpic[];
}

// ─── Issue Links ────────────────────────────────────────────────────────────

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

export interface JiraIssueLink {
  id: string;
  type: JiraIssueLinkType;
  inwardIssue?: { key: string; fields?: { summary: string; status: JiraStatus } };
  outwardIssue?: { key: string; fields?: { summary: string; status: JiraStatus } };
}

export interface LinkIssuesPayload {
  type: { name: string };
  inwardIssue: { key: string };
  outwardIssue: { key: string };
  comment?: { body: string | AdfDocument };
}

// ─── Worklog ────────────────────────────────────────────────────────────────

export interface JiraWorklog {
  id: string;
  author: JiraUser;
  started: string;
  timeSpent: string;
  timeSpentSeconds: number;
  comment?: string | AdfDocument;
  created: string;
  updated: string;
}

export interface JiraWorklogsResponse {
  worklogs: JiraWorklog[];
  total: number;
  maxResults: number;
  startAt: number;
}

export interface AddWorklogPayload {
  timeSpent?: string;
  timeSpentSeconds?: number;
  started?: string;
  comment?: string | AdfDocument;
}

// ─── Watchers ───────────────────────────────────────────────────────────────

export interface JiraWatchersResponse {
  self: string;
  isWatching: boolean;
  watchCount: number;
  watchers: JiraUser[];
}

// ─── Versions ───────────────────────────────────────────────────────────────

export interface JiraVersion {
  id: string;
  name: string;
  description?: string;
  archived: boolean;
  released: boolean;
  startDate?: string;
  releaseDate?: string;
  projectId?: number;
  overdue?: boolean;
}

// ─── Components ─────────────────────────────────────────────────────────────

export interface JiraComponent {
  id: string;
  name: string;
  description?: string;
  lead?: JiraUser;
  assigneeType?: string;
  project?: string;
  projectId?: number;
  isAssigneeTypeValid?: boolean;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

// ─── Myself ─────────────────────────────────────────────────────────────────

export interface JiraMyself extends JiraUser {
  locale?: string;
  groups?: { size: number; items: Array<{ name: string }> };
}

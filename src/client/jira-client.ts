import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { Version2Client, Version3Client } from "jira.js";
import { AgileClient } from "jira.js";
import type { AxiosError } from "axios";
import { getConfig, type Config } from "../config.js";
import { getCache, type EntityType } from "../cache/cache.js";
import type {
  JiraErrorResponse,
  JiraIssue,
  JiraSearchResponse,
  JiraSprintIssuesResponse,
  JiraEpicsResponse,
  JiraBoardsResponse,
} from "./types.js";

export class JiraApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public jiraErrors?: JiraErrorResponse
  ) {
    const messages = [
      ...(jiraErrors?.errorMessages ?? []),
      ...Object.entries(jiraErrors?.errors ?? {}).map(
        ([k, v]) => `${k}: ${v}`
      ),
    ];
    super(
      `JIRA API ${status} ${statusText}${messages.length ? `: ${messages.join("; ")}` : ""}`
    );
    this.name = "JiraApiError";
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    await sleep(waitMs);
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate
    );
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROXY_CONNECT_MSG = "Proxy connection ended before receiving CONNECT response";

/**
 * Wraps HttpsProxyAgent so the destination TLS connection (after CONNECT 200)
 * also receives rejectUnauthorized: false when using corporate proxies / SSL inspection.
 */
function createProxyAgent(proxyUrl: string, insecure: boolean): InstanceType<typeof HttpsProxyAgent> {
  const base = new HttpsProxyAgent(proxyUrl, {
    rejectUnauthorized: !insecure,
  });
  if (!insecure) return base;
  const origConnect = base.connect.bind(base);
  (base as { connect: typeof origConnect }).connect = (req, opts) =>
    origConnect(req, { ...opts, rejectUnauthorized: false } as Parameters<typeof origConnect>[1]);
  return base;
}

interface CacheOpts {
  key: string;
  entity: EntityType;
  skip?: boolean;
}

export class JiraClient {
  private config: Config;
  private bucket: TokenBucket;

  private readonly v2: Version2Client;
  private readonly v3: Version3Client;
  readonly agile: AgileClient;
  readonly isCloud: boolean;

  /**
   * Platform-appropriate REST client (v3 for Cloud, v2 for Data Center).
   * Typed as Version3Client since v2/v3 share the same method surface;
   * the cast is safe because only the TypeScript generic return types differ.
   */
  get api(): Version3Client {
    return (this.isCloud ? this.v3 : this.v2) as unknown as Version3Client;
  }

  constructor() {
    this.config = getConfig();
    this.isCloud = this.config.apiVersion === "3";
    this.bucket = new TokenBucket(
      this.config.rateLimit,
      this.config.rateLimit
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseRequestConfig: Record<string, any> = {
      timeout: this.config.requestTimeout,
    };

    if (this.config.proxyUrl) {
      baseRequestConfig.httpsAgent = createProxyAgent(
        this.config.proxyUrl,
        this.config.insecure
      );
      baseRequestConfig.proxy = false;
    } else if (this.config.insecure) {
      baseRequestConfig.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    const authentication = this.config.email
      ? {
          basic: {
            email: this.config.email,
            apiToken: this.config.apiToken,
          },
        }
      : { oauth2: { accessToken: this.config.apiToken } };

    const clientConfig = {
      host: this.config.baseUrl,
      authentication,
      baseRequestConfig,
    };

    this.v3 = new Version3Client(clientConfig);
    this.v2 = new Version2Client(clientConfig);
    this.agile = new AgileClient(clientConfig);
  }

  /**
   * Rate-limited call with retry and optional caching.
   * Wraps any jira.js client call.
   */
  async call<T>(
    fn: () => Promise<T>,
    cache?: CacheOpts
  ): Promise<T> {
    const cacheStore = getCache();

    if (cache && !cache.skip) {
      const cached = cacheStore.get<T>(cache.key);
      if (cached !== undefined) return cached;
    }

    await this.bucket.acquire();

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000);
        await sleep(backoff);
      }

      try {
        const result = await fn();

        if (cache) {
          cacheStore.set(cache.key, result, cache.entity);
        }

        return result;
      } catch (err) {
        const axErr = err as AxiosError;
        const status = axErr?.response?.status;
        const msg = err instanceof Error ? err.message : String(err);

        if (status === 429) {
          const retryAfter = axErr.response?.headers?.["retry-after"];
          const waitSec = retryAfter
            ? parseInt(String(retryAfter), 10)
            : 2 ** attempt;
          await sleep(waitSec * 1000);
          lastError = this.wrapError(axErr);
          continue;
        }

        if (status && status >= 500 && attempt < this.config.maxRetries) {
          lastError = this.wrapError(axErr);
          continue;
        }

        if (
          msg.includes(PROXY_CONNECT_MSG) &&
          attempt < this.config.maxRetries
        ) {
          lastError = err instanceof Error ? err : new Error(msg);
          continue;
        }

        throw this.wrapError(axErr);
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private wrapError(err: AxiosError | Error): JiraApiError | Error {
    const ax = err as AxiosError;
    if (!ax.response) return err instanceof Error ? err : new Error(String(err));
    const data = ax.response.data as JiraErrorResponse | undefined;
    return new JiraApiError(
      ax.response.status,
      ax.response.statusText ?? "",
      data
    );
  }

  /** JIRA Cloud search returns at most this many issues per request; we paginate to honour maxResultsLimit. */
  private static readonly CLOUD_SEARCH_PAGE_SIZE = 100;

  /** Agile/board APIs often cap at 50–100 per request; we paginate with this page size. */
  private static readonly AGILE_PAGE_SIZE = 100;

  /**
   * JQL search using the correct endpoint:
   * - Cloud: enhanced search (POST /rest/api/3/search/jql) with nextPageToken; paginates when maxResults > 100.
   * - DC: legacy search (POST /rest/api/2/search) with startAt.
   */
  private async searchJql(opts: {
    jql: string;
    fields?: string[];
    maxResults?: number;
    nextPageToken?: string;
    startAt?: number;
    expand?: string[];
  }): Promise<JiraSearchResponse> {
    const requested = opts.maxResults ?? 50;

    if (this.isCloud) {
      const all: JiraIssue[] = [];
      let token: string | undefined = opts.nextPageToken;
      let total = 0;

      while (all.length < requested) {
        const pageSize = Math.min(
          requested - all.length,
          JiraClient.CLOUD_SEARCH_PAGE_SIZE
        );
        const raw = await this.v3.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
          jql: opts.jql,
          fields: opts.fields,
          maxResults: pageSize,
          nextPageToken: token,
        });
        const page = (raw.issues ?? []) as unknown as JiraIssue[];
        all.push(...page);
        token = raw.nextPageToken;
        if (typeof (raw as { totalCount?: number }).totalCount === "number") {
          total = (raw as { totalCount: number }).totalCount;
        }
        if (page.length === 0 || !token) break;
      }

      return {
        issues: all,
        total: total || all.length,
        maxResults: requested,
        startAt: 0,
        nextPageToken: token,
      };
    }

    const raw = await this.v2.issueSearch.searchForIssuesUsingJqlPost({
      jql: opts.jql,
      fields: opts.fields,
      maxResults: requested,
      startAt: opts.startAt ?? 0,
    });
    return {
      issues: (raw.issues ?? []) as unknown as JiraIssue[],
      total: raw.total ?? 0,
      maxResults: raw.maxResults ?? 50,
      startAt: raw.startAt ?? 0,
    };
  }

  /**
   * JQL search wrapped with rate limiting and caching.
   */
  async search(opts: {
    jql: string;
    fields?: string[];
    maxResults?: number;
    cache?: CacheOpts;
  }): Promise<JiraSearchResponse> {
    return this.call(
      () => this.searchJql(opts),
      opts.cache
    );
  }

  /**
   * Agile: get board issues for sprint with pagination so we can return more than the API's per-request cap.
   */
  async getBoardIssuesForSprintPaginated(opts: {
    boardId: number;
    sprintId: number;
    maxResults: number;
    fields?: string[];
  }): Promise<JiraSprintIssuesResponse> {
    const { boardId, sprintId, maxResults, fields } = opts;
    const pageSize = Math.min(maxResults, JiraClient.AGILE_PAGE_SIZE);
    const all: JiraIssue[] = [];
    let startAt = 0;
    let total = 0;

    while (all.length < maxResults) {
      const raw = await this.call(() =>
        this.agile.board.getBoardIssuesForSprint({
          boardId,
          sprintId,
          startAt,
          maxResults: pageSize,
          fields: fields ?? ["summary", "status", "priority", "assignee", "issuetype", "labels", "project"],
        })
      ) as unknown as JiraSprintIssuesResponse;
      const issues = raw.issues ?? [];
      all.push(...issues);
      total = raw.total ?? all.length;
      if (issues.length === 0 || all.length >= total || all.length >= maxResults) break;
      startAt = all.length;
    }

    return {
      issues: all.slice(0, maxResults),
      total,
      maxResults,
      startAt: 0,
    };
  }

  /**
   * Agile: get issues for sprint with pagination.
   */
  async getSprintIssuesPaginated(opts: {
    sprintId: number;
    maxResults: number;
    fields?: string[];
  }): Promise<JiraSprintIssuesResponse> {
    const { sprintId, maxResults, fields } = opts;
    const pageSize = Math.min(maxResults, JiraClient.AGILE_PAGE_SIZE);
    const all: JiraIssue[] = [];
    let startAt = 0;
    let total = 0;

    while (all.length < maxResults) {
      const raw = await this.call(() =>
        this.agile.sprint.getIssuesForSprint({
          sprintId,
          startAt,
          maxResults: pageSize,
          fields: fields ?? ["summary", "status", "priority", "assignee", "issuetype", "labels", "project"],
        })
      ) as unknown as JiraSprintIssuesResponse;
      const issues = raw.issues ?? [];
      all.push(...issues);
      total = raw.total ?? all.length;
      if (issues.length === 0 || all.length >= total || all.length >= maxResults) break;
      startAt = all.length;
    }

    return {
      issues: all.slice(0, maxResults),
      total,
      maxResults,
      startAt: 0,
    };
  }

  /**
   * Agile: get epics for board with pagination.
   */
  async getEpicsPaginated(opts: {
    boardId: number;
    maxResults: number;
    done?: boolean;
  }): Promise<JiraEpicsResponse> {
    const { boardId, maxResults, done } = opts;
    const pageSize = Math.min(maxResults, JiraClient.AGILE_PAGE_SIZE);
    const all: import("./types.js").JiraEpic[] = [];
    let startAt = 0;

    while (all.length < maxResults) {
      const raw = await this.call(() =>
        this.agile.board.getEpics({
          boardId,
          startAt,
          maxResults: pageSize,
          done: done !== undefined ? String(done) : undefined,
        })
      ) as unknown as JiraEpicsResponse;
      const values = raw.values ?? [];
      all.push(...values);
      if ((raw.isLast ?? false) || values.length === 0 || all.length >= maxResults) break;
      startAt = all.length;
    }

    return {
      values: all.slice(0, maxResults),
      maxResults,
      startAt: 0,
      isLast: true,
    };
  }

  /**
   * Agile: get all boards with pagination.
   */
  async getAllBoardsPaginated(opts: {
    maxResults: number;
    projectKeyOrId?: string;
    type?: "scrum" | "kanban" | "simple";
  }): Promise<JiraBoardsResponse> {
    const { maxResults, projectKeyOrId, type } = opts;
    const pageSize = Math.min(maxResults, JiraClient.AGILE_PAGE_SIZE);
    const all: import("./types.js").JiraBoard[] = [];
    let startAt = 0;
    let total = 0;

    while (all.length < maxResults) {
      const raw = await this.call(() =>
        this.agile.board.getAllBoards({
          projectKeyOrId,
          type,
          startAt,
          maxResults: pageSize,
        })
      ) as unknown as JiraBoardsResponse;
      const values = raw.values ?? [];
      all.push(...values);
      total = raw.total ?? all.length;
      if (values.length === 0 || all.length >= maxResults || startAt + values.length >= total) break;
      startAt = all.length;
    }

    return {
      values: all.slice(0, maxResults),
      maxResults,
      startAt: 0,
      total,
      isLast: true,
    };
  }

  /**
   * Get a single issue by key with specified fields.
   */
  async getIssue(
    issueKey: string,
    fields?: string[],
    cache?: CacheOpts
  ): Promise<JiraIssue> {
    return this.call(
      async () => {
        const raw = await this.api.issues.getIssue({ issueIdOrKey: issueKey, fields });
        return raw as unknown as JiraIssue;
      },
      cache
    );
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  resolveCustomField(name: string): string {
    return this.config.customFields[name] ?? name;
  }

  resolveCustomFields(
    fields: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      resolved[this.resolveCustomField(key)] = value;
    }
    return resolved;
  }
}

let _client: JiraClient | null = null;

export function getClient(): JiraClient {
  if (!_client) _client = new JiraClient();
  return _client;
}

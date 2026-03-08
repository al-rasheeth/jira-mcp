import https from "node:https";
import { Version2Client, Version3Client } from "jira.js";
import { AgileClient } from "jira.js";
import type { AxiosError } from "axios";
import { getConfig, type Config } from "../config.js";
import { getCache, type EntityType } from "../cache/cache.js";
import type { JiraErrorResponse, JiraIssue, JiraSearchResponse } from "./types.js";

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

function parseProxy(proxyUrl: string) {
  const u = new URL(proxyUrl);
  return {
    protocol: u.protocol.replace(":", ""),
    host: u.hostname,
    port: parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 8080),
    ...(u.username
      ? {
          auth: {
            username: decodeURIComponent(u.username),
            password: decodeURIComponent(u.password),
          },
        }
      : {}),
  };
}

interface CacheOpts {
  key: string;
  entity: EntityType;
  skip?: boolean;
}

export class JiraClient {
  private config: Config;
  private bucket: TokenBucket;

  readonly v2: Version2Client;
  readonly v3: Version3Client;
  readonly agile: AgileClient;
  readonly isCloud: boolean;

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
      baseRequestConfig.proxy = parseProxy(this.config.proxyUrl);
    }

    if (this.config.insecure) {
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

        throw this.wrapError(axErr);
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private wrapError(err: AxiosError): JiraApiError | Error {
    if (!err.response) return err instanceof Error ? err : new Error(String(err));
    const data = err.response.data as JiraErrorResponse | undefined;
    return new JiraApiError(
      err.response.status,
      err.response.statusText ?? "",
      data
    );
  }

  /**
   * JQL search using the correct endpoint:
   * - Cloud: enhanced search (POST /rest/api/3/search/jql) with nextPageToken
   * - DC: legacy search (POST /rest/api/2/search) with startAt
   */
  async searchJql(opts: {
    jql: string;
    fields?: string[];
    maxResults?: number;
    nextPageToken?: string;
    startAt?: number;
    expand?: string[];
  }): Promise<JiraSearchResponse> {
    if (this.isCloud) {
      const raw = await this.v3.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
        jql: opts.jql,
        fields: opts.fields,
        maxResults: opts.maxResults ?? 50,
        nextPageToken: opts.nextPageToken,
      });
      return {
        issues: (raw.issues ?? []) as unknown as JiraIssue[],
        total: (raw.issues ?? []).length,
        maxResults: opts.maxResults ?? 50,
        startAt: 0,
        nextPageToken: raw.nextPageToken,
      };
    }

    const raw = await this.v2.issueSearch.searchForIssuesUsingJqlPost({
      jql: opts.jql,
      fields: opts.fields,
      maxResults: opts.maxResults ?? 50,
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
   * Get a single issue by key with specified fields.
   */
  async getIssue(
    issueKey: string,
    fields?: string[],
    cache?: CacheOpts
  ): Promise<JiraIssue> {
    const params = { issueIdOrKey: issueKey, fields };
    return this.call(
      async () => {
        const raw = this.isCloud
          ? await this.v3.issues.getIssue(params)
          : await this.v2.issues.getIssue(params);
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

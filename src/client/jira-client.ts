import { ProxyAgent } from "undici";
import { getConfig, type Config } from "../config.js";
import { getCache, type EntityType } from "../cache/cache.js";
import type { JiraErrorResponse } from "./types.js";

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

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  cacheable?: EntityType | false;
  skipCache?: boolean;
}

// Token bucket for rate limiting
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
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JiraClient {
  private config: Config;
  private authHeader: string;
  private bucket: TokenBucket;
  private dispatcher: ProxyAgent | undefined;

  constructor() {
    this.config = getConfig();

    if (this.config.email) {
      const encoded = Buffer.from(
        `${this.config.email}:${this.config.apiToken}`
      ).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    } else {
      this.authHeader = `Bearer ${this.config.apiToken}`;
    }

    this.bucket = new TokenBucket(
      this.config.rateLimit,
      this.config.rateLimit
    );

    if (this.config.proxyUrl) {
      this.dispatcher = new ProxyAgent({
        uri: this.config.proxyUrl,
        ...(this.config.insecure
          ? { requestTls: { rejectUnauthorized: false } }
          : {}),
      });
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const base = this.config.baseUrl;
    const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  get apiBase(): string {
    return `/rest/api/${this.config.apiVersion}`;
  }

  get agileBase(): string {
    return "/rest/agile/1.0";
  }

  get isCloud(): boolean {
    return this.config.apiVersion === "3";
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, query, cacheable, skipCache } = options;

    const cache = getCache();
    const url = this.buildUrl(path, query);
    const cacheKey =
      cacheable && method === "GET"
        ? cache.buildKey(cacheable, url)
        : undefined;

    if (cacheKey && !skipCache) {
      const cached = cache.get<T>(cacheKey);
      if (cached !== undefined) return cached;
    }

    await this.bucket.acquire();

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000);
        await sleep(backoff);
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.requestTimeout
      );

      try {
        const fetchOptions: RequestInit & { dispatcher?: unknown } = {
          method,
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          signal: controller.signal,
        };

        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }

        if (this.dispatcher) {
          fetchOptions.dispatcher = this.dispatcher;
        }

        const response = await fetch(url, fetchOptions);

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitSec = retryAfter ? parseInt(retryAfter, 10) : 2 ** attempt;
          await sleep(waitSec * 1000);
          continue;
        }

        if (response.status >= 500 && attempt < this.config.maxRetries) {
          lastError = new JiraApiError(
            response.status,
            response.statusText
          );
          continue;
        }

        if (!response.ok) {
          let jiraErrors: JiraErrorResponse | undefined;
          try {
            jiraErrors = (await response.json()) as JiraErrorResponse;
          } catch {
            // response body not JSON
          }
          throw new JiraApiError(
            response.status,
            response.statusText,
            jiraErrors
          );
        }

        if (response.status === 204) {
          return undefined as T;
        }

        const data = (await response.json()) as T;

        if (cacheKey && cacheable) {
          cache.set(cacheKey, data, cacheable);
        }

        return data;
      } catch (err) {
        if (
          err instanceof JiraApiError ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === this.config.maxRetries) break;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  /**
   * Auto-paginate using startAt/maxResults pattern.
   * `extract` pulls the items array from each page response.
   */
  async paginate<TPage, TItem>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    extract: (page: TPage) => TItem[],
    isLastPage: (page: TPage) => boolean,
    maxPages = 10
  ): Promise<TItem[]> {
    const items: TItem[] = [];
    let startAt = 0;
    const maxResults = 50;

    for (let page = 0; page < maxPages; page++) {
      const pageData = await this.request<TPage>(path, {
        query: { ...query, startAt, maxResults },
      });
      const pageItems = extract(pageData);
      items.push(...pageItems);

      if (isLastPage(pageData) || pageItems.length === 0) break;
      startAt += pageItems.length;
    }

    return items;
  }

  resolveCustomField(name: string): string {
    const mapping = this.config.customFields;
    return mapping[name] ?? name;
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

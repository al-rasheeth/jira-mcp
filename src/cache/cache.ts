import { LRUCache } from "lru-cache";
import { getConfig } from "../config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CacheValue = any;

export type EntityType =
  | "issue"
  | "search"
  | "project"
  | "board"
  | "sprint"
  | "user"
  | "transition"
  | "comment";

const DEFAULT_TTLS: Record<EntityType, number> = {
  issue: 60,
  search: 30,
  project: 600,
  board: 300,
  sprint: 120,
  user: 300,
  transition: 120,
  comment: 60,
};

export class JiraCache {
  private cache: LRUCache<string, CacheValue>;
  private defaultTtlSec: number;

  constructor() {
    const config = getConfig();
    this.defaultTtlSec = config.cacheTtl;
    this.cache = new LRUCache<string, CacheValue>({
      max: config.cacheMax,
      ttl: this.defaultTtlSec * 1000,
    });
  }

  buildKey(entity: EntityType, ...parts: string[]): string {
    return `${entity}:${parts.join(":")}`;
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set(key: string, value: CacheValue, entity?: EntityType): void {
    const ttlSec = entity
      ? DEFAULT_TTLS[entity] ?? this.defaultTtlSec
      : this.defaultTtlSec;
    this.cache.set(key, value, { ttl: ttlSec * 1000 });
  }

  /** Invalidate a specific key */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Invalidate all keys that start with the given prefix */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Invalidate all cached data for a given entity type */
  invalidateEntity(entity: EntityType): void {
    this.invalidateByPrefix(`${entity}:`);
  }

  /** Invalidate issue-related caches when an issue is mutated */
  invalidateIssue(issueKey?: string): void {
    if (issueKey) {
      this.invalidateByPrefix(`issue:${issueKey}`);
    }
    this.invalidateEntity("search");
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

let _cache: JiraCache | null = null;

export function getCache(): JiraCache {
  if (!_cache) _cache = new JiraCache();
  return _cache;
}

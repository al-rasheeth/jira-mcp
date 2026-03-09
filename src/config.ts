import { z } from "zod";

const configSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, "")),
  email: z.string().optional(),
  apiToken: z.string().min(1),
  apiVersion: z.enum(["2", "3"]).default("3"),
  proxyUrl: z.string().url().optional(),
  cacheTtl: z.coerce.number().int().min(0).default(300),
  cacheMax: z.coerce.number().int().min(0).default(500),
  requestTimeout: z.coerce.number().int().min(1000).default(30000),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  rateLimit: z.coerce.number().min(1).default(10),
  maxResultsLimit: z.coerce.number().int().min(1).max(1000).default(100),
  customFields: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return {} as Record<string, string>;
      try {
        return JSON.parse(v) as Record<string, string>;
      } catch {
        throw new Error(
          `JIRA_CUSTOM_FIELDS must be valid JSON: ${v}`
        );
      }
    }),
  defaultProject: z.string().optional(),
  writeEnabled: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  insecure: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const raw = {
    baseUrl: process.env.JIRA_BASE_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    apiVersion: process.env.JIRA_API_VERSION,
    proxyUrl:
      process.env.JIRA_PROXY_URL ??
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy,
    cacheTtl: process.env.JIRA_CACHE_TTL,
    cacheMax: process.env.JIRA_CACHE_MAX,
    requestTimeout: process.env.JIRA_REQUEST_TIMEOUT,
    maxRetries: process.env.JIRA_MAX_RETRIES,
    rateLimit: process.env.JIRA_RATE_LIMIT,
    maxResultsLimit: process.env.JIRA_MAX_RESULTS_LIMIT,
    customFields: process.env.JIRA_CUSTOM_FIELDS,
    defaultProject: process.env.JIRA_DEFAULT_PROJECT,
    writeEnabled: process.env.JIRA_WRITE_ENABLED,
    insecure: process.env.JIRA_INSECURE,
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid JIRA MCP configuration:\n${issues}\n\nRequired: JIRA_BASE_URL, JIRA_API_TOKEN`
    );
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}

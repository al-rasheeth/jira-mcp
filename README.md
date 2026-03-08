# jira-mcp

STDIO-based JIRA MCP (Model Context Protocol) server for AI assistants like Cursor, Claude Desktop, and VS Code Copilot. Supports both JIRA Cloud (API v3) and Data Center (API v2) with proxy support, LRU caching, and ADF-to-Markdown conversion.

## Quick Start

```bash
npm install
npm run build
```

## MCP Client Configuration

Add to your MCP client config (Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/jira-mcp/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-org.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Data Center / Server

For on-premise JIRA with Personal Access Token:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/jira-mcp/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.your-company.com",
        "JIRA_API_TOKEN": "your-personal-access-token",
        "JIRA_API_VERSION": "2"
      }
    }
  }
}
```

### With Proxy

```json
{
  "env": {
    "JIRA_BASE_URL": "https://your-org.atlassian.net",
    "JIRA_EMAIL": "you@example.com",
    "JIRA_API_TOKEN": "your-api-token",
    "JIRA_PROXY_URL": "http://proxy.corp.com:8080"
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JIRA_BASE_URL` | Yes | — | JIRA instance URL |
| `JIRA_API_TOKEN` | Yes | — | API token (Cloud) or PAT (Data Center) |
| `JIRA_EMAIL` | Cloud only | — | Email for Cloud basic auth |
| `JIRA_API_VERSION` | No | `3` | `3` for Cloud, `2` for Data Center |
| `JIRA_PROXY_URL` | No | — | HTTP/HTTPS proxy URL |
| `HTTPS_PROXY` | No | — | Standard proxy fallback |
| `JIRA_CACHE_TTL` | No | `300` | Cache TTL in seconds |
| `JIRA_CACHE_MAX` | No | `500` | Max cache entries |
| `JIRA_REQUEST_TIMEOUT` | No | `30000` | Request timeout (ms) |
| `JIRA_MAX_RETRIES` | No | `3` | Retry count for transient failures |
| `JIRA_RATE_LIMIT` | No | `10` | Max requests per second |
| `JIRA_CUSTOM_FIELDS` | No | — | JSON map: `{"storyPoints": "customfield_10016"}` |
| `JIRA_DEFAULT_PROJECT` | No | — | Default project key |
| `JIRA_INSECURE` | No | `false` | Skip TLS verification |

## Tools

| Tool | Description |
|---|---|
| `search_issues` | JQL search with field selection |
| `get_issue` | Full issue details with comments |
| `create_issue` | Create issues with markdown descriptions |
| `update_issue` | Update issue fields |
| `delete_issue` | Permanently delete an issue |
| `list_transitions` | Available workflow transitions |
| `transition_issue` | Move issue through workflow |
| `add_comment` | Add comment (markdown) |
| `get_comments` | Get issue comments |
| `list_projects` | List accessible projects |
| `get_project` | Project details |
| `list_boards` | List agile boards |
| `list_sprints` | List sprints for a board |
| `get_sprint_issues` | Issues in a sprint |
| `search_users` | Find users by name/email |
| `assign_issue` | Assign/unassign issue |

## Resources

| URI | Description |
|---|---|
| `jira://projects` | All accessible projects |
| `jira://boards` | All agile boards |
| `jira://myself` | Current authenticated user |
| `jira://issue/{key}` | Single issue by key |

## Prompts

| Prompt | Description |
|---|---|
| `sprint-planning` | Sprint analysis with workload and risk assessment |
| `bug-triage` | Bug prioritization recommendations |
| `release-notes` | Generate release notes from JQL |
| `standup-summary` | Daily standup talking points |

## Key Features

- **ADF-Markdown Bridge**: Bidirectional conversion between JIRA's Atlassian Document Format and Markdown for LLM-friendly interaction
- **Smart Caching**: LRU cache with per-entity TTL and automatic invalidation on write operations
- **Custom Field Mapping**: Define friendly names in config, use them in tools transparently
- **Dual API Support**: Single codebase for Cloud (v3 + ADF) and Data Center (v2 + plain text)
- **Rate Limit Intelligence**: Token bucket rate limiter with Retry-After header respect
- **Proxy Support**: HTTP/HTTPS proxy via undici ProxyAgent
- **Tool Annotations**: MCP annotations (readOnly, destructive, idempotent) for informed client decisions

## Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
npm start      # Run compiled output
```

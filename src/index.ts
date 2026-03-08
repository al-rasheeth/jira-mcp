#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  try {
    loadConfig();
  } catch (err) {
    process.stderr.write(
      `[jira-mcp] Configuration error:\n${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `[jira-mcp] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});

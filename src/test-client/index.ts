#!/usr/bin/env node
/**
 * MCP test client for jira-mcp.
 * Loads env from .env and spawns the MCP server to test tools, resources, and prompts.
 *
 * Usage: npm run test-client   (or: npx tsx src/test-client/index.ts)
 * Ensure .env has JIRA_BASE_URL, JIRA_API_TOKEN, and optionally JIRA_EMAIL (Cloud).
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

config({ path: resolve(process.cwd(), ".env") });

const projectRoot = process.cwd();
const serverEntry = resolve(projectRoot, "build/index.js");
const serverSource = resolve(projectRoot, "src/index.ts");

async function main(): Promise<void> {
  const useBuild = await import("node:fs").then((fs) =>
    fs.promises.access(serverEntry).then(() => true, () => false)
  );
  const transport = new StdioClientTransport({
    command: useBuild ? "node" : "npx",
    args: useBuild ? [serverEntry] : ["tsx", serverSource],
    env: process.env as Record<string, string>,
    stderr: "inherit",
  });

  const client = new Client(
    { name: "jira-mcp-test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    console.error("Failed to connect to MCP server. Check .env (JIRA_BASE_URL, JIRA_API_TOKEN).", err);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question("\n> ", (answer) => resolve(answer.trim()));
    });

  console.log("\nJIRA MCP Test Client");
  console.log("Commands: list-tools | list-resources | list-prompts | call <tool> <json-args> | resource <uri> | prompt <name> <json-args> | quit\n");

  for (;;) {
    const line = await prompt();
    if (!line) continue;
    if (line === "quit" || line === "exit" || line === "q") break;

    const [cmd, ...rest] = line.split(/\s+/);
    const restStr = rest.join(" ");

    try {
      switch (cmd) {
        case "list-tools": {
          const { tools } = await client.listTools();
          console.log(`Tools (${tools.length}):`);
          for (const t of tools) {
            console.log(`  ${t.name}: ${t.description ?? ""}`);
          }
          break;
        }
        case "list-resources": {
          const { resources } = await client.listResources();
          console.log(`Resources (${resources?.length ?? 0}):`);
          for (const r of resources ?? []) {
            const uri = typeof r.uri === "object" && r.uri && "template" in r.uri ? (r.uri as { template: string }).template : (r.uri ?? r.name);
            console.log(`  ${uri}: ${r.description ?? ""}`);
          }
          break;
        }
        case "list-prompts": {
          const { prompts } = await client.listPrompts();
          console.log(`Prompts (${prompts?.length ?? 0}):`);
          for (const p of prompts ?? []) {
            console.log(`  ${p.name}: ${p.description ?? ""}`);
          }
          break;
        }
        case "call": {
          const name = rest[0];
          const argsStr = rest.slice(1).join(" ");
          if (!name) {
            console.log("Usage: call <tool_name> [<json_args>]");
            break;
          }
          const raw = argsStr ? (JSON.parse(argsStr) as Record<string, unknown>) : {};
          const args = Object.fromEntries(
            Object.entries(raw).map(([k, v]) => [k, typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v)])
          ) as { [x: string]: string | number | boolean };
          const result = await client.callTool({ name, arguments: args });
          console.log("Result:", JSON.stringify(result, null, 2));
          break;
        }
        case "resource": {
          const uri = restStr || "jira://projects";
          const result = await client.readResource({ uri });
          console.log("Contents:", result.contents?.map((c) => (c as { text?: string }).text ?? c).join("\n---\n") ?? result);
          break;
        }
        case "prompt": {
          const name = rest[0];
          const argsStr = rest.slice(1).join(" ");
          if (!name) {
            console.log("Usage: prompt <prompt_name> [<json_args>]");
            break;
          }
          const raw = argsStr ? (JSON.parse(argsStr) as Record<string, unknown>) : {};
          const promptArgs = Object.fromEntries(
            Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : String(v)])
          ) as { [x: string]: string };
          const result = await client.getPrompt({ name, arguments: promptArgs });
          console.log("Messages:", JSON.stringify(result.messages, null, 2));
          break;
        }
        default:
          console.log("Unknown command. Use list-tools | list-resources | list-prompts | call | resource | prompt | quit");
      }
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
  }

  await transport.close();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

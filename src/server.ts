/**
 * Tool registration, shared by both transports.
 *
 * The store is created once per server and closed over by every handler, so a
 * conversation that calls six tools downloads a history at most once.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getCacheDir, getCacheTtlMs, getCredentials } from "./config.js";
import { HistoryStore } from "./history/store.js";
import { TOOLS } from "./tools/index.js";

export const SERVER_NAME = "matrix-workouts-mcp";
export const SERVER_VERSION = "0.1.0";

export function createStore(env: NodeJS.ProcessEnv = process.env): HistoryStore {
  return new HistoryStore({
    cacheDir: getCacheDir(env),
    ttlMs: getCacheTtlMs(env),
    credentials: getCredentials(env),
  });
}

export function createServer(store: HistoryStore = createStore()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of TOOLS) {
    server.tool(tool.name, tool.description, tool.schema, async (args: Record<string, unknown>) => {
      try {
        return { content: [{ type: "text" as const, text: await tool.handler(store, args) }] };
      } catch (error) {
        /*
         * The message, never the error object. A thrown value from the API client can
         * carry the request that produced it, and that request has a bearer token in
         * its headers — the core package redacts what it throws, and this is the
         * second place that matters.
         */
        const message = error instanceof Error ? error.message : "Unknown failure.";
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    });
  }

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

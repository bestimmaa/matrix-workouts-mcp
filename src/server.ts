/**
 * Tool registration, shared by both transports.
 *
 * The store is created once per server and closed over by every handler, so a
 * conversation that calls six tools downloads a history at most once.
 */
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getCacheDir, getCacheTtlMs, getCredentials } from "./config.js";
import { HistoryStore } from "./history/store.js";
import { type ToolDefinition, TOOLS } from "./tools/index.js";

export const SERVER_NAME = "matrix-workouts-mcp";

/**
 * The version is read from package.json rather than restated here: `npm version` bumps
 * that file and nothing else, so a literal announced the first release forever. The
 * file is one directory up from `src/` and two up from `dist/src/`.
 */
function packageVersion(): string {
  for (const relative of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === SERVER_NAME && pkg.version) return pkg.version;
    } catch {
      // Not at this depth; try the next.
    }
  }
  return "0.0.0";
}

export const SERVER_VERSION = packageVersion();

export function createStore(env: NodeJS.ProcessEnv = process.env): HistoryStore {
  return new HistoryStore({
    cacheDir: getCacheDir(env),
    ttlMs: getCacheTtlMs(env),
    credentials: getCredentials(env),
  });
}

/** A rejection a model can act on: the key it sent and the ones the tool takes. */
function unknownArgument(tool: ToolDefinition): z.ZodErrorMap {
  const accepted = Object.keys(tool.schema);
  const takes = accepted.length === 0 ? "takes no arguments" : `takes: ${accepted.join(", ")}`;
  return (issue, ctx) =>
    issue.code === z.ZodIssueCode.unrecognized_keys
      ? { message: `Unknown argument ${issue.keys.map((key) => `'${key}'`).join(", ")}; ${tool.name} ${takes}.` }
      : { message: ctx.defaultError };
}

export function createServer(store: HistoryStore = createStore()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of TOOLS) {
    /*
     * Registered strict, so an argument the schema does not name is an error naming
     * it rather than a key the SDK strips before the handler runs — `groupBy` for
     * `bucket` used to come back as a whole-history answer shaped like a correct one.
     * Strictness has to be on the registered schema: the SDK parses against it before
     * the callback, so a strict parse in the handler would see the key already gone.
     * It also needs an SDK that registers a `ZodObject` as given; before 1.22.0
     * `registerTool` wrapped it in `z.object()` again, which breaks every call.
     */
    const inputSchema = z.object(tool.schema, { errorMap: unknownArgument(tool) }).strict();
    server.registerTool(tool.name, { description: tool.description, inputSchema }, async (args) => {
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

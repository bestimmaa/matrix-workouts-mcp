/**
 * The HTTP transport, for agents that cannot spawn a process — a container, another
 * machine, a hosted runner.
 *
 * Two things are deliberately stricter than the stdio path, because this one puts a
 * ride history on a port: it **refuses to start without a token**, and it binds
 * loopback unless told otherwise. Neither is a default to relax without meaning it.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { getAuthToken, getHttpHost, getHttpPort } from "../config.js";
import { createServer, createStore } from "../server.js";
import { isAuthenticatedRequest } from "./auth.js";

const MCP_PATH = "/mcp";
const HEALTHZ_PATH = "/healthz";

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendJsonRpcError(res: ServerResponse, statusCode: number, code: number, message: string): void {
  sendJson(res, statusCode, { jsonrpc: "2.0", error: { code, message }, id: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

export async function startHttpServer(): Promise<import("node:http").Server> {
  const authToken = getAuthToken();
  if (!authToken) {
    throw new Error(
      "MCP_TRANSPORT=http requires MATRIX_MCP_TOKEN. Refusing to serve a workout history, " +
        "heart rate included, on an unauthenticated port.",
    );
  }

  const port = getHttpPort();
  const host = getHttpHost();

  /*
   * One store for the process, not one per request: each request builds its own
   * stateless transport and McpServer, but they must not each re-download a history.
   */
  const store = createStore();

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === HEALTHZ_PATH) {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (url.pathname !== MCP_PATH) {
      sendJsonRpcError(res, 404, -32601, "Not found");
      return;
    }
    if (!isAuthenticatedRequest(req, authToken)) {
      sendJsonRpcError(res, 401, -32001, "Unauthorized: missing or invalid bearer token");
      return;
    }

    void handleMcpRequest(req, res, store);
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      console.error(`matrix-workouts-mcp listening on ${host}:${boundPort} (${MCP_PATH})`);
      resolve(httpServer);
    });
  });
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReturnType<typeof createStore>,
): Promise<void> {
  if (req.method !== "POST") {
    sendJsonRpcError(res, 405, -32000, "Method not allowed. This server only supports stateless POST requests.");
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(req);
  } catch {
    sendJsonRpcError(res, 400, -32700, "Parse error: invalid JSON body.");
    return;
  }

  const server = createServer(store);
  /*
   * Two casts, both at the SDK boundary and neither hiding anything of ours.
   * `exactOptionalPropertyTypes` is on for this repo's own code, and the SDK's types
   * are not written for it: stateless mode is expressed as `sessionIdGenerator:
   * undefined`, which that flag reads as "a function that is undefined". Turning the
   * flag off repo-wide to satisfy a dependency would trade real checking on our
   * optional fields for a cosmetic fix here.
   */
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error("Error handling MCP request:", error instanceof Error ? error.message : error);
    if (!res.headersSent) sendJsonRpcError(res, 500, -32603, "Internal server error");
  }
}

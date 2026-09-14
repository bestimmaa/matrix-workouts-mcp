/**
 * Environment in, typed configuration out.
 *
 * Every reader takes `env` as an argument so the tests can pass a literal instead of
 * mutating `process.env` and racing each other.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export type TransportMode = "stdio" | "http";

const DEFAULT_HTTP_PORT = 3000;

/**
 * Loopback by default, and that is not a default anyone should change casually: the
 * thing behind this port is one person's heart rate at ten-second resolution.
 */
const DEFAULT_HTTP_HOST = "127.0.0.1";

/** How long a cached history is served before a tool call refreshes it. */
const DEFAULT_TTL_MINUTES = 60;

export interface Credentials {
  xid: string;
  pin: string;
}

export function getTransportMode(env: NodeJS.ProcessEnv = process.env): TransportMode {
  return env.MCP_TRANSPORT === "http" ? "http" : "stdio";
}

export function getHttpPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MATRIX_HTTP_PORT ?? env.PORT;
  if (!raw) return DEFAULT_HTTP_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

export function getHttpHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.MATRIX_HTTP_HOST;
  return host && host.trim().length > 0 ? host.trim() : DEFAULT_HTTP_HOST;
}

export function getAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.MATRIX_MCP_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

/**
 * Sign-in credentials, or nothing.
 *
 * Nothing is a supported state, not an error: with a populated cache the server
 * answers every read-only tool without them, which is the mode to run in when you
 * would rather not put a passcode in an MCP client's config at all.
 */
export function getCredentials(env: NodeJS.ProcessEnv = process.env): Credentials | undefined {
  const xid = env.MATRIX_XID;
  const pin = env.MATRIX_PIN;
  if (!xid || !pin) return undefined;
  return { xid, pin };
}

export function getCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.MATRIX_CACHE_DIR;
  if (dir && dir.trim().length > 0) return dir.trim();
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "matrix-workouts-mcp");
}

export function getCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MATRIX_CACHE_TTL_MINUTES;
  if (!raw) return DEFAULT_TTL_MINUTES * 60_000;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`Invalid MATRIX_CACHE_TTL_MINUTES: ${raw}`);
  }
  return minutes * 60_000;
}

/**
 * Every variable this server reads, for the README table and the test that keeps it
 * honest. Adding one here without documenting it fails the build.
 */
export const ENV_VARS = [
  "MATRIX_XID",
  "MATRIX_PIN",
  "MATRIX_CACHE_DIR",
  "MATRIX_CACHE_TTL_MINUTES",
  "MCP_TRANSPORT",
  "MATRIX_HTTP_PORT",
  "MATRIX_HTTP_HOST",
  "MATRIX_MCP_TOKEN",
] as const;

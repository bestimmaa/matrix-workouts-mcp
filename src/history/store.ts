/**
 * One history, fetched at most once per TTL, shared by every tool.
 *
 * `fetchWorkoutHistory` returns **every ride on the account in a single response** —
 * there is no per-workout endpoint that works. So the shape of this server is fixed
 * by the API: fetch the lot, keep it, answer from memory. A tool that re-downloaded
 * an account to answer "what was my longest ride" would be absurd, and with a dozen
 * tools it would happen a dozen times a conversation.
 *
 * The cache survives restarts for a second reason: an agent can then ask about rides
 * with no credentials present at all. That is the mode to prefer — see
 * `getCredentials`.
 */
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { loginWithXid, type Workout } from "matrix-workouts-core";
import { downloadHistory, httpFetch, readRawHistoryFile } from "matrix-workouts-core/node";

import type { Credentials } from "../config.js";

/** One slot, overwritten in place: this is a cache, not an archive. */
export const CACHE_FILENAME = "raw-history.json";

export interface HistorySnapshot {
  workouts: readonly Workout[];
  /** When the underlying response was downloaded. */
  fetchedAt: Date;
  /** The API's own paging said there was more than arrived. */
  truncated: boolean;
  /** Records the parser could not read. Surfaced, never silently dropped. */
  skipped: number;
  /** Where it came from, so a tool can say so rather than implying freshness. */
  source: "network" | "cache";
}

export interface StoreOptions {
  cacheDir: string;
  ttlMs: number;
  credentials?: Credentials | undefined;
  /** Seam for tests: the real one signs in and downloads. */
  download?: (credentials: Credentials, cacheDir: string) => Promise<HistorySnapshot>;
  now?: () => Date;
}

export class HistoryUnavailableError extends Error {
  override name = "HistoryUnavailableError";
}

async function downloadReal(credentials: Credentials, cacheDir: string): Promise<HistorySnapshot> {
  const signedIn = await loginWithXid({ xid: credentials.xid, pin: credentials.pin }, httpFetch);
  const result = await downloadHistory(signedIn, {
    outDir: cacheDir,
    rawFilename: CACHE_FILENAME,
  });
  return {
    workouts: result.workouts,
    fetchedAt: new Date(),
    truncated: result.truncated,
    skipped: result.skipped,
    source: "network",
  };
}

export class HistoryStore {
  private snapshot: HistorySnapshot | undefined;
  private inFlight: Promise<HistorySnapshot> | undefined;

  constructor(private readonly options: StoreOptions) {}

  /** Where downloads and exports land by default. */
  get cacheDir(): string {
    return this.options.cacheDir;
  }

  private get cachePath(): string {
    return join(this.options.cacheDir, CACHE_FILENAME);
  }

  private get now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private readCache(): HistorySnapshot | undefined {
    try {
      const stat = statSync(this.cachePath);
      const parsed = readRawHistoryFile(this.cachePath);
      return {
        workouts: parsed.workouts,
        fetchedAt: stat.mtime,
        truncated: parsed.truncated,
        skipped: parsed.skipped,
        source: "cache",
      };
    } catch {
      return undefined;
    }
  }

  private fresh(snapshot: HistorySnapshot): boolean {
    return this.now.getTime() - snapshot.fetchedAt.getTime() < this.options.ttlMs;
  }

  /**
   * The history every tool reads.
   *
   * Order matters and is deliberate: memory, then a fresh cache, then the network,
   * then a **stale** cache. That last step is the difference between "your Wi-Fi is
   * down so you get nothing" and "your Wi-Fi is down so you get last night's data,
   * labelled as such".
   */
  async snapshotNow(): Promise<HistorySnapshot> {
    if (this.snapshot && this.fresh(this.snapshot)) return this.snapshot;

    const cached = this.snapshot ?? this.readCache();
    if (cached && this.fresh(cached)) {
      this.snapshot = cached;
      return cached;
    }

    const credentials = this.options.credentials;
    if (!credentials) {
      if (cached) {
        this.snapshot = cached;
        return cached;
      }
      throw new HistoryUnavailableError(
        "No cached history and no credentials. Set MATRIX_XID and MATRIX_PIN, or point " +
          "MATRIX_CACHE_DIR at a directory holding a history downloaded by " +
          "`npx matrix-workouts-history`.",
      );
    }

    try {
      return await this.refresh();
    } catch (error) {
      if (cached) {
        // A stale answer that says it is stale beats no answer.
        this.snapshot = cached;
        return cached;
      }
      throw error;
    }
  }

  /** Force a download, whatever the cache says. Shared when calls overlap. */
  async refresh(): Promise<HistorySnapshot> {
    const credentials = this.options.credentials;
    if (!credentials) {
      throw new HistoryUnavailableError(
        "Refreshing needs credentials: set MATRIX_XID and MATRIX_PIN. Without them this " +
          "server is read-only over whatever is already in the cache.",
      );
    }

    this.inFlight ??= (async () => {
      try {
        mkdirSync(this.options.cacheDir, { recursive: true, mode: 0o700 });
        const download = this.options.download ?? downloadReal;
        const snapshot = await download(credentials, this.options.cacheDir);
        this.snapshot = snapshot;
        return snapshot;
      } finally {
        this.inFlight = undefined;
      }
    })();

    return this.inFlight;
  }
}

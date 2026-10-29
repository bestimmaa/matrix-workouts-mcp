import { describe, expect, it } from "vitest";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CACHE_FILENAME, HistoryStore, HistoryUnavailableError, type HistorySnapshot } from "./store.js";
import { fixtureWorkouts } from "../testSupport.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "mw-store-"));

function snapshot(source: "network" | "cache" = "network"): HistorySnapshot {
  return { workouts: fixtureWorkouts(), fetchedAt: new Date(), truncated: false, skipped: 0, source };
}

describe("history store", () => {
  it("downloads once and serves the rest from memory", async () => {
    let calls = 0;
    const store = new HistoryStore({
      cacheDir: dir(),
      ttlMs: 60_000,
      credentials: { xid: "x", pin: "1" },
      download: async () => {
        calls += 1;
        return snapshot();
      },
    });

    await store.snapshotNow();
    await store.snapshotNow();
    await store.snapshotNow();
    expect(calls).toBe(1);
  });

  it("shares one download between overlapping calls", async () => {
    let calls = 0;
    const store = new HistoryStore({
      cacheDir: dir(),
      ttlMs: 60_000,
      credentials: { xid: "x", pin: "1" },
      download: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return snapshot();
      },
    });

    await Promise.all([store.snapshotNow(), store.snapshotNow(), store.snapshotNow()]);
    expect(calls).toBe(1);
  });

  it("re-downloads once the cache is older than the TTL", async () => {
    let calls = 0;
    let now = new Date("2026-09-14T08:00:00Z");
    const store = new HistoryStore({
      cacheDir: dir(),
      ttlMs: 60_000,
      credentials: { xid: "x", pin: "1" },
      now: () => now,
      download: async () => {
        calls += 1;
        return { ...snapshot(), fetchedAt: now };
      },
    });

    await store.snapshotNow();
    now = new Date("2026-09-14T09:00:00Z");
    await store.snapshotNow();
    expect(calls).toBe(2);
  });

  it("reads a history downloaded by the CLI, with no credentials at all", async () => {
    const cacheDir = dir();
    const raw = { workouts: fixtureWorkouts().map((w) => w.raw) };
    writeFileSync(join(cacheDir, CACHE_FILENAME), JSON.stringify(raw));

    const store = new HistoryStore({ cacheDir, ttlMs: 60_000 });
    const result = await store.snapshotNow();
    expect(result.workouts).toHaveLength(3);
    expect(result.source).toBe("cache");
  });

  it("falls back to a stale cache when the download fails, rather than to nothing", async () => {
    const cacheDir = dir();
    writeFileSync(
      join(cacheDir, CACHE_FILENAME),
      JSON.stringify({ workouts: fixtureWorkouts().map((w) => w.raw) }),
    );

    const store = new HistoryStore({
      cacheDir,
      ttlMs: 0, // everything is stale
      credentials: { xid: "x", pin: "1" },
      download: async () => {
        throw new Error("network down");
      },
    });

    const result = await store.snapshotNow();
    expect(result.workouts).toHaveLength(3);
    expect(result.source).toBe("cache");
  });

  /*
   * The credential-free mode is "run the CLI, point the server at its output" — and the
   * CLI is run again whenever there are new rides. A server that only ever answered
   * from the file it read first would need restarting to see them.
   */
  it("picks up a cache the CLI rewrote while the server was running", async () => {
    const cacheDir = dir();
    const path = join(cacheDir, CACHE_FILENAME);
    const write = (count: number, mtime: Date): void => {
      writeFileSync(path, JSON.stringify({ workouts: fixtureWorkouts().slice(0, count).map((w) => w.raw) }));
      utimesSync(path, mtime, mtime);
    };

    const store = new HistoryStore({ cacheDir, ttlMs: 60_000 });
    write(2, new Date("2026-09-01T08:00:00Z"));
    expect((await store.snapshotNow()).workouts).toHaveLength(2);

    write(3, new Date("2026-09-02T08:00:00Z"));
    expect((await store.snapshotNow()).workouts).toHaveLength(3);
  });

  it("does not replay one failed download on every later refresh", async () => {
    let calls = 0;
    const store = new HistoryStore({
      cacheDir: dir(),
      ttlMs: 60_000,
      credentials: { xid: "x", pin: "1" },
      // Not async: a synchronous throw is the case that used to stick.
      download: () => {
        calls += 1;
        if (calls === 1) throw new Error("network down");
        return Promise.resolve(snapshot());
      },
    });

    await expect(store.refresh()).rejects.toThrow("network down");
    await expect(store.refresh()).resolves.toMatchObject({ source: "network" });
    expect(calls).toBe(2);
  });

  it("explains what is missing when there is neither cache nor credentials", async () => {
    const store = new HistoryStore({ cacheDir: dir(), ttlMs: 60_000 });
    await expect(store.snapshotNow()).rejects.toBeInstanceOf(HistoryUnavailableError);
    await expect(store.snapshotNow()).rejects.toThrow(/matrix-workouts-history/);
  });
});

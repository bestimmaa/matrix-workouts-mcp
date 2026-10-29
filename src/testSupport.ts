/**
 * Fixtures for the tests: three real rides, no network, no credentials.
 *
 * These are captures from one account — a Sprint 8, a target-heart-rate ride with 80
 * dropouts, and the snake_case one taken from the API itself. Between them they cover
 * the two wire shapes and the two ends of heart-rate quality, which is what the tools
 * actually have to survive. The full set lives in matrix-workouts-core.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { toWorkout, type Workout } from "matrix-workouts-core";

import { HistoryStore } from "./history/store.js";

export const FIXTURE_IDS = [
  "6a998daf8d2b6d09c6e334d2",
  "6a95b033c23a154beb856bce",
  "6aa194a08d2b6d09c61e9500",
] as const;

export function fixtureWorkout(id: string): Workout {
  const path = fileURLToPath(new URL(`../fixtures/raw-${id}.json`, import.meta.url));
  return toWorkout(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
}

export function fixtureWorkouts(): Workout[] {
  return FIXTURE_IDS.map(fixtureWorkout).sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
}

/**
 * A store that never touches the network: the snapshot is handed in.
 *
 * The tools are the part of this server a model actually sees, so they are tested
 * against real records rather than a mock of the parser. What is being asserted is
 * not that the numbers are pretty but that they are *there* — the whole reason this
 * project exists is three channels the platform's own UI omits, and a tool that
 * quietly dropped one would look perfectly fine in a conversation.
 */
export function storeWith(cacheDir = mkdtempSync(join(tmpdir(), "mw-mcp-")), onRead = (): void => {}): HistoryStore {
  const store = new HistoryStore({ cacheDir, ttlMs: 60_000 });
  const snapshot = {
    workouts: fixtureWorkouts(),
    fetchedAt: new Date("2026-09-14T08:00:00Z"),
    truncated: false,
    skipped: 0,
    source: "cache" as const,
  };
  Object.defineProperty(store, "snapshotNow", {
    value: async () => {
      onRead();
      return snapshot;
    },
  });
  return store;
}

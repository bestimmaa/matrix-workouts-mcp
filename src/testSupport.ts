/**
 * Fixtures for the tests: three real rides, no network, no credentials.
 *
 * These are captures from one account — a Sprint 8, a target-heart-rate ride with 80
 * dropouts, and the snake_case one taken from the API itself. Between them they cover
 * the two wire shapes and the two ends of heart-rate quality, which is what the tools
 * actually have to survive. The full set lives in matrix-workouts-core.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toWorkout, type Workout } from "matrix-workouts-core";

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

/**
 * Cross-ride aggregation: volume per bucket, and how the numbers move.
 *
 * Buckets are computed in UTC. A ride at 22:30 local on the last day of a month is
 * not worth a timezone database; what matters is that the same ride always lands in
 * the same bucket, which `toISOString` guarantees and a local rendering does not.
 */
import type { Workout } from "matrix-workouts-core";

import { mean, rideSummary, type RideSummary } from "./summary.js";

export type Bucket = "week" | "month";

export interface BucketTotals {
  /** ISO date of the bucket's first day. */
  bucket: string;
  rides: number;
  durationSeconds: number;
  distanceMeters: number;
  workKilojoules: number;
  /** Ride-weighted, not sample-weighted: the mean of each ride's average. */
  averagePowerWatts: number | null;
  averageHeartRateBpm: number | null;
}

function bucketKey(date: Date, bucket: Bucket): string {
  if (bucket === "month") return `${date.toISOString().slice(0, 7)}-01`;
  // ISO weeks start on Monday; getUTCDay() is 0 for Sunday.
  const monday = new Date(date);
  const offset = (date.getUTCDay() + 6) % 7;
  monday.setUTCDate(date.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}

export function bucketHistory(workouts: readonly Workout[], bucket: Bucket): BucketTotals[] {
  const buckets = new Map<string, RideSummary[]>();
  for (const workout of workouts) {
    const key = bucketKey(workout.startedAt, bucket);
    const rides = buckets.get(key) ?? [];
    rides.push(rideSummary(workout));
    buckets.set(key, rides);
  }

  const total = (rides: readonly RideSummary[], pick: (s: RideSummary) => number | null): number =>
    rides.reduce((sum, s) => sum + (pick(s) ?? 0), 0);
  const present = (rides: readonly RideSummary[], pick: (s: RideSummary) => number | null): number[] =>
    rides.map(pick).filter((value): value is number => value !== null);

  return [...buckets]
    .map(([key, rides]) => ({
      bucket: key,
      rides: rides.length,
      durationSeconds: total(rides, (s) => s.durationSeconds),
      distanceMeters: total(rides, (s) => s.distanceMeters),
      workKilojoules: total(rides, (s) => s.workKilojoules),
      averagePowerWatts: mean(present(rides, (s) => s.averagePowerWatts)),
      // The reported figure, because it is the one that survives a bad strap.
      averageHeartRateBpm: mean(present(rides, (s) => s.reportedHeartRateBpm)),
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export interface HistoryFilter {
  /** Inclusive ISO date, e.g. "2026-08-01". */
  from?: string | undefined;
  /** Inclusive ISO date. */
  to?: string | undefined;
  machineType?: string | undefined;
  mode?: string | undefined;
}

/**
 * Filtering is deliberately dumb — dates compared as ISO prefixes, everything else an
 * exact match. A query language here would be a second thing to document and a second
 * thing to get wrong; an agent that wants something cleverer can ask for the rides and
 * think for itself.
 */
export function filterWorkouts(workouts: readonly Workout[], filter: HistoryFilter): Workout[] {
  return workouts.filter((workout) => {
    const day = workout.startedAt.toISOString().slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (filter.machineType && workout.machineType !== filter.machineType) return false;
    if (filter.mode && workout.mode !== filter.mode) return false;
    return true;
  });
}

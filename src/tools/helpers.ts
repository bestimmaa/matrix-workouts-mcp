/**
 * The parts of the tool handlers that are worth testing on their own.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  exportFilename,
  findWorkout,
  flagHeartRateDropouts,
  workoutExport,
  type ControlSignature,
  type Sample,
  type Workout,
} from "matrix-workouts-core";

import { num } from "../format.js";

export class ToolError extends Error {
  override name = "ToolError";
}

/** Program modes that name the controlled channel outright. */
const CONTROL_TARGET: Record<string, string> = {
  target_heart_rate: "heart rate",
  target_watts: "watts",
};

/**
 * The control row: the answer first, then the evidence behind it.
 *
 * `controlSignature` classifies from telemetry alone and says so — closed-loop
 * heart-rate stepping is not separable from a rider working the resistance dial, so
 * it returns "unclassified" and exposes its metrics instead. Rendering only the
 * verdict turned that invitation into a dead end: 22 target-heart-rate rides all read
 * `unclassified`, on the one mode whose *name* answers the question. Two things fix
 * it, both here rather than in the classifier, whose telemetry-only contract is
 * deliberate: `mode` comes off the record and names the target when it can, and the
 * numbers go out alongside the verdict so a model can weigh single-step nudging
 * (mean step ~1) against real blocks itself.
 */
export function describeControl(mode: string, control: ControlSignature): string {
  const evidence =
    `${control.levels} levels ${control.minLevel}-${control.maxLevel}, ` +
    `mean step ${num(control.meanStep)}, ${num(control.changeRate, 0)} changes/100 samples`;
  const target = CONTROL_TARGET[mode];
  const prefix = target ? `${target} (program target); series ` : "";
  return `${prefix}${control.mode} — ${evidence}`;
}

/**
 * `findWorkout` accepts either id form, which matters more than it looks: every ride
 * recorded before 13 Aug 2026 has a record id that differs from the id its own URL
 * carries, and a lookup that knows about only one of them fails on half the history.
 */
export function findOrThrow(workouts: readonly Workout[], id: string): Workout {
  const workout = findWorkout(workouts, id);
  if (!workout) {
    throw new ToolError(`No ride with id ${id}. Call list_workouts to see what is available.`);
  }
  return workout;
}

const FIELDS = {
  power: (s: Sample) => s.powerWatts,
  cadence: (s: Sample) => s.cadenceRpm,
  resistance: (s: Sample) => s.resistanceLevel,
  heartRate: (s: Sample) => s.heartRateBpm,
  speed: (s: Sample) => s.speedKmh,
  distance: (s: Sample) => s.cumulativeDistanceMeters,
} as const;

export type FieldName = keyof typeof FIELDS;

const DEFAULT_FIELDS: FieldName[] = ["power", "cadence", "resistance", "heartRate"];

export interface SampleQuery {
  fields?: unknown;
  fromSeconds?: unknown;
  toSeconds?: unknown;
  everyNth?: unknown;
  maxRows?: unknown;
}

/**
 * Rows for `get_samples`.
 *
 * A dropout is emitted as an empty cell rather than the console's `0`, because a zero
 * in a heart-rate column is a number a model will happily average. The filtering is
 * the core package's, so this agrees with what the extension draws.
 */
export function sampleRows(
  workout: Workout,
  query: SampleQuery,
): { headers: string[]; rows: (string | number)[][]; truncated: boolean; total: number } {
  const fields = (Array.isArray(query.fields) && query.fields.length > 0
    ? (query.fields as FieldName[])
    : DEFAULT_FIELDS
  ).filter((field): field is FieldName => field in FIELDS);

  const from = typeof query.fromSeconds === "number" ? query.fromSeconds : 0;
  const to = typeof query.toSeconds === "number" ? query.toSeconds : Number.POSITIVE_INFINITY;
  const stride = typeof query.everyNth === "number" ? Math.max(1, Math.trunc(query.everyNth)) : 1;
  const maxRows = typeof query.maxRows === "number" ? Math.max(1, Math.trunc(query.maxRows)) : 200;

  /*
   * The mask is *validity*, not dropouts — true means the reading is real. Reading it
   * the other way round blanks every good sample and keeps every bad one, which looks
   * plausible right up until someone averages the column.
   */
  const valid = fields.includes("heartRate") ? flagHeartRateDropouts(workout.samples) : [];

  const windowed = workout.samples
    .map((sample, index) => ({ sample, index }))
    .filter(({ sample }) => sample.elapsedSeconds >= from && sample.elapsedSeconds <= to)
    .filter((_, i) => i % stride === 0);

  const rows = windowed.slice(0, maxRows).map(({ sample, index }) =>
    [
      sample.elapsedSeconds,
      ...fields.map((field) => {
        if (field === "heartRate" && valid[index] === false) return "";
        const value = FIELDS[field](sample);
        return Number.isFinite(value) ? Math.round(value * 10) / 10 : "";
      }),
    ],
  );

  return {
    headers: ["seconds", ...fields],
    rows,
    truncated: windowed.length > rows.length,
    total: windowed.length,
  };
}

/**
 * Write the export document somewhere the user can find it.
 *
 * The default is the cache directory rather than the working directory, because an
 * MCP server's working directory is wherever the client happened to launch it — which
 * is not a place anybody would go looking for their heart rate.
 */
export function exportWorkoutTo(workout: Workout, path: string | undefined, defaultDir: string): string {
  const target = path ?? defaultDir;

  let file: string;
  try {
    file = statSync(target).isDirectory() ? join(target, exportFilename(workout)) : target;
  } catch {
    // A path that does not exist yet is treated as a file unless it looks like a dir.
    file = target.endsWith("/") ? join(target, exportFilename(workout)) : target;
  }

  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(workoutExport(workout), null, 2)}\n`, { mode: 0o600 });
  return file;
}

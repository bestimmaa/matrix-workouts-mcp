/**
 * The parts of the tool handlers that are worth testing on their own.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  exportFilename,
  findWorkout,
  flagHeartRateDropouts,
  workoutExport,
  type ControlSignature,
  type Sample,
  type Workout,
} from "matrix-workouts-core";

import { SAMPLE_SECONDS } from "../analysis/powerCurve.js";
import type { Declined } from "../analysis/summary.js";
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
 * Each field of the control signature, rendered by `describeControl` or declined.
 * See the completeness guards in `analysis/summary.ts`.
 */
const CONTROL_SIGNATURE = {
  mode: "rendered",
  levels: "rendered",
  minLevel: "rendered",
  maxLevel: "rendered",
  changes: "declined: changeRate is the same count per 100 samples, comparable across ride lengths",
  changeRate: "rendered",
  meanStep: "rendered",
} satisfies Record<keyof ControlSignature, "rendered" | Declined>;

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

/** The columns `get_samples` offers, in the order its schema lists them. */
export const FIELD_NAMES = ["power", "cadence", "resistance", "heartRate", "speed", "distance"] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

const FIELDS: Record<FieldName, (s: Sample) => number> = {
  power: (s) => s.powerWatts,
  cadence: (s) => s.cadenceRpm,
  resistance: (s) => s.resistanceLevel,
  heartRate: (s) => s.heartRateBpm,
  speed: (s) => s.speedKmh,
  distance: (s) => s.cumulativeDistanceMeters,
};

const DEFAULT_FIELDS: readonly FieldName[] = ["power", "cadence", "resistance", "heartRate"];

export interface SampleQuery {
  fields?: readonly FieldName[] | undefined;
  fromSeconds?: number | undefined;
  toSeconds?: number | undefined;
  everyNth?: number | undefined;
  /** The same stride in the unit a caller thinks in: 60 is one row per minute. */
  resolutionSeconds?: number | undefined;
  maxRows?: number | undefined;
}

export interface SampleTable {
  headers: string[];
  rows: (string | number)[][];
  /** Samples inside the window, before any stride. */
  total: number;
  /** The stride the rows were taken at. */
  stride: number;
  /** The stride asked for, when it had to be raised to fit `maxRows`. */
  requestedStride: number | null;
}

/**
 * Rows for `get_samples`.
 *
 * A dropout is emitted as an empty cell rather than the console's `0`, because a zero
 * in a heart-rate column is a number a model will happily average. The filtering is
 * the core package's, so this agrees with what the extension draws.
 *
 * A window too long for `maxRows` at the requested stride is downsampled, never cut
 * short: the stride rises to the smallest that fits. Taking the first `maxRows` rows
 * returned the first two thirds of a ride as a well-formed CSV indistinguishable from
 * the whole of it, and a model averaging that column had no way to know. A caller who
 * wants part of a ride has `fromSeconds` and `toSeconds` for that.
 */
export function sampleRows(workout: Workout, query: SampleQuery): SampleTable {
  if (query.everyNth !== undefined && query.resolutionSeconds !== undefined) {
    throw new ToolError("Pass everyNth or resolutionSeconds, not both: they are the same stride.");
  }
  const fields = query.fields?.length ? query.fields : DEFAULT_FIELDS;
  const from = query.fromSeconds ?? 0;
  const to = query.toSeconds ?? Number.POSITIVE_INFINITY;
  const requested = Math.max(
    1,
    query.resolutionSeconds !== undefined
      ? Math.round(query.resolutionSeconds / SAMPLE_SECONDS)
      : Math.trunc(query.everyNth ?? 1),
  );
  const maxRows = Math.max(1, Math.trunc(query.maxRows ?? 200));

  /*
   * The mask is *validity*, not dropouts — true means the reading is real. Reading it
   * the other way round blanks every good sample and keeps every bad one, which looks
   * plausible right up until someone averages the column.
   */
  const valid = fields.includes("heartRate") ? flagHeartRateDropouts(workout.samples) : [];

  const inWindow = workout.samples
    .map((sample, index) => ({ sample, index }))
    .filter(({ sample }) => sample.elapsedSeconds >= from && sample.elapsedSeconds <= to);
  const stride = Math.max(requested, Math.ceil(inWindow.length / maxRows));

  const rows = inWindow
    .filter((_, i) => i % stride === 0)
    .map(({ sample, index }) => [
      sample.elapsedSeconds,
      ...fields.map((field) => {
        if (field === "heartRate" && valid[index] === false) return "";
        const value = FIELDS[field](sample);
        return Number.isFinite(value) ? Math.round(value * 10) / 10 : "";
      }),
    ]);

  return {
    headers: ["seconds", ...fields],
    rows,
    total: inWindow.length,
    stride,
    requestedStride: stride > requested ? requested : null,
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

  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(workoutExport(workout), null, 2)}\n`, { mode: 0o600 });
  return file;
}

/**
 * The tool surface, in one list.
 *
 * Each entry is a name, a description the model reads when deciding what to call, a
 * zod shape, and a handler that returns text. `server.ts` registers whatever is here
 * and `docs.test.ts` asserts the README's table matches — so adding a tool is one
 * edit here and one row there, and forgetting the row fails the build.
 */
import { SAMPLE_INTERVAL_SECONDS } from "matrix-workouts-core";
import { z } from "zod";

import { type HistoryFilter, bucketHistory, filterWorkouts } from "../analysis/history.js";
import { DEFAULT_WINDOWS_SECONDS, powerCurve } from "../analysis/powerCurve.js";
import { type Declined, type RideSummary, rideSummary } from "../analysis/summary.js";
import { csv, day, hms, km, num, table, timestamp } from "../format.js";
import type { HistorySnapshot, HistoryStore } from "../history/store.js";
import { FIELD_NAMES, describeControl, exportWorkoutTo, findOrThrow, sampleRows } from "./helpers.js";

const dateFilter = {
  from: z.string().optional().describe("Inclusive start date, YYYY-MM-DD."),
  to: z.string().optional().describe("Inclusive end date, YYYY-MM-DD."),
};

/**
 * Every key `filterWorkouts` understands, in one shape both filtering tools spread.
 *
 * `summarize_history` used to declare only the dates while handing its whole argument
 * object to the filter, so a `mode` a caller asked for was stripped by the schema
 * before the handler ran and whole-history totals came back formatted exactly like
 * filtered ones. The `satisfies` is what stops that recurring: a key in `HistoryFilter`
 * and not here, or here and not there, is now a compile error rather than a wrong
 * answer nobody can see.
 */
const rideFilter = {
  ...dateFilter,
  machineType: z.string().optional().describe("e.g. upright_bike, recumbent_bike."),
  mode: z.string().optional().describe("Program mode, e.g. sprint_8, target_heart_rate."),
} satisfies { [K in keyof Required<HistoryFilter>]: z.ZodType<HistoryFilter[K]> };

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (store: HistoryStore, args: Record<string, unknown>) => Promise<string>;
}

/**
 * A tool whose handler sees its arguments typed by its own schema.
 *
 * Parse, never cast: the `args as never` this replaced is what hid the
 * `summarize_history` mismatch, and the per-field casts that survived it could hide
 * the next one. The SDK has already parsed against the same shape, so this costs a
 * second pass over a handful of fields and buys a handler with no casts in it.
 */
function defineTool<Shape extends z.ZodRawShape>(tool: {
  name: string;
  description: string;
  schema: Shape;
  handler: (store: HistoryStore, args: z.infer<z.ZodObject<Shape>>) => Promise<string>;
}): ToolDefinition {
  const parser = z.object(tool.schema);
  return { ...tool, handler: (store, args) => tool.handler(store, parser.parse(args)) };
}

/**
 * A line every tool appends, so no answer silently implies it is current.
 *
 * Takes the snapshot the handler answered from rather than asking the store again: a
 * second call could retry a failing network on a stale fallback, and describe a
 * different history from the one the rows above it came from.
 */
function provenance(snapshot: HistorySnapshot): string {
  const parts = [
    `${snapshot.workouts.length} rides, ${snapshot.source} of ${timestamp(snapshot.fetchedAt)}Z`,
  ];
  if (snapshot.skipped > 0) parts.push(`${snapshot.skipped} unreadable record(s)`);
  if (snapshot.truncated) parts.push("WARNING: the API's paging says there is more history than arrived");
  return `\n\n(${parts.join("; ")})`;
}

/**
 * Each field of a ride summary, rendered by `get_workout` or declined — the view that
 * claims to be "everything derived about one ride". See the completeness guards in
 * `analysis/summary.ts`.
 */
const GET_WORKOUT_ROWS = {
  id: "declined: the caller passed it in",
  startedAt: "rendered",
  mode: "rendered",
  machineType: "rendered",
  durationSeconds: "rendered",
  distanceMeters: "rendered",
  calories: "rendered",
  averagePowerWatts: "rendered",
  maxPowerWatts: "rendered",
  workKilojoules: "rendered",
  averageCadenceRpm: "rendered",
  maxCadenceRpm: "rendered",
  averageResistance: "rendered",
  maxResistance: "rendered",
  filteredHeartRateBpm: "rendered",
  reportedHeartRateBpm: "rendered",
  filteredMinHeartRateBpm: "rendered",
  filteredMaxHeartRateBpm: "rendered",
  reportedMinHeartRateBpm: "rendered",
  reportedMaxHeartRateBpm: "rendered",
  heartRateValidSamples: "rendered",
  heartRateDropouts: "rendered",
  control: "rendered",
  sampleCount: "rendered",
} satisfies Record<keyof RideSummary, "rendered" | Declined>;

export const TOOLS: ToolDefinition[] = [
  defineTool({
    name: "list_workouts",
    description:
      "List recorded rides, newest first, one compact row each: date, program mode, duration, distance, average power and heart rate. Use this first to find the id of a ride before asking for its detail. Optional filters: `from` and `to` (dates), `machineType`, `mode`; `limit` caps the rows. Returns no sample series.",
    schema: {
      ...rideFilter,
      limit: z.number().int().positive().max(500).optional().describe("Default 20."),
    },
    handler: async (store, args) => {
      const snapshot = await store.snapshotNow();
      const matched = filterWorkouts(snapshot.workouts, args);
      const limit = args.limit ?? 20;
      const rows = matched.slice(0, limit).map((workout) => {
        const s = rideSummary(workout);
        return [
          s.id,
          day(s.startedAt),
          s.mode,
          hms(s.durationSeconds),
          km(s.distanceMeters),
          num(s.averagePowerWatts, 0),
          num(s.reportedHeartRateBpm, 0),
          String(s.sampleCount),
        ];
      });
      const header = `${matched.length} ride(s) matched; showing ${rows.length}.`;
      return (
        `${header}\n\n` +
        table(["id", "date", "mode", "dur", "km", "W", "bpm", "samples"], rows) +
        provenance(snapshot)
      );
    },
  }),
  defineTool({
    name: "get_workout",
    description:
      "Everything derived about one ride, by `id` (from list_workouts; either id form works): duration, distance, work done, average and peak power, cadence and resistance, heart rate's average, minimum and maximum both as the console reported them and as the filtered series gives them, and what the console was actually holding constant — with the resistance metrics behind that call, because the series alone does not always settle it. Does not return the sample series — use get_samples for that.",
    schema: { id: z.string().describe("Workout id, from list_workouts. Either id form works.") },
    handler: async (store, args) => {
      const snapshot = await store.snapshotNow();
      const s = rideSummary(findOrThrow(snapshot.workouts, args.id));
      const rows: [string, string][] = [
        ["date", `${timestamp(s.startedAt)}Z`],
        ["mode", `${s.mode} (${s.machineType})`],
        ["control", describeControl(s.mode, s.control)],
        ["duration", hms(s.durationSeconds)],
        ["distance", `${km(s.distanceMeters)} km`],
        ["work", `${num(s.workKilojoules, 0)} kJ`],
        ["calories", num(s.calories, 0)],
        ["power avg / max", `${num(s.averagePowerWatts, 0)} / ${num(s.maxPowerWatts, 0)} W`],
        ["cadence avg / max", `${num(s.averageCadenceRpm, 0)} / ${num(s.maxCadenceRpm, 0)} rpm`],
        ["resistance avg / max", `${num(s.averageResistance)} / ${num(s.maxResistance, 0)}`],
        [
          "heart rate avg (reported / filtered)",
          `${num(s.reportedHeartRateBpm, 0)} / ${num(s.filteredHeartRateBpm)} bpm`,
        ],
        [
          "heart rate min (reported / filtered)",
          `${num(s.reportedMinHeartRateBpm, 0)} / ${num(s.filteredMinHeartRateBpm, 0)} bpm`,
        ],
        [
          "heart rate max (reported / filtered)",
          `${num(s.reportedMaxHeartRateBpm, 0)} / ${num(s.filteredMaxHeartRateBpm, 0)} bpm`,
        ],
        ["hr samples valid / dropouts", `${s.heartRateValidSamples} / ${s.heartRateDropouts}`],
        ["samples", String(s.sampleCount)],
      ];
      const note =
        s.heartRateDropouts > 0
          ? "\n\nThe reported and filtered heart-rate figures differ because the console read the " +
            "strap in real time, ahead of the dropouts the interval series preserves. On a " +
            "glitching strap the reported figure is usually the better one."
          : "";
      return table(["field", "value"], rows) + note + provenance(snapshot);
    },
  }),
  defineTool({
    name: "get_samples",
    description:
      "The raw interval series for one ride as CSV — power, cadence, resistance, heart rate, speed, one row per 10 seconds. A full ride is several hundred rows, so a window or stride that would exceed the row limit is downsampled to fit, never cut short; the note under the CSV says when that happened. Takes the ride's `id`; optionally `fields`, a window (`fromSeconds`, `toSeconds`), a stride as `everyNth` or `resolutionSeconds`, and `maxRows`.",
    schema: {
      id: z.string().describe("Workout id, from list_workouts. Either id form works."),
      fields: z
        .array(z.enum(FIELD_NAMES))
        .optional()
        .describe("Default: power, cadence, resistance, heartRate."),
      fromSeconds: z.number().int().min(0).optional(),
      toSeconds: z.number().int().min(0).optional(),
      everyNth: z.number().int().positive().max(60).optional().describe("Stride; 6 gives one row per minute."),
      resolutionSeconds: z
        .number()
        .int()
        .positive()
        .multipleOf(SAMPLE_INTERVAL_SECONDS)
        .max(600)
        .optional()
        .describe("The stride in seconds instead, a multiple of 10; 60 gives one row per minute."),
      maxRows: z.number().int().positive().max(1000).optional().describe("Default 200."),
    },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const { headers, rows, total, stride, requestedStride } = sampleRows(findOrThrow(workouts, args.id), args);
      const note =
        requestedStride === null
          ? ""
          : `\n\n(Downsampled to fit maxRows: one row per ${stride * SAMPLE_INTERVAL_SECONDS} s instead of ` +
            `${requestedStride * SAMPLE_INTERVAL_SECONDS} s, ${rows.length} rows across the ${total} samples in the ` +
            "window. Rows are every sample at that stride, not averages over it, so a peak between rows is " +
            "not shown; get_workout has the true maxima. Raise maxRows or narrow the window for finer resolution.)";
      return csv(headers, rows) + note;
    },
  }),
  defineTool({
    name: "summarize_history",
    description:
      "Training volume per week or month — rides, time, distance, work, average power and heart rate — plus the all-time power curve over the matched rides. Takes the same date, machine and mode filters as list_workouts, and both the totals and the curve are computed over what matched, so filter by mode to keep a Sprint 8's spikes out of a steady-state summary. Arguments: `from`, `to`, `machineType`, `mode`, `bucket` (week or month) and `windowsSeconds` for the power curve, all optional. This is the tool for questions about trends, totals and bests.",
    schema: {
      ...rideFilter,
      bucket: z.enum(["week", "month"]).optional().describe("Default month."),
      windowsSeconds: z
        .array(z.number().int().positive())
        .optional()
        .describe(`Power-curve durations. Default ${DEFAULT_WINDOWS_SECONDS.join(", ")}.`),
    },
    handler: async (store, args) => {
      const snapshot = await store.snapshotNow();
      const matched = filterWorkouts(snapshot.workouts, args);
      const bucket = args.bucket ?? "month";

      const totals = bucketHistory(matched, bucket).map((b) => [
        b.bucket,
        String(b.rides),
        hms(b.durationSeconds),
        km(b.distanceMeters),
        num(b.workKilojoules, 0),
        num(b.averagePowerWatts, 0),
        num(b.averageHeartRateBpm, 0),
      ]);

      const curve = powerCurve(matched, args.windowsSeconds).map((point) => [
        hms(point.windowSeconds),
        num(point.watts, 0),
        day(point.startedAt),
        point.workoutId,
      ]);

      return (
        `${matched.length} ride(s) matched.\n\n` +
        `Volume by ${bucket}\n` +
        table([bucket, "rides", "time", "km", "kJ", "W", "bpm"], totals) +
        "\n\nPower curve — best sustained average\n" +
        table(["window", "W", "date", "ride"], curve) +
        provenance(snapshot)
      );
    },
  }),
  defineTool({
    name: "compare_workouts",
    description:
      "Two or more rides side by side on every derived number, given as `ids` (two to eight, from list_workouts). Use it for 'how did today compare to last Tuesday' rather than calling get_workout repeatedly.",
    schema: { ids: z.array(z.string()).min(2).max(8).describe("Two to eight workout ids, from list_workouts.") },
    handler: async (store, args) => {
      const snapshot = await store.snapshotNow();
      const chosen = args.ids.map((id) => rideSummary(findOrThrow(snapshot.workouts, id)));
      const rows: string[][] = [
        ["date", ...chosen.map((s) => day(s.startedAt))],
        ["mode", ...chosen.map((s) => s.mode)],
        // The verdict only: eight columns of metrics would push every other row off the
        // right of the table, and the row above already names each ride's program mode.
        ["control", ...chosen.map((s) => s.control.mode)],
        ["duration", ...chosen.map((s) => hms(s.durationSeconds))],
        ["km", ...chosen.map((s) => km(s.distanceMeters))],
        ["kJ", ...chosen.map((s) => num(s.workKilojoules, 0))],
        ["avg W", ...chosen.map((s) => num(s.averagePowerWatts, 0))],
        ["max W", ...chosen.map((s) => num(s.maxPowerWatts, 0))],
        ["avg rpm", ...chosen.map((s) => num(s.averageCadenceRpm, 0))],
        ["max rpm", ...chosen.map((s) => num(s.maxCadenceRpm, 0))],
        ["avg resistance", ...chosen.map((s) => num(s.averageResistance))],
        ["max resistance", ...chosen.map((s) => num(s.maxResistance, 0))],
        ["bpm (reported)", ...chosen.map((s) => num(s.reportedHeartRateBpm, 0))],
        ["bpm (filtered)", ...chosen.map((s) => num(s.filteredHeartRateBpm, 0))],
        ["min bpm (reported)", ...chosen.map((s) => num(s.reportedMinHeartRateBpm, 0))],
        ["min bpm (filtered)", ...chosen.map((s) => num(s.filteredMinHeartRateBpm, 0))],
        ["max bpm (reported)", ...chosen.map((s) => num(s.reportedMaxHeartRateBpm, 0))],
        ["max bpm (filtered)", ...chosen.map((s) => num(s.filteredMaxHeartRateBpm, 0))],
      ];
      return (
        table(["", ...chosen.map((s) => s.id.slice(-6))], rows) +
        "\n\nColumns are the last six characters of each ride id, in the order given." +
        provenance(snapshot)
      );
    },
  }),
  defineTool({
    name: "export_workout",
    description:
      "Write one ride to disk as a lossless JSON export document — normalized telemetry plus the upstream record verbatim. Takes the ride's `id` and an optional `path`. Returns the path written, not the contents, because the document is far too large to read into a conversation.",
    schema: {
      id: z.string().describe("Workout id, from list_workouts. Either id form works."),
      path: z.string().optional().describe("Directory or file path. Defaults to the cache directory."),
    },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const workout = findOrThrow(workouts, args.id);
      const written = exportWorkoutTo(workout, args.path, store.cacheDir);
      return `Wrote ${workout.samples.length} samples to ${written}`;
    },
  }),
  defineTool({
    name: "refresh_history",
    description:
      "Re-download the whole history from the API, replacing the cache. Takes no arguments. Needs credentials. Everything else answers from the cache, so call this only when a ride is missing because it happened since the last fetch.",
    schema: {},
    handler: async (store) => {
      const snapshot = await store.refresh();
      const lines = [
        `Downloaded ${snapshot.workouts.length} ride(s) at ${timestamp(snapshot.fetchedAt)}Z.`,
      ];
      if (snapshot.skipped > 0) {
        lines.push(`${snapshot.skipped} record(s) could not be parsed and are not included.`);
      }
      if (snapshot.truncated) {
        lines.push("WARNING: the API's paging reports more history than this response carried.");
      }
      return lines.join("\n");
    },
  }),
];

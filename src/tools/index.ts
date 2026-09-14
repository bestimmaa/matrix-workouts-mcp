/**
 * The tool surface, in one list.
 *
 * Each entry is a name, a description the model reads when deciding what to call, a
 * zod shape, and a handler that returns text. `server.ts` registers whatever is here
 * and `docs.test.ts` asserts the README's table matches — so adding a tool is one
 * edit here and one row there, and forgetting the row fails the build.
 */
import { z } from "zod";

import { type HistoryFilter, bucketHistory, filterWorkouts } from "../analysis/history.js";
import { DEFAULT_WINDOWS_SECONDS, powerCurve } from "../analysis/powerCurve.js";
import { rideSummary } from "../analysis/summary.js";
import { csv, day, hms, km, num, table, timestamp } from "../format.js";
import type { HistoryStore } from "../history/store.js";
import { describeControl, exportWorkoutTo, findOrThrow, sampleRows } from "./helpers.js";

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

const rideFilterSchema = z.object(rideFilter);

/** Parse, never cast: the `args as never` this replaces is what hid the mismatch. */
function rideFilterOf(args: Record<string, unknown>): HistoryFilter {
  return rideFilterSchema.parse(args);
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (store: HistoryStore, args: Record<string, unknown>) => Promise<string>;
}

/** A line every tool appends, so no answer silently implies it is current. */
async function provenance(store: HistoryStore): Promise<string> {
  const snapshot = await store.snapshotNow();
  const parts = [
    `${snapshot.workouts.length} rides, ${snapshot.source} of ${timestamp(snapshot.fetchedAt)}Z`,
  ];
  if (snapshot.skipped > 0) parts.push(`${snapshot.skipped} unreadable record(s)`);
  if (snapshot.truncated) parts.push("WARNING: the API's paging says there is more history than arrived");
  return `\n\n(${parts.join("; ")})`;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_workouts",
    description:
      "List recorded rides, newest first, one compact row each: date, program mode, duration, distance, average power and heart rate. Use this first to find the id of a ride before asking for its detail. Returns no sample series.",
    schema: {
      ...rideFilter,
      limit: z.number().int().positive().max(500).optional().describe("Default 20."),
    },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const matched = filterWorkouts(workouts, rideFilterOf(args));
      const limit = (args.limit as number | undefined) ?? 20;
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
        (await provenance(store))
      );
    },
  },
  {
    name: "get_workout",
    description:
      "Everything derived about one ride: duration, distance, work done, average and peak power, cadence, resistance, both heart-rate averages, and what the console was actually holding constant — with the resistance metrics behind that call, because the series alone does not always settle it. Does not return the sample series — use get_samples for that.",
    schema: { id: z.string().describe("Workout id, from list_workouts. Either id form works.") },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const workout = findOrThrow(workouts, String(args.id));
      const s = rideSummary(workout);
      const rows: [string, string][] = [
        ["date", `${timestamp(s.startedAt)}Z`],
        ["mode", `${s.mode} (${s.machineType})`],
        ["control", describeControl(s.mode, s.control)],
        ["duration", hms(s.durationSeconds)],
        ["distance", `${km(s.distanceMeters)} km`],
        ["work", `${num(s.workKilojoules, 0)} kJ`],
        ["calories", num(s.calories, 0)],
        ["power avg / max", `${num(s.averagePowerWatts, 0)} W / ${num(s.maxPowerWatts, 0)} W`],
        ["cadence avg", `${num(s.averageCadenceRpm, 0)} rpm`],
        ["resistance avg", num(s.averageResistance)],
        ["heart rate (reported)", `${num(s.reportedHeartRateBpm, 0)} bpm`],
        ["heart rate (filtered)", `${num(s.filteredHeartRateBpm, 0)} bpm`],
        ["hr dropouts", String(s.heartRateDropouts)],
        ["samples", String(s.sampleCount)],
      ];
      const note =
        s.heartRateDropouts > 0
          ? "\n\nThe two heart-rate averages differ because the console averaged in real time, " +
            "ahead of the dropouts the interval series preserves. On a glitching strap the " +
            "reported figure is usually the better one."
          : "";
      return table(["field", "value"], rows) + note + (await provenance(store));
    },
  },
  {
    name: "get_samples",
    description:
      "The raw interval series for one ride as CSV — power, cadence, resistance, heart rate, speed, one row per 10 seconds. Ask for a window and a stride rather than a whole ride: a full ride is several hundred rows.",
    schema: {
      id: z.string(),
      fields: z
        .array(z.enum(["power", "cadence", "resistance", "heartRate", "speed", "distance"]))
        .optional()
        .describe("Default: power, cadence, resistance, heartRate."),
      fromSeconds: z.number().int().min(0).optional(),
      toSeconds: z.number().int().min(0).optional(),
      everyNth: z.number().int().positive().max(60).optional().describe("Stride; 6 gives one row per minute."),
      maxRows: z.number().int().positive().max(1000).optional().describe("Default 200."),
    },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const workout = findOrThrow(workouts, String(args.id));
      const { headers, rows, truncated, total } = sampleRows(workout, args);
      const note = truncated
        ? `\n\n(${rows.length} of ${total} rows; raise maxRows, widen everyNth, or narrow the window.)`
        : "";
      return csv(headers, rows) + note;
    },
  },
  {
    name: "summarize_history",
    description:
      "Training volume per week or month — rides, time, distance, work, average power and heart rate — plus the all-time power curve over the matched rides. Takes the same date, machine and mode filters as list_workouts, and both the totals and the curve are computed over what matched, so filter by mode to keep a Sprint 8's spikes out of a steady-state summary. This is the tool for questions about trends, totals and bests.",
    schema: {
      ...rideFilter,
      bucket: z.enum(["week", "month"]).optional().describe("Default month."),
      windowsSeconds: z
        .array(z.number().int().positive())
        .optional()
        .describe(`Power-curve durations. Default ${DEFAULT_WINDOWS_SECONDS.join(", ")}.`),
    },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const matched = filterWorkouts(workouts, rideFilterOf(args));
      const bucket = (args.bucket as "week" | "month" | undefined) ?? "month";

      const totals = bucketHistory(matched, bucket).map((b) => [
        b.bucket,
        String(b.rides),
        hms(b.durationSeconds),
        km(b.distanceMeters),
        num(b.workKilojoules, 0),
        num(b.averagePowerWatts, 0),
        num(b.averageHeartRateBpm, 0),
      ]);

      const curve = powerCurve(
        matched,
        (args.windowsSeconds as number[] | undefined) ?? [...DEFAULT_WINDOWS_SECONDS],
      ).map((point) => [
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
        (await provenance(store))
      );
    },
  },
  {
    name: "compare_workouts",
    description:
      "Two or more rides side by side on every derived number. Use it for 'how did today compare to last Tuesday' rather than calling get_workout repeatedly.",
    schema: { ids: z.array(z.string()).min(2).max(8) },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const chosen = (args.ids as string[]).map((id) => rideSummary(findOrThrow(workouts, id)));
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
        ["avg resistance", ...chosen.map((s) => num(s.averageResistance))],
        ["bpm (reported)", ...chosen.map((s) => num(s.reportedHeartRateBpm, 0))],
        ["bpm (filtered)", ...chosen.map((s) => num(s.filteredHeartRateBpm, 0))],
      ];
      return (
        table(["", ...chosen.map((s) => s.id.slice(-6))], rows) +
        "\n\nColumns are the last six characters of each ride id, in the order given." +
        (await provenance(store))
      );
    },
  },
  {
    name: "export_workout",
    description:
      "Write one ride to disk as a lossless JSON export document — normalized telemetry plus the upstream record verbatim. Returns the path, not the contents, because the document is far too large to read into a conversation.",
    schema: {
      id: z.string(),
      path: z.string().optional().describe("Directory or file path. Defaults to the cache directory."),
    },
    handler: async (store, args) => {
      const { workouts } = await store.snapshotNow();
      const workout = findOrThrow(workouts, String(args.id));
      const written = exportWorkoutTo(workout, args.path as string | undefined, store.cacheDir);
      return `Wrote ${workout.samples.length} samples to ${written}`;
    },
  },
  {
    name: "refresh_history",
    description:
      "Re-download the whole history from the API, replacing the cache. Needs credentials. Everything else answers from the cache, so call this only when a ride is missing because it happened since the last fetch.",
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
  },
];

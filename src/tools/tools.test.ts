import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HistoryStore } from "../history/store.js";
import { fixtureWorkout, fixtureWorkouts } from "../testSupport.js";
import { TOOLS } from "./index.js";

/**
 * A store that never touches the network: the snapshot is handed in.
 *
 * The tools are the part of this server a model actually sees, so they are tested
 * against real records rather than a mock of the parser. What is being asserted is
 * not that the numbers are pretty but that they are *there* — the whole reason this
 * project exists is three channels the platform's own UI omits, and a tool that
 * quietly dropped one would look perfectly fine in a conversation.
 */
function storeWith(cacheDir = mkdtempSync(join(tmpdir(), "mw-mcp-"))): HistoryStore {
  const store = new HistoryStore({ cacheDir, ttlMs: 60_000 });
  const snapshot = {
    workouts: fixtureWorkouts(),
    fetchedAt: new Date("2026-09-14T08:00:00Z"),
    truncated: false,
    skipped: 0,
    source: "cache" as const,
  };
  Object.defineProperty(store, "snapshotNow", { value: async () => snapshot });
  return store;
}

const tool = (name: string) => {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const run = (name: string, args: Record<string, unknown> = {}, store = storeWith()) =>
  tool(name).handler(store, args);

describe("list_workouts", () => {
  it("lists every ride with its power and sample count", async () => {
    const text = await run("list_workouts");
    expect(text).toContain("3 ride(s) matched");
    for (const workout of fixtureWorkouts()) expect(text).toContain(workout.id);
  });

  it("filters by mode and by date, and says how many matched", async () => {
    expect(await run("list_workouts", { mode: "sprint_8" })).toContain("1 ride(s) matched");
    expect(await run("list_workouts", { from: "2030-01-01" })).toContain("0 ride(s) matched");
  });

  it("honours the limit without lying about the total", async () => {
    const text = await run("list_workouts", { limit: 1 });
    expect(text).toContain("3 ride(s) matched; showing 1.");
  });
});

describe("get_workout", () => {
  it("reports both heart-rate averages and explains why they differ", async () => {
    const text = await run("get_workout", { id: "6aa194a08d2b6d09c61e9500" });
    expect(text).toContain("heart rate (reported)");
    expect(text).toContain("heart rate (filtered)");
    expect(text).toMatch(/hr dropouts\s+\d+/);
    expect(text).toContain("the console averaged in real time");
  });

  it("carries the three channels the stock dashboard omits", async () => {
    const text = await run("get_workout", { id: "6a998daf8d2b6d09c6e334d2" });
    expect(text).toContain("power avg / max");
    expect(text).toContain("cadence avg");
    expect(text).toContain("resistance avg");
  });

  it("names the ride that does not exist rather than failing vaguely", async () => {
    await expect(run("get_workout", { id: "nope" })).rejects.toThrow(/No ride with id nope/);
  });
});

describe("get_samples", () => {
  it("returns CSV with a header naming the requested fields", async () => {
    const text = await run("get_samples", { id: "6a998daf8d2b6d09c6e334d2", maxRows: 5 });
    const [header, ...rows] = text.split("\n");
    expect(header).toBe("seconds,power,cadence,resistance,heartRate");
    expect(rows[0]?.split(",")).toHaveLength(5);
  });

  it("caps rows and says so, instead of flooding the conversation", async () => {
    const text = await run("get_samples", { id: "6a998daf8d2b6d09c6e334d2", maxRows: 10 });
    expect(text).toContain("10 of 362 rows");
  });

  it("strides, so a whole ride fits in a readable number of rows", async () => {
    const text = await run("get_samples", { id: "6a998daf8d2b6d09c6e334d2", everyNth: 6 });
    const rows = text.split("\n").filter((line) => /^\d/.test(line));
    expect(rows.length).toBe(61);
  });

  it("blanks a dropout rather than emitting the console's zero", async () => {
    const text = await run("get_samples", {
      id: "6aa194a08d2b6d09c61e9500",
      fields: ["heartRate"],
      maxRows: 1000,
    });
    const values = text.split("\n").slice(1).map((line) => line.split(",")[1]);
    expect(values).toContain("");
    expect(values).not.toContain("0");
  });
});

describe("summarize_history", () => {
  it("buckets volume and reports a power curve with the ride each best came from", async () => {
    const text = await run("summarize_history");
    expect(text).toContain("Volume by month");
    expect(text).toContain("Power curve");
    expect(text).toMatch(/1:00\s+\d+/);
  });

  it("accepts week buckets", async () => {
    expect(await run("summarize_history", { bucket: "week" })).toContain("Volume by week");
  });
});

describe("compare_workouts", () => {
  it("puts the rides side by side", async () => {
    const ids = ["6a998daf8d2b6d09c6e334d2", "6a95b033c23a154beb856bce"];
    const text = await run("compare_workouts", { ids });
    expect(text).toContain("avg W");
    for (const id of ids) expect(text).toContain(id.slice(-6));
  });
});

describe("export_workout", () => {
  it("writes a lossless document and returns the path, not the contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mw-export-"));
    const text = await run("export_workout", { id: "6a95b033c23a154beb856bce" }, storeWith(dir));
    const path = text.split(" to ")[1] ?? "";
    expect(path.startsWith(dir)).toBe(true);

    const written = JSON.parse(readFileSync(path, "utf8")) as { source: { record: unknown } };
    expect(written.source.record).toEqual(fixtureWorkout("6a95b033c23a154beb856bce").raw);
    expect(text.length).toBeLessThan(400);
  });
});

describe("refresh_history", () => {
  it("refuses clearly when there are no credentials to sign in with", async () => {
    await expect(run("refresh_history")).rejects.toThrow(/MATRIX_XID/);
  });
});

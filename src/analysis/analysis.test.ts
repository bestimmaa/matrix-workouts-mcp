import { describe, expect, it } from "vitest";

import { bucketHistory, filterWorkouts } from "./history.js";
import { powerCurve } from "./powerCurve.js";
import { rideSummary, workKilojoules } from "./summary.js";
import { fixtureWorkout, fixtureWorkouts } from "../testSupport.js";

describe("ride summary", () => {
  it("derives power, cadence and resistance from the series", () => {
    const s = rideSummary(fixtureWorkout("6a998daf8d2b6d09c6e334d2"));
    expect(s.averagePowerWatts).toBeGreaterThan(50);
    expect(s.maxPowerWatts).toBeGreaterThanOrEqual(s.averagePowerWatts ?? 0);
    expect(s.averageCadenceRpm).toBeGreaterThan(30);
    expect(s.averageResistance).toBeGreaterThan(0);
  });

  it("keeps both heart-rate figures, because they legitimately disagree", () => {
    const s = rideSummary(fixtureWorkout("6aa194a08d2b6d09c61e9500"));
    expect(s.heartRateDropouts).toBeGreaterThan(0);
    expect(s.filteredHeartRateBpm).not.toBeNull();
    expect(s.reportedHeartRateBpm).not.toBeNull();
  });

  it("integrates work over each sample's own gap, not an assumed ten seconds", () => {
    const samples = [
      { elapsedSeconds: 0, powerWatts: 100 },
      { elapsedSeconds: 10, powerWatts: 100 },
      { elapsedSeconds: 20, powerWatts: 100 },
    ] as never;
    // Two 10 s gaps at 100 W = 2 kJ. The last sample closes the ride and adds nothing.
    expect(workKilojoules(samples)).toBeCloseTo(2);
  });
});

describe("power curve", () => {
  it("finds the best sustained effort and says which ride it came from", () => {
    const curve = powerCurve(fixtureWorkouts(), [10, 60, 300]);
    expect(curve).toHaveLength(3);
    expect(curve[0]?.watts).toBeGreaterThan(0);
    expect(curve[0]?.workoutId).toBeTruthy();
  });

  it("falls as the window widens — a 10 s best cannot be below a 5 min best", () => {
    const curve = powerCurve(fixtureWorkouts(), [10, 60, 300, 600]);
    const watts = curve.map((point) => point.watts);
    expect([...watts].sort((a, b) => b - a)).toEqual(watts);
  });

  it("omits a window longer than any ride rather than inventing a number", () => {
    expect(powerCurve(fixtureWorkouts(), [86_400])).toEqual([]);
  });
});

describe("history aggregation", () => {
  it("buckets by month and totals the volume", () => {
    const buckets = bucketHistory(fixtureWorkouts(), "month");
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.every((b) => b.bucket.endsWith("-01"))).toBe(true);
    expect(buckets.reduce((sum, b) => sum + b.rides, 0)).toBe(3);
  });

  it("buckets weeks onto the Monday", () => {
    for (const bucket of bucketHistory(fixtureWorkouts(), "week")) {
      expect(new Date(`${bucket.bucket}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it("filters on inclusive date bounds", () => {
    const all = fixtureWorkouts();
    const day = all[0]?.startedAt.toISOString().slice(0, 10) ?? "";
    expect(filterWorkouts(all, { from: day, to: day }).length).toBeGreaterThan(0);
    expect(filterWorkouts(all, { from: "2030-01-01" })).toEqual([]);
  });
});

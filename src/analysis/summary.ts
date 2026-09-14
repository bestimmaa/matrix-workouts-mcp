/**
 * Per-ride derived numbers.
 *
 * Everything here is computed from the interval series rather than read off the
 * record's own summary fields, with one deliberate exception: heart rate is reported
 * **both** ways. The platform's average is not derived from the samples and does not
 * always agree with them — on a badly glitching strap the console's figure is the
 * *better* one, because it averaged in real time ahead of the dropouts the series
 * preserves. Showing only ours would be quietly misleading, so both go out, labelled.
 */
import { controlSignature, heartRateStats, type Sample, type Workout } from "matrix-workouts-core";

export interface RideSummary {
  id: string;
  startedAt: Date;
  mode: string;
  machineType: string;
  durationSeconds: number;
  distanceMeters: number;
  calories: number | null;
  /** Mean of every sample carrying power. */
  averagePowerWatts: number | null;
  maxPowerWatts: number | null;
  /** Mechanical work over the ride, kJ — power integrated across sample duration. */
  workKilojoules: number | null;
  averageCadenceRpm: number | null;
  /** Mean resistance level, which is machine- and program-dependent. */
  averageResistance: number | null;
  /** Ours: mean of the samples that survive dropout filtering. */
  filteredHeartRateBpm: number | null;
  /** Theirs: what the console reported. See the note above. */
  reportedHeartRateBpm: number | null;
  heartRateDropouts: number;
  /** What the console was actually holding constant, derived from the series. */
  control: string;
  sampleCount: number;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** Samples with a usable reading for one channel. Zero is absence, not a measurement. */
const channel = (samples: readonly Sample[], pick: (s: Sample) => number): number[] =>
  samples.map(pick).filter((value) => Number.isFinite(value) && value > 0);

export function rideSummary(workout: Workout): RideSummary {
  const power = channel(workout.samples, (s) => s.powerWatts);
  const hr = heartRateStats(workout.samples);

  return {
    id: workout.id,
    startedAt: workout.startedAt,
    mode: workout.mode,
    machineType: workout.machineType,
    durationSeconds: workout.durationSeconds,
    distanceMeters: workout.distanceMeters,
    calories: workout.calories,
    averagePowerWatts: mean(power),
    maxPowerWatts: power.length > 0 ? Math.max(...power) : null,
    workKilojoules: workKilojoules(workout.samples),
    averageCadenceRpm: mean(channel(workout.samples, (s) => s.cadenceRpm)),
    averageResistance: mean(channel(workout.samples, (s) => s.resistanceLevel)),
    filteredHeartRateBpm: hr.meanBpm,
    reportedHeartRateBpm: workout.reported.averageHeartRateBpm,
    heartRateDropouts: hr.dropoutCount,
    control: controlSignature(workout.samples).mode,
    sampleCount: workout.samples.length,
  };
}

/**
 * Work in kilojoules: watts × seconds, summed.
 *
 * Each sample covers its own `elapsedSeconds` gap rather than an assumed 10, because
 * the final sample of a ride reports a duration of 0, 1 or 8 depending on when the
 * rider stopped. Multiplying it by 10 would invent a few seconds of effort.
 */
export function workKilojoules(samples: readonly Sample[]): number | null {
  if (samples.length === 0) return null;
  let joules = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample || sample.powerWatts <= 0) continue;
    const next = samples[i + 1];
    const seconds = next ? next.elapsedSeconds - sample.elapsedSeconds : 0;
    joules += sample.powerWatts * Math.max(seconds, 0);
  }
  return joules / 1000;
}

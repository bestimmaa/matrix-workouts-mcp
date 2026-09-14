/**
 * Best sustained power over a set of durations — the one cross-ride view that makes
 * months of records worth keeping.
 *
 * The console emits a sample every 10 seconds, so 10 s is the finest resolution any
 * of this can honestly claim. A requested window shorter than that would be answered
 * with a single sample's instantaneous reading dressed up as an average, which is why
 * the windows below start at 10 and every one of them is a multiple of it.
 */
import type { Sample, Workout } from "matrix-workouts-core";

export const DEFAULT_WINDOWS_SECONDS = [10, 30, 60, 300, 600, 1200, 3600] as const;

export interface PowerCurvePoint {
  windowSeconds: number;
  /** Best average power sustained over a window this long, watts. */
  watts: number;
  /** The ride it came from, so a number can be traced back to a Tuesday. */
  workoutId: string;
  startedAt: Date;
  /** Seconds into that ride where the window begins. */
  atSeconds: number;
}

/**
 * A sliding mean over consecutive samples.
 *
 * Deliberately not interpolated: a window is a whole number of samples, and one that
 * does not divide evenly is rounded down, so a reported "60 s best" is six real
 * samples rather than five and a guess.
 */
function bestWindow(samples: readonly Sample[], windowSeconds: number): { watts: number; atSeconds: number } | null {
  const width = Math.floor(windowSeconds / 10);
  if (width < 1 || samples.length < width) return null;

  let sum = 0;
  for (let i = 0; i < width; i += 1) sum += samples[i]?.powerWatts ?? 0;

  let best = sum;
  let bestAt = 0;
  for (let i = width; i < samples.length; i += 1) {
    sum += (samples[i]?.powerWatts ?? 0) - (samples[i - width]?.powerWatts ?? 0);
    if (sum > best) {
      best = sum;
      bestAt = samples[i - width + 1]?.elapsedSeconds ?? 0;
    }
  }

  if (best <= 0) return null;
  return { watts: best / width, atSeconds: bestAt };
}

export function powerCurve(
  workouts: readonly Workout[],
  windowsSeconds: readonly number[] = DEFAULT_WINDOWS_SECONDS,
): PowerCurvePoint[] {
  const curve: PowerCurvePoint[] = [];

  for (const windowSeconds of windowsSeconds) {
    let best: PowerCurvePoint | undefined;
    for (const workout of workouts) {
      const found = bestWindow(workout.samples, windowSeconds);
      if (!found) continue;
      if (!best || found.watts > best.watts) {
        best = {
          windowSeconds,
          watts: found.watts,
          workoutId: workout.id,
          startedAt: workout.startedAt,
          atSeconds: found.atSeconds,
        };
      }
    }
    if (best) curve.push(best);
  }

  return curve;
}

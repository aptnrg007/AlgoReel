import type { TimeSeriesSpec } from "../spec/timeSeries/types";
import type { TimeSeriesVideoPlan } from "./types";

// Mirrors fromStorySpec.ts's toDsaVideoPlan — TimeSeriesSpec carries no
// duration/description of its own, so those are supplied by the caller
// (an authoring-time decision, not something derivable from the data).
export function toTimeSeriesVideoPlan(
  spec: TimeSeriesSpec,
  opts: { targetDurationSec: number; description?: string },
): TimeSeriesVideoPlan {
  return {
    version: 1,
    videoType: "time_series",
    title: spec.title,
    description: opts.description,
    targetDurationSec: opts.targetDurationSec,
    payload: spec,
  };
}

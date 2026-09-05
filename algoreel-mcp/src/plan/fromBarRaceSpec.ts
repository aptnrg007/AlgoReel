import type { BarRaceSpec } from "../spec/barRace/types";
import type { BarRaceVideoPlan } from "./types";

// Mirrors fromTimeSeriesSpec.ts's toTimeSeriesVideoPlan — BarRaceSpec
// carries no duration/description of its own, so those are supplied by
// the caller (an authoring-time decision, not something derivable from
// the data).
export function toBarRaceVideoPlan(spec: BarRaceSpec, opts: { targetDurationSec: number; description?: string }): BarRaceVideoPlan {
  return {
    version: 1,
    videoType: "bar_race",
    title: spec.title,
    description: opts.description,
    targetDurationSec: opts.targetDurationSec,
    payload: spec,
  };
}

import type { TimelineSpec } from "../spec/timeline/types";
import type { TimelineVideoPlan } from "./types";

// Mirrors fromTimeSeriesSpec.ts/fromBarRaceSpec.ts — TimelineSpec carries
// no duration/description of its own, so those are supplied by the caller
// (an authoring-time decision, not something derivable from the events).
export function toTimelineVideoPlan(spec: TimelineSpec, opts: { targetDurationSec: number; description?: string }): TimelineVideoPlan {
  return {
    version: 1,
    videoType: "timeline",
    title: spec.title,
    description: opts.description,
    targetDurationSec: opts.targetDurationSec,
    payload: spec,
  };
}

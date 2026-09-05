import type { VideoPlan } from "../src/plan/types";
import { buildTimeline } from "./buildTimeline";

// The one place a VideoPlan's rendered duration is computed, keyed by
// videoType — Root.tsx's calculateMetadata calls this so Remotion always
// renders exactly as many frames as the video actually needs. "dsa" defers
// to buildTimeline (its duration depends on the algorithm's real operation
// count); "time_series" has no per-beat timeline at all, just one
// continuous animation across targetDurationSec.
export function calculateDurationInFrames(plan: VideoPlan, fps: number): number {
  switch (plan.videoType) {
    case "dsa":
      return buildTimeline(plan.payload, fps).totalDurationInFrames;
    case "time_series":
      return Math.round(plan.targetDurationSec * fps);
  }
}

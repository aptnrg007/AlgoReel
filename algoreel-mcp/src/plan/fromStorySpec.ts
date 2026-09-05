import type { StorySpec } from "../spec/types";
import type { DsaVideoPlan } from "./types";

// The only place a bare StorySpec becomes a VideoPlan today. Every current
// entry point (Root.tsx's compositions, renderVideo.ts, frameSampler.ts)
// still hands out/receives a StorySpec, not a VideoPlan — there is no
// planner producing VideoPlan directly yet — so each wraps it the same way
// right before it reaches the Video router.
export function toDsaVideoPlan(spec: StorySpec): DsaVideoPlan {
  return {
    version: 1,
    videoType: "dsa",
    title: spec.topic,
    targetDurationSec: spec.targetDurationSec,
    payload: spec,
  };
}

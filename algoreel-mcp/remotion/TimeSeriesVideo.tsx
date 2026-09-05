import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimeSeriesVideoPlan } from "../src/plan/types";
import { TimeSeriesView } from "./primitives/TimeSeriesView";
import { Frame } from "./template/Frame";

// The Remotion composition for generic time-series/timelapse videos
// (PLAN.md §7/§9). Its only job: turn the current frame into a [0,1]
// progress value and hand it to TimeSeriesView — it does not fetch data,
// call an LLM, decide chart type, or mutate anything. Takes the whole plan
// so it slots directly into VIDEO_TYPES' registry (videoTypes.ts) — see
// AlgorithmVideo.tsx's matching comment.
export const TimeSeriesVideo: React.FC<{ plan: TimeSeriesVideoPlan }> = ({ plan }) => {
  const { payload: spec, targetDurationSec } = plan;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationInFrames = Math.round(targetDurationSec * fps);
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Frame>
      <TimeSeriesView spec={spec} progress={progress} />
    </Frame>
  );
};

import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { BarRaceVideoPlan } from "../src/plan/types";
import { BarRaceView } from "./primitives/BarRaceView";
import { Frame } from "./template/Frame";

// The Remotion composition for bar-race videos (mirrors TimeSeriesVideo.tsx
// exactly — PLAN.md §27's recipe). Its only job: turn the current frame
// into a [0,1] progress value and hand it to BarRaceView — it does not
// fetch data, call an LLM, decide rankings, or mutate anything.
export const BarRaceVideo: React.FC<{ plan: BarRaceVideoPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationInFrames = Math.round(plan.targetDurationSec * fps);
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Frame>
      <BarRaceView spec={plan.payload} progress={progress} />
    </Frame>
  );
};

import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineVideoPlan } from "../src/plan/types";
import { TimelineView } from "./primitives/TimelineView";
import { Frame } from "./template/Frame";

// The Remotion composition for timeline (historical events) videos
// (mirrors TimeSeriesVideo.tsx/BarRaceVideo.tsx — PLAN.md §27's recipe).
// Its only job: turn the current frame into a [0,1] progress value and
// hand it to TimelineView — it does not fetch data, call an LLM, decide
// which events matter, or mutate anything.
export const TimelineVideo: React.FC<{ plan: TimelineVideoPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationInFrames = Math.round(plan.targetDurationSec * fps);
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Frame>
      <TimelineView spec={plan.payload} progress={progress} />
    </Frame>
  );
};

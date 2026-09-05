import React from "react";
import type { VideoPlan } from "../src/plan/types";
import { AlgorithmVideo } from "./AlgorithmVideo";
import { TimeSeriesVideo } from "./TimeSeriesVideo";

// Top-level dispatcher (PLAN.md's multi-video-type architecture §10): picks
// which video-type-specific renderer runs, and nothing else. Never contains
// video-type-specific layout/timing logic itself — that stays in each
// renderer (AlgorithmVideo, TimeSeriesVideo, ...).
export const Video: React.FC<{ plan: VideoPlan }> = ({ plan }) => {
  switch (plan.videoType) {
    case "dsa":
      return <AlgorithmVideo spec={plan.payload} />;
    case "time_series":
      return <TimeSeriesVideo spec={plan.payload} targetDurationSec={plan.targetDurationSec} />;
  }
};

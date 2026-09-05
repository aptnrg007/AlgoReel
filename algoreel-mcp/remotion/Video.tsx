import React from "react";
import type { VideoPlan } from "../src/plan/types";
import { renderComponentFor } from "./videoTypes";

// Top-level dispatcher (PLAN.md's multi-video-type architecture §10): picks
// which video-type-specific renderer runs, and nothing else. A pure lookup
// against VIDEO_TYPES (videoTypes.ts) rather than a switch, so adding a
// video type never touches this file.
export const Video: React.FC<{ plan: VideoPlan }> = ({ plan }) => {
  const Render = renderComponentFor(plan);
  return <Render plan={plan} />;
};

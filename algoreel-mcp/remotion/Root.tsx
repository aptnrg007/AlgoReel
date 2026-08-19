import React from "react";
import { Composition } from "remotion";
import type { StorySpec } from "../src/spec/types";
import spec from "../specs/binary-search-demo.json";
import { buildTimeline } from "./buildTimeline";
import { FRAME } from "./template/tokens";
import { Video } from "./Video";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BinarySearch"
      component={Video}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      durationInFrames={300}
      defaultProps={{ spec: spec as StorySpec }}
      calculateMetadata={async ({ props }) => {
        const timeline = buildTimeline(props.spec, FRAME.fps);
        return { durationInFrames: timeline.totalDurationInFrames };
      }}
    />
  );
};

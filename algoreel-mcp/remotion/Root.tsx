import React from "react";
import { Composition } from "remotion";
import type { StorySpec } from "../src/spec/types";
import type { TimeSeriesSpec } from "../src/spec/timeSeries/types";
import balancedParensSpec from "../specs/balanced-parens-demo.json";
import bfsSpec from "../specs/bfs-demo.json";
import binarySearchSpec from "../specs/binary-search-demo.json";
import bstInsertSpec from "../specs/bst-insert-demo.json";
import bubbleSortSpec from "../specs/bubble-sort-demo.json";
import inorderTraversalSpec from "../specs/inorder-traversal-demo.json";
import reverseLinkedListSpec from "../specs/reverse-linked-list-demo.json";
import timeSeriesDemoSpec from "../specs/time-series/time-series-demo.json";
import { toDsaVideoPlan } from "../src/plan/fromStorySpec";
import { toTimeSeriesVideoPlan } from "../src/plan/fromTimeSeriesSpec";
import type { VideoPlan } from "../src/plan/types";
import { calculateDurationInFrames } from "./videoTypes";
import { FRAME } from "./template/tokens";
import { Video } from "./Video";

// Every entry here shares the exact same component, template, and duration
// logic — only the VideoPlan differs. That's what Phase 1 (dsa) and Phase 2
// (time_series) are each meant to prove (PLAN.md §9): adding a video, or a
// whole video type, doesn't require touching the router.
const compositions: Array<{ id: string; plan: VideoPlan }> = [
  { id: "BinarySearch", plan: toDsaVideoPlan(binarySearchSpec as StorySpec) },
  { id: "BubbleSort", plan: toDsaVideoPlan(bubbleSortSpec as StorySpec) },
  { id: "Bfs", plan: toDsaVideoPlan(bfsSpec as StorySpec) },
  { id: "ReverseLinkedList", plan: toDsaVideoPlan(reverseLinkedListSpec as StorySpec) },
  { id: "InorderTraversal", plan: toDsaVideoPlan(inorderTraversalSpec as StorySpec) },
  { id: "BalancedParens", plan: toDsaVideoPlan(balancedParensSpec as StorySpec) },
  { id: "BstInsert", plan: toDsaVideoPlan(bstInsertSpec as StorySpec) },
  {
    id: "TimeSeriesDemo",
    plan: toTimeSeriesVideoPlan(timeSeriesDemoSpec as TimeSeriesSpec, { targetDurationSec: 20 }),
  },
  // Generic target for MCP-driven renders (src/server.ts's render_preview
  // tool): the defaultProps plan here is just a placeholder, always
  // overridden at render time via `--props=<path-to-{plan:...}.json>`
  // (renderVideo.ts/frameSampler.ts wrap the StorySpec into a DsaVideoPlan
  // before writing it out — those two are still dsa-only; time_series has
  // no MCP tool wiring yet).
  { id: "Video", plan: toDsaVideoPlan(binarySearchSpec as StorySpec) },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {compositions.map(({ id, plan }) => (
        <Composition
          key={id}
          id={id}
          component={Video}
          fps={FRAME.fps}
          width={FRAME.width}
          height={FRAME.height}
          durationInFrames={300}
          defaultProps={{ plan }}
          calculateMetadata={async ({ props }) => {
            return { durationInFrames: calculateDurationInFrames(props.plan, FRAME.fps) };
          }}
        />
      ))}
    </>
  );
};

import React from "react";
import { Composition } from "remotion";
import type { StorySpec } from "../src/spec/types";
import balancedParensSpec from "../specs/balanced-parens-demo.json";
import bfsSpec from "../specs/bfs-demo.json";
import binarySearchSpec from "../specs/binary-search-demo.json";
import bubbleSortSpec from "../specs/bubble-sort-demo.json";
import inorderTraversalSpec from "../specs/inorder-traversal-demo.json";
import reverseLinkedListSpec from "../specs/reverse-linked-list-demo.json";
import { buildTimeline } from "./buildTimeline";
import { FRAME } from "./template/tokens";
import { Video } from "./Video";

// Every entry here shares the exact same component, template, and timeline
// logic — only the StorySpec differs. That's the thing Phase 1 is meant to
// prove (PLAN.md §9): adding an algorithm doesn't require touching the
// renderer, just adding a spec.
const compositions: Array<{ id: string; spec: StorySpec }> = [
  { id: "BinarySearch", spec: binarySearchSpec as StorySpec },
  { id: "BubbleSort", spec: bubbleSortSpec as StorySpec },
  { id: "Bfs", spec: bfsSpec as StorySpec },
  { id: "ReverseLinkedList", spec: reverseLinkedListSpec as StorySpec },
  { id: "InorderTraversal", spec: inorderTraversalSpec as StorySpec },
  { id: "BalancedParens", spec: balancedParensSpec as StorySpec },
  // Generic target for MCP-driven renders (src/server.ts's render_preview
  // tool): the defaultProps spec here is just a placeholder, always
  // overridden at render time via `--props=<path-to-{spec:...}.json>`.
  { id: "Video", spec: binarySearchSpec as StorySpec },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {compositions.map(({ id, spec }) => (
        <Composition
          key={id}
          id={id}
          component={Video}
          fps={FRAME.fps}
          width={FRAME.width}
          height={FRAME.height}
          durationInFrames={300}
          defaultProps={{ spec }}
          calculateMetadata={async ({ props }) => {
            const timeline = buildTimeline(props.spec, FRAME.fps);
            return { durationInFrames: timeline.totalDurationInFrames };
          }}
        />
      ))}
    </>
  );
};

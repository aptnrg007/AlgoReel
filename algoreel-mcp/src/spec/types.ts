import type { BFSInput } from "../algorithms/bfs";
import type { BinarySearchInput } from "../algorithms/binarySearch";
import type { BubbleSortInput } from "../algorithms/bubbleSort";

export interface NarrationBeat {
  beat: "intro" | "outro" | `op:${number}`;
  text: string;
}

interface StorySpecBase {
  version: 1;
  topic: string;
  targetDurationSec: number;
  hook: string;
  narration: NarrationBeat[];
  emphasis: string[];
  complexity: { time: string; space: string };
  youtube: { title: string; description: string; tags: string[] };
}

// Discriminated on `algorithm` so each variant's `input` is typed to match
// (PLAN.md §4). Adding an algorithm means adding a branch here.
export type StorySpec =
  | (StorySpecBase & { algorithm: "binarySearch"; input: BinarySearchInput })
  | (StorySpecBase & { algorithm: "bubbleSort"; input: BubbleSortInput })
  | (StorySpecBase & { algorithm: "bfs"; input: BFSInput });

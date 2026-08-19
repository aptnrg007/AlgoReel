import { binarySearch } from "./binarySearch";
import { bubbleSort } from "./bubbleSort";
import type { AlgorithmResult } from "./types";
import type { StorySpec } from "../spec/types";

export const ALGORITHMS = {
  binarySearch: {
    name: "binarySearch",
    description: "Find a target in a sorted array by repeatedly halving the search range.",
  },
  bubbleSort: {
    name: "bubbleSort",
    description: "Sort an array by repeatedly swapping adjacent out-of-order elements.",
  },
} as const;

export type AlgorithmName = keyof typeof ALGORITHMS;

// The one place a StorySpec's `algorithm` discriminant meets the actual
// engine. A switch (not a lookup table) so adding an algorithm here is a
// compile error until this is updated — TypeScript enforces the registry
// can't drift from the StorySpec union.
export function runAlgorithm(spec: StorySpec): AlgorithmResult {
  switch (spec.algorithm) {
    case "binarySearch":
      return binarySearch(spec.input);
    case "bubbleSort":
      return bubbleSort(spec.input);
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

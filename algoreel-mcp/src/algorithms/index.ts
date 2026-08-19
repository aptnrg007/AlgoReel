import { binarySearch, type BinarySearchInput } from "./binarySearch";
import { bubbleSort, type BubbleSortInput } from "./bubbleSort";
import type { AlgorithmResult } from "./types";
import type { StorySpec } from "../spec/types";

export const ALGORITHMS = {
  binarySearch: {
    name: "binarySearch",
    description: "Find a target in a sorted array by repeatedly halving the search range.",
    inputHint: "{ array: number[] (sorted ascending), target: number }",
  },
  bubbleSort: {
    name: "bubbleSort",
    description: "Sort an array by repeatedly swapping adjacent out-of-order elements.",
    inputHint: "{ array: number[] }",
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

// Same dispatch, but for callers (the MCP `run_algorithm` tool) that only
// have a bare algorithm name + input — not a full StorySpec — and whose
// input has already been validated against the matching zod schema
// (src/spec/schema.ts) before this is called.
export function runAlgorithmByName(algorithm: AlgorithmName, input: BinarySearchInput | BubbleSortInput): AlgorithmResult {
  switch (algorithm) {
    case "binarySearch":
      return binarySearch(input as BinarySearchInput);
    case "bubbleSort":
      return bubbleSort(input as BubbleSortInput);
    default: {
      const _exhaustive: never = algorithm;
      return _exhaustive;
    }
  }
}

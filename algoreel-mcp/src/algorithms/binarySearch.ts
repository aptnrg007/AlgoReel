import type { AlgorithmResult, Operation } from "./types";

export interface BinarySearchInput {
  array: number[];
  target: number;
}

/**
 * Pure, deterministic. No LLM involvement — this is the boundary described
 * in PLAN.md §2: the agent decides *what* to search, this decides *what happens*.
 */
export function binarySearch({ array, target }: BinarySearchInput): AlgorithmResult {
  for (let i = 1; i < array.length; i++) {
    if (array[i]! < array[i - 1]!) {
      throw new Error("binarySearch requires a sorted array");
    }
  }

  const operations: Operation[] = [{ type: "init", array }];

  let lo = 0;
  let hi = array.length - 1;
  operations.push({ type: "pointer", name: "lo", index: lo });
  operations.push({ type: "pointer", name: "hi", index: hi });

  let result: number | undefined;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    // Highlight before the pointer label: the renderer groups a new
    // narration beat starting at each focus highlight (PLAN.md §4 grouping,
    // see remotion/primitives/state.ts), so this order keeps "mid" from
    // appearing on screen a beat early.
    operations.push({ type: "highlight", indices: [mid], style: "focus" });
    operations.push({ type: "pointer", name: "mid", index: mid });

    const midVal = array[mid]!;
    const cmp: "lt" | "eq" | "gt" = midVal === target ? "eq" : midVal < target ? "lt" : "gt";
    operations.push({ type: "compare", a: midVal, b: target, result: cmp });

    if (cmp === "eq") {
      operations.push({ type: "highlight", indices: [mid], style: "found" });
      result = mid;
      break;
    }

    if (cmp === "gt") {
      operations.push({ type: "discard", from: mid, to: hi });
      hi = mid - 1;
      operations.push({ type: "pointer", name: "hi", index: hi });
    } else {
      operations.push({ type: "discard", from: lo, to: mid });
      lo = mid + 1;
      operations.push({ type: "pointer", name: "lo", index: lo });
    }
  }

  operations.push({ type: "done", result });

  const summary =
    result !== undefined
      ? `Found ${target} at index ${result} in ${countSteps(operations)} comparisons.`
      : `${target} is not in the array (${countSteps(operations)} comparisons).`;

  return { operations, summary };
}

function countSteps(operations: Operation[]): number {
  return operations.filter((op) => op.type === "compare").length;
}

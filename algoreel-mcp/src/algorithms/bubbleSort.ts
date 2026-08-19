import type { AlgorithmResult, Operation } from "./types";

export interface BubbleSortInput {
  array: number[];
}

/**
 * Pure, deterministic — same boundary as binarySearch.ts (PLAN.md §2).
 * Reuses the existing operation vocabulary (init/highlight/compare/swap/done)
 * with no new variants, per the §4 rule: adding an algorithm must not
 * require adding an operation type.
 */
export function bubbleSort({ array }: BubbleSortInput): AlgorithmResult {
  const arr = [...array];
  const n = arr.length;
  const operations: Operation[] = [{ type: "init", array: [...arr] }];

  let comparisons = 0;
  let swaps = 0;

  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let k = 0; k < n - 1 - i; k++) {
      operations.push({ type: "highlight", indices: [k, k + 1], style: "focus" });

      const a = arr[k]!;
      const b = arr[k + 1]!;
      comparisons++;
      const result: "lt" | "eq" | "gt" = a === b ? "eq" : a < b ? "lt" : "gt";
      operations.push({ type: "compare", a, b, result });

      if (result === "gt") {
        [arr[k], arr[k + 1]] = [arr[k + 1]!, arr[k]!];
        operations.push({ type: "swap", i: k, j: k + 1 });
        swaps++;
        swapped = true;
      }
    }
    operations.push({ type: "highlight", indices: [n - 1 - i], style: "found" });
    if (!swapped) break;
  }

  // Idempotent final pass: guarantees every cell reads "found" at the end
  // regardless of whether the loop above exited early.
  if (n > 0) {
    operations.push({
      type: "highlight",
      indices: Array.from({ length: n }, (_, idx) => idx),
      style: "found",
    });
  }
  operations.push({ type: "done" });

  const summary = `Sorted ${n} elements in ${comparisons} comparisons and ${swaps} swaps.`;
  return { operations, summary };
}

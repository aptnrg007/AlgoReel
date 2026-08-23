// AUTO-GENERATED and validated by AlgoReel's codegen path
// (algoreel-mcp/src/algorithms/sandbox.ts) on 2026-08-23T17:53:57.486Z.
// Bidirectional bubble sort: alternates forward and backward passes through the array, swapping adjacent out-of-order elements, until no swaps are needed.
//
// Validated once via sandboxed execution (result-correctness +
// complexity-class checks — see sandbox.ts) before being cached here.
// From this point on it's a real, permanent algorithm file, run
// in-process like any hand-written one — no further sandboxing on load.
import { createTracedArray } from "../trace";
import type { AlgorithmResult } from "../types";
import type { TracedArray } from "../trace";

export const DESCRIPTION = "Bidirectional bubble sort: alternates forward and backward passes through the array, swapping adjacent out-of-order elements, until no swaps are needed.";

export interface GeneratedInput {
  array: number[];
}

function run(trace: TracedArray): void {
    let start = 0;
    let end = trace.length - 1;
    let swapped = true;

    while (swapped) {
        swapped = false;

        // Forward pass
        for (let i = start; i < end; i++) {
            if (trace.compare(i, i + 1) > 0) {
                trace.swap(i, i + 1);
                swapped = true;
            }
        }

        if (!swapped) break;

        swapped = false;
        end--;

        // Backward pass
        for (let i = end; i > start; i--) {
            if (trace.compare(i, i - 1) < 0) {
                trace.swap(i, i - 1);
                swapped = true;
            }
        }

        start++;
    }
}

export function cocktailsort({ array }: GeneratedInput): AlgorithmResult {
  const { trace, operations } = createTracedArray(array);
  run(trace);
  return { operations, summary: "Ran the generated \"cocktail sort\" implementation on " + array.length + " elements." };
}

// AUTO-GENERATED and validated by AlgoReel's codegen path
// (algoreel-mcp/src/algorithms/sandbox.ts) on 2026-08-23T14:34:05.795Z.
// Sort an array by recursively splitting it in half, sorting each half, and merging the sorted halves back together.
//
// Validated once via sandboxed execution (result-correctness +
// complexity-class checks — see sandbox.ts) before being cached here.
// From this point on it's a real, permanent algorithm file, run
// in-process like any hand-written one — no further sandboxing on load.
//
// Non-null assertions below (left[i]!, right[j]!) added by hand on
// review, not part of the generated/validated code: each is guarded by
// the exact loop condition that proves the index is in bounds, which
// noUncheckedIndexedAccess can't see on its own. This is the "human
// review before trusting it" step this file's header already implies —
// the sandbox validates behavior, not TypeScript strictness.
import { createTracedArray } from "../trace";
import type { AlgorithmResult } from "../types";
import type { TracedArray } from "../trace";

export const DESCRIPTION = "Sort an array by recursively splitting it in half, sorting each half, and merging the sorted halves back together.";

export interface GeneratedInput {
  array: number[];
}


function run(trace: TracedArray): void {
  function merge(lo: number, mid: number, hi: number) {
    const left = [];
    const right = [];
    for (let i = lo; i <= mid; i++) left.push(trace.get(i));
    for (let j = mid + 1; j <= hi; j++) right.push(trace.get(j));

    let i = 0, j = 0, k = lo;
    while (i < left.length && j < right.length) {
      // mirror the real comparison onto the actual positions for the video
      const posI = lo + i;
      const posJ = mid + 1 + j;
      trace.compare(posI, posJ);
      if (left[i]! <= right[j]!) {
        trace.set(k, left[i]!);
        i++;
      } else {
        trace.set(k, right[j]!);
        j++;
      }
      k++;
    }
    while (i < left.length) {
      trace.set(k, left[i]!);
      i++;
      k++;
    }
    while (j < right.length) {
      trace.set(k, right[j]!);
      j++;
      k++;
    }
  }

  function sort(lo: number, hi: number) {
    if (lo >= hi) return;
    const mid = Math.floor((lo + hi) / 2);
    sort(lo, mid);
    sort(mid + 1, hi);
    merge(lo, mid, hi);
  }

  sort(0, trace.length - 1);
}


export function mergesort({ array }: GeneratedInput): AlgorithmResult {
  const { trace, operations } = createTracedArray(array);
  run(trace);
  return { operations, summary: "Ran the generated \"mergeSort\" implementation on " + array.length + " elements." };
}

import type { Operation } from "./types";

// The instrumentation boundary for generated algorithms (PLAN.md §2's
// determinism boundary, moved up one level): an LLM never writes an
// Operation directly. It writes ordinary-looking code against this
// array API instead, and every access is logged as a side effect —
// the operation log is a mechanical record of what the code actually
// did, not something the model had to get right by construction.
export interface TracedArray {
  readonly length: number;
  get(i: number): number;
  set(i: number, value: number): void;
  compare(i: number, j: number): -1 | 0 | 1;
  swap(i: number, j: number): void;
  toArray(): number[];
}

export function createTracedArray(initial: number[]): { trace: TracedArray; operations: Operation[] } {
  const array = [...initial];
  const operations: Operation[] = [{ type: "init", array: [...array] }];

  const trace: TracedArray = {
    get length() {
      return array.length;
    },
    get(i) {
      return array[i]!;
    },
    set(i, value) {
      array[i] = value;
      operations.push({ type: "write", index: i, value });
    },
    compare(i, j) {
      const a = array[i]!;
      const b = array[j]!;
      // "focus" mirrors the hand-written algorithms' existing
      // convention (see binarySearch.ts) — a highlight immediately
      // before the compare marks the step boundary splitPrimarySteps
      // (src/spec/beats.ts) relies on to count primary steps.
      operations.push({ type: "highlight", indices: [i, j], style: "focus" });
      const result: -1 | 0 | 1 = a < b ? -1 : a > b ? 1 : 0;
      operations.push({ type: "compare", a, b, result: result === -1 ? "lt" : result === 1 ? "gt" : "eq" });
      return result;
    },
    swap(i, j) {
      const tmp = array[i]!;
      array[i] = array[j]!;
      array[j] = tmp;
      operations.push({ type: "swap", i, j });
    },
    toArray() {
      return [...array];
    },
  };

  return { trace, operations };
}

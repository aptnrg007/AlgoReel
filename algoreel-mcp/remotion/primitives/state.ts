import type { Operation } from "../../src/algorithms/types";
import { splitPrimarySteps } from "../../src/spec/beats";

export interface ArrayState {
  array: number[];
  pointers: Record<string, number>;
  highlights: Record<number, "focus" | "found" | "dead">;
  discarded: Set<number>;
}

export const INITIAL_STATE: ArrayState = {
  array: [],
  pointers: {},
  highlights: {},
  discarded: new Set(),
};

// The renderer's only job: fold operations into visual state. This must
// handle every Operation variant (exhaustive switch) — adding an algorithm
// should never require touching this file (PLAN.md §4).
export function applyOperation(state: ArrayState, op: Operation): ArrayState {
  switch (op.type) {
    case "init":
      return { ...state, array: op.array };
    case "pointer":
      return { ...state, pointers: { ...state.pointers, [op.name]: op.index } };
    case "highlight": {
      const highlights = { ...state.highlights };
      // "focus" is a spotlight on whatever's currently being compared, not
      // a permanent mark — clear stale focus entries whenever a new one
      // arrives, so cells a sort has already moved past go back to neutral
      // instead of staying lit forever (only surfaced once bubbleSort's
      // lack of "discard" exposed it — binarySearch always overwrote focus
      // with discard shortly after, masking the same latent bug).
      if (op.style === "focus") {
        for (const key of Object.keys(highlights)) {
          const idx = Number(key);
          if (highlights[idx] === "focus") delete highlights[idx];
        }
      }
      for (const idx of op.indices) highlights[idx] = op.style;
      return { ...state, highlights };
    }
    case "discard": {
      const discarded = new Set(state.discarded);
      for (let i = op.from; i <= op.to; i++) discarded.add(i);
      return { ...state, discarded };
    }
    case "swap": {
      const array = [...state.array];
      const tmp = array[op.i]!;
      array[op.i] = array[op.j]!;
      array[op.j] = tmp;
      return { ...state, array };
    }
    case "compare":
    case "visit":
    case "enqueue":
    case "dequeue":
    case "edge":
    case "done":
      return state;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function replay(operations: Operation[]): ArrayState {
  return operations.reduce(applyOperation, INITIAL_STATE);
}

// Splits a beat's operations into the distinct visual states they pass
// through (skipping ops like "compare" that don't change anything on
// screen), so a beat can animate through its sub-steps instead of jumping
// straight to the end state while its caption is still being read.
export function buildCheckpoints(ops: Operation[], startState: ArrayState): ArrayState[] {
  const states: ArrayState[] = [];
  let state = startState;
  for (const op of ops) {
    const next = applyOperation(state, op);
    if (next !== state) {
      states.push(next);
    }
    state = next;
  }
  if (states.length === 0) states.push(state);
  return states;
}

// Groups operations by which narration beat they belong to.
//
// A new "primary step" starts at each focus highlight (the moment a new
// element comes under scrutiny); everything before the first one is
// "intro". An algorithm like binarySearch has few primary steps and
// narrates one per beat 1:1. An O(n^2) algorithm like bubbleSort can have
// far more primary steps than an agent would ever narrate individually, so
// primary steps are distributed evenly across however many "op:N" beats
// the StorySpec actually declares (opBeatCount) — a beat may end up
// covering several primary steps, each still animated as its own
// checkpoint (see buildCheckpoints) within that beat's screen time.
export function groupOperationsByBeat(operations: Operation[], opBeatCount: number): Map<string, Operation[]> {
  const { introOps, primarySteps } = splitPrimarySteps(operations);

  const groups = new Map<string, Operation[]>();
  groups.set("intro", introOps!);

  const n = Math.max(opBeatCount, 1);
  const base = Math.floor(primarySteps.length / n);
  const remainder = primarySteps.length - base * n;
  let idx = 0;
  for (let b = 0; b < n; b++) {
    const count = base + (b < remainder ? 1 : 0);
    const bucket: Operation[] = [];
    for (let k = 0; k < count; k++) {
      bucket.push(...primarySteps[idx]!);
      idx++;
    }
    groups.set(`op:${b}`, bucket);
  }
  return groups;
}

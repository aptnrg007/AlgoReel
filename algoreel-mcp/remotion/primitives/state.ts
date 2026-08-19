import type { Operation } from "../../src/algorithms/types";

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

// Groups operations by which narration beat they belong to. A new "op:N"
// group starts at each focus highlight (the moment a new element comes
// under scrutiny); everything before the first one is "intro".
export function groupOperationsByBeat(operations: Operation[]): Map<string, Operation[]> {
  const groups = new Map<string, Operation[]>();
  let opIndex = -1;
  for (const op of operations) {
    if (op.type === "highlight" && op.style === "focus") {
      opIndex += 1;
    }
    const beat = opIndex === -1 ? "intro" : `op:${opIndex}`;
    if (!groups.has(beat)) groups.set(beat, []);
    groups.get(beat)!.push(op);
  }
  return groups;
}

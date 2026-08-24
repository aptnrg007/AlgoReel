import type { LayoutKind, Operation } from "../../src/algorithms/types";
import { splitPrimarySteps } from "../../src/spec/beats";

// One flat state bag covering every algorithm shape built so far — array
// fields for binarySearch/bubbleSort/etc., struct fields for every
// node/link structure (linked lists, trees, graphs, stacks, ...), rendered
// by ArrayView or StructureView respectively (remotion/Video.tsx picks
// which one to mount via src/spec/inputShape.ts). Kept unified (rather
// than a union type per algorithm shape) so Checkpoint/Timeline and the
// beat-grouping/checkpoint-allocation math below stay exactly as written
// for every algorithm — they never touch these fields directly.
export interface VisualState {
  array: number[];
  pointers: Record<string, number>;
  highlights: Record<number, "focus" | "found" | "dead">;
  discarded: Set<number>;
  structLayout: LayoutKind | null;
  structNodes: { id: string; value: string | number }[];
  // Undirected, declared once and never rewired (a graph's edges) — see
  // the "struct" op's own comment for why this is separate from
  // structLinks.
  structEdges: [string, string][];
  // Directed, current links only — a "link" op with `to: null` removes
  // the (from, slot) entry rather than storing a null target. Unlike the
  // pre-generalization LinkedListView, a rewired-to-null link simply
  // isn't drawn (no arrow), rather than rendering an explicit "∅" stub —
  // a deliberate simplification once this had to generalize to trees
  // (a real tree diagram doesn't draw a box for every leaf's missing
  // child) and graphs (no concept of a null edge at all). "Where did the
  // pointer go" is still visible via structPointers, which does keep
  // explicit nulls (a nodePointer floating with no node under it).
  structLinks: { from: string; slot: string; to: string }[];
  structNodeState: Record<string, "focus" | "pending" | "done" | "dead">;
  structLinkState: Record<string, "active" | "used">;
  structPointers: Record<string, string | null>;
}

export const INITIAL_STATE: VisualState = {
  array: [],
  pointers: {},
  highlights: {},
  discarded: new Set(),
  structLayout: null,
  structNodes: [],
  structEdges: [],
  structLinks: [],
  structNodeState: {},
  structLinkState: {},
  structPointers: {},
};

// Undirected pairs (a graph's edges, or a linkState lookup) can be
// declared/traversed in either order — normalize to one key so
// StructureView's lookups agree with whatever order applyOperation
// stored a status under.
export function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

function linkKey(from: string, slot: string): string {
  return `${from}|${slot}`;
}

// The renderer's only job: fold operations into visual state. This must
// handle every Operation variant (exhaustive switch) — adding an algorithm
// should never require touching this file (PLAN.md §4).
export function applyOperation(state: VisualState, op: Operation): VisualState {
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
    case "write": {
      const array = [...state.array];
      array[op.index] = op.value;
      return { ...state, array };
    }
    case "struct":
      return { ...state, structLayout: op.layout, structNodes: op.nodes, structEdges: op.edges ?? [] };
    case "link": {
      const kept = state.structLinks.filter((l) => linkKey(l.from, l.slot) !== linkKey(op.from, op.slot));
      const structLinks = op.to === null ? kept : [...kept, { from: op.from, slot: op.slot, to: op.to }];
      return { ...state, structLinks };
    }
    case "nodeState": {
      const structNodeState = { ...state.structNodeState };
      // Same "focus" special case as "highlight" above, and for the same
      // reason: a spotlight that isn't cleared when a new one arrives
      // elsewhere leaves stale nodes lit forever.
      if (op.state === "focus") {
        for (const id of Object.keys(structNodeState)) {
          if (structNodeState[id] === "focus") delete structNodeState[id];
        }
      }
      for (const id of op.nodes) structNodeState[id] = op.state;
      return { ...state, structNodeState };
    }
    case "linkState":
      return { ...state, structLinkState: { ...state.structLinkState, [edgeKey(op.from, op.to)]: op.state } };
    case "nodePointer":
      return { ...state, structPointers: { ...state.structPointers, [op.name]: op.node } };
    case "compare":
    case "done":
      return state;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function replay(operations: Operation[]): VisualState {
  return operations.reduce(applyOperation, INITIAL_STATE);
}

// Splits a beat's operations into the distinct visual states they pass
// through (skipping ops like "compare" that don't change anything on
// screen), so a beat can animate through its sub-steps instead of jumping
// straight to the end state while its caption is still being read.
export function buildCheckpoints(ops: Operation[], startState: VisualState): VisualState[] {
  const states: VisualState[] = [];
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

import type { Operation } from "../algorithms/types";

// A "primary step" is one chunk of operations starting at a step-boundary
// op — the moment a new element comes under scrutiny. Everything before the
// first one is "intro". This is the single definition of that chunk
// boundary: both the renderer (remotion/primitives/state.ts,
// groupOperationsByBeat) and spec validation (src/spec/validate.ts) must
// agree on it, or a spec can validate against a step budget the renderer
// doesn't actually honor.
export function splitPrimarySteps(operations: Operation[]): {
  introOps: Operation[];
  primarySteps: Operation[][];
} {
  const chunks: Operation[][] = [[]];
  for (const op of operations) {
    if (isStepBoundary(op)) {
      chunks.push([]);
    }
    chunks[chunks.length - 1]!.push(op);
  }
  const [introOps, ...primarySteps] = chunks;
  return { introOps: introOps!, primarySteps };
}

// "highlight" with style "focus" is array algorithms' step boundary (the
// element(s) currently under scrutiny); "nodeState" with state "focus" is
// the identical concept for every node/link structure (linked lists,
// trees, graphs, ...) — one spotlight-clearing rule (state.ts), one
// step-boundary rule, regardless of which of the two visual state shapes
// an algorithm uses.
function isStepBoundary(op: Operation): boolean {
  return (op.type === "highlight" && op.style === "focus") || (op.type === "nodeState" && op.state === "focus");
}

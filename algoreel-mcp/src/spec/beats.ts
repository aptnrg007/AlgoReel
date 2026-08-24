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

// A "focus" highlight is array algorithms' step boundary (the element(s)
// currently under scrutiny); a "dequeue" is graph algorithms' equivalent
// (the node currently being processed); "listFocus" is linked-list
// algorithms' equivalent (the node currently under the cursor) —
// binarySearch/bubbleSort emit one focus highlight per logical step, bfs
// emits one dequeue per logical step, reverseLinkedList emits one
// listFocus per logical step. All three mark "a new primary step begins
// here" the same way, just from different algorithm shapes, so all count.
function isStepBoundary(op: Operation): boolean {
  return (op.type === "highlight" && op.style === "focus") || op.type === "dequeue" || op.type === "listFocus";
}

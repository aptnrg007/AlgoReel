import type { Operation } from "../algorithms/types";

// A "primary step" is one chunk of operations starting at a "focus"
// highlight — the moment a new element comes under scrutiny. Everything
// before the first one is "intro". This is the single definition of that
// chunk boundary: both the renderer (remotion/primitives/state.ts,
// groupOperationsByBeat) and spec validation (src/spec/validate.ts) must
// agree on it, or a spec can validate against a step budget the renderer
// doesn't actually honor.
export function splitPrimarySteps(operations: Operation[]): {
  introOps: Operation[];
  primarySteps: Operation[][];
} {
  const chunks: Operation[][] = [[]];
  for (const op of operations) {
    if (op.type === "highlight" && op.style === "focus") {
      chunks.push([]);
    }
    chunks[chunks.length - 1]!.push(op);
  }
  const [introOps, ...primarySteps] = chunks;
  return { introOps: introOps!, primarySteps };
}

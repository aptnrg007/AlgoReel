export type Operation =
  | { type: "init"; array: number[] }
  | { type: "pointer"; name: string; index: number }
  | { type: "compare"; a: number; b: number; result: "lt" | "eq" | "gt" }
  | { type: "swap"; i: number; j: number }
  // Writes an arbitrary computed value into a position — distinct from
  // "swap" (which only ever exchanges two existing values). Needed for
  // algorithms like merge sort whose merge step writes a value chosen
  // from a temporary buffer, not one already living at that index.
  | { type: "write"; index: number; value: number }
  | { type: "highlight"; indices: number[]; style: "focus" | "found" | "dead" }
  | { type: "discard"; from: number; to: number }
  // graph algorithms' analog of "init": declares the full node/edge set up
  // front so the renderer can lay out even not-yet-visited nodes, the same
  // way "init"'s array gives every algorithm a fixed set of cells from
  // frame 0. Kept as its own type rather than folded into "init" because
  // its payload shape (nodes/edges) is fundamentally different from an
  // array, not just a variant of it.
  | { type: "graph"; nodes: string[]; edges: [string, string][] }
  | { type: "visit"; node: string }
  | { type: "enqueue"; node: string }
  | { type: "dequeue"; node: string }
  | { type: "edge"; from: string; to: string; state: "active" | "used" }
  | { type: "done"; result?: number | string };

export interface AlgorithmResult {
  operations: Operation[];
  summary: string;
}

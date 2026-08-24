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
  // linked-list algorithms' analog of "init"/"graph": declares every node
  // up front, in the order they sit left-to-right on screen. Unlike
  // "graph"'s edges, a list's links are directed and change over an
  // algorithm's lifetime (a reversal rewires next-pointers one at a
  // time), so they can't be declared here — the *initial* chain is
  // implied by array order (node i -> node i+1, last -> null), and every
  // change after that goes through "relink".
  | { type: "list"; nodes: { id: string; value: number }[] }
  // Rewires exactly one node's next-pointer. `to: null` means "points at
  // nothing" and must render, not be treated as "no change" — a
  // reversal's very first relink is prev (starting at null) receiving
  // curr, and curr's own next has to visibly become the old prev.
  | { type: "relink"; from: string; to: string | null }
  // Named pointers into the list (head/prev/curr/next/...), the list
  // analog of "pointer" — kept separate from "pointer" because that type
  // is read by ArrayView against array *indices*, not node ids, and
  // reusing it would make the same field mean two different things
  // depending on which view is mounted.
  | { type: "listPointer"; name: string; node: string | null }
  // The list analog of a "focus" highlight — replaces the focused node
  // set wholesale (mirroring how "highlight" with style "focus" clears
  // stale focus) and is this structure's step boundary (src/spec/beats.ts).
  | { type: "listFocus"; nodes: string[] }
  | { type: "done"; result?: number | string };

export interface AlgorithmResult {
  operations: Operation[];
  summary: string;
}

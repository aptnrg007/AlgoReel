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
  // The node/link analog of "init": declares every node up front, in
  // declaration order, plus which layout the renderer should place them
  // with (StructureView / remotion/primitives/layout.ts). One vocabulary
  // now covers what used to be two separate ones (graph's "graph" op,
  // linked-list's "list" op) — a linked list, a tree, a graph, and a
  // stack are all "nodes plus links between them," differing only in
  // *how they're arranged* (layout) and *what links look like* (directed
  // vs undirected, declared here vs one at a time). Kept as its own type
  // rather than folded into "init" because its payload shape is
  // fundamentally different from an array, not just a variant of it.
  | {
      type: "struct";
      layout: LayoutKind;
      nodes: { id: string; value: string | number }[];
      // Undirected structures (a "circle" layout graph) declare their
      // full, fixed edge set here, up front — the same way "init" gives
      // an array a fixed set of cells from frame 0. Undirected edges
      // never move, so unlike a directed structure's links (rewired one
      // at a time via "link"), there's nothing to address by (from, slot)
      // later. Directed structures (row/column/levels) leave this empty
      // and build their links up via "link" instead.
      edges?: [string, string][];
    }
  // One directed link, addressed by (from, slot) rather than just
  // (from, to) — a plain linked list only ever has one outgoing link per
  // node ("next"), but a tree needs "left" and "right", a doubly linked
  // list needs "next" and "prev". `to: null` means "points at nothing"
  // and must render, not be treated as "no change" (a reversal's first
  // link is prev, starting at null, receiving curr). Undirected
  // structures (graphs) declare their fixed edge set up front in
  // "struct" instead of using "link" at all — an undirected edge doesn't
  // have a "from" to rewire.
  | { type: "link"; from: string; slot: string; to: string | null }
  // A node's visual state — the node analog of "highlight", including
  // its exact "focus" behavior (a spotlight on whatever's currently
  // under scrutiny, cleared from every other node the moment a new one
  // arrives) and this structure's step boundary (src/spec/beats.ts).
  // A separate "nodeFocus" set was tried and rejected while building
  // this: keeping focus as its own field, independent of a node's
  // persistent state, let a later "done"/"dead" on that same node get
  // masked by a stale, unrelated "focus" that nothing had cleared yet
  // (nothing changes the focus set until the *next* explicit focus
  // call). One map avoids that by construction, the same way
  // "highlight" already avoids it for arrays. Maps onto the five locked
  // color roles (tokens.ts): pending -> pointer, done -> found,
  // dead -> discarded.
  | { type: "nodeState"; nodes: string[]; state: "focus" | "pending" | "done" | "dead" }
  // A link's persistent visual state, the link analog of "nodeState" —
  // kept separate from "link" itself because rewiring *where* a link
  // points and marking it *visually active* are different events (a
  // graph's edges never move, but do light up as "active" then settle to
  // "used" the same way a node settles from active to done).
  | { type: "linkState"; from: string; to: string; state: "active" | "used" }
  // Named pointers into a structure (head/prev/curr/next/... for a list,
  // or a graph's implicit "current" node), the node analog of "pointer"
  // — kept separate from "pointer" because that type is read by
  // ArrayView against array *indices*, not node ids, and reusing it
  // would make the same field mean two different things depending on
  // which view is mounted.
  | { type: "nodePointer"; name: string; node: string | null }
  | { type: "done"; result?: number | string };

// Every structure this renderer knows how to draw is "nodes plus links,"
// differing only in how the nodes are arranged on screen — an algorithm
// declares which one it needs via "struct"'s layout field.
export type LayoutKind = "row" | "column" | "levels" | "circle";

export interface AlgorithmResult {
  operations: Operation[];
  summary: string;
}

import type { AlgorithmResult, Operation } from "./types";

export interface InorderTraversalInput {
  // Level-order (heap-style) representation of a complete binary tree:
  // index i's children live at 2i+1 and 2i+2. Chosen over an arbitrary
  // {value,left,right} JSON shape because it needs no separate validation
  // pass (every index either has a value or doesn't exist) and is the
  // same representation a heap already uses.
  tree: number[];
}

/**
 * Pure, deterministic — same boundary as reverseLinkedList.ts/bfs.ts
 * (PLAN.md §2). This is Phase 2's proof case for the generic structure
 * engine (remotion/primitives/layout.ts, StructureView.tsx): a binary
 * tree is just a "levels"-layout node/link structure, no different in
 * kind from a linked list's "row" or a graph's "circle" — this file adds
 * zero new Operation variants and the renderer needs zero changes to
 * support it.
 *
 * In-order (left, node, right) — no comparisons, no values used to
 * decide anything, purely a traversal. The tree's shape is fixed and
 * known up front (unlike an evolving structure like a reversed list), so
 * every "link" is declared immediately after "struct", the same way
 * bfs.ts declares its full edge set immediately after "struct".
 */
export function inorderTraversal({ tree }: InorderTraversalInput): AlgorithmResult {
  const ids = tree.map((_, i) => `n${i}`);
  const nodes = tree.map((value, i) => ({ id: ids[i]!, value }));

  const operations: Operation[] = [{ type: "struct", layout: "levels", nodes }];
  for (let i = 0; i < tree.length; i++) {
    const leftIndex = 2 * i + 1;
    const rightIndex = 2 * i + 2;
    if (leftIndex < tree.length) operations.push({ type: "link", from: ids[i]!, slot: "left", to: ids[leftIndex]! });
    if (rightIndex < tree.length) operations.push({ type: "link", from: ids[i]!, slot: "right", to: ids[rightIndex]! });
  }

  const order: number[] = [];
  function visit(i: number): void {
    if (i >= tree.length) return;
    visit(2 * i + 1);
    // "focus" is the step boundary (src/spec/beats.ts) — one primary step
    // per node visited, the tree analog of one rewired pointer in
    // reverseLinkedList or one node processed in bfs.
    operations.push({ type: "nodeState", nodes: [ids[i]!], state: "focus" });
    operations.push({ type: "nodeState", nodes: [ids[i]!], state: "done" });
    order.push(tree[i]!);
    visit(2 * i + 2);
  }
  visit(0);

  operations.push({ type: "done" });

  const summary =
    `In-order traversal of a ${tree.length}-node binary tree visits left subtree, node, then right subtree, ` +
    `recursively — producing this order: ${order.join(", ")}. No values are compared; this is a pure walk.`;

  return { operations, summary };
}

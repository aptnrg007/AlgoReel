import { inferLayout } from "../../remotion/primitives/layout";
import type { AlgorithmResult, Operation } from "./types";

export interface BstInsertInput {
  // Inserted one at a time, in order — the first value becomes the root.
  values: number[];
}

/**
 * Pure, deterministic — same boundary as reverseLinkedList.ts/bfs.ts/
 * inorderTraversal.ts/checkBalancedParens.ts (PLAN.md §2). The proof case
 * for tree *mutation*: inorderTraversal already proved a binary tree is
 * just a "levels"-layout structure, but only ever walked a tree that
 * existed complete from frame 0. This is the first hand-written algorithm
 * whose tree grows one node at a time — the same category of change
 * checkBalancedParens already proved for a stack (re-declaring "struct"
 * as the node set itself changes, not just states/links) — so this file
 * adds zero new Operation variants and the renderer needs zero changes
 * to support it either.
 *
 * Each insert walks down from the root, comparing the new value against
 * the current node (smaller goes left, larger goes right — duplicates
 * are rejected up front, the same way a real BST never has a meaningful
 * answer for "insert a value already present"), until it reaches an
 * empty child slot. "struct" is only re-declared once that slot is
 * found — the new node's id is added to the running set and linked in
 * the same beat as the last comparison, never appearing unlinked or
 * floating. A short dedicated focus/done step on the new node afterward
 * gives it its own "found the spot" beat, distinct from the walk-down
 * comparisons.
 */
export function bstInsert({ values }: BstInsertInput): AlgorithmResult {
  if (values.length === 0) {
    throw new Error("bstInsert requires at least one value");
  }
  if (new Set(values).size !== values.length) {
    throw new Error("bstInsert requires distinct values — a real BST has nothing meaningful to do with a duplicate");
  }

  const ids: string[] = [];
  const valueOf = new Map<string, number>();
  const leftOf = new Map<string, string | null>();
  const rightOf = new Map<string, string | null>();
  const operations: Operation[] = [];

  const declareStruct = (): void => {
    operations.push({
      type: "struct",
      layout: inferLayout("tree"),
      nodes: ids.map((id) => ({ id, value: valueOf.get(id)! })),
    });
  };

  let root: string | null = null;

  for (let i = 0; i < values.length; i++) {
    const id = `n${i}`;
    const value = values[i]!;
    valueOf.set(id, value);
    leftOf.set(id, null);
    rightOf.set(id, null);

    if (root === null) {
      root = id;
      ids.push(id);
      declareStruct();
      operations.push({ type: "nodeState", nodes: [id], state: "focus" });
      operations.push({ type: "nodeState", nodes: [id], state: "done" });
      continue;
    }

    let cur = root;
    for (;;) {
      operations.push({ type: "nodeState", nodes: [cur], state: "focus" });
      const goLeft = value < valueOf.get(cur)!;
      const child = goLeft ? leftOf.get(cur)! : rightOf.get(cur)!;
      if (child === null) {
        ids.push(id);
        declareStruct();
        operations.push({ type: "link", from: cur, slot: goLeft ? "left" : "right", to: id });
        if (goLeft) leftOf.set(cur, id);
        else rightOf.set(cur, id);
        break;
      }
      cur = child;
    }
    operations.push({ type: "nodeState", nodes: [id], state: "focus" });
    operations.push({ type: "nodeState", nodes: [id], state: "done" });
  }

  // In-order traversal of the finished tree doubles as the correctness
  // signal a viewer can check by eye: a BST's in-order walk always comes
  // back sorted, regardless of insertion order.
  const order: number[] = [];
  function visit(id: string | null): void {
    if (id === null) return;
    visit(leftOf.get(id) ?? null);
    order.push(valueOf.get(id)!);
    visit(rightOf.get(id) ?? null);
  }
  visit(root);

  operations.push({ type: "done", result: order.join(", ") });

  const summary =
    `Inserted ${values.length} value${values.length === 1 ? "" : "s"} into a binary search tree one at a time, ` +
    `each walking down from the root — smaller goes left, larger goes right — until it found an empty slot to ` +
    `attach to. Reading the finished tree in-order gives back a sorted sequence: ${order.join(", ")}.`;

  return { operations, summary };
}

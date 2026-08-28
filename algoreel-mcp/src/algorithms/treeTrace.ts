import { inferLayout } from "../../remotion/primitives/layout";
import type { Operation } from "./types";

// The instrumentation boundary for generated binary-search-tree-shaped
// algorithms — one level up the determinism boundary (PLAN.md §2), the
// tree-shaped twin of trace.ts's TracedArray and graphTrace.ts's
// TracedGraph. An LLM never emits an Operation directly, it writes
// ordinary-looking code against this API instead, and every meaningful
// action is logged as a side effect.
//
// Scoped narrowly on purpose, the same way TracedGraph is scoped to
// bfs/dfs rather than "graphs in general": this supports building an
// ordered binary tree by inserting values one at a time (bstInsert.ts's
// hand-written proof case is the reference this mirrors), not tree
// algorithms in general. Deletion, rotation, and any non-BST tree shape
// are out of scope — see sandbox.ts's oracle for why insertion-only is
// what actually has a cheap, reference-free correctness check
// (invariants.ts's isOrderedBst + isSameMultiset).
export interface TracedTree {
  // The full sequence of values to insert, in order — values[0] becomes
  // the root. Read-only; submitted code never invents its own values.
  readonly values: readonly number[];
  isEmpty(): boolean;
  // Throws if the tree has no root yet — call insertRoot() first.
  root(): string;
  valueOf(id: string): number;
  left(id: string): string | null;
  right(id: string): string | null;
  // Marks a node as currently under comparison — the step boundary
  // (src/spec/beats.ts), used while walking down deciding which way to
  // go. Does not by itself create or finalize anything.
  focus(id: string): void;
  // Creates the tree's first node from values[index]. Call exactly once,
  // only while isEmpty() is true.
  insertRoot(index: number): string;
  // Creates a node from values[index] and attaches it as the left or
  // right child of `parent` — the only way any node after the root
  // enters the tree. Throws if `parent` already has a child on that
  // side (a real BST insert never overwrites an existing child).
  insertChild(parent: string, side: "left" | "right", index: number): string;
}

export function createTracedTree(values: number[]): { trace: TracedTree; operations: Operation[] } {
  const operations: Operation[] = [];
  const ids: string[] = [];
  const valueOf = new Map<string, number>();
  const leftOf = new Map<string, string | null>();
  const rightOf = new Map<string, string | null>();
  let rootId: string | null = null;

  const declareStruct = (): void => {
    operations.push({
      type: "struct",
      layout: inferLayout("tree"),
      nodes: ids.map((id) => ({ id, value: valueOf.get(id)! })),
    });
  };

  // A newly created node's own "focus" + "done" pair, the same "settle
  // in one call" shape TracedGraph.visit() already uses — insertRoot/
  // insertChild are the only things that call this, so a node's
  // creation and its step-boundary marking can never drift apart.
  const settle = (id: string): void => {
    operations.push({ type: "nodeState", nodes: [id], state: "focus" });
    operations.push({ type: "nodeState", nodes: [id], state: "done" });
  };

  const createNode = (index: number): string => {
    const value = values[index];
    if (value === undefined) throw new Error(`values[${index}] is out of range (values has ${values.length} entries)`);
    const id = `n${index}`;
    if (valueOf.has(id)) throw new Error(`values[${index}] was already inserted`);
    valueOf.set(id, value);
    leftOf.set(id, null);
    rightOf.set(id, null);
    ids.push(id);
    return id;
  };

  const trace: TracedTree = {
    values: [...values],
    isEmpty() {
      return rootId === null;
    },
    root() {
      if (rootId === null) throw new Error("tree is empty — call insertRoot() first");
      return rootId;
    },
    valueOf(id) {
      const value = valueOf.get(id);
      if (value === undefined) throw new Error(`unknown node id "${id}"`);
      return value;
    },
    left(id) {
      return leftOf.get(id) ?? null;
    },
    right(id) {
      return rightOf.get(id) ?? null;
    },
    focus(id) {
      if (!valueOf.has(id)) throw new Error(`unknown node id "${id}"`);
      operations.push({ type: "nodeState", nodes: [id], state: "focus" });
    },
    insertRoot(index) {
      if (rootId !== null) throw new Error("insertRoot() called but the tree already has a root");
      const id = createNode(index);
      rootId = id;
      declareStruct();
      settle(id);
      return id;
    },
    insertChild(parent, side, index) {
      if (!valueOf.has(parent)) throw new Error(`unknown parent id "${parent}"`);
      const existingChild = side === "left" ? leftOf.get(parent) : rightOf.get(parent);
      if (existingChild) throw new Error(`node "${parent}" already has a ${side} child`);
      const id = createNode(index);
      if (side === "left") leftOf.set(parent, id);
      else rightOf.set(parent, id);
      declareStruct();
      operations.push({ type: "link", from: parent, slot: side, to: id });
      settle(id);
      return id;
    },
  };

  return { trace, operations };
}

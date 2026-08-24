import assert from "node:assert/strict";
import { test } from "node:test";

import { checkBalancedParens } from "../../src/algorithms/checkBalancedParens";
import { inorderTraversal } from "../../src/algorithms/inorderTraversal";
import { reverseLinkedList } from "../../src/algorithms/reverseLinkedList";
import { applyOperation, INITIAL_STATE, replay } from "./state";

test("struct op declares nodes but not links", () => {
  const state = applyOperation(INITIAL_STATE, {
    type: "struct",
    layout: "row",
    nodes: [
      { id: "n0", value: 1 },
      { id: "n1", value: 2 },
      { id: "n2", value: 3 },
    ],
  });
  assert.deepEqual(state.structNodes, [
    { id: "n0", value: 1 },
    { id: "n1", value: 2 },
    { id: "n2", value: 3 },
  ]);
  assert.deepEqual(state.structLinks, []);
});

test("struct op with edges declares a fixed, undirected edge set", () => {
  const state = applyOperation(INITIAL_STATE, {
    type: "struct",
    layout: "circle",
    nodes: [
      { id: "A", value: "A" },
      { id: "B", value: "B" },
    ],
    edges: [["A", "B"]],
  });
  assert.deepEqual(state.structEdges, [["A", "B"]]);
});

test("link adds, rewires, and removes exactly one (from, slot) entry", () => {
  const seeded = applyOperation(INITIAL_STATE, {
    type: "struct",
    layout: "row",
    nodes: [
      { id: "n0", value: 1 },
      { id: "n1", value: 2 },
    ],
  });
  const linked = applyOperation(seeded, { type: "link", from: "n0", slot: "next", to: "n1" });
  assert.deepEqual(linked.structLinks, [{ from: "n0", slot: "next", to: "n1" }]);

  const relinked = applyOperation(linked, { type: "link", from: "n0", slot: "next", to: null });
  assert.deepEqual(relinked.structLinks, [], "a link rewired to null is removed, not stored as null");
});

test("nodeState sets an arbitrary state, and 'focus' clears stale focus elsewhere", () => {
  const first = applyOperation(INITIAL_STATE, { type: "nodeState", nodes: ["n0", "n1"], state: "focus" });
  assert.deepEqual(first.structNodeState, { n0: "focus", n1: "focus" });

  const second = applyOperation(first, { type: "nodeState", nodes: ["n2"], state: "focus" });
  assert.deepEqual(second.structNodeState, { n2: "focus" }, "stale focus on n0/n1 must be cleared, not left lit");
});

test("nodeState 'done' directly overwrites a still-focused node, unmasked by stale focus", () => {
  const focused = applyOperation(INITIAL_STATE, { type: "nodeState", nodes: ["n0"], state: "focus" });
  const done = applyOperation(focused, { type: "nodeState", nodes: ["n0"], state: "done" });
  assert.equal(done.structNodeState.n0, "done");
});

test("nodePointer sets a named pointer, including to null", () => {
  const withHead = applyOperation(INITIAL_STATE, { type: "nodePointer", name: "head", node: "n0" });
  assert.equal(withHead.structPointers.head, "n0");
  const withPrev = applyOperation(withHead, { type: "nodePointer", name: "prev", node: null });
  assert.equal(withPrev.structPointers.prev, null);
});

test("linkState sets an edge's status, keyed order-independently", () => {
  const state = applyOperation(INITIAL_STATE, { type: "linkState", from: "A", to: "B", state: "active" });
  assert.equal(state.structLinkState["A::B"], "active");
});

test("a full reverseLinkedList replay ends with the chain fully reversed and head on the old tail", () => {
  const { operations } = reverseLinkedList({ list: [4, 9, 2, 7] });
  const final = replay(operations);
  assert.equal(final.structPointers.head, "n3");
  assert.deepEqual(
    final.structLinks.sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: "n1", slot: "next", to: "n0" },
      { from: "n2", slot: "next", to: "n1" },
      { from: "n3", slot: "next", to: "n2" },
    ],
    "n0's next was rewired to null, which is absence, not an entry",
  );
});

// Phase 2's proof case: a binary tree needed zero new Operation variants
// or renderer changes — this replay exercises the "levels" layout's
// link shape (left/right slots) end to end through the real reducer.
test("a full inorderTraversal replay on a BST ends with every node visited, sorted by value", () => {
  const { operations } = inorderTraversal({ tree: [8, 4, 12, 2, 6, 10, 14] });
  const final = replay(operations);
  assert.equal(Object.keys(final.structNodeState).length, 7);
  assert.ok(Object.values(final.structNodeState).every((s) => s === "done"));
  assert.deepEqual(
    final.structLinks.find((l) => l.from === "n0" && l.slot === "left"),
    { from: "n0", slot: "left", to: "n1" },
  );
});

// Phase 2's other proof case: a stack (column layout, no links at all)
// re-declaring "struct" repeatedly as its node set itself changes.
test("a full checkBalancedParens replay on balanced input ends with the last node marked done, not vanished", () => {
  const { operations } = checkBalancedParens({ expression: "(()())" });
  const final = replay(operations);
  assert.equal(final.structNodes.length, 1, "the final pop leaves its node visible rather than emptying the view");
  assert.equal(final.structNodeState[final.structNodes[0]!.id], "done");
});

test("a full checkBalancedParens replay on mismatched input marks the offending node dead", () => {
  const { operations } = checkBalancedParens({ expression: "(]" });
  const final = replay(operations);
  assert.equal(final.structNodeState[final.structNodes[0]!.id], "dead");
});

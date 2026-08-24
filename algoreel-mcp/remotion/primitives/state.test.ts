import assert from "node:assert/strict";
import { test } from "node:test";

import { reverseLinkedList } from "../../src/algorithms/reverseLinkedList";
import { applyOperation, INITIAL_STATE, replay } from "./state";

test("list op seeds nodes and the implied forward chain", () => {
  const state = applyOperation(INITIAL_STATE, {
    type: "list",
    nodes: [
      { id: "n0", value: 1 },
      { id: "n1", value: 2 },
      { id: "n2", value: 3 },
    ],
  });
  assert.deepEqual(state.listNodes, [
    { id: "n0", value: 1 },
    { id: "n1", value: 2 },
    { id: "n2", value: 3 },
  ]);
  assert.deepEqual(state.listNext, { n0: "n1", n1: "n2", n2: null });
});

test("relink rewires exactly one node's next pointer, including to null", () => {
  const seeded = applyOperation(INITIAL_STATE, {
    type: "list",
    nodes: [
      { id: "n0", value: 1 },
      { id: "n1", value: 2 },
    ],
  });
  const relinked = applyOperation(seeded, { type: "relink", from: "n0", to: null });
  assert.deepEqual(relinked.listNext, { n0: null, n1: null });
});

test("listPointer sets a named pointer, including to null", () => {
  const withHead = applyOperation(INITIAL_STATE, { type: "listPointer", name: "head", node: "n0" });
  assert.equal(withHead.listPointers.head, "n0");
  const withPrev = applyOperation(withHead, { type: "listPointer", name: "prev", node: null });
  assert.equal(withPrev.listPointers.prev, null);
});

test("listFocus replaces the focused set wholesale", () => {
  const first = applyOperation(INITIAL_STATE, { type: "listFocus", nodes: ["n0", "n1"] });
  assert.deepEqual([...first.listFocus], ["n0", "n1"]);
  const second = applyOperation(first, { type: "listFocus", nodes: ["n2"] });
  assert.deepEqual([...second.listFocus], ["n2"]);
});

test("a full reverseLinkedList replay ends with the chain fully reversed and head on the old tail", () => {
  const { operations } = reverseLinkedList({ list: [4, 9, 2, 7] });
  const final = replay(operations);
  assert.equal(final.listPointers.head, "n3");
  assert.deepEqual(final.listNext, { n0: null, n1: "n0", n2: "n1", n3: "n2" });
});

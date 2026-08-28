import assert from "node:assert/strict";
import { test } from "node:test";

import { createTracedTree } from "./treeTrace";

const VALUES = [50, 30, 70];

test("insertRoot creates the first node, struct-declaring just it, then settling it", () => {
  const { trace, operations } = createTracedTree(VALUES);
  const id = trace.insertRoot(0);
  assert.equal(id, "n0");
  assert.equal(trace.root(), "n0");
  assert.deepEqual(operations, [
    { type: "struct", layout: "levels", nodes: [{ id: "n0", value: 50 }] },
    { type: "nodeState", nodes: ["n0"], state: "focus" },
    { type: "nodeState", nodes: ["n0"], state: "done" },
  ]);
});

test("insertRoot throws if called twice", () => {
  const { trace } = createTracedTree(VALUES);
  trace.insertRoot(0);
  assert.throws(() => trace.insertRoot(1), /already has a root/);
});

test("insertChild attaches a new node and re-declares struct with the full node set", () => {
  const { trace, operations } = createTracedTree(VALUES);
  trace.insertRoot(0);
  const id = trace.insertChild("n0", "left", 1);
  assert.equal(id, "n1");
  assert.equal(trace.left("n0"), "n1");
  assert.equal(trace.right("n0"), null);
  assert.deepEqual(operations.slice(3), [
    {
      type: "struct",
      layout: "levels",
      nodes: [
        { id: "n0", value: 50 },
        { id: "n1", value: 30 },
      ],
    },
    { type: "link", from: "n0", slot: "left", to: "n1" },
    { type: "nodeState", nodes: ["n1"], state: "focus" },
    { type: "nodeState", nodes: ["n1"], state: "done" },
  ]);
});

test("insertChild throws when the target slot is already occupied", () => {
  const { trace } = createTracedTree(VALUES);
  trace.insertRoot(0);
  trace.insertChild("n0", "left", 1);
  assert.throws(() => trace.insertChild("n0", "left", 2), /already has a left child/);
});

test("focus logs a standalone nodeState focus, with no matching done", () => {
  const { trace, operations } = createTracedTree(VALUES);
  trace.insertRoot(0);
  trace.focus("n0");
  assert.deepEqual(operations.slice(3), [{ type: "nodeState", nodes: ["n0"], state: "focus" }]);
});

test("focus on an unknown id throws", () => {
  const { trace } = createTracedTree(VALUES);
  trace.insertRoot(0);
  assert.throws(() => trace.focus("nowhere"), /unknown node id/);
});

test("isEmpty reflects whether insertRoot has been called", () => {
  const { trace } = createTracedTree(VALUES);
  assert.equal(trace.isEmpty(), true);
  trace.insertRoot(0);
  assert.equal(trace.isEmpty(), false);
});

test("root() throws before insertRoot has been called", () => {
  const { trace } = createTracedTree(VALUES);
  assert.throws(() => trace.root(), /tree is empty/);
});

test("insertChild on an unknown parent throws", () => {
  const { trace } = createTracedTree(VALUES);
  trace.insertRoot(0);
  assert.throws(() => trace.insertChild("nowhere", "left", 1), /unknown parent id/);
});

test("values is exposed on the trace, unchanged", () => {
  const { trace } = createTracedTree(VALUES);
  assert.deepEqual(trace.values, VALUES);
});

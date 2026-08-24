import assert from "node:assert/strict";
import { test } from "node:test";

import { createTracedGraph } from "./graphTrace";

const NODES = ["A", "B", "C"];
const EDGES: [string, string][] = [
  ["A", "B"],
  ["B", "C"],
];

test("the first operation is always struct, declaring nodes and the fixed edge set", () => {
  const { operations } = createTracedGraph(NODES, EDGES, "A");
  assert.deepEqual(operations[0], {
    type: "struct",
    layout: "circle",
    nodes: [
      { id: "A", value: "A" },
      { id: "B", value: "B" },
      { id: "C", value: "C" },
    ],
    edges: EDGES,
  });
});

test("neighbors are sorted ascending regardless of edge declaration order", () => {
  const { trace } = createTracedGraph(["A", "B", "C"], [
    ["C", "A"],
    ["B", "A"],
  ], "A");
  assert.deepEqual(trace.neighbors("A"), ["B", "C"]);
});

test("isVisited reflects visit() calls, false until then", () => {
  const { trace } = createTracedGraph(NODES, EDGES, "A");
  assert.equal(trace.isVisited("B"), false);
  trace.visit("B");
  assert.equal(trace.isVisited("B"), true);
});

test("visit logs a focus nodeState then a done nodeState, for that node", () => {
  const { trace, operations } = createTracedGraph(NODES, EDGES, "A");
  trace.visit("B");
  assert.deepEqual(operations.slice(1), [
    { type: "nodeState", nodes: ["B"], state: "focus" },
    { type: "nodeState", nodes: ["B"], state: "done" },
  ]);
});

test("traverseEdge logs an active linkState for exactly that pair", () => {
  const { trace, operations } = createTracedGraph(NODES, EDGES, "A");
  trace.traverseEdge("A", "B");
  assert.deepEqual(operations.slice(1), [{ type: "linkState", from: "A", to: "B", state: "active" }]);
});

test("start is exposed on the trace, unchanged", () => {
  const { trace } = createTracedGraph(NODES, EDGES, "C");
  assert.equal(trace.start, "C");
});

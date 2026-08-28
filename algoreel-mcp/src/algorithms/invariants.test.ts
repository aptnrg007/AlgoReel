import assert from "node:assert/strict";
import { test } from "node:test";

import { bfs } from "./bfs";
import { bstInsert } from "./bstInsert";
import { bubbleSort } from "./bubbleSort";
import { runAlgorithmByName } from "./index";
import {
  buildAdjacency,
  finalArrayFromTrace,
  isOrderedBst,
  isSameMultiset,
  isSorted,
  matchesQueueDiscipline,
  matchesStackDiscipline,
  parentConsistency,
  reachableAll,
  satisfiesShortestPathCertificate,
  structSnapshotFromTrace,
  visitOrderFromTrace,
} from "./invariants";

// --- array family: reproduces sandbox.ts's real oracle ---
// ("does the result equal the input sorted ascending" is, exactly,
// isSorted(result) && isSameMultiset(input, result) — this proves the
// equivalence against bubbleSort's real trace, not a synthetic array.)

test("array: isSorted + isSameMultiset accept bubbleSort's real output", () => {
  const input = [38, 12, 27, 5, 43, 9];
  const { operations } = bubbleSort({ array: input });
  const result = finalArrayFromTrace(operations);
  assert.ok(isSorted(result));
  assert.ok(isSameMultiset(input, result));
  assert.deepEqual(result, [...input].sort((a, b) => a - b));
});

test("array: the pair rejects a wrong result the same way sandbox.ts's oracle would", () => {
  const input = [3, 1, 2];
  assert.ok(!isSorted([3, 1, 2]), "not sorted -> rejected");
  assert.ok(!isSameMultiset(input, [1, 2, 2]), "wrong multiset (dropped a 3, duplicated a 2) -> rejected");
  assert.ok(!isSameMultiset(input, [1, 2]), "wrong length -> rejected");
});

// --- tree family: no reference BST-insert implementation anywhere below ---

test("tree: isOrderedBst + isSameMultiset accept bstInsert's real output, shape-only", () => {
  const values = [50, 30, 70, 20, 40, 65, 80];
  const { operations } = bstInsert({ values });
  const snapshot = structSnapshotFromTrace(operations);
  assert.ok(isOrderedBst(snapshot));
  assert.ok(isSameMultiset(values, snapshot.nodes.map((n) => Number(n.value))));
});

test("tree: isOrderedBst rejects a hand-built tree that violates BST ordering", () => {
  // root=50, left=60 (WRONG — a left child must be < its parent)
  const broken = {
    nodes: [
      { id: "a", value: 50 },
      { id: "b", value: 60 },
    ],
    links: [{ from: "a", slot: "left", to: "b" }],
  };
  assert.ok(!isOrderedBst(broken));
});

test("tree: isOrderedBst rejects a right subtree with a value smaller than an ancestor's left bound", () => {
  // root=50 -> right=70 -> left=40 (WRONG — 40 must be > 50, the whole
  // right subtree's lower bound, not just > 70's own left check)
  const broken = {
    nodes: [
      { id: "a", value: 50 },
      { id: "b", value: 70 },
      { id: "c", value: 40 },
    ],
    links: [
      { from: "a", slot: "right", to: "b" },
      { from: "b", slot: "left", to: "c" },
    ],
  };
  assert.ok(!isOrderedBst(broken));
});

// --- graph family: reachability/parent-consistency are reference-free; ---
// --- discipline checks are not (see invariants.ts's header comment)    ---

test("graph: reachableAll + parentConsistency hold for bfs.ts's real trace", () => {
  const nodes = ["A", "B", "C", "D", "E"];
  const edges: [string, string][] = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["C", "E"]];
  const start = "A";
  const { operations } = bfs({ nodes, edges, start });
  const visitOrder = visitOrderFromTrace(operations);
  const adjacency = buildAdjacency(nodes, edges);
  assert.ok(reachableAll(adjacency, start, visitOrder));
  assert.ok(parentConsistency(adjacency, start, visitOrder));
});

test("graph: matchesQueueDiscipline accepts real BFS and rejects real DFS on the same graph", () => {
  const nodes = ["A", "B", "C", "D"];
  const edges: [string, string][] = [["A", "B"], ["A", "C"], ["B", "D"]];
  const start = "A";
  const adjacency = buildAdjacency(nodes, edges);

  const bfsOrder = visitOrderFromTrace(bfs({ nodes, edges, start }).operations);
  assert.deepEqual(bfsOrder, ["A", "B", "C", "D"]);
  assert.ok(matchesQueueDiscipline(adjacency, start, bfsOrder));
  assert.ok(!matchesStackDiscipline(adjacency, start, bfsOrder), "a real BFS order must not also satisfy stack discipline");

  // The real, permanently committed generated-graph/dfs.ts (PLAN.md §10),
  // run through the public registry exactly like any hand-written
  // algorithm — not a fixture string.
  const dfsResult = runAlgorithmByName("dfs", { nodes, edges, start });
  const dfsOrder = visitOrderFromTrace(dfsResult.operations);
  assert.deepEqual(dfsOrder, ["A", "B", "D", "C"]);
  assert.ok(matchesStackDiscipline(adjacency, start, dfsOrder));
  assert.ok(!matchesQueueDiscipline(adjacency, start, dfsOrder), "a real DFS order must not also satisfy queue discipline");

  // The honest limit this file's header comment documents: reachability
  // alone cannot tell BFS and DFS apart — both are valid traversals of
  // the same graph, just in a different order.
  assert.ok(reachableAll(adjacency, start, dfsOrder));
  assert.ok(parentConsistency(adjacency, start, dfsOrder));
});

// --- shortest-path family: a real, standalone certificate (no algorithm ---
// --- in this codebase produces one yet — validated directly)           ---

test("shortest-path: a correct distance assignment satisfies the relaxation certificate", () => {
  // A -1- B -2- C, and A -5- C directly. Correct shortest distances from
  // A: A=0, B=1, C=3 (via B, not the direct 5-weight edge).
  const nodeIds = ["A", "B", "C"];
  const edges = [
    { from: "A", to: "B", weight: 1 },
    { from: "B", to: "C", weight: 2 },
    { from: "A", to: "C", weight: 5 },
  ];
  const dist = { A: 0, B: 1, C: 3 };
  assert.ok(satisfiesShortestPathCertificate(nodeIds, edges, "A", dist));
});

test("shortest-path: a distance that violates the triangle inequality is rejected", () => {
  const nodeIds = ["A", "B", "C"];
  const edges = [
    { from: "A", to: "B", weight: 1 },
    { from: "B", to: "C", weight: 2 },
    { from: "A", to: "C", weight: 5 },
  ];
  // C claimed at 5 (the direct edge) while a real path of length 3
  // exists via B — a real Dijkstra would never emit this, and the
  // certificate catches it without knowing that.
  const wrong = { A: 0, B: 1, C: 5 };
  assert.ok(!satisfiesShortestPathCertificate(nodeIds, edges, "A", wrong));
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { generateAndValidateGraphAlgorithm } from "./sandbox";
import { GenerateAlgorithmError } from "./sandbox";
import { restoreDir, snapshotDir } from "./testGeneratedDirSnapshot";

const GENERATED_GRAPH_DIR = join(dirname(fileURLToPath(import.meta.url)), "generated-graph");

// Captured once, at import time — before this file's before() hook or
// any test has run — so it reflects exactly what's really on disk/
// committed (including the real, permanent generated-graph/dfs.ts, see
// the "dfs" note below), not a hardcoded assumption. See
// testGeneratedDirSnapshot.ts for why that distinction matters. Note
// this only fixes the *disk* — index.ts's module-level registration loop
// already ran once at this process's startup against whatever was on
// disk before this file's before() hook ever fires (ES module evaluation
// happens before any test code runs), so a real committed file is in the
// in-memory registry for this whole process regardless. That's exactly
// the "dfs" situation below, not a bug in this reset.
const ORIGINAL_GENERATED_GRAPH = snapshotDir(GENERATED_GRAPH_DIR);

function resetGeneratedGraphDir(): void {
  restoreDir(GENERATED_GRAPH_DIR, ORIGINAL_GENERATED_GRAPH);
}

// A..D, deliberately small: BFS from A visits [A,B,C,D] (B and C both
// discovered from A, sorted ascending so B first; D discovered from B).
// DFS from A visits [A,B,D,C] (goes all the way down B's branch to D
// before backtracking to try C) — a real, different order from BFS on
// the same graph, so a DFS submitted under the wrong name is guaranteed
// to actually mismatch, not coincidentally match.
const NODES = ["A", "B", "C", "D"];
const EDGES: [string, string][] = [
  ["A", "B"],
  ["A", "C"],
  ["B", "D"],
];
const INPUT = { nodes: NODES, edges: EDGES, start: "A" };

const REAL_BFS = `
function run(trace) {
  const seen = new Set([trace.start]);
  const queue = [trace.start];
  while (queue.length > 0) {
    const node = queue.shift();
    trace.visit(node);
    for (const neighbor of trace.neighbors(node)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        trace.traverseEdge(node, neighbor);
        queue.push(neighbor);
      }
    }
  }
}
`;

const REAL_DFS = `
function run(trace) {
  function visit(node) {
    trace.visit(node);
    for (const neighbor of trace.neighbors(node)) {
      if (!trace.isVisited(neighbor)) {
        trace.traverseEdge(node, neighbor);
        visit(neighbor);
      }
    }
  }
  visit(trace.start);
}
`;

// Correct BFS logic and order, but never calls traverseEdge — exists
// specifically to exercise validator 2, which REAL_BFS/REAL_DFS never do.
const BFS_NO_TRAVERSE_EDGE = `
function run(trace) {
  const seen = new Set([trace.start]);
  const queue = [trace.start];
  while (queue.length > 0) {
    const node = queue.shift();
    trace.visit(node);
    for (const neighbor of trace.neighbors(node)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
}
`;

const INFINITE_LOOP_CODE = `
function run(trace) {
  while (true) { trace.isVisited(trace.start); }
}
`;

const ESCAPE_ATTEMPT_CODE = `
function run(trace) {
  const fs = require("fs");
  trace.visit(fs.readFileSync("/etc/passwd").length.toString());
}
`;

before(resetGeneratedGraphDir);
after(resetGeneratedGraphDir);

// Naming, deliberately, and order-sensitive — read this before touching
// either:
//
// "bfs" collides with the real hand-written bfs.ts from the very first
// test in this process (getAlgorithmByNormalizedName short-circuits to
// it). "dfs" collides too, but for a different reason: a real, live
// codegen run against this exact feature already produced and committed
// a genuine generated-graph/dfs.ts (mirroring generated/cocktailsort.ts
// on the array side) — and because index.ts's module-level registration
// loop runs at import time, before this file's before() hook can reset
// anything, that real "dfs" entry is in the in-memory registry for this
// entire process no matter what. That leaves exactly two usable
// GRAPH_REFERENCE keys: "breadthfirstsearch" and "depthfirstsearch".
//
// Every FAILING test below (order mismatch, missing traverseEdge, a
// hang, an escape attempt) reuses these two freely, because a failed
// attempt never caches anything — but they must all run *before* the two
// SUCCEEDING tests at the bottom, which permanently claim each name for
// the rest of this process the moment they cache a real file. Node's
// test runner executes tests within one file sequentially in declaration
// order by default, which is what makes this ordering reliable — the
// same assumption sandbox.test.ts's array-side fixtures already rely on.

test("an unsupported algorithm name is rejected immediately, before any sandbox run", async () => {
  await assert.rejects(
    generateAndValidateGraphAlgorithm({ name: "dijkstra", description: "t", code: REAL_BFS, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /only supports "bfs" and "dfs"/.test(err.message),
  );
});

test("a real DFS submitted under the name 'breadthfirstsearch' produces the wrong order and is rejected", async () => {
  await assert.rejects(
    generateAndValidateGraphAlgorithm({ name: "breadthfirstsearch", description: "t", code: REAL_DFS, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /produced visit order/.test(err.message),
  );
  assert.ok(!existsSync(join(GENERATED_GRAPH_DIR, "breadthfirstsearch.ts")), "a rejected implementation must not be cached");
});

test("correct traversal order that never calls trace.traverseEdge() is rejected, not just cached with a warning", async () => {
  await assert.rejects(
    generateAndValidateGraphAlgorithm({
      name: "breadthfirstsearch",
      description: "t",
      code: BFS_NO_TRAVERSE_EDGE,
      input: INPUT,
    }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /never called trace\.traverseEdge/.test(err.message),
  );
});

test("an infinite loop is killed and reported as a clean error, not a hang", async () => {
  await assert.rejects(
    generateAndValidateGraphAlgorithm({ name: "breadthfirstsearch", description: "t", code: INFINITE_LOOP_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError,
  );
});

test("code attempting require() is blocked by the sandbox", async () => {
  await assert.rejects(
    generateAndValidateGraphAlgorithm({
      name: "breadthfirstsearch",
      description: "t",
      code: ESCAPE_ATTEMPT_CODE,
      input: INPUT,
    }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /require is not defined/.test(err.message),
  );
});

test("a correct, properly-instrumented BFS passes and caches a file", async () => {
  const result = await generateAndValidateGraphAlgorithm({
    name: "breadthfirstsearch",
    description: "test fixture",
    code: REAL_BFS,
    input: INPUT,
  });
  assert.ok(result.summary.includes("A, B, C, D"));
  assert.ok(existsSync(join(GENERATED_GRAPH_DIR, "breadthfirstsearch.ts")), "expected a cached generated file");
});

test("a correct, properly-instrumented DFS passes and caches a file", async () => {
  const result = await generateAndValidateGraphAlgorithm({
    name: "depthfirstsearch",
    description: "test fixture",
    code: REAL_DFS,
    input: INPUT,
  });
  assert.ok(result.summary.includes("A, B, D, C"));
  assert.ok(existsSync(join(GENERATED_GRAPH_DIR, "depthfirstsearch.ts")), "expected a cached generated file");
});

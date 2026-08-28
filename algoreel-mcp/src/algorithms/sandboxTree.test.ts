import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { generateAndValidateTreeAlgorithm } from "./sandboxTree";
import { GenerateAlgorithmError } from "./sandboxCore";
import { restoreDir, snapshotDir } from "./testGeneratedDirSnapshot";

const GENERATED_TREE_DIR = join(dirname(fileURLToPath(import.meta.url)), "generated-tree");

// Same reset as sandbox.test.ts/sandboxGraph.test.ts, captured for the
// same reason (this file runs as its own process under `node --test`,
// and this directory currently holds nothing but manifest.ts — but the
// snapshot approach means that stays true even once a real tree
// algorithm gets generated and committed here, the same way
// generated/cocktailsort.ts and generated-graph/dfs.ts already are for
// their families). See testGeneratedDirSnapshot.ts.
const ORIGINAL_GENERATED_TREE = snapshotDir(GENERATED_TREE_DIR);

function resetGeneratedTreeDir(): void {
  restoreDir(GENERATED_TREE_DIR, ORIGINAL_GENERATED_TREE);
}

const VALUES = [50, 30, 70, 20, 40, 65, 80];
const INPUT = { values: VALUES };

// Type-annotated, with trace.values[i] asserted non-null — see
// sandbox.test.ts's REAL_MERGE_SORT comment for why the annotation is
// structurally required. The assertion is the real fix for the actual
// bug this whole validator was built to catch (algorithm-tree.yaml's own
// commit): "i < trace.values.length" already guarantees the index is in
// range, the same reasoning a real submission has to get right too.
const REAL_BST_INSERT = `
function run(trace: TracedTree) {
  if (trace.isEmpty()) trace.insertRoot(0);
  for (let i = 1; i < trace.values.length; i++) {
    let cur = trace.root();
    while (true) {
      trace.focus(cur);
      const goLeft = trace.values[i]! < trace.valueOf(cur);
      const child = goLeft ? trace.left(cur) : trace.right(cur);
      if (child === null) {
        trace.insertChild(cur, goLeft ? "left" : "right", i);
        break;
      }
      cur = child;
    }
  }
}
`;

// Correct logic and shape, but never calls trace.focus() while walking
// down — exists specifically to exercise validator 2, which
// REAL_BST_INSERT never does.
const BST_INSERT_NO_FOCUS = `
function run(trace) {
  if (trace.isEmpty()) trace.insertRoot(0);
  for (let i = 1; i < trace.values.length; i++) {
    let cur = trace.root();
    while (true) {
      const goLeft = trace.values[i] < trace.valueOf(cur);
      const child = goLeft ? trace.left(cur) : trace.right(cur);
      if (child === null) {
        trace.insertChild(cur, goLeft ? "left" : "right", i);
        break;
      }
      cur = child;
    }
  }
}
`;

// Ignores every real comparison — attaches each new node as the left
// child of the previous one regardless of value, producing a chain that
// is not a valid BST (a later, larger value ends up left of an earlier,
// smaller one). Exercises validator 1's ordering check.
const WRONG_SHAPE_CODE = `
function run(trace) {
  if (trace.isEmpty()) trace.insertRoot(0);
  let cur = trace.root();
  for (let i = 1; i < trace.values.length; i++) {
    trace.focus(cur);
    trace.insertChild(cur, "left", i);
    cur = trace.left(cur);
  }
}
`;

// Real comparison logic, but stops one value short — produces a
// genuinely valid, ordered BST (validator 1 passes) that's just missing
// the last value. Exercises validator 1's multiset check specifically.
const MISSING_VALUE_CODE = `
function run(trace) {
  if (trace.isEmpty()) trace.insertRoot(0);
  for (let i = 1; i < trace.values.length - 1; i++) {
    let cur = trace.root();
    while (true) {
      trace.focus(cur);
      const goLeft = trace.values[i] < trace.valueOf(cur);
      const child = goLeft ? trace.left(cur) : trace.right(cur);
      if (child === null) {
        trace.insertChild(cur, goLeft ? "left" : "right", i);
        break;
      }
      cur = child;
    }
  }
}
`;

const INFINITE_LOOP_CODE = `
function run(trace) {
  while (true) { trace.isEmpty(); }
}
`;

const ESCAPE_ATTEMPT_CODE = `
function run(trace) {
  const fs = require("fs");
  trace.insertRoot(0);
}
`;

before(resetGeneratedTreeDir);
after(resetGeneratedTreeDir);

// Naming, deliberately: "bstInsert" collides with the real hand-written
// bstInsert.ts from the very first test in this process
// (getAlgorithmByNormalizedName short-circuits to it, the same "bfs"/
// "dfs" situation sandboxGraph.test.ts's own naming note documents) — so
// every test below that actually wants to exercise the sandbox uses
// "binarySearchTreeInsertion" instead, one of TREE_SUPPORTED_NAMES's other
// accepted spellings (sandbox.ts).

test("an unsupported algorithm name is rejected immediately, before any sandbox run", async () => {
  await assert.rejects(
    generateAndValidateTreeAlgorithm({ name: "avlInsert", description: "t", code: REAL_BST_INSERT, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /only supports building a binary search tree/.test(err.message),
  );
});

test("a tree that violates BST ordering is rejected, not cached", async () => {
  await assert.rejects(
    generateAndValidateTreeAlgorithm({ name: "binarySearchTreeInsertion", description: "t", code: WRONG_SHAPE_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /isn't a valid binary search tree/.test(err.message),
  );
  assert.ok(!existsSync(join(GENERATED_TREE_DIR, "binarysearchtreeinsertion.ts")), "a rejected implementation must not be cached");
});

test("a valid BST missing an input value is rejected", async () => {
  await assert.rejects(
    generateAndValidateTreeAlgorithm({ name: "binarySearchTreeInsertion", description: "t", code: MISSING_VALUE_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /must appear exactly once/.test(err.message),
  );
});

test("correct shape and values that never calls trace.focus() is rejected, not just cached with a warning", async () => {
  await assert.rejects(
    generateAndValidateTreeAlgorithm({ name: "binarySearchTreeInsertion", description: "t", code: BST_INSERT_NO_FOCUS, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /never called trace\.focus/.test(err.message),
  );
});

test("an infinite loop is killed and reported as a clean error, not a hang", async () => {
  await assert.rejects(
    generateAndValidateTreeAlgorithm({ name: "binarySearchTreeInsertion", description: "t", code: INFINITE_LOOP_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError,
  );
});

test("code attempting require() is blocked by the sandbox", async () => {
  await assert.rejects(
    generateAndValidateTreeAlgorithm({
      name: "binarySearchTreeInsertion",
      description: "t",
      code: ESCAPE_ATTEMPT_CODE,
      input: INPUT,
    }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /require is not defined/.test(err.message),
  );
});

test("a correct, properly-instrumented BST insert passes and caches a file", async () => {
  const result = await generateAndValidateTreeAlgorithm({
    name: "binarySearchTreeInsertion",
    description: "test fixture",
    code: REAL_BST_INSERT,
    input: INPUT,
  });
  // finalValues is in insertion (id) order, not sorted — snapshot.nodes
  // comes straight from the struct op's declaration order.
  assert.ok(result.summary.includes("50, 30, 70, 20, 40, 65, 80"));
  assert.ok(existsSync(join(GENERATED_TREE_DIR, "binarysearchtreeinsertion.ts")), "expected a cached generated file");
});

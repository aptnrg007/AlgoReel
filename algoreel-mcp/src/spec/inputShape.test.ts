import assert from "node:assert/strict";
import { test } from "node:test";

import { inputShape } from "./inputShape";

test("array shape: input with a plain 'array' field", () => {
  assert.equal(inputShape({ array: [1, 2, 3] }), "array");
});

test("struct shape: every known node/link field name", () => {
  assert.equal(inputShape({ list: [1, 2] }), "struct");
  assert.equal(inputShape({ nodes: ["a"], edges: [] }), "struct");
  assert.equal(inputShape({ tree: [1, 2, 3] }), "struct");
  assert.equal(inputShape({ expression: "(())" }), "struct");
});

// Regression: bstInsert's { values: number[] } input fell through to the
// "array" default (nothing here recognized "values"), and checkRender.ts's
// array-shaped path then crashed reading spec.input.array off an input
// that only ever had .values — found live wiring up the bst-insert-demo
// spec, before this field was added.
test("struct shape: bstInsert's 'values' field", () => {
  assert.equal(inputShape({ values: [50, 30, 70] }), "struct");
});

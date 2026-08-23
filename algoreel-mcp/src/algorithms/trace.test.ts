import assert from "node:assert/strict";
import { test } from "node:test";

import { createTracedArray } from "./trace";

test("get/set/toArray reflect mutations, set logs a write operation", () => {
  const { trace, operations } = createTracedArray([5, 3, 1]);
  assert.equal(trace.get(1), 3);
  trace.set(1, 99);
  assert.equal(trace.get(1), 99);
  assert.deepEqual(trace.toArray(), [5, 99, 1]);

  const writes = operations.filter((o) => o.type === "write");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { type: "write", index: 1, value: 99 });
});

test("compare logs a focus highlight then a compare, and returns the right sign", () => {
  const { trace, operations } = createTracedArray([1, 5]);
  assert.equal(trace.compare(0, 1), -1); // 1 < 5
  assert.equal(trace.compare(1, 0), 1); // 5 > 1
  assert.equal(trace.compare(0, 0), 0); // 1 == 1

  const highlights = operations.filter((o) => o.type === "highlight");
  const compares = operations.filter((o) => o.type === "compare");
  assert.equal(highlights.length, 3);
  assert.deepEqual(
    compares.map((c) => (c as { result: string }).result),
    ["lt", "gt", "eq"],
  );
});

test("swap exchanges values and logs a swap operation", () => {
  const { trace, operations } = createTracedArray([1, 2, 3]);
  trace.swap(0, 2);
  assert.deepEqual(trace.toArray(), [3, 2, 1]);
  assert.deepEqual(
    operations.filter((o) => o.type === "swap"),
    [{ type: "swap", i: 0, j: 2 }],
  );
});

test("the first operation is always init with a snapshot of the starting array", () => {
  const { operations } = createTracedArray([7, 8, 9]);
  assert.deepEqual(operations[0], { type: "init", array: [7, 8, 9] });
});

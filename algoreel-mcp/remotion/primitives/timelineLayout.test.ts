import assert from "node:assert/strict";
import { test } from "node:test";

import { TIMELINE, revealedCount, xForIndex } from "./timelineLayout";

test("xForIndex spaces events evenly across the fixed line width", () => {
  assert.equal(xForIndex(0, 4), 0);
  assert.equal(xForIndex(3, 4), TIMELINE.width);
  assert.equal(xForIndex(1, 4), TIMELINE.width / 3);
});

test("xForIndex centers a single event when count is 1", () => {
  assert.equal(xForIndex(0, 1), TIMELINE.width / 2);
});

test("revealedCount is 1 at progress 0, so the timeline is never blank", () => {
  assert.equal(revealedCount(0, 4), 1);
});

test("revealedCount is the full event count at progress 1", () => {
  assert.equal(revealedCount(1, 4), 4);
});

test("revealedCount clamps progress outside [0,1]", () => {
  assert.equal(revealedCount(-0.5, 4), 1);
  assert.equal(revealedCount(1.5, 4), 4);
});

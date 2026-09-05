import assert from "node:assert/strict";
import { test } from "node:test";

import { detectStandoutIndex } from "./detectStandout";

test("finds the index of the single largest relative jump", () => {
  // 100->110 (+10%), 110->200 (+82%), 200->210 (+5%) -> index 2 is the standout.
  assert.equal(detectStandoutIndex([100, 110, 200, 210]), 2);
});

test("finds the largest relative drop just as readily as a rise", () => {
  // 100->90 (-10%), 90->20 (-78%), 20->22 (+10%) -> index 2 (the crash) wins.
  assert.equal(detectStandoutIndex([100, 90, 20, 22]), 2);
});

test("returns null for a series with fewer than 2 points (no transition to measure)", () => {
  assert.equal(detectStandoutIndex([100]), null);
  assert.equal(detectStandoutIndex([]), null);
});

test("returns null when every transition starts from a zero base", () => {
  assert.equal(detectStandoutIndex([0, 0, 0]), null);
});

test("skips a zero-base transition but still finds a real standout elsewhere", () => {
  // 0->5 is undefined (skipped); 5->50 (+900%) is the real standout.
  assert.equal(detectStandoutIndex([0, 5, 50]), 2);
});

test("a perfectly flat series has no standout (every transition is 0% change)", () => {
  // No transition has nonzero magnitude, so the first one (index 1) wins
  // as the (only) candidate — deterministic, not arbitrary.
  assert.equal(detectStandoutIndex([10, 10, 10]), 1);
});

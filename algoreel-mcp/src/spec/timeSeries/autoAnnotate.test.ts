import assert from "node:assert/strict";
import { test } from "node:test";

import { autoAnnotateStandout } from "./autoAnnotate";

test("labels the standout index with its real percent change, direction included", () => {
  const result = autoAnnotateStandout({ name: "A", values: [100, 110, 200, 210] });
  assert.equal(result?.index, 2);
  assert.match(result!.label, /increase/);
  assert.match(result!.label, /82%/); // (200-110)/110 = 81.8...% -> rounds to 82
});

test("labels a sharp drop with 'decrease' and the drop's real magnitude", () => {
  const result = autoAnnotateStandout({ name: "A", values: [100, 90, 20, 22] });
  assert.equal(result?.index, 2);
  assert.match(result!.label, /decrease/);
  assert.match(result!.label, /78%/); // (20-90)/90 = -77.8% -> rounds to 78
});

test("returns null when there's no computable standout (e.g. a single point)", () => {
  assert.equal(autoAnnotateStandout({ name: "A", values: [100] }), null);
});

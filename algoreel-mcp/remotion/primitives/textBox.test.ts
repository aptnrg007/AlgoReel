import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateWrappedLines } from "./textBox";

test("a single short word never wraps", () => {
  assert.equal(estimateWrappedLines("Hi", { maxWidthPx: 960, fontSizePx: 46 }), 1);
});

test("empty text has zero lines", () => {
  assert.equal(estimateWrappedLines("", { maxWidthPx: 960, fontSizePx: 46 }), 0);
  assert.equal(estimateWrappedLines("   ", { maxWidthPx: 960, fontSizePx: 46 }), 0);
});

test("line count grows with more words at a fixed width", () => {
  const short = estimateWrappedLines("one two three", { maxWidthPx: 300, fontSizePx: 46 });
  const long = estimateWrappedLines("one two three four five six seven eight nine ten", { maxWidthPx: 300, fontSizePx: 46 });
  assert.ok(long > short);
});

test("a narrower box wraps the same text into more lines", () => {
  const text = "one two three four five six seven eight";
  const wide = estimateWrappedLines(text, { maxWidthPx: 1000, fontSizePx: 46 });
  const narrow = estimateWrappedLines(text, { maxWidthPx: 300, fontSizePx: 46 });
  assert.ok(narrow >= wide);
});

// The real calibration point (see this module's own header comment):
// bfs-demo.json's actual 122-character op:0 caption, sample_frames-
// confirmed to wrap to exactly 4 lines in a real render at this box width
// and font size.
test("matches the real, sample_frames-confirmed line count for bfs-demo.json's op:0 caption", () => {
  const text =
    "We start at A and enqueue its neighbors B and C. Then we dequeue B — its only new neighbor is D, so D joins the queue too.";
  assert.equal(estimateWrappedLines(text, { maxWidthPx: 960, fontSizePx: 46 }), 4);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeNarrationText } from "./sanitizeText";

test("strips **bold** markers, keeping the text", () => {
  assert.equal(sanitizeNarrationText("Binary search finds it in **two steps**!"), "Binary search finds it in two steps!");
});

test("strips __bold__ markers", () => {
  assert.equal(sanitizeNarrationText("__O(log n)__ complexity"), "O(log n) complexity");
});

test("strips single *italic* markers without eating multiplication", () => {
  assert.equal(sanitizeNarrationText("The *middle* element"), "The middle element");
  assert.equal(sanitizeNarrationText("Runtime is 2*n in the worst case"), "Runtime is 2*n in the worst case");
});

test("strips `code` backticks", () => {
  assert.equal(sanitizeNarrationText("Call `trace.compare(i, j)`"), "Call trace.compare(i, j)");
});

test("leaves plain text with no markdown untouched", () => {
  const text = "The array [2, 5, 8, 12] is already sorted.";
  assert.equal(sanitizeNarrationText(text), text);
});

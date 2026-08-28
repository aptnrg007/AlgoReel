import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveEmphasis } from "./emphasis";

test("never picks a word that is a substring of another word used elsewhere in the narration", () => {
  // The real bug this guards against: Caption.tsx's splitEmphasis regex-
  // matches "sort" unanchored, so if "sort" were chosen, it would also
  // highlight the "sort" inside "sorted" as a partial-word render glitch.
  const words = deriveEmphasis([
    "Watch bubble sort in action!",
    "First pass: 5 and 3 swap.",
    "The array is now sorted.",
  ]);
  assert.ok(!words.includes("sort"), `expected "sort" to be excluded once "sorted" is also present, got ${JSON.stringify(words)}`);
});

test("picks real standalone words, in first-appearance order, up to maxWords", () => {
  const words = deriveEmphasis(["Binary search eliminates half the array every step."], { maxWords: 2 });
  assert.equal(words.length, 2);
  assert.equal(words[0], "binary");
  assert.equal(words[1], "search");
});

test("excludes words shorter than minLength and common stopwords", () => {
  const words = deriveEmphasis(["The array is big and the list will grow."]);
  assert.ok(!words.includes("the"));
  assert.ok(!words.includes("big"), "3-letter word should be excluded by the default minLength of 4");
  assert.ok(!words.includes("will"), "stopword should be excluded");
});

test("returns an empty array for text with nothing qualifying", () => {
  const words = deriveEmphasis(["it is up"]);
  assert.deepEqual(words, []);
});

test("case-insensitive: matching differently-cased occurrences still count as the same word", () => {
  const words = deriveEmphasis(["Sort the array.", "sorting complete."]);
  // "sort" is a substring of "sorting" case-insensitively, so it must still
  // be excluded even though the two occurrences differ in case.
  assert.ok(!words.includes("sort"));
});

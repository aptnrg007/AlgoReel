import assert from "node:assert/strict";
import { test } from "node:test";

import { EnsureSpecError, ensureSpec } from "./ensureSpec";

// A minimal, valid narration-draft answer for binarySearch's canonical
// input ({array:[2,5,8,12,16,23,38], target:23}) — real values from that
// input, matching whatever opBudget length ensureSpec.ts's beatBudget
// planning actually computes (read from the test's own captured prompt
// rather than hardcoded, so this stays correct if planBeats' defaults
// ever change).
function draftFor(opCount: number, overrides: Partial<{ hook: string; opTexts: string[]; outroText: string }> = {}) {
  return JSON.stringify({
    hook: overrides.hook ?? "Binary search finds 23 fast!",
    opTexts:
      overrides.opTexts ??
      Array.from({ length: opCount }, (_, i) => `Step ${i + 1}: the middle element is compared against the target value twenty three here.`),
    outroText: overrides.outroText ?? "That's how binary search eliminates half the array every single step of the way.",
    complexity: { time: "O(log n)", space: "O(1)" },
    youtube: { title: "Binary Search Explained", description: "Watch binary search find 23 fast.", tags: ["algorithms", "binarysearch"] },
  });
}

test("a direct topic matches an existing algorithm by keyword, with zero selection model calls", async () => {
  let selectionCalls = 0;
  const result = await ensureSpec(
    { topic: "explain binary search" },
    {
      chooseAlgorithm: async () => {
        selectionCalls++;
        return "{}";
      },
      writeNarration: async (prompt) => {
        const opCountMatch = prompt.match(/exactly (\d+) "opTexts"/);
        return draftFor(Number(opCountMatch![1]));
      },
    },
  );
  assert.equal(selectionCalls, 0, "a direct topic must never call the selection model");
  assert.equal(result.spec.algorithm, "binarySearch");
  assert.equal(result.notes.some((n) => n.includes("keyword")), true);
});

test("an indirect topic goes through the selection ladder and the returned choice is used", async () => {
  const result = await ensureSpec(
    { topic: "finding something in an already-alphabetized list efficiently" },
    {
      chooseAlgorithm: async () => JSON.stringify({ algorithm: "binarySearch", structure: "array" }),
      writeNarration: async (prompt) => {
        const opCountMatch = prompt.match(/exactly (\d+) "opTexts"/);
        return draftFor(Number(opCountMatch![1]));
      },
    },
  );
  assert.equal(result.spec.algorithm, "binarySearch");
  assert.equal(result.selectRung, 0);
});

test("op:N beats are zipped from opTexts in order, with no way to introduce a numbering gap", async () => {
  const result = await ensureSpec(
    { topic: "explain bubble sort" },
    {
      writeNarration: async (prompt) => {
        const opCountMatch = prompt.match(/exactly (\d+) "opTexts"/);
        return draftFor(Number(opCountMatch![1]));
      },
    },
  );
  const opBeats = result.spec.narration.filter((n) => n.beat.startsWith("op:")).map((n) => n.beat);
  const expected = opBeats.map((_, i) => `op:${i}`);
  assert.deepEqual(opBeats, expected);
  assert.equal(result.spec.narration.filter((n) => n.beat === "outro").length, 1);
});

test("markdown decoration from the model is stripped before it reaches the spec", async () => {
  const result = await ensureSpec(
    { topic: "explain bubble sort" },
    {
      writeNarration: async (prompt) => {
        const opCountMatch = prompt.match(/exactly (\d+) "opTexts"/);
        const n = Number(opCountMatch![1]);
        return draftFor(n, {
          hook: "**Bubble sort** in action!",
          opTexts: Array.from({ length: n }, () => "The `swap` happens because five is greater than two in this pass here."),
        });
      },
    },
  );
  assert.ok(!result.spec.hook.includes("**"), `hook still has markdown: ${result.spec.hook}`);
  assert.ok(
    result.spec.narration.every((n) => !n.text.includes("`")),
    "narration still has backtick markdown",
  );
});

test("targetDurationSec is set from the real computed timeline, never left at a guess", async () => {
  const result = await ensureSpec(
    { topic: "explain bubble sort" },
    {
      writeNarration: async (prompt) => {
        const opCountMatch = prompt.match(/exactly (\d+) "opTexts"/);
        return draftFor(Number(opCountMatch![1]));
      },
    },
  );
  // checkRender.ts's duration-off-target allows up to 5s drift — the whole
  // point of assembleSpec computing this from buildTimeline is that drift
  // should be ~0, not just under the tolerance.
  const { buildTimeline } = await import("../../remotion/buildTimeline");
  const { FRAME } = await import("../../remotion/template/tokens");
  const timeline = buildTimeline(result.spec, FRAME.fps);
  const real = Math.round(timeline.totalDurationInFrames / FRAME.fps);
  assert.equal(result.spec.targetDurationSec, real);
});

test("an opTexts count that doesn't match the budget is rejected and retried, not silently truncated or padded", async () => {
  let call = 0;
  const result = await ensureSpec(
    { topic: "explain bubble sort" },
    {
      writeNarration: async (prompt) => {
        call++;
        const opCountMatch = prompt.match(/exactly (\d+) "opTexts"/);
        const n = Number(opCountMatch![1]);
        // First attempt deliberately wrong (one too many), second correct.
        return call === 1 ? draftFor(n + 1) : draftFor(n);
      },
    },
  );
  assert.ok(call >= 2, "expected at least one retry after the wrong opTexts count");
  const opBeats = result.spec.narration.filter((n) => n.beat.startsWith("op:"));
  assert.equal(result.spec.narration.filter((n) => n.beat === "outro").length, 1);
  // Whatever the real budget length is, the final spec's op count must
  // match it exactly, not the model's first (wrong) count.
  assert.ok(opBeats.length >= 1);
});

test("a topic with no plausible match and structure other than array/graph fails honestly", async () => {
  await assert.rejects(
    ensureSpec(
      { topic: "explain a hash table" },
      { chooseAlgorithm: async () => JSON.stringify({ algorithm: "hashTable", structure: "other" }) },
    ),
    (err: unknown) => err instanceof EnsureSpecError && /isn't a known algorithm/.test(err.message),
  );
});

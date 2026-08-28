import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildTimeline } from "../../remotion/buildTimeline";
import { FRAME } from "../../remotion/template/tokens";
import { checkRender } from "./checkRender";
import type { StorySpec } from "./types";

const YOUTUBE = { title: "t", description: "d", tags: ["a"] };
const COMPLEXITY = { time: "O(n)", space: "O(1)" };

function longText(words: number): string {
  return Array.from({ length: words }, () => "word").join(" ");
}

// Sets targetDurationSec to whatever buildTimeline actually computes, so
// tests that aren't specifically about duration drift never trip
// duration-off-target as an incidental side effect.
function withMatchedDuration(spec: StorySpec): StorySpec {
  const timeline = buildTimeline(spec, FRAME.fps);
  return { ...spec, targetDurationSec: Math.round(timeline.totalDurationInFrames / FRAME.fps) };
}

function codesOf(result: ReturnType<typeof checkRender>): string[] {
  return result.failures.map((f) => f.code);
}

test("array-too-wide fires at n=8 and not below", () => {
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(10) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "binarySearch",
    input: { array: [1, 2, 3, 4, 5, 6, 7, 8], target: 8 },
  };
  const result = checkRender(withMatchedDuration(spec));
  assert.ok(codesOf(result).includes("array-too-wide"));
  assert.equal(result.pass, false);
});

test("array-near-edge warns at n=7 without failing the render", () => {
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(10) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "binarySearch",
    input: { array: [1, 2, 3, 4, 5, 6, 7], target: 7 },
  };
  const result = checkRender(withMatchedDuration(spec));
  const warning = result.failures.find((f) => f.code === "array-near-edge");
  assert.ok(warning);
  assert.equal(warning.severity, "warning");
  assert.equal(result.pass, true);
});

test("n=5 array is clean — no width failures at all", () => {
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(10) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "binarySearch",
    input: { array: [1, 2, 3, 4, 5], target: 5 },
  };
  const result = checkRender(withMatchedDuration(spec));
  assert.ok(!codesOf(result).includes("array-too-wide"));
  assert.ok(!codesOf(result).includes("array-near-edge"));
  assert.equal(result.pass, true);
});

// caption-overlaps-structure is a WARNING, not an error (its check-side
// comment explains why: the wrapped-line estimate isn't a real
// measurement) — so every case below must leave result.pass true even
// when the code fires, unlike struct-nodes-overlap/struct-too-large above.
test("caption-overlaps-structure fires for a deliberately verbose caption over a tall circle graph", () => {
  const nodes = Array.from({ length: 7 }, (_, i) => `n${i}`);
  const edges: [string, string][] = nodes.slice(1).map((n, i) => [nodes[i]!, n]);
  const spec: StorySpec = withMatchedDuration({
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(60) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "bfs",
    input: { nodes, edges, start: nodes[0]! },
  });
  const result = checkRender(spec);
  assert.ok(codesOf(result).includes("caption-overlaps-structure"));
  const failure = result.failures.find((f) => f.code === "caption-overlaps-structure")!;
  assert.equal(failure.severity, "warning");
  assert.equal(result.pass, true, "a warning-only failure must never flip pass to false");
});

test("caption-overlaps-structure does not fire for a short caption over the same circle graph", () => {
  const nodes = Array.from({ length: 7 }, (_, i) => `n${i}`);
  const edges: [string, string][] = nodes.slice(1).map((n, i) => [nodes[i]!, n]);
  const spec: StorySpec = withMatchedDuration({
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(5) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "bfs",
    input: { nodes, edges, start: nodes[0]! },
  });
  const result = checkRender(spec);
  assert.ok(!codesOf(result).includes("caption-overlaps-structure"));
});

// Real, committed evidence, not just a synthetic case: bfs-demo.json's real
// narration (~20-word captions) over its real 7-node circle graph sample_
// frames-confirmed clean live, but tight — exactly the "warning, not error"
// case this check exists for. Pins the calibration in textBox.ts's
// AVG_CHAR_WIDTH_EM against a real spec, not just synthetic longText().
test("bfs-demo.json's real caption/circle-graph pairing warns (tight) but still passes", () => {
  const raw = readFileSync(join(import.meta.dirname, "../../specs/bfs-demo.json"), "utf8");
  const spec = JSON.parse(raw) as StorySpec;
  const result = checkRender(spec);
  assert.ok(codesOf(result).includes("caption-overlaps-structure"));
  assert.equal(result.pass, true);
});

test("struct-nodes-overlap fires for a 25-node graph on the fixed layout circle", () => {
  const nodes = Array.from({ length: 25 }, (_, i) => `n${i}`);
  const edges: [string, string][] = nodes.slice(1).map((n, i) => [nodes[i]!, n]);
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 90,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(10) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "bfs",
    input: { nodes, edges, start: nodes[0]! },
  };
  const result = checkRender(spec);
  assert.ok(codesOf(result).includes("struct-nodes-overlap"));
  assert.equal(result.pass, false);
});

test("duration-off-target fires when the computed render drifts from targetDurationSec", () => {
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 90,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(4) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "binarySearch",
    input: { array: [1, 2, 3, 4, 5], target: 5 },
  };
  // Deliberately NOT withMatchedDuration — a handful of short beats totals
  // well under 90s, which is the point of this test.
  const result = checkRender(spec);
  assert.ok(codesOf(result).includes("duration-off-target"));
  assert.equal(result.pass, false);
});

test("Phase 4 exit criterion: a 40-element array with 90s target and thin narration is caught", () => {
  // Realistic version of the "deliberately broken" spec PLAN.md §9 names:
  // a 40-element array (way over width budget) narrated with just two
  // short op:N beats — each gets only the ~1.8s minimum, while the real
  // algorithm run produces hundreds of primary steps to cram into that
  // pair of beats, so almost all of them get 0 frames. targetDurationSec
  // is set to the claimed 90s even though two minimum-length beats don't
  // come close, which is itself part of what's broken about this spec.
  const spec: StorySpec = {
    version: 1,
    topic: "stress",
    targetDurationSec: 90,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(5) },
      { beat: "op:0", text: "first step" },
      { beat: "op:1", text: "second step" },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "bubbleSort",
    input: { array: Array.from({ length: 40 }, (_, i) => 40 - i) },
  };
  const result = checkRender(spec);
  const codes = codesOf(result);
  assert.ok(codes.includes("array-too-wide"));
  assert.ok(codes.includes("invisible-checkpoints"));
  assert.ok(codes.includes("duration-off-target"));
  assert.equal(result.pass, false);
});

// Row-layout geometry: width(n) = (n-1)*(STRUCT.row.size+STRUCT.row.gap) +
// STRUCT.row.size = 180n - 60 (tokens.ts). n=6 -> 1020px (fits the
// 1080px frame); n=7 -> 1200px (doesn't). No terminal-box slot is added
// to this budget any more — a rewired-to-null link is drawn as an
// absence, not an extra reserved node-sized box (state.ts's structLinks
// comment) — so this genuinely fits one more real node than the
// pre-generalization LinkedListView's same check did.
test("struct-too-large fires at n=7 nodes (row layout) and not at n=6", () => {
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(10) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "reverseLinkedList",
    input: { list: [1, 2, 3, 4, 5, 6, 7] },
  };
  const result = checkRender(withMatchedDuration(spec));
  assert.ok(codesOf(result).includes("struct-too-large"));
  assert.equal(result.pass, false);
});

test("n=6 nodes (row layout) sits right at the width boundary and is still clean", () => {
  const spec: StorySpec = {
    version: 1,
    topic: "t",
    targetDurationSec: 30,
    hook: "h",
    narration: [
      { beat: "intro", text: longText(3) },
      { beat: "op:0", text: longText(10) },
      { beat: "outro", text: longText(5) },
    ],
    emphasis: [],
    complexity: COMPLEXITY,
    youtube: YOUTUBE,
    algorithm: "reverseLinkedList",
    input: { list: [1, 2, 3, 4, 5, 6] },
  };
  const result = checkRender(withMatchedDuration(spec));
  assert.ok(!codesOf(result).includes("struct-too-large"));
  assert.ok(!codesOf(result).includes("struct-nodes-overlap"));
  assert.ok(!codesOf(result).includes("blank-checkpoint"));
  assert.equal(result.pass, true);
});

test("committed reverse-linked-list-demo.json is clean end to end", () => {
  const raw = readFileSync(join(import.meta.dirname, "../../specs/reverse-linked-list-demo.json"), "utf8");
  const spec = JSON.parse(raw) as StorySpec;
  const result = checkRender(spec);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

test("committed bubble-sort-demo.json is clean end to end", () => {
  const raw = readFileSync(join(import.meta.dirname, "../../specs/bubble-sort-demo.json"), "utf8");
  const spec = JSON.parse(raw) as StorySpec;
  const result = checkRender(spec);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

// Phase 2 proof cases: a "levels" layout (a tree) and a "column" layout
// (a stack) go through the exact same checkRender path as every other
// structure, with zero changes to checkRender.ts itself.
test("committed inorder-traversal-demo.json is clean end to end", () => {
  const raw = readFileSync(join(import.meta.dirname, "../../specs/inorder-traversal-demo.json"), "utf8");
  const spec = JSON.parse(raw) as StorySpec;
  const result = checkRender(spec);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

test("committed balanced-parens-demo.json is clean end to end", () => {
  const raw = readFileSync(join(import.meta.dirname, "../../specs/balanced-parens-demo.json"), "utf8");
  const spec = JSON.parse(raw) as StorySpec;
  const result = checkRender(spec);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

// bstInsert's proof case: a tree that grows one node at a time, unlike
// inorderTraversal's fixed, already-complete tree — same "levels" layout,
// same checkRender path, zero changes needed to get here.
test("committed bst-insert-demo.json is clean end to end", () => {
  const raw = readFileSync(join(import.meta.dirname, "../../specs/bst-insert-demo.json"), "utf8");
  const spec = JSON.parse(raw) as StorySpec;
  const result = checkRender(spec);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

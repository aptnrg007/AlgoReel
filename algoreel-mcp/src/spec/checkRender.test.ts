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

test("graph-nodes-overlap fires for a 25-node graph on the fixed layout circle", () => {
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
  assert.ok(codesOf(result).includes("graph-nodes-overlap"));
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

test("list-too-wide fires at n=6 and not below", () => {
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
  assert.ok(codesOf(result).includes("list-too-wide"));
  assert.equal(result.pass, false);
});

test("list-near-edge warns at n=5 without failing the render", () => {
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
    input: { list: [1, 2, 3, 4, 5] },
  };
  const result = checkRender(withMatchedDuration(spec));
  const warning = result.failures.find((f) => f.code === "list-near-edge");
  assert.ok(warning);
  assert.equal(warning.severity, "warning");
  assert.equal(result.pass, true);
});

test("n=4 list is clean — no width failures at all", () => {
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
    input: { list: [1, 2, 3, 4] },
  };
  const result = checkRender(withMatchedDuration(spec));
  assert.ok(!codesOf(result).includes("list-too-wide"));
  assert.ok(!codesOf(result).includes("list-near-edge"));
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

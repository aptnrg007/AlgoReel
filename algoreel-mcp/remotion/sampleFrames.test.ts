import assert from "node:assert/strict";
import { test } from "node:test";

import { pickSampleFrames } from "./sampleFrames";
import type { Timeline } from "./buildTimeline";

function timelineWithSteps(stepDurations: number[]): Timeline {
  return {
    hookDurationInFrames: 90,
    steps: stepDurations.map((durationInFrames, i) => ({
      beat: `op:${i}`,
      text: `step ${i}`,
      durationInFrames,
      checkpoints: [],
    })),
    outroText: "outro",
    outroDurationInFrames: 120,
    totalDurationInFrames: 90 + stepDurations.reduce((a, b) => a + b, 0) + 120,
  };
}

test("2 steps produce hook + both steps + outro, 4 samples total", () => {
  const timeline = timelineWithSteps([60, 60]);
  const samples = pickSampleFrames(timeline);
  assert.deepEqual(
    samples.map((s) => s.label),
    ["hook", "op:0", "op:1", "outro"],
  );
  for (const s of samples) {
    assert.ok(s.frame >= 0 && s.frame < timeline.totalDurationInFrames, `frame ${s.frame} out of bounds`);
  }
});

test("10 steps are capped at 6 samples total, spanning first and last", () => {
  const timeline = timelineWithSteps(Array.from({ length: 10 }, () => 30));
  const samples = pickSampleFrames(timeline);
  assert.equal(samples.length, 6);
  assert.equal(samples[0]!.label, "hook");
  assert.equal(samples[samples.length - 1]!.label, "outro");
  const stepLabels = samples.slice(1, -1).map((s) => s.label);
  assert.equal(stepLabels.length, 4);
  assert.ok(stepLabels.includes("op:0"), "expected the first step to be sampled");
  assert.ok(stepLabels.includes("op:9"), "expected the last step to be sampled");
  // No duplicate step indices.
  assert.equal(new Set(stepLabels).size, stepLabels.length);
});

test("0 steps still returns hook and outro without crashing", () => {
  const timeline = timelineWithSteps([]);
  const samples = pickSampleFrames(timeline);
  assert.deepEqual(
    samples.map((s) => s.label),
    ["hook", "outro"],
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkTimelineRender } from "./checkRender";
import type { TimelineSpec } from "./types";

const MILESTONES: TimelineSpec = {
  title: "Milestones of the 20th Century",
  events: [
    { date: "1945", title: "WWII ends" },
    { date: "1969", title: "Moon landing" },
    { date: "1989", title: "Berlin Wall falls" },
    { date: "1991", title: "World Wide Web" },
  ],
};

function codes(failures: { code: string }[]): string[] {
  return failures.map((f) => f.code);
}

test("the committed milestones demo spec is clean end to end at a real duration", () => {
  const result = checkTimelineRender(MILESTONES, 20);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

test("timeline-label-too-wide fires for a long title that would crowd its neighbors", () => {
  const spec: TimelineSpec = {
    ...MILESTONES,
    events: [MILESTONES.events[0]!, { date: "1969", title: "A".repeat(80) }, ...MILESTONES.events.slice(2)],
  };
  const result = checkTimelineRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("timeline-label-too-wide"));
});

test("duration-too-short fires below the 1s minimum", () => {
  const result = checkTimelineRender(MILESTONES, 0.5);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("duration-too-short"));
});

test("reveal-faster-than-frames warns when there are more events than frames to reveal them in", () => {
  const spec: TimelineSpec = {
    title: "Many Events",
    events: Array.from({ length: 40 }, (_, i) => ({ date: String(1900 + i), title: `Event ${i}` })),
  };
  // 1s at 30fps = 30 frames, fewer than the 39 event-to-event transitions.
  const result = checkTimelineRender(spec, 1);
  assert.ok(codes(result.failures).includes("reveal-faster-than-frames"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AlgorithmVideo } from "./AlgorithmVideo";
import { TimeSeriesVideo } from "./TimeSeriesVideo";
import { buildTimeline } from "./buildTimeline";
import { FRAME } from "./template/tokens";
import { calculateDurationInFrames, renderComponentFor, validateVideoPlan } from "./videoTypes";
import { toDsaVideoPlan } from "../src/plan/fromStorySpec";
import { toTimeSeriesVideoPlan } from "../src/plan/fromTimeSeriesSpec";
import type { StorySpec } from "../src/spec/types";
import type { TimeSeriesSpec } from "../src/spec/timeSeries/types";

const DSA_SPEC: StorySpec = JSON.parse(readFileSync(join(import.meta.dirname, "../specs/binary-search-demo.json"), "utf8"));
const TIME_SERIES_SPEC: TimeSeriesSpec = JSON.parse(
  readFileSync(join(import.meta.dirname, "../specs/time-series/time-series-demo.json"), "utf8"),
);

// This registry (PLAN.md §11/§28) is the one place Video.tsx and
// Root.tsx's duration calculation both delegate to instead of switching on
// videoType themselves — these tests exist to prove that delegation
// actually reaches the right implementation for each video type, not just
// that each implementation works in isolation (already covered by
// buildTimeline's/checkTimeSeriesRender's own test suites).

test("calculateDurationInFrames for a dsa plan matches buildTimeline's own computed duration", () => {
  const plan = toDsaVideoPlan(DSA_SPEC);
  const expected = buildTimeline(DSA_SPEC, FRAME.fps).totalDurationInFrames;
  assert.equal(calculateDurationInFrames(plan, FRAME.fps), expected);
});

test("calculateDurationInFrames for a time_series plan is targetDurationSec converted to frames, not derived from a timeline", () => {
  const plan = toTimeSeriesVideoPlan(TIME_SERIES_SPEC, { targetDurationSec: 12 });
  assert.equal(calculateDurationInFrames(plan, FRAME.fps), Math.round(12 * FRAME.fps));
});

test("validateVideoPlan passes a valid dsa plan", () => {
  const plan = toDsaVideoPlan(DSA_SPEC);
  const result = validateVideoPlan(plan);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateVideoPlan fails an invalid dsa plan (unknown algorithm) and reaches the dsa validator, not the time_series one", () => {
  const plan = toDsaVideoPlan({ ...DSA_SPEC, algorithm: "not-a-real-algorithm" });
  const result = validateVideoPlan(plan);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unknown algorithm/);
});

test("validateVideoPlan passes a valid time_series plan at a real duration", () => {
  const plan = toTimeSeriesVideoPlan(TIME_SERIES_SPEC, { targetDurationSec: 20 });
  const result = validateVideoPlan(plan);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateVideoPlan fails a time_series plan whose data is schema-invalid, before any geometry check runs", () => {
  const badSpec = { ...TIME_SERIES_SPEC, series: [] };
  const plan = toTimeSeriesVideoPlan(badSpec as unknown as TimeSeriesSpec, { targetDurationSec: 20 });
  const result = validateVideoPlan(plan);
  assert.equal(result.valid, false);
});

test("validateVideoPlan fails a time_series plan whose data is schema-valid but geometrically bad (check_render's job)", () => {
  // A single-series huge, unscaled value — many x-axis points alone is no
  // longer a hard failure since PLAN.md Phase 9 step 1 (labels thin
  // instead of erroring); this is a failure thinning can't fix.
  const unscaled: TimeSeriesSpec = {
    ...TIME_SERIES_SPEC,
    series: [{ name: "India", values: TIME_SERIES_SPEC.series[0]!.values.map((v) => v * 1e12) }],
  };
  const plan = toTimeSeriesVideoPlan(unscaled, { targetDurationSec: 20 });
  const result = validateVideoPlan(plan);
  assert.equal(result.valid, false);
});

test("validateVideoPlan still passes a time_series plan with many points — labels thin instead of failing", () => {
  const manyPoints: TimeSeriesSpec = {
    ...TIME_SERIES_SPEC,
    xAxis: { label: "Year", values: Array.from({ length: 30 }, (_, i) => 1990 + i) },
    series: [{ name: "India", values: Array.from({ length: 30 }, (_, i) => i) }],
  };
  const plan = toTimeSeriesVideoPlan(manyPoints, { targetDurationSec: 20 });
  const result = validateVideoPlan(plan);
  assert.equal(result.valid, true);
});

test("renderComponentFor returns AlgorithmVideo for a dsa plan and TimeSeriesVideo for a time_series plan", () => {
  assert.equal(renderComponentFor(toDsaVideoPlan(DSA_SPEC)), AlgorithmVideo);
  assert.equal(renderComponentFor(toTimeSeriesVideoPlan(TIME_SERIES_SPEC, { targetDurationSec: 20 })), TimeSeriesVideo);
});

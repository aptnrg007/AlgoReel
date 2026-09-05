import assert from "node:assert/strict";
import { test } from "node:test";

import { checkTimeSeriesRender } from "./checkRender";
import type { TimeSeriesSpec } from "./types";

const GDP_DEMO: TimeSeriesSpec = {
  title: "India GDP: 1990-2025",
  xAxis: { label: "Year", values: [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025] },
  yAxis: { label: "GDP", unit: "USD billions" },
  series: [{ name: "India", values: [320, 480, 710, 900, 1700, 2100, 2700, 3900] }],
};

function codes(failures: { code: string }[]): string[] {
  return failures.map((f) => f.code);
}

test("the committed GDP demo spec is clean end to end at its real duration", () => {
  const result = checkTimeSeriesRender(GDP_DEMO, 20);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

test("x-axis-labels-thinned warns (not fails) when too many points are crammed into the fixed chart width — labels get thinned, not rejected", () => {
  const spec: TimeSeriesSpec = {
    ...GDP_DEMO,
    xAxis: { label: "Year", values: Array.from({ length: 25 }, (_, i) => 1000 + i) },
    series: [{ name: "India", values: Array.from({ length: 25 }, (_, i) => i) }],
  };
  const result = checkTimeSeriesRender(spec, 20);
  assert.equal(result.pass, true, "thinning fixes crowding — a wide dataset must not be rejected outright");
  assert.ok(codes(result.failures).includes("x-axis-labels-thinned"));
});

test("x-axis-labels-thinned does not fire when every label already fits", () => {
  const result = checkTimeSeriesRender(GDP_DEMO, 20);
  assert.equal(codes(result.failures).includes("x-axis-labels-thinned"), false);
});

test("x-axis-label-too-wide fires only when a single label alone couldn't fit even with thinning", () => {
  const spec: TimeSeriesSpec = {
    ...GDP_DEMO,
    xAxis: { label: "Year", values: ["a".repeat(200), "b".repeat(200)] },
    series: [{ name: "India", values: [1, 2] }],
  };
  const result = checkTimeSeriesRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("x-axis-label-too-wide"));
});

test("y-axis-label-too-wide fires for unscaled huge values (use a yAxis.unit that pre-scales instead)", () => {
  const spec: TimeSeriesSpec = {
    ...GDP_DEMO,
    // Two series so the single-series end-value-label check (which would
    // also legitimately fire on values this large) can't confound this
    // test's assertion.
    series: [
      { name: "India", values: [3.9e14, 4e14, 4.1e14, 4.2e14, 4.3e14, 4.4e14, 4.5e14, 4.6e14] },
      { name: "China", values: [3.6e14, 3.9e14, 4.0e14, 4.1e14, 4.2e14, 4.3e14, 4.4e14, 4.5e14] },
    ],
  };
  const result = checkTimeSeriesRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("y-axis-label-too-wide"));
  assert.equal(codes(result.failures).includes("end-value-label-too-wide"), false);
});

test("end-value-label-too-wide fires for a single series with an unscaled huge value", () => {
  const spec: TimeSeriesSpec = {
    ...GDP_DEMO,
    series: [{ name: "India", values: [3.9e14, 4e14, 4.1e14, 4.2e14, 4.3e14, 4.4e14, 4.5e14, 4.6e14] }],
  };
  const result = checkTimeSeriesRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("end-value-label-too-wide"));
});

test("end-value-label-too-wide never fires for 2+ series (no end-value label is ever drawn for them)", () => {
  const spec: TimeSeriesSpec = {
    ...GDP_DEMO,
    series: [
      { name: "India", values: [3.9e14, 4e14, 4.1e14, 4.2e14, 4.3e14, 4.4e14, 4.5e14, 4.6e14] },
      { name: "China", values: [3.9e14, 4e14, 4.1e14, 4.2e14, 4.3e14, 4.4e14, 4.5e14, 4.6e14] },
    ],
  };
  const result = checkTimeSeriesRender(spec, 20);
  assert.equal(codes(result.failures).includes("end-value-label-too-wide"), false);
});

test("duration-too-short fires below the 1s minimum", () => {
  const result = checkTimeSeriesRender(GDP_DEMO, 0.5);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("duration-too-short"));
});

test("reveal-faster-than-frames warns when there are more points than frames to reveal them in", () => {
  const spec: TimeSeriesSpec = {
    ...GDP_DEMO,
    xAxis: { label: "Year", values: Array.from({ length: 100 }, (_, i) => 1900 + i) },
    series: [{ name: "India", values: Array.from({ length: 100 }, (_, i) => i) }],
  };
  // 2s at 30fps = 60 frames, fewer than the 99 point-to-point transitions.
  const result = checkTimeSeriesRender(spec, 2);
  assert.ok(codes(result.failures).includes("reveal-faster-than-frames"));
});

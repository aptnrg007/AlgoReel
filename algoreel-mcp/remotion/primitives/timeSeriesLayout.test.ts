import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART, computeYDomain, labelStride, revealedCount, tickIndicesToLabel, xForIndex, yForValue } from "./timeSeriesLayout";
import type { TimeSeriesSpec } from "../../src/spec/timeSeries/types";

const SPEC: TimeSeriesSpec = {
  title: "t",
  xAxis: { label: "Year", values: [1990, 2000, 2010] },
  yAxis: { label: "GDP" },
  series: [{ name: "A", values: [100, 200, 300] }],
};

test("computeYDomain pads 10% of the value range above the max and below the min", () => {
  // values span 100..300 (range 200) -> a 20-unit pad each side
  const domain = computeYDomain(SPEC);
  assert.equal(domain.max, 320);
  assert.equal(domain.min, 80);
});

test("computeYDomain spans every series, not just the first", () => {
  const spec: TimeSeriesSpec = { ...SPEC, series: [{ name: "A", values: [0, 0, 0] }, { name: "B", values: [-50, 0, 500] }] };
  const domain = computeYDomain(spec);
  assert.ok(domain.min < -50);
  assert.ok(domain.max > 500);
});

test("computeYDomain pads a flat series with a fixed absolute amount, not a zero percentage", () => {
  const spec: TimeSeriesSpec = { ...SPEC, series: [{ name: "A", values: [5, 5, 5] }] };
  const domain = computeYDomain(spec);
  assert.ok(domain.max > 5);
  assert.ok(domain.min < 5);
});

test("xForIndex spaces points evenly across the fixed chart width", () => {
  assert.equal(xForIndex(0, 3), 0);
  assert.equal(xForIndex(2, 3), CHART.width);
  assert.equal(xForIndex(1, 3), CHART.width / 2);
});

test("xForIndex centers a single point when count is 1", () => {
  assert.equal(xForIndex(0, 1), CHART.width / 2);
});

test("yForValue maps the domain max to the top (y=0) and min to the bottom", () => {
  const domain = { min: 0, max: 100 };
  assert.equal(yForValue(100, domain), 0);
  assert.equal(yForValue(0, domain), CHART.height);
  assert.equal(yForValue(50, domain), CHART.height / 2);
});

test("revealedCount is 1 at progress 0, so the chart is never blank", () => {
  assert.equal(revealedCount(0, 8), 1);
});

test("revealedCount is the full point count at progress 1", () => {
  assert.equal(revealedCount(1, 8), 8);
});

test("revealedCount clamps progress outside [0,1]", () => {
  assert.equal(revealedCount(-0.5, 8), 1);
  assert.equal(revealedCount(1.5, 8), 8);
});

test("revealedCount returns the full (degenerate) count for a single-point series", () => {
  assert.equal(revealedCount(0, 1), 1);
  assert.equal(revealedCount(1, 1), 1);
});

test("labelStride is 1 (no thinning) when every label already fits at the real per-point spacing", () => {
  // n=9 -> spacing = 760/8 = 95px; a 20px label needs no thinning at all.
  assert.equal(labelStride(9, 20), 1);
});

test("labelStride guarantees consecutive shown labels are far enough apart to never overlap", () => {
  // Regression test for a real bug: an earlier proportional-count version
  // computed "18 of 25 fit" for this exact case, but a real render showed
  // several originally-adjacent years (e.g. 2006/2007/2008) still both
  // labeled and overlapping — the count was right on average but not
  // evenly distributed across the actual discrete indices. Stride-based
  // selection can't make that mistake: by construction, every kept pair
  // is >= stride indices apart.
  const n = 25;
  const widestLabel = 43.68; // ~ estimateTextWidth("2024", 21)
  const stride = labelStride(n, widestLabel);
  const spacing = CHART.width / (n - 1);
  assert.ok(stride * spacing >= widestLabel, `stride ${stride} * spacing ${spacing} should clear label width ${widestLabel}`);
  assert.ok(stride > 1, "this dataset should actually need thinning");
});

test("labelStride never returns less than 1", () => {
  assert.equal(labelStride(9, 0), 1);
  assert.equal(labelStride(1, 100), 1);
});

test("tickIndicesToLabel labels every point at stride 1", () => {
  assert.deepEqual(tickIndicesToLabel(5, 1), [0, 1, 2, 3, 4]);
});

test("tickIndicesToLabel keeps every pair of shown indices exactly `stride` apart (except possibly the last)", () => {
  const indices = tickIndicesToLabel(9, 3);
  assert.deepEqual(indices, [0, 3, 6, 8]); // 8 appended since stride 3 from 6 would overshoot to 9
});

test("tickIndicesToLabel always includes the final index, even when the stride doesn't land on it", () => {
  const indices = tickIndicesToLabel(10, 4);
  assert.equal(indices[indices.length - 1], 9);
});

test("tickIndicesToLabel returns just the endpoints when the stride spans the whole axis", () => {
  assert.deepEqual(tickIndicesToLabel(9, 9), [0, 8]);
});

test("tickIndicesToLabel returns nothing for an empty axis", () => {
  assert.deepEqual(tickIndicesToLabel(0, 5), []);
});

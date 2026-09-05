import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART, computeYDomain, revealedCount, xForIndex, yForValue } from "./timeSeriesLayout";
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

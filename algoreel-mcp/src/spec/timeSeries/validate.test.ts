import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTimeSeriesSpec } from "./validate";

const VALID = {
  title: "India GDP: 1990-2025",
  xAxis: { label: "Year", values: [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025] },
  yAxis: { label: "GDP", unit: "USD billions" },
  series: [{ name: "India", values: [320, 480, 710, 900, 1700, 2100, 2700, 3900] }],
  animation: { mode: "progressive" },
};

test("a well-formed spec validates clean", () => {
  const result = validateTimeSeriesSpec(VALID);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects a series with fewer values than xAxis", () => {
  const spec = { ...VALID, series: [{ name: "India", values: VALID.series[0]!.values.slice(0, -1) }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /has 7 value\(s\) but xAxis has 8/);
});

test("rejects a series with more values than xAxis", () => {
  const spec = { ...VALID, series: [{ name: "India", values: [...VALID.series[0]!.values, 4200] }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /has 9 value\(s\) but xAxis has 8/);
});

test("rejects a non-finite value (zod's z.number() itself rejects NaN/Infinity)", () => {
  const spec = { ...VALID, series: [{ name: "India", values: [320, 480, 710, 900, 1700, 2100, 2700, Infinity] }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
});

test("rejects an empty series array", () => {
  const result = validateTimeSeriesSpec({ ...VALID, series: [] });
  assert.equal(result.valid, false);
});

test("rejects fewer than 2 xAxis values", () => {
  const result = validateTimeSeriesSpec({
    ...VALID,
    xAxis: { label: "Year", values: [1990] },
    series: [{ name: "India", values: [320] }],
  });
  assert.equal(result.valid, false);
});

test("rejects duplicate series names", () => {
  const result = validateTimeSeriesSpec({
    ...VALID,
    series: [VALID.series[0]!, { name: "India", values: VALID.series[0]!.values }],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /series names must be unique/);
});

test("rejects a missing title", () => {
  const { title: _title, ...rest } = VALID;
  const result = validateTimeSeriesSpec(rest);
  assert.equal(result.valid, false);
});

test("accepts string x-axis values (categorical, not just years)", () => {
  const result = validateTimeSeriesSpec({
    ...VALID,
    xAxis: { label: "Quarter", values: ["Q1", "Q2", "Q3"] },
    series: [{ name: "India", values: [1, 2, 3] }],
  });
  assert.equal(result.valid, true);
});

test("accepts a well-formed annotation", () => {
  const spec = { ...VALID, series: [{ ...VALID.series[0]!, annotations: [{ index: 4, label: "Post-liberalization surge" }] }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, true);
});

test("rejects an annotation index past the end of xAxis", () => {
  const spec = { ...VALID, series: [{ ...VALID.series[0]!, annotations: [{ index: 8, label: "out of range" }] }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /only has 8 point\(s\)/);
});

test("rejects two annotations on the same index", () => {
  const spec = {
    ...VALID,
    series: [{ ...VALID.series[0]!, annotations: [{ index: 3, label: "a" }, { index: 3, label: "b" }] }],
  };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /more than one annotation at the same index/);
});

test("rejects an annotation with an empty label", () => {
  const spec = { ...VALID, series: [{ ...VALID.series[0]!, annotations: [{ index: 0, label: "" }] }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
});

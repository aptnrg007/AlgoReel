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

test("rejects a non-finite value (zod's z.number() alone allows Infinity)", () => {
  const spec = { ...VALID, series: [{ name: "India", values: [320, 480, 710, 900, 1700, 2100, 2700, Infinity] }] };
  const result = validateTimeSeriesSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /not a finite number/);
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

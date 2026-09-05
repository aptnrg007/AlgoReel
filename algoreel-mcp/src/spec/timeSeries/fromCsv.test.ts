import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsvToTimeSeriesSpec } from "./fromCsv";
import { validateTimeSeriesSpec } from "./validate";

const OPTS = { title: "GDP", xAxisLabel: "Year", yAxisLabel: "GDP", yAxisUnit: "USD billions" };

test("parses a single-series CSV into a valid TimeSeriesSpec", () => {
  const csv = "year,india\n1990,320\n1995,480\n2000,710\n";
  const spec = parseCsvToTimeSeriesSpec(csv, OPTS);
  assert.deepEqual(spec.xAxis.values, [1990, 1995, 2000]);
  assert.deepEqual(spec.series, [{ name: "india", values: [320, 480, 710] }]);
  assert.equal(validateTimeSeriesSpec(spec).valid, true);
});

test("parses a multi-series CSV, one column per series", () => {
  const csv = "year,india,china\n1990,320,360\n1995,480,730\n";
  const spec = parseCsvToTimeSeriesSpec(csv, OPTS);
  assert.deepEqual(spec.series, [
    { name: "india", values: [320, 480] },
    { name: "china", values: [360, 730] },
  ]);
});

test("detects a numeric x-axis and keeps values as numbers", () => {
  const csv = "year,india\n1990,320\n";
  const spec = parseCsvToTimeSeriesSpec(csv, OPTS);
  assert.equal(typeof spec.xAxis.values[0], "number");
});

test("keeps a non-numeric x-axis as strings (e.g. quarters)", () => {
  const csv = "quarter,revenue\nQ1,100\nQ2,150\n";
  const spec = parseCsvToTimeSeriesSpec(csv, OPTS);
  assert.deepEqual(spec.xAxis.values, ["Q1", "Q2"]);
});

test("tolerates surrounding whitespace around cells", () => {
  const csv = "year, india \n 1990 , 320 \n";
  const spec = parseCsvToTimeSeriesSpec(csv, OPTS);
  assert.deepEqual(spec.series[0]!.values, [320]);
  assert.equal(spec.series[0]!.name, "india");
});

test("throws on a row with the wrong column count", () => {
  const csv = "year,india,china\n1990,320,360\n1995,480\n";
  assert.throws(() => parseCsvToTimeSeriesSpec(csv, OPTS), /row 3 has 2 column\(s\), expected 3/);
});

test("throws on a non-numeric series cell", () => {
  const csv = "year,india\n1990,not-a-number\n";
  assert.throws(() => parseCsvToTimeSeriesSpec(csv, OPTS), /row 2, column "india": "not-a-number" is not a finite number/);
});

test("throws on an empty series cell", () => {
  const csv = "year,india\n1990,\n";
  assert.throws(() => parseCsvToTimeSeriesSpec(csv, OPTS), /is not a finite number/);
});

test("throws when the CSV has only a header row", () => {
  const csv = "year,india\n";
  assert.throws(() => parseCsvToTimeSeriesSpec(csv, OPTS), /header row and at least one data row/);
});

test("throws when the header has fewer than 2 columns", () => {
  const csv = "year\n1990\n";
  assert.throws(() => parseCsvToTimeSeriesSpec(csv, OPTS), /at least 2 columns/);
});

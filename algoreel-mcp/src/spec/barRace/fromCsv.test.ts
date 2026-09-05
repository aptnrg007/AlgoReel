import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsvToBarRaceSpec } from "./fromCsv";
import { validateBarRaceSpec } from "./validate";

const OPTS = { title: "GDP Race", xAxisLabel: "Year", valueLabel: "GDP (USD billions)" };

test("parses a multi-entry CSV into a valid BarRaceSpec", () => {
  const csv = "year,usa,china\n1990,5900,360\n2000,10250,1210\n";
  const spec = parseCsvToBarRaceSpec(csv, OPTS);
  assert.deepEqual(spec.xAxis.values, [1990, 2000]);
  assert.deepEqual(spec.entries, [
    { name: "usa", values: [5900, 10250] },
    { name: "china", values: [360, 1210] },
  ]);
  assert.equal(validateBarRaceSpec(spec).valid, true);
});

test("throws when there are fewer than 2 entry columns (a race needs entries to rank)", () => {
  const csv = "year,usa\n1990,5900\n";
  assert.throws(() => parseCsvToBarRaceSpec(csv, OPTS), /at least 3 columns/);
});

test("throws on a row with the wrong column count", () => {
  const csv = "year,usa,china\n1990,5900,360\n2000,10250\n";
  assert.throws(() => parseCsvToBarRaceSpec(csv, OPTS), /row 3 has 2 column\(s\), expected 3/);
});

test("throws on a non-numeric entry cell", () => {
  const csv = "year,usa,china\n1990,not-a-number,360\n";
  assert.throws(() => parseCsvToBarRaceSpec(csv, OPTS), /column "usa": "not-a-number" is not a finite number/);
});

test("throws when the CSV has only a header row", () => {
  const csv = "year,usa,china\n";
  assert.throws(() => parseCsvToBarRaceSpec(csv, OPTS), /header row and at least one data row/);
});

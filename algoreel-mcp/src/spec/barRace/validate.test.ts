import assert from "node:assert/strict";
import { test } from "node:test";

import { validateBarRaceSpec } from "./validate";

const VALID = {
  title: "Largest Economies",
  xAxis: { label: "Year", values: [1990, 2000, 2010, 2020] },
  valueLabel: "GDP (USD billions)",
  entries: [
    { name: "USA", values: [5900, 10250, 14990, 21430] },
    { name: "Japan", values: [3130, 4970, 5700, 5050] },
    { name: "China", values: [360, 1210, 6100, 14720] },
  ],
};

test("a well-formed spec validates clean", () => {
  const result = validateBarRaceSpec(VALID);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects an entry with fewer values than xAxis", () => {
  const spec = { ...VALID, entries: [{ ...VALID.entries[0]!, values: VALID.entries[0]!.values.slice(0, -1) }, ...VALID.entries.slice(1)] };
  const result = validateBarRaceSpec(spec);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /has 3 value\(s\) but xAxis has 4/);
});

test("rejects fewer than 2 entries", () => {
  const result = validateBarRaceSpec({ ...VALID, entries: [VALID.entries[0]!] });
  assert.equal(result.valid, false);
});

test("rejects fewer than 2 xAxis steps", () => {
  const result = validateBarRaceSpec({
    ...VALID,
    xAxis: { label: "Year", values: [1990] },
    entries: VALID.entries.map((e) => ({ name: e.name, values: [e.values[0]!] })),
  });
  assert.equal(result.valid, false);
});

test("rejects duplicate entry names", () => {
  const result = validateBarRaceSpec({ ...VALID, entries: [VALID.entries[0]!, { name: "USA", values: VALID.entries[0]!.values }] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /entry names must be unique/);
});

test("rejects a missing valueLabel", () => {
  const { valueLabel: _valueLabel, ...rest } = VALID;
  const result = validateBarRaceSpec(rest);
  assert.equal(result.valid, false);
});

test("accepts string x-axis values (categorical steps, not just years)", () => {
  const result = validateBarRaceSpec({
    ...VALID,
    xAxis: { label: "Quarter", values: ["Q1", "Q2", "Q3"] },
    entries: [
      { name: "USA", values: [1, 2, 3] },
      { name: "Japan", values: [1, 1, 1] },
    ],
  });
  assert.equal(result.valid, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkBarRaceRender } from "./checkRender";
import type { BarRaceSpec } from "./types";

const GDP_RACE: BarRaceSpec = {
  title: "Largest Economies",
  xAxis: { label: "Year", values: [1990, 2000, 2010, 2020] },
  valueLabel: "GDP (USD billions)",
  entries: [
    { name: "USA", values: [5900, 10250, 14990, 21430] },
    { name: "Japan", values: [3130, 4970, 5700, 5050] },
    { name: "China", values: [360, 1210, 6100, 14720] },
    { name: "Germany", values: [1770, 1950, 3400, 3860] },
    { name: "India", values: [320, 480, 1670, 2670] },
  ],
};

function codes(failures: { code: string }[]): string[] {
  return failures.map((f) => f.code);
}

test("the committed GDP race demo spec is clean end to end at its real duration", () => {
  const result = checkBarRaceRender(GDP_RACE, 20);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pass, true);
});

test("bar-race-too-many-entries fires when there are more entries than fit the fixed row height", () => {
  const spec: BarRaceSpec = {
    ...GDP_RACE,
    entries: Array.from({ length: 20 }, (_, i) => ({ name: `Entry ${i}`, values: [1, 2, 3, 4] })),
  };
  const result = checkBarRaceRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("bar-race-too-many-entries"));
});

test("entry-name-too-wide fires for a name wider than the fixed label column", () => {
  const spec: BarRaceSpec = {
    ...GDP_RACE,
    entries: [{ name: "A".repeat(80), values: [1, 2, 3, 4] }, GDP_RACE.entries[1]!],
  };
  const result = checkBarRaceRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("entry-name-too-wide"));
});

test("value-label-too-wide fires for unscaled huge values", () => {
  const spec: BarRaceSpec = {
    ...GDP_RACE,
    entries: [
      { name: "USA", values: [5.9e14, 1.0e15, 1.5e15, 2.1e15] },
      { name: "Japan", values: [3.1e14, 5.0e14, 5.7e14, 5.1e14] },
    ],
  };
  const result = checkBarRaceRender(spec, 20);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("value-label-too-wide"));
});

test("duration-too-short fires below the 1s minimum", () => {
  const result = checkBarRaceRender(GDP_RACE, 0.5);
  assert.equal(result.pass, false);
  assert.ok(codes(result.failures).includes("duration-too-short"));
});

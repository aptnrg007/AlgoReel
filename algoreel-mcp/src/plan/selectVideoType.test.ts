import assert from "node:assert/strict";
import { test } from "node:test";

import { selectVideoType } from "./selectVideoType";

test("csv input decides time_series deterministically, with zero model calls", async () => {
  const result = await selectVideoType(
    { csv: "year,india\n1990,320\n" },
    { chooseVideoType: () => { throw new Error("should not be called"); } },
  );
  assert.equal(result.videoType, "time_series");
  assert.equal(result.rung, undefined);
});

test("TimeSeriesSpec-shaped data decides time_series deterministically", async () => {
  const data = { title: "x", xAxis: { label: "Year", values: [1, 2] }, yAxis: { label: "y" }, series: [{ name: "a", values: [1, 2] }] };
  const result = await selectVideoType(
    { prompt: "make me a video", data },
    { chooseVideoType: () => { throw new Error("should not be called"); } },
  );
  assert.equal(result.videoType, "time_series");
  assert.equal(result.rung, undefined);
});

test("a direct DSA topic matches an existing algorithm by keyword, with zero model calls", async () => {
  const result = await selectVideoType(
    { prompt: "explain bubble sort" },
    { chooseVideoType: () => { throw new Error("should not be called"); } },
  );
  assert.equal(result.videoType, "dsa");
  assert.equal(result.rung, undefined);
});

test("a GDP/year-range prompt matches time-series vocabulary, with zero model calls", async () => {
  const result = await selectVideoType(
    { prompt: "Create a video showing India's GDP from 1990 to 2025" },
    { chooseVideoType: () => { throw new Error("should not be called"); } },
  );
  assert.equal(result.videoType, "time_series");
  assert.equal(result.rung, undefined);
});

test("an ambiguous prompt (neither signal) goes through the selection ladder and the returned choice is used", async () => {
  const result = await selectVideoType(
    { prompt: "make something cool about frogs" },
    { chooseVideoType: async () => JSON.stringify({ videoType: "dsa" }) },
  );
  assert.equal(result.videoType, "dsa");
  assert.equal(result.rung, 0);
});

test("a prompt matching both signals at once is still treated as ambiguous and goes through the ladder", async () => {
  // Matches bubbleSort by keyword ("bubble" + "sort" both present) AND
  // time-series vocabulary ("gdp") — neither deterministic path should
  // win outright when both fire.
  const result = await selectVideoType(
    { prompt: "explain bubble sort while tracking gdp over time" },
    { chooseVideoType: async () => JSON.stringify({ videoType: "time_series" }) },
  );
  assert.equal(result.videoType, "time_series");
  assert.equal(result.rung, 0);
});

test("throws when given neither a prompt nor data/csv", async () => {
  await assert.rejects(() => selectVideoType({}), /needs a prompt, or data\/csv/);
});

test("csv takes priority even when a prompt is also given", async () => {
  const result = await selectVideoType(
    { prompt: "explain bubble sort", csv: "year,india\n1990,320\n" },
    { chooseVideoType: () => { throw new Error("should not be called"); } },
  );
  assert.equal(result.videoType, "time_series");
});

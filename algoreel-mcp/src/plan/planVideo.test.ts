import assert from "node:assert/strict";
import { test } from "node:test";

import { PlanVideoError, planVideo } from "./planVideo";
import type { StorySpec } from "../spec/types";

const CANNED_STORY_SPEC: StorySpec = {
  version: 1,
  topic: "explain bubble sort",
  targetDurationSec: 30,
  hook: "hook",
  narration: [
    { beat: "op:0", text: "first" },
    { beat: "outro", text: "outro" },
  ],
  emphasis: [],
  complexity: { time: "O(n^2)", space: "O(1)" },
  youtube: { title: "t", description: "d", tags: ["x"] },
  algorithm: "bubbleSort",
  input: { array: [3, 1, 2] },
};

test("a DSA request calls ensureSpec with the prompt as topic and wraps the result", async () => {
  let calledWith: { topic: string } | undefined;
  const plan = await planVideo(
    { prompt: "explain bubble sort" },
    {
      ensureSpec: async (req) => {
        calledWith = req;
        return { spec: CANNED_STORY_SPEC, narrateRung: 0, repairRounds: 0, notes: [] };
      },
    },
  );
  assert.equal(calledWith?.topic, "explain bubble sort");
  assert.equal(plan.videoType, "dsa");
  assert.deepEqual(plan.payload, CANNED_STORY_SPEC);
  assert.equal(plan.targetDurationSec, CANNED_STORY_SPEC.targetDurationSec);
});

test("a time-series request with supplied JSON data produces a TimeSeriesVideoPlan", async () => {
  const data = {
    title: "India GDP",
    xAxis: { label: "Year", values: [1990, 2000] },
    yAxis: { label: "GDP" },
    series: [{ name: "India", values: [320, 710] }],
  };
  const plan = await planVideo({ data, targetDurationSec: 15 });
  assert.equal(plan.videoType, "time_series");
  assert.deepEqual(plan.payload, data);
  assert.equal(plan.targetDurationSec, 15);
});

test("a time-series request defaults targetDurationSec when none is given", async () => {
  const data = {
    title: "x",
    xAxis: { label: "Year", values: [1990, 2000] },
    yAxis: { label: "y" },
    series: [{ name: "a", values: [1, 2] }],
  };
  const plan = await planVideo({ data });
  assert.equal(plan.targetDurationSec, 20);
});

test("a time-series request with CSV input normalizes it via fromCsv", async () => {
  const plan = await planVideo({
    csv: "year,india\n1990,320\n2000,710\n",
    csvOptions: { title: "India GDP", xAxisLabel: "Year", yAxisLabel: "GDP" },
  });
  assert.equal(plan.videoType, "time_series");
  if (plan.videoType === "time_series") {
    assert.deepEqual(plan.payload.series, [{ name: "india", values: [320, 710] }]);
  }
});

test("csv input without csvOptions is a clear PlanVideoError, not a crash", async () => {
  await assert.rejects(() => planVideo({ csv: "year,india\n1990,320\n" }), (err) => {
    assert.ok(err instanceof PlanVideoError);
    assert.match(err.message, /csvOptions/);
    return true;
  });
});

test("a time-series request with no data or csv is a clear PlanVideoError, not a hallucinated dataset", async () => {
  await assert.rejects(
    () => planVideo({ prompt: "show India's GDP from 1990 to 2025" }),
    (err) => {
      assert.ok(err instanceof PlanVideoError);
      assert.match(err.message, /does not fetch external data/);
      return true;
    },
  );
});

test("invalid supplied data is a clear PlanVideoError", async () => {
  const badData = { title: "x", xAxis: { label: "Year", values: [1990, 2000] }, yAxis: { label: "y" }, series: [] };
  await assert.rejects(() => planVideo({ data: badData }), (err) => {
    assert.ok(err instanceof PlanVideoError);
    assert.match(err.message, /supplied data is invalid/);
    return true;
  });
});

test("supplied data that fails check_render is a clear PlanVideoError before any render is attempted", async () => {
  const data = {
    title: "Too Many Points",
    xAxis: { label: "Year", values: Array.from({ length: 30 }, (_, i) => 1990 + i) },
    yAxis: { label: "y" },
    series: [{ name: "a", values: Array.from({ length: 30 }, (_, i) => i) }],
  };
  await assert.rejects(() => planVideo({ data, targetDurationSec: 20 }), (err) => {
    assert.ok(err instanceof PlanVideoError);
    assert.match(err.message, /fails check_render/);
    return true;
  });
});

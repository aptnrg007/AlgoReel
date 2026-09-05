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

test("a time-series request with no data/csv and no extractable World Bank request is a clear PlanVideoError, not a hallucinated dataset", async () => {
  // Matches time-series vocabulary ("revenue growth") but names no known
  // country/indicator, so extractWorldBankRequest can't fire either.
  await assert.rejects(
    () => planVideo({ prompt: "show revenue growth over time" }),
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

test("supplied data with an unfixable check_render failure (not duration-shaped) is a clear PlanVideoError", async () => {
  const data = {
    title: "Unscaled",
    xAxis: { label: "Year", values: [1990, 2000] },
    yAxis: { label: "y" },
    series: [{ name: "a", values: [3.9e14, 4.6e14] }],
  };
  await assert.rejects(() => planVideo({ data, targetDurationSec: 20 }), (err) => {
    assert.ok(err instanceof PlanVideoError);
    assert.match(err.message, /fails check_render/);
    return true;
  });
});

test("a wide dataset (many points) is no longer rejected outright — labels thin instead", async () => {
  const data = {
    title: "Many Points",
    xAxis: { label: "Year", values: Array.from({ length: 30 }, (_, i) => 1990 + i) },
    yAxis: { label: "y" },
    series: [{ name: "a", values: Array.from({ length: 30 }, (_, i) => i) }],
  };
  const plan = await planVideo({ data, targetDurationSec: 20 });
  assert.equal(plan.videoType, "time_series");
});

test("a too-short targetDurationSec is repaired to the minimum sufficient duration, not rejected", async () => {
  const data = {
    title: "x",
    xAxis: { label: "Year", values: [1990, 1995, 2000, 2005, 2010] },
    yAxis: { label: "y" },
    series: [{ name: "a", values: [1, 2, 3, 4, 5] }],
  };
  const plan = await planVideo({ data, targetDurationSec: 0.1 });
  assert.equal(plan.videoType, "time_series");
  assert.ok(plan.targetDurationSec >= 1, `expected a repaired duration >= 1s, got ${plan.targetDurationSec}`);
});

test("a duration request that already passes is left untouched, not silently widened", async () => {
  const data = {
    title: "x",
    xAxis: { label: "Year", values: [1990, 1995, 2000] },
    yAxis: { label: "y" },
    series: [{ name: "a", values: [1, 2, 3] }],
  };
  const plan = await planVideo({ data, targetDurationSec: 20 });
  assert.equal(plan.targetDurationSec, 20);
});

test("a bar-race request with supplied JSON data produces a BarRaceVideoPlan", async () => {
  const data = {
    title: "Largest Economies",
    xAxis: { label: "Year", values: [1990, 2000] },
    valueLabel: "GDP (USD billions)",
    entries: [
      { name: "USA", values: [5900, 10250] },
      { name: "China", values: [360, 1210] },
    ],
  };
  const plan = await planVideo({ data, targetDurationSec: 15 });
  assert.equal(plan.videoType, "bar_race");
  assert.deepEqual(plan.payload, data);
  assert.equal(plan.targetDurationSec, 15);
});

test("a bar-race request with CSV input normalizes it via barRace/fromCsv", async () => {
  const plan = await planVideo({
    prompt: "a bar chart race",
    csv: "year,usa,china\n1990,5900,360\n2000,10250,1210\n",
    barRaceCsvOptions: { title: "GDP Race", xAxisLabel: "Year", valueLabel: "GDP (USD billions)" },
  });
  assert.equal(plan.videoType, "bar_race");
  if (plan.videoType === "bar_race") {
    assert.deepEqual(plan.payload.entries, [
      { name: "usa", values: [5900, 10250] },
      { name: "china", values: [360, 1210] },
    ]);
  }
});

test("bar-race csv input without barRaceCsvOptions is a clear PlanVideoError, not a crash", async () => {
  await assert.rejects(
    () => planVideo({ prompt: "a bar chart race", csv: "year,usa,china\n1990,5900,360\n" }),
    (err) => {
      assert.ok(err instanceof PlanVideoError);
      assert.match(err.message, /barRaceCsvOptions/);
      return true;
    },
  );
});

test("a bar-race request with no data or csv is a clear PlanVideoError, not a hallucinated dataset", async () => {
  await assert.rejects(
    () => planVideo({ prompt: "show the ranking of the biggest tech companies changing" }),
    (err) => {
      assert.ok(err instanceof PlanVideoError);
      assert.match(err.message, /does not fetch external data/);
      return true;
    },
  );
});

test("a too-short bar-race duration is repaired to the minimum, not rejected", async () => {
  const data = {
    title: "x",
    xAxis: { label: "Year", values: [1990, 2000] },
    valueLabel: "v",
    entries: [
      { name: "A", values: [1, 2] },
      { name: "B", values: [2, 1] },
    ],
  };
  const plan = await planVideo({ data, targetDurationSec: 0.1 });
  assert.equal(plan.videoType, "bar_race");
  assert.ok(plan.targetDurationSec >= 1);
});

const CANNED_WORLD_BANK_SPEC = {
  title: "Brazil: GDP (current US$)",
  xAxis: { label: "Year", values: [1990, 2000, 2010] },
  yAxis: { label: "GDP (current US$)", unit: "USD billions" },
  series: [{ name: "Brazil", values: [461, 655, 2209] }],
};

test("a natural GDP-for-country request with no data/csv fetches from World Bank automatically", async () => {
  let calledWith: unknown;
  const plan = await planVideo(
    { prompt: "Create a GDP timelapse for Brazil", targetDurationSec: 15 },
    {
      fetchWorldBankTimeSeries: async (opts) => {
        calledWith = opts;
        return { spec: CANNED_WORLD_BANK_SPEC, sourceUrl: "https://api.worldbank.org/v2/country/BR/indicator/NY.GDP.MKTP.CD?format=json", retrievedAt: "2026-01-01T00:00:00.000Z" };
      },
    },
  );
  assert.equal(plan.videoType, "time_series");
  assert.deepEqual(plan.payload, CANNED_WORLD_BANK_SPEC);
  assert.equal((calledWith as { countryCode: string }).countryCode, "BR");
  assert.equal((calledWith as { indicatorCode: string }).indicatorCode, "NY.GDP.MKTP.CD");
  // Provenance stamped into the plan's description, not silently dropped.
  assert.match(plan.description ?? "", /World Bank API/);
  assert.match(plan.description ?? "", /api\.worldbank\.org/);
});

test("an explicit worldBank field takes precedence and is used even without a matching prompt", async () => {
  const plan = await planVideo(
    { worldBank: { countryCode: "ZZ", indicatorCode: "SP.POP.TOTL" }, targetDurationSec: 15 },
    {
      fetchWorldBankTimeSeries: async (opts) => {
        assert.equal(opts.countryCode, "ZZ");
        assert.equal(opts.indicatorCode, "SP.POP.TOTL");
        return { spec: CANNED_WORLD_BANK_SPEC, sourceUrl: "https://example.test/", retrievedAt: "2026-01-01T00:00:00.000Z" };
      },
    },
  );
  assert.equal(plan.videoType, "time_series");
});

test("an explicit description overrides World Bank provenance rather than being silently discarded", async () => {
  const plan = await planVideo(
    { prompt: "GDP timelapse for Brazil", description: "my own description", targetDurationSec: 15 },
    { fetchWorldBankTimeSeries: async () => ({ spec: CANNED_WORLD_BANK_SPEC, sourceUrl: "https://example.test/", retrievedAt: "2026-01-01T00:00:00.000Z" }) },
  );
  assert.equal(plan.description, "my own description");
});

test("a World Bank fetch failure surfaces as a clear PlanVideoError, not an uncaught exception", async () => {
  await assert.rejects(
    () =>
      planVideo(
        { prompt: "GDP timelapse for Brazil" },
        { fetchWorldBankTimeSeries: async () => { throw new Error("network unreachable"); } },
      ),
    (err) => {
      assert.ok(err instanceof PlanVideoError);
      assert.match(err.message, /could not fetch World Bank data/);
      return true;
    },
  );
});

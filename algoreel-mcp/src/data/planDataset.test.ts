import assert from "node:assert/strict";
import { test } from "node:test";

import { planDataset } from "./planDataset";
import type { DatasetSchema } from "./types";

const POPULATION_SCHEMA: DatasetSchema = {
  columns: [
    { name: "Country", type: "categorical" },
    { name: "Year", type: "numeric" },
    { name: "Population", type: "numeric" },
    { name: "Region", type: "categorical" },
  ],
  rowCount: 6,
  sampleRows: [
    { Country: "India", Year: "1950", Population: "376325200", Region: "Asia" },
    { Country: "China", Year: "1950", Population: "554419000", Region: "Asia" },
  ],
};

test("returns a time_series DataPlan when the agent answers with one", async () => {
  const result = await planDataset(
    { prompt: "show India's population over time", schema: POPULATION_SCHEMA },
    {
      planDataset: async () =>
        JSON.stringify({
          videoType: "time_series",
          xColumn: "Year",
          yColumns: ["Population"],
          filters: [{ column: "Country", value: "India" }],
        }),
    },
  );
  assert.equal(result.plan.videoType, "time_series");
  assert.equal(result.rung, 0);
});

test("returns a bar_race DataPlan when the agent answers with one", async () => {
  const result = await planDataset(
    { prompt: "top countries by population, 1950 to 1960", schema: POPULATION_SCHEMA },
    {
      planDataset: async () =>
        JSON.stringify({
          videoType: "bar_race",
          entityColumn: "Country",
          periodColumn: "Year",
          valueColumn: "Population",
          topN: 10,
        }),
    },
  );
  assert.equal(result.plan.videoType, "bar_race");
  if (result.plan.videoType === "bar_race") {
    assert.equal(result.plan.topN, 10);
  }
});

test("a plan referencing a column that doesn't exist is rejected and retried, not silently accepted", async () => {
  let calls = 0;
  const result = await planDataset(
    { prompt: "population over time", schema: POPULATION_SCHEMA },
    {
      planDataset: async () => {
        calls++;
        if (calls === 1) {
          return JSON.stringify({ videoType: "time_series", xColumn: "Yeer", yColumns: ["Population"] });
        }
        return JSON.stringify({ videoType: "time_series", xColumn: "Year", yColumns: ["Population"] });
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.plan.videoType, "time_series");
});

test("a plan referencing an unknown filter column is rejected the same way", async () => {
  let calls = 0;
  await planDataset(
    { prompt: "population over time", schema: POPULATION_SCHEMA },
    {
      planDataset: async () => {
        calls++;
        if (calls === 1) {
          return JSON.stringify({
            videoType: "time_series",
            xColumn: "Year",
            yColumns: ["Population"],
            filters: [{ column: "Continent", value: "Asia" }],
          });
        }
        return JSON.stringify({
          videoType: "time_series",
          xColumn: "Year",
          yColumns: ["Population"],
          filters: [{ column: "Region", value: "Asia" }],
        });
      },
    },
  );
  assert.equal(calls, 2);
});

test("a structurally invalid answer (missing required field) is rejected by the schema, not crash the process", async () => {
  await assert.rejects(
    () =>
      planDataset(
        { prompt: "population over time", schema: POPULATION_SCHEMA },
        { planDataset: async () => JSON.stringify({ videoType: "time_series", yColumns: ["Population"] }) },
      ),
    /could not produce a data plan/,
  );
});

test("exhausting the ladder is a clear PlanDataset error, not a hang", async () => {
  await assert.rejects(
    () =>
      planDataset(
        { prompt: "population over time", schema: POPULATION_SCHEMA },
        { planDataset: async () => "not json at all" },
      ),
    /could not produce a data plan for "population over time"/,
  );
});

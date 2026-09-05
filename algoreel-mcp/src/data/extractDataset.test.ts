import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { extractDataset } from "./extractDataset";
import type { BarRaceDataPlan, TimeSeriesDataPlan } from "./types";
import { validateBarRaceSpec } from "../spec/barRace/validate";
import { validateTimeSeriesSpec } from "../spec/timeSeries/validate";

function withFile(name: string, contents: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "extract-dataset-test-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const POPULATION_CSV =
  "Country,Year,Population,Region\n" +
  "India,1990,870000000,Asia\n" +
  "India,2000,1056000000,Asia\n" +
  "India,2010,1234000000,Asia\n" +
  "China,1990,1176000000,Asia\n" +
  "China,2000,1290000000,Asia\n" +
  "China,2010,1341000000,Asia\n" +
  "USA,1990,250000000,Americas\n" +
  "USA,2000,282000000,Americas\n" +
  "USA,2010,309000000,Americas\n";

// --- time_series ---------------------------------------------------------

test("extracts a filtered, single-entity time_series (auto-scaled — see the dedicated scaling tests below)", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = {
      videoType: "time_series",
      xColumn: "Year",
      yColumns: ["Population"],
      filters: [{ column: "Country", value: "India" }],
    };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.xAxis.values, [1990, 2000, 2010]);
    assert.deepEqual(spec.series, [{ name: "Population", values: [0.87, 1.056, 1.234] }]);
    assert.equal(spec.yAxis.unit, "billions");
    assert.equal(spec.title, "Population (India)");
  });
});

test("range restricts the x/period column", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = {
      videoType: "time_series",
      xColumn: "Year",
      yColumns: ["Population"],
      filters: [{ column: "Country", value: "India" }],
      range: { column: "Year", from: "1995", to: "2010" },
    };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.xAxis.values, [2000, 2010]);
  });
});

test("an unknown column in the plan is a clear error naming the real columns", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Yeer", yColumns: ["Population"] };
    assert.throws(() => extractDataset(path, plan), /unknown column\(s\).*Yeer.*Country, Year, Population, Region/s);
  });
});

test("a range on a column other than the x/period column is rejected", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = {
      videoType: "time_series",
      xColumn: "Year",
      yColumns: ["Population"],
      range: { column: "Population", from: "0" },
    };
    assert.throws(() => extractDataset(path, plan), /range must be on the x\/period column \("Year"\)/);
  });
});

test("a filter matching zero rows is a clear error, not an empty spec", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = {
      videoType: "time_series",
      xColumn: "Year",
      yColumns: ["Population"],
      filters: [{ column: "Country", value: "Brazil" }],
    };
    assert.throws(() => extractDataset(path, plan), /no rows matched/);
  });
});

test("multiple rows sharing an x-axis value (forgot to filter to one entity) is a clear error", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Population"] };
    assert.throws(() => extractDataset(path, plan), /multiple rows share x-axis value "1990"/);
  });
});

test("a non-numeric value in a value column is a hard error, not silently skipped", () => {
  const csv = "Year,Population\n1990,870000000\n2000,not-a-number\n2010,1234000000\n";
  withFile("pop.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Population"] };
    assert.throws(() => extractDataset(path, plan), /non-numeric value "not-a-number"/);
  });
});

test("an empty cell is a real gap — the point is dropped, not errored on", () => {
  const csv = "Year,Population\n1990,870000000\n2000,\n2010,1234000000\n";
  withFile("pop.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Population"] };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.xAxis.values, [1990, 2010]);
  });
});

test("fewer than 2 complete points after gaps are dropped is a clear error", () => {
  const csv = "Year,Population\n1990,870000000\n2000,\n2010,\n";
  withFile("pop.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Population"] };
    assert.throws(() => extractDataset(path, plan), /fewer than 2 complete x-axis point/);
  });
});

test("multiple yColumns produce multiple series, still aligned to a shared x-axis", () => {
  const csv = "Year,India,China\n1990,870,1176\n2000,1056,1290\n2010,1234,1341\n";
  withFile("pop.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["India", "China"] };
    const spec = extractDataset(path, plan);
    assert.deepEqual(
      spec.series.map((s) => s.name),
      ["India", "China"],
    );
    assert.deepEqual(spec.series[0]!.values, [870, 1056, 1234]);
    assert.deepEqual(spec.series[1]!.values, [1176, 1290, 1341]);
  });
});

// --- bar_race --------------------------------------------------------------

test("extracts a bar_race with entities ranked by their latest value, topN applied", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: BarRaceDataPlan = {
      videoType: "bar_race",
      entityColumn: "Country",
      periodColumn: "Year",
      valueColumn: "Population",
      topN: 2,
    };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.xAxis.values, [1990, 2000, 2010]);
    assert.deepEqual(
      spec.entries.map((e) => e.name),
      ["China", "India"],
    );
    assert.equal(spec.valueLabel, "Population (billions)");
  });
});

test("bar_race range restricts the period column", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: BarRaceDataPlan = {
      videoType: "bar_race",
      entityColumn: "Country",
      periodColumn: "Year",
      valueColumn: "Population",
      range: { column: "Year", from: "1990", to: "2000" },
    };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.xAxis.values, [1990, 2000]);
  });
});

test("bar_race filters restrict which entities are considered", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: BarRaceDataPlan = {
      videoType: "bar_race",
      entityColumn: "Country",
      periodColumn: "Year",
      valueColumn: "Population",
      filters: [{ column: "Region", value: "Asia" }],
    };
    const spec = extractDataset(path, plan);
    assert.deepEqual(
      spec.entries.map((e) => e.name).sort(),
      ["China", "India"],
    );
  });
});

test("a duplicate (entity, period) pair is a hard error", () => {
  const csv = "Country,Year,Population\nIndia,1990,870\nIndia,1990,871\n";
  withFile("pop.csv", csv, (path) => {
    const plan: BarRaceDataPlan = { videoType: "bar_race", entityColumn: "Country", periodColumn: "Year", valueColumn: "Population" };
    assert.throws(() => extractDataset(path, plan), /duplicate \(entity, period\) pair: entity "India"/);
  });
});

test("a non-numeric value column is a hard error", () => {
  const csv = "Country,Year,Population\nIndia,1990,not-a-number\n";
  withFile("pop.csv", csv, (path) => {
    const plan: BarRaceDataPlan = { videoType: "bar_race", entityColumn: "Country", periodColumn: "Year", valueColumn: "Population" };
    assert.throws(() => extractDataset(path, plan), /non-numeric value "not-a-number"/);
  });
});

test("a selected entity's missing period narrows the race to the intersection, not an error", () => {
  const csv = "Country,Year,Population\nIndia,1990,870\nIndia,2000,1056\nIndia,2010,1234\nChina,1990,1176\nChina,2000,1290\n";
  withFile("pop.csv", csv, (path) => {
    const plan: BarRaceDataPlan = { videoType: "bar_race", entityColumn: "Country", periodColumn: "Year", valueColumn: "Population" };
    const spec = extractDataset(path, plan);
    // China has no 2010 row — only the periods both entities share survive.
    assert.deepEqual(spec.xAxis.values, [1990, 2000]);
  });
});

test("too few periods survive the intersection is a clear error naming the selected entities", () => {
  const csv = "Country,Year,Population\nIndia,1990,870\nChina,2000,1176\n";
  withFile("pop.csv", csv, (path) => {
    const plan: BarRaceDataPlan = { videoType: "bar_race", entityColumn: "Country", periodColumn: "Year", valueColumn: "Population" };
    assert.throws(() => extractDataset(path, plan), /fewer than 2 period\(s\).*Selected entities: China, India/s);
  });
});

// --- output actually satisfies the existing spec validators ---------------

test("a time_series extraction always satisfies validateTimeSeriesSpec", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Population"], filters: [{ column: "Country", value: "India" }] };
    const spec = extractDataset(path, plan);
    assert.equal(validateTimeSeriesSpec(spec).valid, true);
  });
});

test("a bar_race extraction always satisfies validateBarRaceSpec", () => {
  withFile("pop.csv", POPULATION_CSV, (path) => {
    const plan: BarRaceDataPlan = { videoType: "bar_race", entityColumn: "Country", periodColumn: "Year", valueColumn: "Population" };
    const spec = extractDataset(path, plan);
    assert.equal(validateBarRaceSpec(spec).valid, true);
  });
});

// --- auto-scale for large raw values (found live: raw population/GDP-
// scale numbers blow checkTimeSeriesRender/checkBarRaceRender's
// label-width budget the same way World Bank's raw GDP dollars did) ----

test("small values (below 1e6) are never scaled", () => {
  const csv = "Year,Value\n1990,100\n2000,250\n2010,500\n";
  withFile("small.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Value"] };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.series[0]!.values, [100, 250, 500]);
    assert.equal(spec.yAxis.unit, undefined);
  });
});

test("values in the millions are scaled to millions", () => {
  const csv = "Year,Value\n1990,2000000\n2000,3500000\n2010,5000000\n";
  withFile("millions.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Value"] };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.series[0]!.values, [2, 3.5, 5]);
    assert.equal(spec.yAxis.unit, "millions");
  });
});

test("values at or above 1e9 are scaled to billions", () => {
  const csv = "Year,Value\n1990,2000000000\n2000,3500000000\n";
  withFile("billions.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Value"] };
    const spec = extractDataset(path, plan);
    assert.deepEqual(spec.series[0]!.values, [2, 3.5]);
    assert.equal(spec.yAxis.unit, "billions");
  });
});

test("a caller-supplied yAxisUnit overrides the auto-picked one, but the values are still scaled to match", () => {
  const csv = "Year,Value\n1990,2000000000\n2000,3500000000\n";
  withFile("billions.csv", csv, (path) => {
    const plan: TimeSeriesDataPlan = { videoType: "time_series", xColumn: "Year", yColumns: ["Value"] };
    const spec = extractDataset(path, plan, { yAxisUnit: "USD billions" });
    assert.equal(spec.yAxis.unit, "USD billions");
    assert.deepEqual(spec.series[0]!.values, [2, 3.5]);
  });
});

test("bar_race values are scaled the same way, folded into valueLabel since bar_race has no separate unit field", () => {
  const csv = "Country,Year,Value\nA,1990,2000000000\nA,2000,3500000000\nB,1990,1000000000\nB,2000,1500000000\n";
  withFile("billions.csv", csv, (path) => {
    const plan: BarRaceDataPlan = { videoType: "bar_race", entityColumn: "Country", periodColumn: "Year", valueColumn: "Value" };
    const spec = extractDataset(path, plan);
    assert.equal(spec.valueLabel, "Value (billions)");
    assert.deepEqual(
      spec.entries.find((e) => e.name === "A")!.values,
      [2, 3.5],
    );
  });
});

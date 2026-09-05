import assert from "node:assert/strict";
import { test } from "node:test";

import { parseWorldBankResponse, worldBankUrl } from "./fromWorldBank";
import { validateTimeSeriesSpec } from "./validate";

const OPTS = { countryCode: "IN", indicatorCode: "NY.GDP.MKTP.CD", startYear: 1990, endYear: 2000 };

function observation(date: string, value: number | null) {
  return { date, value, country: { id: "IN", value: "India" }, indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" } };
}

test("worldBankUrl builds the real API shape, no auth needed", () => {
  const url = worldBankUrl(OPTS);
  assert.equal(url, "https://api.worldbank.org/v2/country/IN/indicator/NY.GDP.MKTP.CD?format=json&date=1990:2000&per_page=1000");
});

test("parseWorldBankResponse sorts newest-first observations into oldest-first and produces a valid spec", () => {
  const body = [
    { page: 1 },
    [observation("2000", 710), observation("1995", 480), observation("1990", 320)],
  ];
  const spec = parseWorldBankResponse(body, OPTS);
  assert.deepEqual(spec.xAxis.values, [1990, 1995, 2000]);
  assert.deepEqual(spec.series[0]!.values, [320, 480, 710]);
  assert.equal(spec.series[0]!.name, "India");
  assert.equal(validateTimeSeriesSpec(spec).valid, true);
});

test("parseWorldBankResponse skips real gaps (null values) rather than fabricating them", () => {
  const body = [{ page: 1 }, [observation("2000", 710), observation("1995", null), observation("1990", 320)]];
  const spec = parseWorldBankResponse(body, OPTS);
  assert.deepEqual(spec.xAxis.values, [1990, 2000]);
  assert.deepEqual(spec.series[0]!.values, [320, 710]);
});

test("throws when fewer than 2 real (non-null) observations remain", () => {
  const body = [{ page: 1 }, [observation("2000", 710), observation("1995", null), observation("1990", null)]];
  assert.throws(() => parseWorldBankResponse(body, OPTS), /fewer than 2 years of real data/);
});

test("throws when the API returns no observations at all", () => {
  const body = [{ page: 1 }, []];
  assert.throws(() => parseWorldBankResponse(body, OPTS), /no data for country/);
});

test("throws when the response isn't the expected [metadata, observations] shape", () => {
  assert.throws(() => parseWorldBankResponse({ error: "bad request" }, OPTS), /expected \[metadata, observations\] shape/);
  assert.throws(() => parseWorldBankResponse([{ page: 1 }], OPTS), /expected \[metadata, observations\] shape/);
});

test("titles and labels the spec from the real indicator/country names in the response, not the raw codes", () => {
  const body = [{ page: 1 }, [observation("1990", 320), observation("2000", 710)]];
  const spec = parseWorldBankResponse(body, OPTS);
  assert.equal(spec.title, "India: GDP (current US$)");
  assert.equal(spec.yAxis.label, "GDP (current US$)");
});

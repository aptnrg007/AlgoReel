import assert from "node:assert/strict";
import { test } from "node:test";

import { extractWorldBankRequest, scaleForIndicatorCode } from "./extractWorldBankRequest";

test("extracts a country and indicator from a natural request", () => {
  const result = extractWorldBankRequest("Create a GDP timelapse for Brazil");
  assert.deepEqual(result, {
    countryCode: "BR",
    countryName: "brazil",
    indicatorCode: "NY.GDP.MKTP.CD",
    yAxisUnit: "USD billions",
    scale: 1e9,
  });
});

test("matches a multi-word country name only when every word is present", () => {
  const result = extractWorldBankRequest("population growth in south korea");
  assert.equal(result?.countryCode, "KR");
  assert.equal(result?.indicatorCode, "SP.POP.TOTL");
});

test("returns null when only a country is named, no indicator", () => {
  assert.equal(extractWorldBankRequest("tell me about brazil"), null);
});

test("returns null when only an indicator is named, no country", () => {
  assert.equal(extractWorldBankRequest("show me gdp growth"), null);
});

test("returns null for a request naming neither", () => {
  assert.equal(extractWorldBankRequest("explain bubble sort"), null);
});

test("does not false-positive-match a country name as a substring of another word", () => {
  // Regression guard for the exact collision risk this file's own
  // comment calls out: "us" (if it were a dictionary key) would match
  // inside "russia" or "discuss" under naive substring matching.
  // "united states" requires both words present, so a sentence with
  // neither shouldn't match it.
  const result = extractWorldBankRequest("let us discuss GDP trends");
  assert.equal(result, null);
});

test("a real GDP-for-Russia request still matches correctly (not defeated by 'us' being a substring of 'russia')", () => {
  const result = extractWorldBankRequest("GDP timelapse for Russia");
  assert.equal(result?.countryCode, "RU");
});

test("scaleForIndicatorCode finds the right scale by real World Bank code, not just by keyword", () => {
  assert.deepEqual(scaleForIndicatorCode("NY.GDP.MKTP.CD"), { yAxisUnit: "USD billions", scale: 1e9 });
  assert.deepEqual(scaleForIndicatorCode("SP.POP.TOTL"), { yAxisUnit: "millions", scale: 1e6 });
});

test("scaleForIndicatorCode returns an empty (no-scale) result for an indicator code outside the table", () => {
  assert.deepEqual(scaleForIndicatorCode("SOME.OTHER.CODE"), {});
});

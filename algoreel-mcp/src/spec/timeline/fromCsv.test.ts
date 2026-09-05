import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsvToTimelineSpec } from "./fromCsv";
import { validateTimelineSpec } from "./validate";

const OPTS = { title: "Milestones" };

test("parses a two-column CSV into a valid TimelineSpec", () => {
  const csv = "date,title\n1945,WWII ends\n1969,Moon landing\n";
  const spec = parseCsvToTimelineSpec(csv, OPTS);
  assert.deepEqual(spec.events, [
    { date: "1945", title: "WWII ends" },
    { date: "1969", title: "Moon landing" },
  ]);
  assert.equal(validateTimelineSpec(spec).valid, true);
});

test("throws when the header isn't exactly 2 columns", () => {
  const csv = "date,title,extra\n1945,WWII ends,x\n1969,Moon landing,y\n";
  assert.throws(() => parseCsvToTimelineSpec(csv, OPTS), /exactly "date,title"/);
});

test("throws on a row with the wrong column count", () => {
  const csv = "date,title\n1945,WWII ends\n1969\n";
  assert.throws(() => parseCsvToTimelineSpec(csv, OPTS), /row 3 has 1 column\(s\), expected 2/);
});

test("throws on a row with an empty date or title", () => {
  const csv = "date,title\n1945,WWII ends\n,Moon landing\n";
  assert.throws(() => parseCsvToTimelineSpec(csv, OPTS), /must both be non-empty/);
});

test("throws when there are fewer than 2 data rows", () => {
  const csv = "date,title\n1945,WWII ends\n";
  assert.throws(() => parseCsvToTimelineSpec(csv, OPTS), /at least 2 data rows/);
});

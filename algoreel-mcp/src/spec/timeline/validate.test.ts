import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTimelineSpec } from "./validate";

const VALID = {
  title: "Milestones of the 20th Century",
  events: [
    { date: "1945", title: "WWII ends" },
    { date: "1969", title: "Moon landing" },
    { date: "1989", title: "Berlin Wall falls" },
    { date: "1991", title: "World Wide Web" },
  ],
};

test("a well-formed spec validates clean", () => {
  const result = validateTimelineSpec(VALID);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects fewer than 2 events", () => {
  const result = validateTimelineSpec({ ...VALID, events: [VALID.events[0]!] });
  assert.equal(result.valid, false);
});

test("rejects an empty events array", () => {
  const result = validateTimelineSpec({ ...VALID, events: [] });
  assert.equal(result.valid, false);
});

test("rejects an event with an empty date or title", () => {
  assert.equal(validateTimelineSpec({ ...VALID, events: [{ date: "", title: "x" }, VALID.events[1]!] }).valid, false);
  assert.equal(validateTimelineSpec({ ...VALID, events: [{ date: "1945", title: "" }, VALID.events[1]!] }).valid, false);
});

test("rejects a missing title", () => {
  const { title: _title, ...rest } = VALID;
  const result = validateTimelineSpec(rest);
  assert.equal(result.valid, false);
});

test("rejects an exact duplicate event (same date and title)", () => {
  const result = validateTimelineSpec({ ...VALID, events: [VALID.events[0]!, VALID.events[0]!] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /events must be unique/);
});

test("allows two different events sharing the same date (two things happened the same year)", () => {
  const result = validateTimelineSpec({
    ...VALID,
    events: [{ date: "1969", title: "Moon landing" }, { date: "1969", title: "Woodstock" }],
  });
  assert.equal(result.valid, true);
});

test("accepts non-numeric date labels (not every timeline is year-based)", () => {
  const result = validateTimelineSpec({
    ...VALID,
    events: [
      { date: "Ancient Rome", title: "Republic founded" },
      { date: "Middle Ages", title: "Feudalism spreads" },
    ],
  });
  assert.equal(result.valid, true);
});

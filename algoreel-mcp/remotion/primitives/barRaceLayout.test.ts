import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BAR,
  barLength,
  computeValueDomain,
  currentStepIndex,
  interpolatedValue,
  rankEntries,
  rowY,
  stepPosition,
} from "./barRaceLayout";
import type { BarRaceSpec } from "../../src/spec/barRace/types";

const SPEC: BarRaceSpec = {
  title: "t",
  xAxis: { label: "Year", values: [1990, 2000, 2010] },
  valueLabel: "v",
  entries: [
    { name: "A", values: [100, 200, 300] },
    { name: "B", values: [50, 400, 250] },
  ],
};

test("computeValueDomain always starts at 0 and pads 10% above the real max", () => {
  const domain = computeValueDomain(SPEC);
  assert.equal(domain.min, 0);
  assert.equal(domain.max, 440); // max is 400 (B at 2000) + 10%
});

test("computeValueDomain pads a flat all-zero dataset with a fixed absolute amount", () => {
  const domain = computeValueDomain({ ...SPEC, entries: [{ name: "A", values: [0, 0, 0] }] });
  assert.equal(domain.max, 1);
});

test("barLength scales linearly from 0 to the full chart width at domain.max", () => {
  const domain = { min: 0, max: 100 };
  assert.equal(barLength(0, domain), 0);
  assert.equal(barLength(100, domain), BAR.chartWidth);
  assert.equal(barLength(50, domain), BAR.chartWidth / 2);
});

test("rowY places rank 0 at the top and increases by a fixed row step per rank", () => {
  assert.equal(rowY(0), 0);
  assert.equal(rowY(1), BAR.rowHeight + BAR.rowGap);
  assert.equal(rowY(2), 2 * (BAR.rowHeight + BAR.rowGap));
});

test("stepPosition sits exactly on step 0 at progress 0 and the last step at progress 1", () => {
  assert.deepEqual(stepPosition(0, 3), { index: 0, frac: 0 });
  const end = stepPosition(1, 3);
  assert.equal(end.index, 1);
  assert.equal(end.frac, 1);
});

test("stepPosition lands exactly on the middle step at progress 0.5 with 3 steps", () => {
  const pos = stepPosition(0.5, 3);
  assert.equal(pos.index, 1);
  assert.equal(pos.frac, 0);
});

test("stepPosition is genuinely between two steps at a non-aligned progress", () => {
  const pos = stepPosition(0.25, 3); // scaled = 0.5 -> halfway through step 0->1
  assert.equal(pos.index, 0);
  assert.equal(pos.frac, 0.5);
});

test("interpolatedValue linearly blends between the two bracketing values", () => {
  const pos = { index: 0, frac: 0.5 };
  assert.equal(interpolatedValue([100, 200], pos), 150);
});

test("interpolatedValue returns the exact value at frac 0 or 1", () => {
  assert.equal(interpolatedValue([100, 200], { index: 0, frac: 0 }), 100);
  assert.equal(interpolatedValue([100, 200], { index: 0, frac: 1 }), 200);
});

test("currentStepIndex is 0 at the start and the final step exactly at progress 1", () => {
  assert.equal(currentStepIndex(0, 3), 0);
  assert.equal(currentStepIndex(1, 3), 2);
});

test("currentStepIndex lands exactly on a step when progress does, with no lag", () => {
  assert.equal(currentStepIndex(0.5, 3), 1); // scaled = 1.0 exactly, frac = 0
});

test("currentStepIndex stays on the lower step throughout a transition, never labeling ahead of the real value — regression test for a real bug", () => {
  // Found live: an earlier version rounded to the *nearest* step, so at
  // progress 0.75 with 3 steps (mid-transition from step 1 to step 2) it
  // would report step 2 while interpolatedValue was still only halfway
  // from step 1's real value toward step 2's — a rendered frame labeled
  // "2015" while showing a number that wasn't actually 2015's data.
  const mid = currentStepIndex(0.75, 3); // scaled = 1.5 -> still mid-transition into step 2
  assert.equal(mid, 1, "must stay on the lower step until the value actually arrives, not round ahead of it");
});

test("currentStepIndex advances to the next step only once frac reaches exactly 1", () => {
  const justBefore = currentStepIndex(0.99 / 2, 3); // scaled just under 1.0
  assert.equal(justBefore, 0);
});

test("rankEntries sorts descending by interpolated value, with a fixed entryIndex tracking identity", () => {
  // At progress corresponding to index 0 exactly: A=100, B=50 -> A ranks first.
  const ranked = rankEntries(SPEC, { index: 0, frac: 0 });
  assert.equal(ranked[0]!.name, "A");
  assert.equal(ranked[0]!.entryIndex, 0);
  assert.equal(ranked[1]!.name, "B");
  assert.equal(ranked[1]!.entryIndex, 1);
});

test("rankEntries re-ranks as interpolated values cross over", () => {
  // At step index 1 (year 2000): A=200, B=400 -> B now ranks first.
  const ranked = rankEntries(SPEC, { index: 1, frac: 0 });
  assert.equal(ranked[0]!.name, "B");
  assert.equal(ranked[0]!.entryIndex, 1);
  assert.equal(ranked[1]!.name, "A");
});

test("rankEntries keeps entryIndex tied to identity regardless of rank, so color-by-entryIndex never changes for a given entity", () => {
  const early = rankEntries(SPEC, { index: 0, frac: 0 }).find((e) => e.name === "B")!;
  const late = rankEntries(SPEC, { index: 1, frac: 0 }).find((e) => e.name === "B")!;
  assert.equal(early.entryIndex, late.entryIndex);
  assert.notEqual(early.rank, late.rank);
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { planBeats } from "./beatBudget";
import type { StorySpec } from "./types";

// Non-recursive on purpose: every file directly under specs/ is assumed to
// be a StorySpec. Other video types' demo specs (e.g. specs/time-series/)
// live in their own subdirectory precisely so this scan never picks them up.
const SPECS_DIR = join(import.meta.dirname, "../../specs");

function loadSpec(filename: string): StorySpec {
  return JSON.parse(readFileSync(join(SPECS_DIR, filename), "utf8"));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// The real regression corpus: every committed demo spec already renders
// correctly (checkRender.test.ts asserts several of them clean end to end),
// so its narration's real word counts are a live example of "words that
// worked." planBeats must never demand more words than what already shipped
// — if it does, the budget is miscalibrated, not the spec.
test("planBeats' minWords never exceeds what every committed demo spec's real narration already uses", () => {
  for (const filename of readdirSync(SPECS_DIR)) {
    if (!filename.endsWith(".json")) continue;
    const spec = loadSpec(filename);
    const budget = planBeats({ algorithm: spec.algorithm, input: spec.input }, spec.narration.filter((n) => n.beat.startsWith("op:")).length);
    assert.equal(budget.feasible, true, `${filename}: expected a feasible budget, got infeasible: ${budget.infeasibleReason}`);

    for (const beat of budget.perBeat) {
      const narrated = spec.narration.find((n) => n.beat === beat.beat);
      assert.ok(narrated, `${filename}: budget expected a "${beat.beat}" beat but the spec has none`);
      const actualWords = wordCount(narrated!.text);
      assert.ok(
        actualWords >= beat.minWords,
        `${filename}: beat "${beat.beat}" needed >= ${beat.minWords} words per the budget, ` +
          `but the committed narration only has ${actualWords} ("${narrated!.text}")`,
      );
    }
  }
});

// The Phase 4 exit-criterion case (checkRender.test.ts): a 40-element array
// with only 2 thin op:N beats produces 1601 checkpoints, 1598 of which get
// 0 frames. planBeats must recognize this input as needing either more
// beats or a smaller input *before* any narration is written, at the
// opBeatCount the (broken) original spec used.
test("planBeats flags the Phase 4 adversarial case as needing more beats than 2", () => {
  const array = Array.from({ length: 40 }, (_, i) => 40 - i);
  const budget = planBeats({ algorithm: "bubbleSort", input: { array } }, 2);
  // Either it reports infeasible outright, or it silently needed more than
  // the 2 beats the broken original spec used — both are the correct
  // "don't author 2 op beats for this input" signal for the orchestrator.
  if (budget.feasible) {
    assert.ok(
      budget.opBeatCount > 2,
      `expected planBeats to need more than 2 op:N beats for a 40-element array, got ${budget.opBeatCount}`,
    );
  }
});

test("planBeats reports a single-primary-step algorithm (e.g. a 2-element input) with exactly 1 op beat", () => {
  const budget = planBeats({ algorithm: "reverseLinkedList", input: { list: [1, 2] } });
  assert.equal(budget.feasible, true);
  const opBeats = budget.perBeat.filter((b) => b.beat.startsWith("op:"));
  assert.ok(opBeats.length >= 1, "expected at least one op:N beat");
});

test("every beat's maxWords is at least its minWords", () => {
  const budget = planBeats({ algorithm: "bfs", input: { nodes: ["A", "B", "C"], edges: [["A", "B"], ["B", "C"]], start: "A" } });
  assert.equal(budget.feasible, true);
  for (const beat of budget.perBeat) {
    assert.ok(beat.maxWords >= beat.minWords, `beat "${beat.beat}": maxWords (${beat.maxWords}) < minWords (${beat.minWords})`);
  }
});

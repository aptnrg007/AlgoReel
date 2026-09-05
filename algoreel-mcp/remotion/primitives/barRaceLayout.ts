import type { BarRaceSpec } from "../../src/spec/barRace/types";

// Pure — no React, no Remotion imports — same discipline as
// timeSeriesLayout.ts/layout.ts: checkBarRaceRender can call this exact
// geometry instead of a separate estimate that could drift from it.
// Fixed sizes, never resized by entry count (PLAN.md §6's "never resize
// per element count") — if a dataset doesn't fit legibly, the fix is
// fewer entries, not smaller rows.
export const BAR = {
  labelColumnWidth: 260,
  chartWidth: 620,
  rightLabelSpace: 140,
  rowHeight: 90,
  rowGap: 24,
  barHeight: 60,
} as const;

export interface ValueDomain {
  min: number;
  max: number;
}

// Bars always start at 0 — a bar race with negative values isn't a
// supported/tested case for this first version (real bar-race datasets —
// GDP, population, counts — are practically always non-negative).
export function computeValueDomain(spec: BarRaceSpec): ValueDomain {
  const all = spec.entries.flatMap((e) => e.values);
  const max = Math.max(...all, 0);
  const pad = max > 0 ? max * 0.1 : 1;
  return { min: 0, max: max + pad };
}

export function barLength(value: number, domain: ValueDomain): number {
  if (domain.max <= 0) return 0;
  return Math.max(0, (value / domain.max) * BAR.chartWidth);
}

export function rowY(rank: number): number {
  return rank * (BAR.rowHeight + BAR.rowGap);
}

// Where a continuous [0,1] progress sits among stepCount x-axis steps —
// which pair of adjacent steps we're between, and how far. Unlike
// time_series's discrete revealedCount (one point at a time), a bar race
// interpolates *continuously* between steps so bars smoothly grow/shrink
// and re-rank as they cross, rather than jumping.
export interface StepPosition {
  index: number;
  frac: number;
}

export function stepPosition(progress: number, stepCount: number): StepPosition {
  if (stepCount <= 1) return { index: 0, frac: 0 };
  const clamped = Math.min(1, Math.max(0, progress));
  const scaled = clamped * (stepCount - 1);
  const index = Math.min(stepCount - 2, Math.floor(scaled));
  return { index, frac: scaled - index };
}

export function interpolatedValue(values: number[], pos: StepPosition): number {
  const a = values[pos.index] ?? 0;
  const b = values[Math.min(values.length - 1, pos.index + 1)] ?? a;
  return a + (b - a) * pos.frac;
}

// The x-axis step to *display* (e.g. the year readout). Found live: an
// earlier version rounded to the *nearest* whole step, which could label
// the frame "2015" while interpolatedValue was still blending 2010's and
// 2015's real numbers halfway toward 2015 — a video claiming a value for
// a year that isn't actually that year's real number, which is exactly
// the kind of thing this project's determinism principle exists to rule
// out. Fixed to stay on the *lower* bound of the current transition (the
// step whose real value the interpolation is ramping away from) and only
// advance once frac reaches exactly 1 — the instant the bars actually
// arrive at that step's true values, never before.
export function currentStepIndex(progress: number, stepCount: number): number {
  if (stepCount <= 1) return 0;
  const pos = stepPosition(progress, stepCount);
  return pos.frac >= 1 ? Math.min(stepCount - 1, pos.index + 1) : pos.index;
}

export interface RankedEntry {
  name: string;
  value: number;
  rank: number;
  // Index into spec.entries — fixed, unlike rank. Color must follow this,
  // never `rank`, so an entity's color never changes as it moves up or
  // down (dataviz skill: "color follows the entity, never its rank").
  entryIndex: number;
}

// Sorted descending by each entry's interpolated value at this continuous
// position — recomputed fresh every frame from continuously-interpolated
// values, which is what makes bars visibly slide past each other as they
// cross, rather than jump-cutting between fixed per-step ranks.
export function rankEntries(spec: BarRaceSpec, pos: StepPosition): RankedEntry[] {
  const withValues = spec.entries.map((e, entryIndex) => ({
    name: e.name,
    value: interpolatedValue(e.values, pos),
    entryIndex,
  }));
  withValues.sort((a, b) => b.value - a.value);
  return withValues.map((e, rank) => ({ ...e, rank }));
}

// Duplicated from timeSeriesLayout.ts's formatValue rather than imported —
// deliberately: each video type stays self-contained (PLAN.md §22's "keep
// domain-specific state separate"), so a future change to how time_series
// formats numbers can't silently change how bar_race does.
export function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) {
    const scaled = v / 1000;
    return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}k`;
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

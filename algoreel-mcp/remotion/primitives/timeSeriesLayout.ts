import type { TimeSeriesSpec } from "../../src/spec/timeSeries/types";

// Pure — no React, no Remotion imports — same discipline as layout.ts:
// checkRender.ts's future time-series geometry checks can call this exact
// code instead of duplicating it against a separate pre-render estimate.
// Fixed plot size, never resized by point count (PLAN.md §6's "never
// resize per element count" — if a dataset doesn't fit legibly here, the
// fix is fewer points, not a smaller chart).
// width leaves deliberate room in the 1080px frame for the y-axis label
// column on the left (marginLeft) and the single-series end-value label on
// the right (rightLabelSpace) — found live: an earlier 860px width put
// "3.9k" a few pixels from the frame's right edge on the demo's final
// frame. marginLeft/marginTop/rightLabelSpace live here rather than as
// TimeSeriesView.tsx locals specifically so checkTimeSeriesRender (this
// file's future consumer) can check real label geometry against the exact
// space the renderer actually reserves, instead of a second guess that
// could drift from it.
export const CHART = {
  width: 760,
  height: 900,
  tickLength: 14,
  pointRadius: 6,
  leadPointRadius: 10,
  marginLeft: 100,
  marginTop: 30,
  rightLabelSpace: 140,
} as const;

export interface YDomain {
  min: number;
  max: number;
}

// Padded 10% top/bottom so a series doesn't hug the plot edge; a flat
// series (min === max) gets a fixed absolute pad instead, since a
// percentage of zero range is zero.
export function computeYDomain(spec: TimeSeriesSpec): YDomain {
  const all = spec.series.flatMap((s) => s.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) {
    const pad = min !== 0 ? Math.abs(min) * 0.1 : 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

export function xForIndex(index: number, count: number): number {
  if (count <= 1) return CHART.width / 2;
  return (index / (count - 1)) * CHART.width;
}

export function yForValue(value: number, domain: YDomain): number {
  if (domain.max === domain.min) return CHART.height / 2;
  const t = (value - domain.min) / (domain.max - domain.min);
  return CHART.height - t * CHART.height;
}

// How many of the x-axis's points are revealed at a given [0,1] progress —
// always at least 1 (a blank chart at frame 0 would look broken, not "the
// start"), the full count at progress 1. Rounds rather than floors so the
// very last frame always lands exactly on the final point.
export function revealedCount(progress: number, totalPoints: number): number {
  if (totalPoints <= 1) return totalPoints;
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 + Math.round(clamped * (totalPoints - 1));
}

// Shared by TimeSeriesView.tsx (what actually renders) and
// checkTimeSeriesRender (what checks label width before rendering) — a
// single source of truth for how a value becomes label text, so the two
// can never disagree about how wide a label is.
export function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) {
    const scaled = v / 1000;
    return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}k`;
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// PLAN.md Phase 9 step 1: a wide dataset shouldn't be rejected just
// because every point's own label wouldn't fit at once — every point
// still gets its tick mark and its place on the line/chart regardless;
// this only decides how many of those ticks also get a text label
// underneath.
//
// Found live, the expensive way: an earlier version computed "how many
// labels fit" as a standalone count (floor(CHART.width / labelWidth)),
// then proportionally remapped that count onto n original indices with
// Math.round. That's wrong for a *constrained* subset — the shown labels
// aren't free to redistribute across the full width, they're stuck at
// wherever their original point already sits, and proportional rounding
// on non-integer steps doesn't guarantee even index gaps (it can, and
// did, keep two originally-adjacent points both labeled while dropping a
// point three slots away). A real render at n=25 showed exactly that:
// clusters of consecutive years still overlapping despite the count math
// claiming "18 of 25 fit."
//
// The fix works in index space directly: a fixed *stride* between shown
// indices, chosen so stride original-index-steps of the *real* per-point
// spacing is provably >= the widest label's width — which is the only
// thing that actually guarantees no two shown labels overlap.
export function labelStride(n: number, widestLabelWidthPx: number): number {
  if (n <= 1) return 1;
  const spacing = CHART.width / (n - 1);
  if (widestLabelWidthPx <= 0 || spacing <= 0) return 1;
  return Math.max(1, Math.ceil(widestLabelWidthPx / spacing));
}

// Every `stride`-th index, out of n total x-axis points, plus the final
// index always (so the last point is never left unlabeled just because
// the stride didn't land on it exactly). A fixed, whole-dataset decision —
// not something that varies frame to frame — so it stays as checkable
// ahead of a render as everything else in this file.
export function tickIndicesToLabel(n: number, stride: number): number[] {
  if (n <= 0) return [];
  const step = Math.max(1, Math.floor(stride));
  const indices: number[] = [];
  for (let i = 0; i < n; i += step) indices.push(i);
  if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
  return indices;
}

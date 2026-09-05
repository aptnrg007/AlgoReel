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

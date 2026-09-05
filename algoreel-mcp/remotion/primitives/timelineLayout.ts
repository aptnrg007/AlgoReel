// Pure — no React, no Remotion imports — same discipline as
// timeSeriesLayout.ts/barRaceLayout.ts: checkTimelineRender can call this
// exact geometry instead of a separate estimate that could drift from it.
// Fixed line width, never resized by event count (PLAN.md §6's "never
// resize per element count").
export const TIMELINE = {
  width: 820,
  marginLeft: 130,
  marginRight: 130,
  dotRadius: 8,
  leadDotRadius: 14,
} as const;

// xForIndex/revealedCount duplicate timeSeriesLayout.ts's own functions
// of the same name and signature almost exactly — a genuine, acknowledged
// tradeoff (this is the third video type wanting identical "evenly space
// N items, reveal them one at a time" math, following bar_race as the
// second), kept separate anyway rather than extracted into a shared
// module purely to avoid destabilizing time_series's already-shipped,
// live-verified xForIndex/revealedCount for a lower-priority type whose
// own charter is "confirm the recipe again," not "refactor working code."
// Worth a real extraction if a fifth type needs the same thing.
export function xForIndex(index: number, count: number): number {
  if (count <= 1) return TIMELINE.width / 2;
  return (index / (count - 1)) * TIMELINE.width;
}

export function revealedCount(progress: number, totalEvents: number): number {
  if (totalEvents <= 1) return totalEvents;
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 + Math.round(clamped * (totalEvents - 1));
}

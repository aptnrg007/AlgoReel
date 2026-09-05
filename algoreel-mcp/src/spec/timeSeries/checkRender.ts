import { CHART, computeYDomain, formatValue, labelStride, tickIndicesToLabel, xForIndex } from "../../../remotion/primitives/timeSeriesLayout";
import { estimateTextWidth } from "../../../remotion/primitives/textBox";
import { FRAME, TYPE_SCALE } from "../../../remotion/template/tokens";
import type { TimeSeriesSpec } from "./types";

export interface Check {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CheckRenderResult {
  pass: boolean;
  failures: Check[];
}

// Same fontSize TimeSeriesView.tsx actually draws x/y tick and value
// labels at (TYPE_SCALE.label * 0.7) — duplicated as a literal rather than
// imported, same tradeoff the DSA checkRender.ts accepts for Caption's
// line-height: TimeSeriesView doesn't export its own font-size constant.
const LABEL_FONT_SIZE = TYPE_SCALE.label * 0.7;
// Gap TimeSeriesView.tsx leaves between a lead point's edge and its
// value-at-the-end label (x = lead.x + leadPointRadius + 10).
const END_LABEL_GAP = 10;

// Deliberately a pure function of the spec (+ a duration the spec itself
// doesn't carry — see plan/types.ts's TimeSeriesVideoPlan comment), not a
// rendered video — same principle as the DSA checkRender.ts, using the
// exact geometry (timeSeriesLayout.ts) and label-width estimate
// (textBox.ts) the renderer actually uses.
//
// Deliberately NOT checked here, and why:
// - "points inside chart" / "no invalid coordinates": guaranteed by
//   construction. computeYDomain always spans every plotted value (with
//   padding), so yForValue never produces a coordinate outside the chart
//   box; validateTimeSeriesSpec already rejects non-finite values before
//   this ever runs. There's no code path that could produce an invalid
//   coordinate from a spec that passed validation.
export function checkTimeSeriesRender(spec: TimeSeriesSpec, targetDurationSec: number): CheckRenderResult {
  const failures: Check[] = [
    ...xAxisLabelChecks(spec),
    ...yAxisLabelChecks(spec),
    ...endValueLabelChecks(spec),
    ...annotationChecks(spec),
    ...durationChecks(spec, targetDurationSec),
  ];
  return { pass: !failures.some((f) => f.severity === "error"), failures };
}

// PLAN.md Phase 9 step 1: a dataset with many real, valid points used to
// be rejected outright just because every point's own label wouldn't fit
// on screen at once. TimeSeriesView.tsx now draws a tick mark for every
// point but only a text label under a thinned, evenly-spaced subset
// (tickIndicesToLabel) — no data is dropped, only some labels are. What's
// left to check here is narrower: is even a *single* label too wide for
// the chart to ever show (nothing thinning can fix), and — informationally,
// never blocking — will thinning actually kick in for this dataset.
function xAxisLabelChecks(spec: TimeSeriesSpec): Check[] {
  const n = spec.xAxis.values.length;
  if (n <= 1) return [];

  const widestLabel = Math.max(...spec.xAxis.values.map((v) => estimateTextWidth(String(v), LABEL_FONT_SIZE)));

  if (widestLabel > CHART.width) {
    return [
      {
        severity: "error",
        code: "x-axis-label-too-wide",
        message:
          `the widest x-axis label is an estimated ${widestLabel.toFixed(0)}px wide, wider than the entire ` +
          `${CHART.width}px chart — no amount of label thinning can fit it. Use shorter x-axis values.`,
      },
    ];
  }

  const stride = labelStride(n, widestLabel);
  if (stride > 1) {
    const shown = tickIndicesToLabel(n, stride).length;
    return [
      {
        severity: "warning",
        code: "x-axis-labels-thinned",
        message:
          `${n} x-axis points won't all fit their own label at this width (estimated, not measured — see ` +
          `textBox.ts) — only ${shown} of them will be labeled, evenly spaced, including both ends. Every point ` +
          `still renders on the line; this only affects which ones get a text label.`,
      },
    ];
  }
  return [];
}

function yAxisLabelChecks(spec: TimeSeriesSpec): Check[] {
  const domain = computeYDomain(spec);
  const widestLabel = Math.max(
    ...[domain.max, (domain.max + domain.min) / 2, domain.min].map((v) => estimateTextWidth(formatValue(v), LABEL_FONT_SIZE)),
  );
  const available = CHART.marginLeft - CHART.tickLength - 10;

  if (widestLabel > available) {
    return [
      {
        severity: "error",
        code: "y-axis-label-too-wide",
        message:
          `the widest y-axis tick label ("${formatValue(domain.max)}"-scale values) is an estimated ` +
          `${widestLabel.toFixed(0)}px wide, wider than the ${available}px reserved for it in the left margin — ` +
          `it will be clipped or crowd the chart. Consider a yAxis.unit that produces shorter numbers ` +
          `(e.g. pre-scaled to thousands/millions).`,
      },
    ];
  }
  return [];
}

// The single-series end-value label (TimeSeriesView.tsx) rides the lead
// point as it moves left-to-right, so its available space shrinks as the
// point approaches the right edge — checking only the final value (as the
// DSA equivalent would check only "the last state") would miss an earlier,
// numerically wider value that happens to have less slack than its string
// length suggests. Checks every point's real worst case instead.
function endValueLabelChecks(spec: TimeSeriesSpec): Check[] {
  if (spec.series.length !== 1) return [];
  const n = spec.xAxis.values.length;
  const values = spec.series[0]!.values;

  let worst: { index: number; overflow: number; label: string } | null = null;
  for (let i = 0; i < values.length; i++) {
    const label = formatValue(values[i]!);
    const labelWidth = estimateTextWidth(label, LABEL_FONT_SIZE);
    const needed = CHART.leadPointRadius + END_LABEL_GAP + labelWidth;
    const available = CHART.width - xForIndex(i, n) + CHART.rightLabelSpace;
    const overflow = needed - available;
    if (overflow > 0 && (!worst || overflow > worst.overflow)) {
      worst = { index: i, overflow, label };
    }
  }

  if (worst) {
    return [
      {
        severity: "error",
        code: "end-value-label-too-wide",
        message:
          `series "${spec.series[0]!.name}"'s value at x=${spec.xAxis.values[worst.index]} formats as ` +
          `"${worst.label}", whose label would overflow the frame by an estimated ${worst.overflow.toFixed(0)}px ` +
          `when that point is the current lead. Consider a yAxis.unit that produces shorter numbers.`,
      },
    ];
  }
  return [];
}

// TimeSeriesView.tsx draws an annotation's label centered (text-anchor
// "middle") above its point — an svg-absolute x of
// `marginLeft + xForIndex(index, n)`, needing half its estimated width of
// clearance on both sides of the full svg canvas
// (`marginLeft + CHART.width + rightLabelSpace`). Checked per point, not
// just the two ends, since a wide label anywhere near either edge can
// overflow even though the DSA-style "check only the extremes" heuristic
// wouldn't catch it.
function annotationChecks(spec: TimeSeriesSpec): Check[] {
  const n = spec.xAxis.values.length;
  const svgWidth = CHART.marginLeft + CHART.width + CHART.rightLabelSpace;

  let worst: { seriesName: string; index: number; overflow: number; label: string } | null = null;
  for (const s of spec.series) {
    for (const a of s.annotations ?? []) {
      if (a.index >= n) continue; // already a validate_spec error; nothing to check geometrically
      const halfWidth = estimateTextWidth(a.label, LABEL_FONT_SIZE) / 2;
      const absoluteX = CHART.marginLeft + xForIndex(a.index, n);
      const overflow = Math.max(halfWidth - absoluteX, absoluteX + halfWidth - svgWidth);
      if (overflow > 0 && (!worst || overflow > worst.overflow)) {
        worst = { seriesName: s.name, index: a.index, overflow, label: a.label };
      }
    }
  }

  if (worst) {
    return [
      {
        severity: "error",
        code: "annotation-label-too-wide",
        message:
          `series "${worst.seriesName}"'s annotation "${worst.label}" at x=${spec.xAxis.values[worst.index]} would ` +
          `overflow the frame by an estimated ${worst.overflow.toFixed(0)}px. Use a shorter label.`,
      },
    ];
  }
  return [];
}

export const MIN_DURATION_SEC = 1;

// The smallest targetDurationSec that would clear both of durationChecks'
// concerns for this spec — used by planVideo.ts's repair step (PLAN.md
// Phase 9 step 1) to widen a too-short duration deterministically, never
// by a human/agent guessing a number. Doesn't touch data at all — only
// how long the same reveal takes.
export function minimumSufficientDurationSec(spec: TimeSeriesSpec): number {
  const n = spec.xAxis.values.length;
  const framesNeeded = Math.max(0, n - 1);
  const secForFullReveal = framesNeeded / FRAME.fps;
  return Math.max(MIN_DURATION_SEC, secForFullReveal);
}

function durationChecks(spec: TimeSeriesSpec, targetDurationSec: number): Check[] {
  const failures: Check[] = [];
  if (targetDurationSec < MIN_DURATION_SEC) {
    failures.push({
      severity: "error",
      code: "duration-too-short",
      message: `targetDurationSec is ${targetDurationSec}s, below the ${MIN_DURATION_SEC}s minimum for a watchable render.`,
    });
  }

  // Each of the n-1 point-to-point transitions needs at least 1 frame of
  // its own to be perceptible as a distinct reveal, not a jump straight to
  // a later point — mirrors the DSA checkRender's "invisible checkpoints"
  // concern, though milder: the skipped point still eventually appears
  // (the line/point set includes it once revealed), it just never gets a
  // frame where it's the newest thing shown.
  const n = spec.xAxis.values.length;
  const durationInFrames = Math.round(targetDurationSec * FRAME.fps);
  if (n > 1 && durationInFrames < n - 1) {
    failures.push({
      severity: "warning",
      code: "reveal-faster-than-frames",
      message:
        `${n} x-axis points need to reveal one-by-one across only ${durationInFrames} frames — some points will ` +
        `jump in together rather than each getting a visible reveal moment. Lengthen targetDurationSec or use fewer points.`,
    });
  }

  return failures;
}

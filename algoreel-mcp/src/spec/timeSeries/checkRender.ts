import { CHART, computeYDomain, formatValue, xForIndex } from "../../../remotion/primitives/timeSeriesLayout";
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
    ...durationChecks(spec, targetDurationSec),
  ];
  return { pass: !failures.some((f) => f.severity === "error"), failures };
}

function xAxisLabelChecks(spec: TimeSeriesSpec): Check[] {
  const n = spec.xAxis.values.length;
  if (n <= 1) return [];

  const spacing = CHART.width / (n - 1);
  const widestLabel = Math.max(...spec.xAxis.values.map((v) => estimateTextWidth(String(v), LABEL_FONT_SIZE)));

  if (widestLabel > spacing) {
    return [
      {
        severity: "error",
        code: "x-axis-labels-overlap",
        message:
          `${n} x-axis points are spaced ${spacing.toFixed(0)}px apart on the fixed ${CHART.width}px chart, but the ` +
          `widest label is an estimated ${widestLabel.toFixed(0)}px wide — adjacent labels will overlap. ` +
          `Use fewer points, or shorter labels.`,
      },
    ];
  }
  if (widestLabel > spacing * 0.8) {
    return [
      {
        severity: "warning",
        code: "x-axis-labels-tight",
        message:
          `${n} x-axis points are spaced ${spacing.toFixed(0)}px apart, and the widest label is an estimated ` +
          `${widestLabel.toFixed(0)}px wide (estimated, not measured — see textBox.ts) — labels are tight and may ` +
          `visually crowd each other.`,
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

const MIN_DURATION_SEC = 1;

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

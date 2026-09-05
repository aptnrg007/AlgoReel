import { BAR, computeValueDomain, formatValue } from "../../../remotion/primitives/barRaceLayout";
import { estimateTextWidth } from "../../../remotion/primitives/textBox";
import { FRAME, SAFE_AREA, TYPE_SCALE } from "../../../remotion/template/tokens";
import type { BarRaceSpec } from "./types";

export interface Check {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CheckRenderResult {
  pass: boolean;
  failures: Check[];
}

// Same fontSize BarRaceView.tsx draws entry names and value labels at.
const LABEL_FONT_SIZE = TYPE_SCALE.label * 0.8;
// Space BarRaceView.tsx reserves above the bars for the title + current
// x-axis-step readout — mirrors TimeSeriesView.tsx's own header.
const HEADER_HEIGHT = 220;
const EDGE_MARGIN = 20;

// Deliberately a pure function of the spec (+ a duration the spec itself
// doesn't carry — see plan/types.ts's BarRaceVideoPlan comment), not a
// rendered video — same principle as checkRender.ts (dsa) and
// timeSeries/checkRender.ts. Uses the exact geometry (barRaceLayout.ts)
// and label-width estimate (textBox.ts) the renderer actually uses.
//
// Deliberately NOT checked here, and why: "bars inside chart" / "no
// invalid coordinates" — guaranteed by construction. computeValueDomain
// always spans every entry's values (with padding), so barLength never
// produces a length past BAR.chartWidth; validateBarRaceSpec already
// rejects non-finite values before this ever runs.
export function checkBarRaceRender(spec: BarRaceSpec, targetDurationSec: number): CheckRenderResult {
  const failures: Check[] = [
    ...entryCountChecks(spec),
    ...labelColumnChecks(spec),
    ...valueLabelChecks(spec),
    ...durationChecks(targetDurationSec),
  ];
  return { pass: !failures.some((f) => f.severity === "error"), failures };
}

function maxEntries(): number {
  const availableHeight = FRAME.height - SAFE_AREA.top - SAFE_AREA.bottom - HEADER_HEIGHT;
  return Math.floor((availableHeight + BAR.rowGap) / (BAR.rowHeight + BAR.rowGap));
}

function entryCountChecks(spec: BarRaceSpec): Check[] {
  const n = spec.entries.length;
  const max = maxEntries();
  if (n > max) {
    return [
      {
        severity: "error",
        code: "bar-race-too-many-entries",
        message:
          `${n} entries need ${n} fixed-height rows, more than the ${max} that fit the available vertical space ` +
          `(BarRaceView never shrinks rows to fit — see barRaceLayout.ts's BAR comment) — use at most ${max} entries.`,
      },
    ];
  }
  return [];
}

function labelColumnChecks(spec: BarRaceSpec): Check[] {
  const available = BAR.labelColumnWidth - EDGE_MARGIN;
  let worst: { name: string; width: number } | null = null;
  for (const entry of spec.entries) {
    const width = estimateTextWidth(entry.name, LABEL_FONT_SIZE);
    if (width > available && (!worst || width > worst.width)) {
      worst = { name: entry.name, width };
    }
  }
  if (worst) {
    return [
      {
        severity: "error",
        code: "entry-name-too-wide",
        message:
          `entry name "${worst.name}" is an estimated ${worst.width.toFixed(0)}px wide, wider than the ` +
          `${available}px reserved for it in the label column — it will be clipped or crowd the bars. Use a shorter name.`,
      },
    ];
  }
  return [];
}

function valueLabelChecks(spec: BarRaceSpec): Check[] {
  const domain = computeValueDomain(spec);
  const widest = estimateTextWidth(formatValue(domain.max), LABEL_FONT_SIZE);
  const available = BAR.rightLabelSpace - EDGE_MARGIN;
  if (widest > available) {
    return [
      {
        severity: "error",
        code: "value-label-too-wide",
        message:
          `the widest value label ("${formatValue(domain.max)}"-scale values) is an estimated ${widest.toFixed(0)}px ` +
          `wide, wider than the ${available}px reserved for it — it will be clipped. Consider a valueLabel unit that ` +
          `produces shorter numbers (e.g. pre-scaled to thousands/millions).`,
      },
    ];
  }
  return [];
}

export const MIN_DURATION_SEC = 1;

function durationChecks(targetDurationSec: number): Check[] {
  if (targetDurationSec < MIN_DURATION_SEC) {
    return [
      {
        severity: "error",
        code: "duration-too-short",
        message: `targetDurationSec is ${targetDurationSec}s, below the ${MIN_DURATION_SEC}s minimum for a watchable render.`,
      },
    ];
  }
  return [];
}

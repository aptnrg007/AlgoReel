import { TIMELINE, xForIndex } from "../../../remotion/primitives/timelineLayout";
import { estimateTextWidth } from "../../../remotion/primitives/textBox";
import { FRAME, TYPE_SCALE } from "../../../remotion/template/tokens";
import type { TimelineSpec } from "./types";

export interface Check {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CheckRenderResult {
  pass: boolean;
  failures: Check[];
}

const LABEL_FONT_SIZE = TYPE_SCALE.label * 0.8;

// Deliberately a pure function of the spec (+ a duration the spec itself
// doesn't carry — see plan/types.ts's TimelineVideoPlan comment), not a
// rendered video — same principle as every other checkRender.ts in this
// repo. Unlike time_series's x-axis ticks (which can be thinned — the
// data survives without every label shown), an event with no visible
// label defeats the whole point of a timeline, so a dataset that doesn't
// fit is a real error here, not a warning.
export function checkTimelineRender(spec: TimelineSpec, targetDurationSec: number): CheckRenderResult {
  const failures: Check[] = [...labelChecks(spec), ...durationChecks(spec, targetDurationSec)];
  return { pass: !failures.some((f) => f.severity === "error"), failures };
}

// Every event needs its own date+title labels to fit within its share of
// the fixed line width without crowding its neighbors — checked per
// event, not just the two ends, same reasoning timeSeries/checkRender.ts's
// annotationChecks already documents.
function labelChecks(spec: TimelineSpec): Check[] {
  const n = spec.events.length;
  if (n <= 1) return [];
  const spacing = TIMELINE.width / (n - 1);

  let worst: { index: number; width: number; label: string } | null = null;
  spec.events.forEach((e, i) => {
    const widest = Math.max(estimateTextWidth(e.date, LABEL_FONT_SIZE), estimateTextWidth(e.title, LABEL_FONT_SIZE));
    if (widest > spacing && (!worst || widest > worst.width)) {
      worst = { index: i, width: widest, label: e.title };
    }
  });

  if (worst) {
    const w = worst as { index: number; width: number; label: string };
    return [
      {
        severity: "error",
        code: "timeline-label-too-wide",
        message:
          `event "${w.label}" (index ${w.index}) has a label an estimated ${w.width.toFixed(0)}px wide, wider than ` +
          `the ${spacing.toFixed(0)}px each event gets on this ${n}-event timeline — it will crowd its neighbors. ` +
          `Use fewer events or a shorter date/title.`,
      },
    ];
  }
  return [];
}

export const MIN_DURATION_SEC = 1;

function durationChecks(spec: TimelineSpec, targetDurationSec: number): Check[] {
  const failures: Check[] = [];
  if (targetDurationSec < MIN_DURATION_SEC) {
    failures.push({
      severity: "error",
      code: "duration-too-short",
      message: `targetDurationSec is ${targetDurationSec}s, below the ${MIN_DURATION_SEC}s minimum for a watchable render.`,
    });
  }

  // Same concern timeSeries/checkRender.ts's reveal-faster-than-frames
  // documents: each of the n-1 event-to-event reveals needs at least 1
  // frame of its own to be perceptible, or several events jump in
  // together rather than each getting a visible reveal moment.
  const n = spec.events.length;
  const durationInFrames = Math.round(targetDurationSec * FRAME.fps);
  if (n > 1 && durationInFrames < n - 1) {
    failures.push({
      severity: "warning",
      code: "reveal-faster-than-frames",
      message:
        `${n} events need to reveal one-by-one across only ${durationInFrames} frames — some will jump in together ` +
        `rather than each getting a visible reveal moment. Lengthen targetDurationSec or use fewer events.`,
    });
  }

  return failures;
}

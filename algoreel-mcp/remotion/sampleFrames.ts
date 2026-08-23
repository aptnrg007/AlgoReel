import type { Timeline } from "./buildTimeline";

export interface FrameSample {
  frame: number;
  label: string;
}

const MAX_STEP_SAMPLES = 4;

// PLAN.md §7's Layer 2 calls for "4-6 sampled frames" — one from the
// hook, one per primary step (evenly subsampled down if there are more
// than MAX_STEP_SAMPLES), one from the outro. Frame numbers are absolute
// (0-based into the full rendered video), computed the same way
// Video.tsx's back-to-back <Series.Sequence> stacking lays out hook, then
// each step's own local frame range, then outro — buildTimeline's
// Checkpoint.startFrame is local to its step, so this re-derives the
// absolute offset the same way the renderer implicitly does.
export function pickSampleFrames(timeline: Timeline): FrameSample[] {
  const samples: FrameSample[] = [{ frame: midpoint(0, timeline.hookDurationInFrames), label: "hook" }];

  const stepStarts: number[] = [];
  let cursor = timeline.hookDurationInFrames;
  for (const step of timeline.steps) {
    stepStarts.push(cursor);
    cursor += step.durationInFrames;
  }

  for (const i of selectStepIndices(timeline.steps.length)) {
    const step = timeline.steps[i]!;
    const start = stepStarts[i]!;
    samples.push({ frame: midpoint(start, start + step.durationInFrames), label: step.beat });
  }

  samples.push({ frame: midpoint(cursor, cursor + timeline.outroDurationInFrames), label: "outro" });

  return samples;
}

// Always includes the first and last step so the sample spans the full
// animation instead of clustering at one end.
function selectStepIndices(stepCount: number): number[] {
  if (stepCount === 0) return [];
  if (stepCount <= MAX_STEP_SAMPLES) {
    return Array.from({ length: stepCount }, (_, i) => i);
  }
  const indices = new Set<number>();
  for (let i = 0; i < MAX_STEP_SAMPLES; i++) {
    indices.add(Math.round((i * (stepCount - 1)) / (MAX_STEP_SAMPLES - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

function midpoint(start: number, end: number): number {
  return Math.floor((start + end) / 2);
}

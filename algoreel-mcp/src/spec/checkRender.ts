import { buildTimeline, type Timeline } from "../../remotion/buildTimeline";
import { CELL, FRAME, NODE } from "../../remotion/template/tokens";
import type { StorySpec } from "./types";

export interface Check {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CheckRenderResult {
  pass: boolean;
  failures: Check[];
}

// Deliberately a pure function of the spec, not a rendered video — deviates
// from PLAN.md §5's original check_render(previewPath) sketch. Every check
// below is fully determined by spec + buildTimeline() + the fixed geometry
// in remotion/template/tokens.ts (no measurement, no randomness anywhere in
// that path), so this can run before the ~30-60s render instead of after
// it, which is what makes an agentic fix-and-retry loop affordable.
//
// PLAN.md §7 checks deliberately NOT implemented here, and why:
// - "abs(audioDuration - timelineDuration) < 0.5s": vacuous today —
//   generate_voice (src/server.ts) estimates its duration with the exact
//   same estimateBeatFrames() the timeline itself uses, so this would
//   always trivially pass until real TTS lands (PLAN.md §11).
// - "every emphasis word appears in a caption": already enforced in
//   validate.ts's semanticErrors — duplicating it here would just create a
//   second source of truth for one check.
// - "no frame is >98% single-colour": would be a false-positive machine
//   against this template. A 7-cell array covers ~5.6% of the 1080x1920
//   frame against a flat background, so every valid render this template
//   produces is already >90% single-colour. The real signal ("did
//   anything render?") is covered geometrically by blank-checkpoint below.
export function checkRender(spec: StorySpec): CheckRenderResult {
  const failures: Check[] = [];

  // Keyed off input *shape*, not algorithm name — was `spec.algorithm ===
  // "binarySearch" || "bubbleSort"` / `"bfs"` before the codegen redesign
  // (spec/types.ts's StorySpec comment). A newly generated array
  // algorithm (algoreel-mcp/src/algorithms/index.ts's dynamic registry)
  // has an `input.array` exactly like the hand-written ones do, and gets
  // this same check for free without checkRender needing to know its name.
  if (Array.isArray(spec.input.array)) {
    failures.push(...arrayWidthChecks((spec.input.array as unknown[]).length));
  }
  if (Array.isArray(spec.input.nodes)) {
    const overlap = graphOverlapCheck((spec.input.nodes as unknown[]).length);
    if (overlap) failures.push(overlap);
  }

  const timeline = buildTimeline(spec, FRAME.fps);
  failures.push(...checkpointChecks(timeline));

  const totalSec = timeline.totalDurationInFrames / FRAME.fps;
  const drift = Math.abs(totalSec - spec.targetDurationSec);
  if (drift > 5) {
    failures.push({
      severity: "error",
      code: "duration-off-target",
      message:
        `render is ${totalSec.toFixed(1)}s but targetDurationSec is ${spec.targetDurationSec}s ` +
        `(off by ${drift.toFixed(1)}s, allowed drift is 5s) — shorten or lengthen the narration, ` +
        `or adjust targetDurationSec to match.`,
    });
  }

  return { pass: !failures.some((f) => f.severity === "error"), failures };
}

// Same margin as Caption's left+right inset (remotion/primitives/Caption.tsx)
// — an array that reaches into that band is visually crowding the caption
// even before it hits the frame edge.
const EDGE_MARGIN = 120;

function arrayWidthChecks(n: number): Check[] {
  const width = n * CELL.size + (n - 1) * CELL.gap;
  if (width > FRAME.width) {
    return [
      {
        severity: "error",
        code: "array-too-wide",
        message:
          `array has ${n} elements = ${width}px wide, wider than the ${FRAME.width}px frame ` +
          `(ArrayView never resizes cells to fit — see tokens.ts's CELL comment) — ` +
          `use at most ${maxArrayLength()} elements.`,
      },
    ];
  }
  if (width > FRAME.width - EDGE_MARGIN) {
    return [
      {
        severity: "warning",
        code: "array-near-edge",
        message:
          `array has ${n} elements = ${width}px wide, only ${FRAME.width - width}px from the frame edge ` +
          `(captions use a ${EDGE_MARGIN}px inset) — consider fewer elements for breathing room.`,
      },
    ];
  }
  return [];
}

function maxArrayLength(): number {
  return Math.floor((FRAME.width + CELL.gap) / (CELL.size + CELL.gap));
}

function graphOverlapCheck(n: number): Check | null {
  if (n < 2) return null;
  const spacing = 2 * NODE.radius * Math.sin(Math.PI / n);
  if (spacing < NODE.size) {
    return {
      severity: "error",
      code: "graph-nodes-overlap",
      message:
        `graph has ${n} nodes, giving ${spacing.toFixed(0)}px between adjacent nodes on the fixed layout ` +
        `circle (remotion/primitives/GraphView.tsx) — less than the ${NODE.size}px node size, so nodes ` +
        `overlap. Use at most ${maxGraphNodes()} nodes.`,
    };
  }
  return null;
}

function maxGraphNodes(): number {
  return Math.floor(Math.PI / Math.asin(NODE.size / (2 * NODE.radius)));
}

function checkpointChecks(timeline: Timeline): Check[] {
  const failures: Check[] = [];
  const invisibleByBeat = new Map<string, number>();
  let blankCount = 0;

  for (const step of timeline.steps) {
    let invisible = 0;
    for (const cp of step.checkpoints) {
      if (cp.durationInFrames === 0) invisible++;
      if (cp.state.array.length === 0 && cp.state.nodes.length === 0) blankCount++;
    }
    if (invisible > 0) invisibleByBeat.set(step.beat, invisible);
  }

  if (invisibleByBeat.size > 0) {
    const totalInvisible = [...invisibleByBeat.values()].reduce((a, b) => a + b, 0);
    const totalCheckpoints = timeline.steps.reduce((sum, s) => sum + s.checkpoints.length, 0);
    const beats = [...invisibleByBeat.entries()].map(([b, c]) => `${b} (${c})`).join(", ");
    failures.push({
      severity: "error",
      code: "invisible-checkpoints",
      message:
        `${totalInvisible} of ${totalCheckpoints} animation checkpoints get 0 frames and will never appear ` +
        `on screen, in beat(s): ${beats}. This happens when a beat has more animation steps than its ` +
        `narration duration allows — shorten the narration for those beats, spread the same input across ` +
        `more "op:N" beats, or use a smaller input with fewer steps.`,
    });
  }

  if (blankCount > 0) {
    failures.push({
      severity: "error",
      code: "blank-checkpoint",
      message:
        `${blankCount} checkpoint(s) render with no array and no graph nodes — the screen would be empty. ` +
        `This usually means the "intro" beat (or its absence) isn't seeding the array/graph before the ` +
        `first op:N beat.`,
    });
  }

  return failures;
}

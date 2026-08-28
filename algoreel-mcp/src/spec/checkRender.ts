import { buildTimeline, type Timeline } from "../../remotion/buildTimeline";
import { computeLayout } from "../../remotion/primitives/layout";
import type { VisualState } from "../../remotion/primitives/state";
import { estimateTextBoxHeight } from "../../remotion/primitives/textBox";
import { CELL, FRAME, SAFE_AREA, STRUCT, TYPE_SCALE } from "../../remotion/template/tokens";
import { inputShape } from "./inputShape";
import type { StorySpec } from "./types";

// Caption.tsx's own lineHeight (1.3) and font weight (600) — duplicated as
// a literal here rather than imported, since Caption.tsx doesn't export
// its style constants; if that file's lineHeight ever changes, this needs
// to change with it (same drift risk tokens.ts's own STRUCT constants
// already accept for their "carried over unchanged" numbers).
const CAPTION_LINE_HEIGHT = 1.3;
// Below this many px of headroom, a structure/caption pairing is worth a
// warning even though the estimate says it's (barely) still clean —
// mirrors array-near-edge's "technically fine but tight" philosophy above.
const CAPTION_GAP_WARN_PX = 60;

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

  // Array width is keyed off input *shape*, not algorithm name — was
  // `spec.algorithm === "binarySearch" || "bubbleSort"` before the
  // codegen redesign (spec/types.ts's StorySpec comment). A newly
  // generated array algorithm (algoreel-mcp/src/algorithms/index.ts's
  // dynamic registry) has an `input.array` exactly like the hand-written
  // ones do, and gets this same check for free without checkRender
  // needing to know its name. Struct geometry (every node/link structure
  // — lists, trees, graphs, ...) can't be measured from spec.input alone
  // the same way: a tree's rendered depth/width depends on its *shape*,
  // not just its node count, and shape only exists once the algorithm has
  // actually run — so that check lives in checkpointChecks below, against
  // the timeline's real checkpoints, using the exact same computeLayout
  // StructureView will render with.
  if (inputShape(spec.input) === "array") {
    failures.push(...arrayWidthChecks((spec.input.array as unknown[]).length));
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

// Exported so a spec author (src/spec/beatBudget.ts, ensureSpec.ts) can pick
// an input that's guaranteed clean here rather than authoring freely and
// finding out from a failure message — one definition either way, since this
// is also exactly what arrayWidthChecks above compares n against.
export function maxArrayLength(): number {
  return Math.floor((FRAME.width + CELL.gap) / (CELL.size + CELL.gap));
}

// A single generic replacement for the old, per-layout listWidthChecks/
// graphOverlapCheck: any node/link structure's *rendered* geometry
// depends on its shape (a tree's width/depth), not just its node count,
// and shape only exists once the algorithm has actually run — so this
// scans every checkpoint the timeline actually produces, calling the
// exact same computeLayout StructureView renders with, and reports the
// single worst bounding-box overflow and the single tightest pairwise
// node spacing found across the whole run. Strictly more coverage than
// the two checks it replaces: this also catches a too-deep tree, which
// neither one could (both only ever looked at the initial node count).
// Structure vertical center in the actual rendered frame — Video.tsx mounts
// StateView inside its own <AbsoluteFill style={{alignItems:"center",
// justifyContent:"center"}}>, itself a direct absolutely-positioned child of
// Frame's own AbsoluteFill. Per CSS, an absolutely positioned element's
// inset offsets resolve against its containing block's padding box, not a
// padding-reduced content box — confirmed by Caption.tsx's own comment,
// which independently rediscovered this positioning it a bare bottom:60
// deep inside SAFE_AREA.bottom's zone (the exact bug this constant's
// derivation avoids repeating in reverse). So the structure centers on the
// *full* frame height, not the SAFE_AREA-reduced one.
const STRUCT_CENTER_Y = FRAME.height / 2;
// Caption's own anchor (remotion/template/Caption.tsx: bottom:
// SAFE_AREA.bottom on the same kind of absolutely-positioned box) — its
// bottom edge is fixed here and it grows upward as it wraps.
const CAPTION_BOTTOM_Y = FRAME.height - SAFE_AREA.bottom;
// Caption.tsx: left:60, right:60 on a FRAME.width-wide box.
const CAPTION_BOX_WIDTH = FRAME.width - 60 - 60;

function structGeometryChecks(timeline: Timeline): Check[] {
  const failures: Check[] = [];
  const maxHeight = FRAME.height - SAFE_AREA.top - SAFE_AREA.bottom;

  let worstOverflow: { width: number; height: number; layout: string; n: number } | null = null;
  let tightest: { spacing: number; size: number; layout: string; n: number } | null = null;
  let worstCaptionGap: { gap: number; layout: string; n: number } | null = null;

  for (const step of timeline.steps) {
    for (const cp of step.checkpoints) {
      const { structLayout, structNodes, structLinks } = cp.state;
      if (!structLayout || structNodes.length === 0) continue;

      const { width, height, positions } = computeLayout(structLayout, structNodes, structLinks);
      if (width > FRAME.width || height > maxHeight) {
        if (!worstOverflow || width * height > worstOverflow.width * worstOverflow.height) {
          worstOverflow = { width, height, layout: structLayout, n: structNodes.length };
        }
      }

      const size = STRUCT[structLayout].size;
      for (let i = 0; i < structNodes.length; i++) {
        for (let j = i + 1; j < structNodes.length; j++) {
          const a = positions[structNodes[i]!.id]!;
          const b = positions[structNodes[j]!.id]!;
          const spacing = Math.hypot(a.x - b.x, a.y - b.y);
          if (spacing < size && (!tightest || spacing < tightest.spacing)) {
            tightest = { spacing, size, layout: structLayout, n: structNodes.length };
          }
        }
      }

      // Vertical overlap between the structure and this beat's caption —
      // see estimateTextBoxHeight's own comment for how the wrapped-line
      // estimate was calibrated. Only structures tall enough to matter
      // (row/column/levels are all short; circle's the one that gets close)
      // ever come near CAPTION_BOTTOM_Y, so this is a no-op for most specs.
      const structBottomY = STRUCT_CENTER_Y + height / 2;
      const captionHeight = estimateTextBoxHeight(step.text, {
        maxWidthPx: CAPTION_BOX_WIDTH,
        fontSizePx: TYPE_SCALE.caption,
        lineHeight: CAPTION_LINE_HEIGHT,
      });
      const captionTopY = CAPTION_BOTTOM_Y - captionHeight;
      const gap = captionTopY - structBottomY;
      if (gap < CAPTION_GAP_WARN_PX && (!worstCaptionGap || gap < worstCaptionGap.gap)) {
        worstCaptionGap = { gap, layout: structLayout, n: structNodes.length };
      }
    }
  }

  if (worstOverflow) {
    failures.push({
      severity: "error",
      code: "struct-too-large",
      message:
        `a "${worstOverflow.layout}"-layout structure with ${worstOverflow.n} nodes renders ` +
        `${worstOverflow.width}x${worstOverflow.height}px, wider or taller than the available ` +
        `${FRAME.width}x${maxHeight}px (StructureView never resizes nodes to fit — see tokens.ts's ` +
        `STRUCT comment) — use fewer nodes or a shallower structure.`,
    });
  }
  if (tightest) {
    failures.push({
      severity: "error",
      code: "struct-nodes-overlap",
      message:
        `a "${tightest.layout}"-layout structure with ${tightest.n} nodes puts two nodes ${tightest.spacing.toFixed(0)}px ` +
        `apart on the fixed layout — less than the ${tightest.size}px node size, so they overlap. ` +
        `Use fewer nodes or a shallower structure.`,
    });
  }
  if (worstCaptionGap) {
    // Estimated, not measured (no real font metrics available outside a
    // browser — see textBox.ts's comment), so this stays a warning even
    // when the estimate says the gap is negative: an approximate check
    // shouldn't be the thing that fails a render, only something worth a
    // human or agent's attention. Promote to "error" only after this has
    // run against real renders long enough to trust the margin (PLAN.md's
    // own discipline against false-positive machines — see this file's
    // header comment on the checks deliberately not implemented).
    const verb = worstCaptionGap.gap < 0 ? "overlaps" : "comes within";
    const amount = Math.abs(worstCaptionGap.gap).toFixed(0);
    failures.push({
      severity: "warning",
      code: "caption-overlaps-structure",
      message:
        `a "${worstCaptionGap.layout}"-layout structure with ${worstCaptionGap.n} nodes ${verb} an estimated ` +
        `${amount}px ${worstCaptionGap.gap < 0 ? "past" : "of"} its beat's caption text (estimated, not measured — ` +
        `see textBox.ts) — consider a shorter caption or fewer/shallower nodes for this beat.`,
    });
  }

  return failures;
}

function isBlankState(state: VisualState): boolean {
  return state.array.length === 0 && state.structNodes.length === 0;
}

function checkpointChecks(timeline: Timeline): Check[] {
  const failures: Check[] = [...structGeometryChecks(timeline)];
  const invisibleByBeat = new Map<string, number>();
  let blankCount = 0;

  for (const step of timeline.steps) {
    let invisible = 0;
    for (const cp of step.checkpoints) {
      if (cp.durationInFrames === 0) invisible++;
      if (isBlankState(cp.state)) blankCount++;
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
        `${blankCount} checkpoint(s) render with no array and no struct nodes — the screen would be empty. ` +
        `This usually means the "intro" beat (or its absence) isn't seeding the array/structure before the ` +
        `first op:N beat.`,
    });
  }

  return failures;
}

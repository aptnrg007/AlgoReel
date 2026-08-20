import { runAlgorithm } from "../src/algorithms";
import type { StorySpec } from "../src/spec/types";
import { applyOperation, buildCheckpoints, groupOperationsByBeat, INITIAL_STATE, type VisualState } from "./primitives/state";
import { estimateBeatFrames, HOOK_DURATION_SEC } from "./timing";

export interface Checkpoint {
  state: VisualState;
  startFrame: number;
  durationInFrames: number;
}

export interface TimelineStep {
  beat: string;
  text: string;
  durationInFrames: number;
  checkpoints: Checkpoint[];
}

export interface Timeline {
  hookDurationInFrames: number;
  steps: TimelineStep[];
  outroText: string;
  outroDurationInFrames: number;
  totalDurationInFrames: number;
}

// The only place a StorySpec meets the deterministic algorithm engine. The
// agent never sees or invents this timeline — it only wrote the narration
// beats; everything about *when* things happen is computed here.
export function buildTimeline(spec: StorySpec, fps: number): Timeline {
  const { operations } = runAlgorithm(spec);

  const stepBeats = spec.narration.filter((n) => n.beat !== "outro");
  const outroBeat = spec.narration.find((n) => n.beat === "outro");
  const opBeatCount = stepBeats.filter((n) => n.beat !== "intro").length;
  const groups = groupOperationsByBeat(operations, opBeatCount);

  let state: VisualState = INITIAL_STATE;
  const steps: TimelineStep[] = [];
  const consumedKeys = new Set<string>();

  for (const beat of stepBeats) {
    const ops = groups.get(beat.beat) ?? [];
    consumedKeys.add(beat.beat);
    const durationInFrames = estimateBeatFrames(beat.text, fps);
    const checkpointStates = buildCheckpoints(ops, state);
    const checkpoints = allocateCheckpoints(checkpointStates, durationInFrames);
    state = checkpointStates[checkpointStates.length - 1]!;
    steps.push({ beat: beat.beat, text: beat.text, durationInFrames, checkpoints });
  }

  // Fold in any trailing operations (e.g. the final "done") that weren't
  // claimed by a narration beat, so the outro card reflects final state.
  for (const [key, ops] of groups) {
    if (!consumedKeys.has(key)) {
      for (const op of ops) state = applyOperation(state, op);
    }
  }

  const hookDurationInFrames = Math.round(HOOK_DURATION_SEC * fps);
  const outroText = outroBeat?.text ?? "";
  const outroDurationInFrames = estimateBeatFrames(outroText, fps, { minSec: 3.5, maxSec: 8 });

  const totalDurationInFrames =
    hookDurationInFrames + steps.reduce((sum, s) => sum + s.durationInFrames, 0) + outroDurationInFrames;

  return { hookDurationInFrames, steps, outroText, outroDurationInFrames, totalDurationInFrames };
}

// Splits a beat's frame budget evenly across its checkpoint states, giving
// any remainder to the last checkpoint.
function allocateCheckpoints(states: VisualState[], totalDurationInFrames: number): Checkpoint[] {
  const base = Math.floor(totalDurationInFrames / states.length);
  const remainder = totalDurationInFrames - base * states.length;
  let startFrame = 0;
  return states.map((state, i) => {
    const durationInFrames = base + (i === states.length - 1 ? remainder : 0);
    const checkpoint: Checkpoint = { state, startFrame, durationInFrames };
    startFrame += durationInFrames;
    return checkpoint;
  });
}

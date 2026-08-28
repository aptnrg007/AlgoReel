import { buildCheckpoints, INITIAL_STATE, groupOperationsByBeat } from "../../remotion/primitives/state";
import { estimateBeatFrames } from "../../remotion/timing";
import { runAlgorithm } from "../algorithms/index";
import { splitPrimarySteps } from "./beats";

// This is the "plan before authoring" half of running StorySpec generation
// on a local model (see ensureSpec.ts) — checkRender.ts's invisible-
// checkpoints/duration-off-target failures are a pure function of
// (algorithm, input, per-beat word count), and the orchestrator picks all
// three before a narration model ever runs. So instead of authoring freely
// and repairing afterward, this computes exactly how many op:N beats are
// worth asking for and how many words each one needs, and hands the model a
// fill-in-the-blanks job it can't get catastrophically wrong on pacing.
//
// Deliberately reuses buildCheckpoints/groupOperationsByBeat/
// splitPrimarySteps/estimateBeatFrames rather than re-deriving their math —
// this must never become a second, driftable definition of "how many
// checkpoints does this beat produce" or "how many frames does this many
// words buy."

export interface BeatPlan {
  beat: "intro" | `op:${number}`;
  checkpointCount: number;
  // Fewer words than this and checkRender.ts's invisible-checkpoints check
  // will fire for this beat (some checkpoint gets 0 frames). Mechanically
  // derived, not guessed: the smallest word count whose estimateBeatFrames
  // output covers this beat's real checkpoint count.
  minWords: number;
  // A soft ceiling, not enforced anywhere — beyond this, extra words buy no
  // extra frames (estimateBeatFrames caps at maxSec), so there's no reason
  // to ask a narration model to write more.
  maxWords: number;
}

export interface BeatBudget {
  opBeatCount: number;
  perBeat: BeatPlan[];
  feasible: boolean;
  // Set only when feasible is false — explains which beat couldn't be
  // satisfied by any opBeatCount and why, so the caller knows the fix is a
  // smaller/simpler input, not more retries.
  infeasibleReason?: string;
}

const FPS = 30;
// estimateBeatFrames' own defaults (timing.ts) — duplicated as literal
// bounds here only for the search below, never as a substitute for calling
// the real function to check a word count's actual frame yield.
const MIN_SEC = 1.8;
const MAX_SEC = 6;
const MAX_WORDS_SEARCHED = 200;

function countCheckpoints(ops: Parameters<typeof buildCheckpoints>[0]): number {
  return buildCheckpoints(ops, INITIAL_STATE).length;
}

// Smallest N words whose estimateBeatFrames(...) output is >= requiredFrames,
// found by calling the real function with an N-word placeholder rather than
// inverting its formula by hand — stays correct even if WORDS_PER_SECOND or
// the min/max clamp in timing.ts ever changes. Returns null if no word count
// up to MAX_WORDS_SEARCHED gets there (requiredFrames exceeds what maxSec's
// cap allows at all, for this beat).
function minWordsForFrames(requiredFrames: number, opts?: { minSec?: number; maxSec?: number }): number | null {
  for (let words = 1; words <= MAX_WORDS_SEARCHED; words++) {
    const placeholder = Array.from({ length: words }, () => "w").join(" ");
    if (estimateBeatFrames(placeholder, FPS, opts) >= requiredFrames) return words;
  }
  return null;
}

function maxWordsWorthWriting(opts?: { minSec?: number; maxSec?: number }): number {
  const maxSec = opts?.maxSec ?? MAX_SEC;
  // One past the last word count that still increases estimateBeatFrames'
  // output — i.e. the point estimateBeatFrames' own maxSec clamp takes over.
  let words = 1;
  let frames = estimateBeatFrames("w", FPS, opts);
  const capFrames = Math.round(maxSec * FPS);
  while (frames < capFrames && words < MAX_WORDS_SEARCHED) {
    words++;
    frames = estimateBeatFrames(Array.from({ length: words }, () => "w").join(" "), FPS, opts);
  }
  return words;
}

const MAX_CHECKPOINT_FRAMES = Math.round(MAX_SEC * FPS);

// Tries opBeatCount candidates from a viewer-friendly default upward to
// primaryStepCount (never higher — there's nothing to distribute past one
// primary step per beat), stopping at the first one where every beat's
// checkpoint count fits under maxSec's frame cap. Preferring the smallest
// feasible count keeps beat counts close to what every committed demo spec
// already uses (2-5 op:N beats), rather than always maxing out at
// primaryStepCount.
export function planBeats(spec: { algorithm: string; input: unknown }, preferredMaxOpBeats = 5): BeatBudget {
  const { operations } = runAlgorithm(spec);
  const { introOps, primarySteps } = splitPrimarySteps(operations);
  const primaryStepCount = primarySteps.length;

  const introCheckpoints = countCheckpoints(introOps);
  if (introCheckpoints > MAX_CHECKPOINT_FRAMES) {
    return {
      opBeatCount: 0,
      perBeat: [],
      feasible: false,
      infeasibleReason:
        `the intro alone produces ${introCheckpoints} animation checkpoints, more than any single beat can ` +
        `hold even at the longest allowed narration (${MAX_CHECKPOINT_FRAMES} frames) — use a smaller input.`,
    };
  }

  if (primaryStepCount === 0) {
    return {
      opBeatCount: 0,
      perBeat: [{ beat: "intro", checkpointCount: introCheckpoints, minWords: 1, maxWords: maxWordsWorthWriting() }],
      feasible: true,
    };
  }

  const start = Math.min(primaryStepCount, Math.max(preferredMaxOpBeats, 1));
  for (let n = start; n <= primaryStepCount; n++) {
    const groups = groupOperationsByBeat(operations, n);
    const perBeat: BeatPlan[] = [
      { beat: "intro", checkpointCount: introCheckpoints, minWords: 1, maxWords: maxWordsWorthWriting() },
    ];
    let feasible = true;
    for (let b = 0; b < n; b++) {
      const ops = groups.get(`op:${b}`) ?? [];
      const checkpointCount = countCheckpoints(ops);
      if (checkpointCount > MAX_CHECKPOINT_FRAMES) {
        feasible = false;
        break;
      }
      const minWords = minWordsForFrames(checkpointCount) ?? maxWordsWorthWriting();
      perBeat.push({ beat: `op:${b}`, checkpointCount, minWords, maxWords: maxWordsWorthWriting() });
    }
    if (feasible) return { opBeatCount: n, perBeat, feasible: true };
  }

  return {
    opBeatCount: 0,
    perBeat: [],
    feasible: false,
    infeasibleReason:
      `even at ${primaryStepCount} op:N beat(s) (one per primary step, the finest split possible), some beat ` +
      `still produces more than ${MAX_CHECKPOINT_FRAMES} checkpoints — use a smaller input.`,
  };
}

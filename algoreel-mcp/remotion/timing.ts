// Frame timings are derived, never invented by hand (PLAN.md §4). Phase 0
// has no real TTS yet (§11 — provider still an open decision), so duration
// is estimated from narration word count at a Shorts-appropriate reading
// pace. This function is the one place that estimate lives, so swapping in
// real audio duration later means changing this file only.
const WORDS_PER_SECOND = 2.6;

export function estimateBeatFrames(text: string, fps: number, opts?: { minSec?: number; maxSec?: number }): number {
  const minSec = opts?.minSec ?? 1.8;
  const maxSec = opts?.maxSec ?? 6;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sec = Math.min(maxSec, Math.max(minSec, words / WORDS_PER_SECOND));
  return Math.round(sec * fps);
}

export const HOOK_DURATION_SEC = 3;

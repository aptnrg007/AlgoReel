// Pure, video-type-agnostic — lives outside any one video type's own
// directory on purpose, same precedent as remotion/primitives/textBox.ts
// (shared by more than one checkRender.ts already). Finds the single-step
// transition in a series of numbers with the largest relative change.
//
// PLAN.md Phase 9 step 3's rule, restated: an agent may explain a finding
// ("2008 was a sharp drop"), never invent one. This is the "detect" half —
// arithmetic on the real data, nothing else. Whatever calls this (a CLI
// flag, a human, eventually a narration step) supplies the label text for
// whichever index comes back; nothing here ever produces prose.
export function detectStandoutIndex(values: number[]): number | null {
  let bestIndex: number | null = null;
  let bestMagnitude = -Infinity;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const curr = values[i]!;
    if (prev === 0) continue; // relative change is undefined from a zero base
    const magnitude = Math.abs((curr - prev) / prev);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestIndex = i;
    }
  }
  return bestIndex;
}

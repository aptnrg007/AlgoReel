// Deliberately no React/Remotion imports — same discipline layout.ts
// already documents (its own header comment) for the same reason:
// checkRender.ts needs to call the exact wrapping math a real render will
// use, before ever paying for a render, and a pure function is the only
// way both the renderer and the pre-render checker can share one
// definition instead of two that can drift.
//
// This estimates wrapped line count, not exact pixel-perfect layout —
// there is no real font-metrics measurement available outside a browser
// context here (the same limitation checkRender.ts's other geometry
// checks don't have, since node/link positions are pure arithmetic but
// text shaping isn't). avgCharWidthEm below is calibrated, not guessed:
// checkRender.test.ts's fixtures include a real committed spec
// (bfs-demo.json) with a 122-character caption over this template's
// tallest structure (a 7-node circle graph) — sampled and visually
// confirmed clean (no overlap) via sample_frames before picking this
// constant, so it's tuned to under-count rather than over-count lines
// against real evidence, not a bare guess.
const AVG_CHAR_WIDTH_EM = 0.52;

// Greedy word-wrap simulation (wraps at word boundaries like a real
// renderer does, not a raw chars-per-line division, which would wrap
// mid-word and under-count real captions that happen to have one long
// word near a line boundary).
export function estimateWrappedLines(text: string, opts: { maxWidthPx: number; fontSizePx: number }): number {
  const avgCharWidthPx = opts.fontSizePx * AVG_CHAR_WIDTH_EM;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let lines = 1;
  let currentLineWidth = 0;
  for (const word of words) {
    const wordWidth = word.length * avgCharWidthPx;
    const withSpace = currentLineWidth === 0 ? wordWidth : currentLineWidth + avgCharWidthPx + wordWidth;
    if (withSpace > opts.maxWidthPx && currentLineWidth > 0) {
      lines++;
      currentLineWidth = wordWidth;
    } else {
      currentLineWidth = withSpace;
    }
  }
  return lines;
}

export function estimateTextBoxHeight(text: string, opts: { maxWidthPx: number; fontSizePx: number; lineHeight: number }): number {
  return estimateWrappedLines(text, opts) * opts.fontSizePx * opts.lineHeight;
}

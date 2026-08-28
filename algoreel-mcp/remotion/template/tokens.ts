// The visual language, locked per PLAN.md §6. Every primitive and template
// component reads from here — nothing sizes or colors itself independently.

export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;

export const SAFE_AREA = { top: 120, bottom: 280 } as const;

export const COLORS = {
  background: "#0b0e14",
  neutral: "#e8e9ed",
  neutralDim: "#7a7f8c",
  focus: "#ffcc66",
  found: "#5ee6a0",
  discarded: "#3a3f4b",
  pointer: "#66aaff",
  emphasis: "#ff8a65",
} as const;

export const FONT_FAMILY =
  "'Helvetica Neue', Inter, Arial, sans-serif";

// The one enter/exit pop transition (PLAN.md §6: "one enter, one exit, one
// emphasis pop. Reuse everywhere.") — the spring's damping is shared by
// every text/primitive pop-in (Hook, Outro, ArrayView, StructureView);
// duration defaults to 15 frames but Caption.tsx intentionally uses a
// quicker 12 (captions change more often, on a beat cadence, so a slower
// pop would visibly lag behind the text).
export const POP_SPRING_CONFIG = { damping: 200 } as const;
export const POP_SPRING_DURATION_FRAMES = 15;

// Shared between buildTimeline.ts (how long the outro sequence actually
// runs) and server.ts's generate_voice-adjacent duration estimate — both
// have to agree on this or the rendered outro and its planned duration
// silently diverge.
export const OUTRO_TIMING = { minSec: 3.5, maxSec: 8 } as const;

export const TYPE_SCALE = {
  hook: 76,
  caption: 46,
  label: 30,
} as const;

// Fixed per-cell geometry — never resized based on element count. If an
// array doesn't fit at this size, the fix is a shorter array, not a smaller cell.
export const CELL = { size: 120, gap: 22, radius: 18 } as const;

// Fixed per-layout geometry for StructureView (remotion/primitives/
// layout.ts computes positions from these; StructureView draws with
// them) — one entry per LayoutKind (src/algorithms/types.ts), same
// "never resize per element count" discipline as CELL: if a structure
// doesn't fit, the fix is a smaller structure, not a smaller layout.
// Numbers are carried over unchanged from the pre-generalization
// LinkedListView (row) and GraphView (circle) so migrating both onto
// this one engine doesn't change how they look.
export const STRUCT = {
  // A single left-to-right row (a former linked list, a stack drawn
  // horizontally, ...). `gap` is wide because a directed arrow has to
  // live in it; `arcHeight` is how far a rewired (non-adjacent) link's
  // arrow bows below the row so it never crosses a pointer label
  // stacked above.
  row: { size: 120, gap: 60, radius: 18, arcHeight: 90 },
  // A single top-to-bottom column (a stack). Narrower gap than row's —
  // a column has no need to leave room for a directed arrow's label,
  // just the arrowhead itself.
  column: { size: 120, gap: 40, radius: 18 },
  // Nodes arranged by tree depth (binary tree / BST / heap / trie).
  // `hGap`/`vGap` are independent because a tree's width (how many
  // leaves) and depth (how many levels) grow at different rates.
  levels: { size: 100, hGap: 40, vGap: 140, radius: 18 },
  // Nodes evenly spaced around a fixed circle (a graph) — position is
  // purely a function of a node's index and the total count, no
  // force-directed layout (that can't be checked before a render).
  circle: { size: 96, radius: 380 },
} as const;

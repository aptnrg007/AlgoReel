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

export const TYPE_SCALE = {
  hook: 76,
  caption: 46,
  label: 30,
} as const;

// Fixed per-cell geometry — never resized based on element count. If an
// array doesn't fit at this size, the fix is a shorter array, not a smaller cell.
export const CELL = { size: 120, gap: 22, radius: 18 } as const;

// Graph nodes sit evenly spaced around a fixed circle (GraphView) — same
// "never resize per element count" discipline as CELL. If a graph doesn't
// fit at this size, the fix is fewer nodes, not a smaller layout.
export const NODE = { size: 96, radius: 380 } as const;

// Linked-list nodes sit in a single left-to-right row (LinkedListView) —
// same "never resize per element count" discipline as CELL/NODE. `gap` is
// much wider than CELL.gap because a directed arrow has to live in it;
// `arcHeight` is how far a rewired (non-adjacent) link's arrow bows below
// the row so it never crosses a pointer label stacked above.
export const LIST = { size: 120, gap: 60, radius: 18, arcHeight: 90 } as const;

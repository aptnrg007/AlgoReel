import type { LayoutKind, StructureShape } from "../../src/algorithms/types";
import { STRUCT } from "../template/tokens";

// The single place a StructureShape becomes a LayoutKind. An algorithm
// declares the conceptual shape it built (types.ts's StructureShape
// doc-comment); this is the one deterministic lookup deciding what that
// renders as, so no call site ever asserts a LayoutKind literal by hand
// again. Exhaustively checked the same way computeLayout's own switch is.
export function inferLayout(shape: StructureShape): LayoutKind {
  switch (shape) {
    case "chain":
      return "row";
    case "tree":
      return "levels";
    case "graph":
      return "circle";
    case "stack":
      return "column";
    default: {
      const _exhaustive: never = shape;
      return _exhaustive;
    }
  }
}

// Pure — no React, no Remotion imports — so checkRender.ts (which runs
// before the ~30-60s render, PLAN.md §7) can call the exact same code
// StructureView will actually render with, instead of duplicating the
// geometry in a separate pre-render estimate that could drift from it.

export interface StructNode {
  id: string;
  value: string | number;
}

export interface StructLink {
  from: string;
  slot: string;
  to: string;
}

// Every position is the node's *center* — uniform across all four layouts
// (circleLayout's math is naturally center-based; row/column/levels add
// half their node size to what would otherwise be a top-left corner) so
// StructureView never needs to know which layout produced a position to
// draw it.
export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

export function computeLayout(layout: LayoutKind, nodes: StructNode[], links: StructLink[]): LayoutResult {
  switch (layout) {
    case "row":
      return rowLayout(nodes);
    case "column":
      return columnLayout(nodes);
    case "circle":
      return circleLayout(nodes);
    case "levels":
      return levelsLayout(nodes, links);
    default: {
      const _exhaustive: never = layout;
      return _exhaustive;
    }
  }
}

// Index * step, left to right — lifted from the pre-generalization
// LinkedListView's row math.
function rowLayout(nodes: StructNode[]): LayoutResult {
  const step = STRUCT.row.size + STRUCT.row.gap;
  const half = STRUCT.row.size / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, i) => {
    positions[node.id] = { x: i * step + half, y: half };
  });
  const width = nodes.length === 0 ? 0 : (nodes.length - 1) * step + STRUCT.row.size;
  return { positions, width, height: nodes.length === 0 ? 0 : STRUCT.row.size };
}

// Index * step, top to bottom — same math as rowLayout with the axes
// swapped. Which end of the array is visually "top" (e.g. a stack's top
// of stack) is the algorithm's call, made by the order it declares nodes
// in, not this function's.
function columnLayout(nodes: StructNode[]): LayoutResult {
  const step = STRUCT.column.size + STRUCT.column.gap;
  const half = STRUCT.column.size / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, i) => {
    positions[node.id] = { x: half, y: i * step + half };
  });
  const height = nodes.length === 0 ? 0 : (nodes.length - 1) * step + STRUCT.column.size;
  return { positions, width: nodes.length === 0 ? 0 : STRUCT.column.size, height };
}

// Evenly spaced around a fixed circle — lifted verbatim from the
// pre-generalization GraphView's math.
function circleLayout(nodes: StructNode[]): LayoutResult {
  const n = nodes.length;
  if (n === 0) return { positions: {}, width: 0, height: 0 };
  const diameter = STRUCT.circle.radius * 2 + STRUCT.circle.size;
  const center = diameter / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions[node.id] = {
      x: center + STRUCT.circle.radius * Math.cos(angle),
      y: center + STRUCT.circle.radius * Math.sin(angle),
    };
  });
  return { positions, width: diameter, height: diameter };
}

// Binary-tree-shaped: depth from walking "left"/"right" links down from
// the root, x from an in-order walk (so a left child always ends up left
// of its parent and a right child right of it — the one thing that
// actually makes a rendered tree read as a tree). A node not yet
// reachable from the root (e.g. the single checkpoint right after
// "struct", before any "link" ops have arrived) gets appended as its own
// floating root on row 0 rather than crashing — deliberately permissive,
// since checkRender calls this on every checkpoint a spec produces,
// including transient ones mid-construction.
//
// Binary only (looks for "left"/"right" slots specifically) — a general
// n-ary tree isn't in scope (PLAN.md's linked-list-first phasing applies
// here too: prove one tree shape before generalizing further).
function levelsLayout(nodes: StructNode[], links: StructLink[]): LayoutResult {
  const childOf = new Map<string, Map<string, string>>(); // parent -> slot -> child
  const hasParent = new Set<string>();
  for (const link of links) {
    if (!childOf.has(link.from)) childOf.set(link.from, new Map());
    childOf.get(link.from)!.set(link.slot, link.to);
    hasParent.add(link.to);
  }

  const depthOf = new Map<string, number>();
  const xOf = new Map<string, number>();
  let nextX = 0;
  const visiting = new Set<string>(); // cycle guard — malformed input must not hang

  function visit(id: string, depth: number): void {
    if (depthOf.has(id) || visiting.has(id)) return;
    visiting.add(id);
    depthOf.set(id, depth);
    const children = childOf.get(id);
    const left = children?.get("left");
    if (left) visit(left, depth + 1);
    xOf.set(id, nextX++);
    const right = children?.get("right");
    if (right) visit(right, depth + 1);
    visiting.delete(id);
  }

  for (const node of nodes) {
    if (!hasParent.has(node.id)) visit(node.id, 0);
  }
  // Anything still unpositioned (only reachable via a cycle) gets a slot
  // too, so every declared node always has a position.
  for (const node of nodes) {
    if (!depthOf.has(node.id)) {
      depthOf.set(node.id, 0);
      xOf.set(node.id, nextX++);
    }
  }

  const half = STRUCT.levels.size / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    positions[node.id] = {
      x: xOf.get(node.id)! * (STRUCT.levels.size + STRUCT.levels.hGap) + half,
      y: depthOf.get(node.id)! * STRUCT.levels.vGap + half,
    };
  }
  if (nextX === 0) return { positions, width: 0, height: 0 };
  const maxDepth = Math.max(0, ...depthOf.values());
  const width = (nextX - 1) * (STRUCT.levels.size + STRUCT.levels.hGap) + STRUCT.levels.size;
  const height = maxDepth * STRUCT.levels.vGap + STRUCT.levels.size;
  return { positions, width, height };
}

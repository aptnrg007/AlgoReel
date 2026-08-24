import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LayoutKind } from "../../src/algorithms/types";
import { COLORS, STRUCT, TYPE_SCALE } from "../template/tokens";
import { computeLayout, type LayoutResult } from "./layout";
import { edgeKey, type VisualState } from "./state";

// Replaces the pre-generalization LinkedListView and GraphView with one
// component parameterized by state.structLayout — see layout.ts's own
// comment for why layouts stay pure functions of node/link data rather
// than force-directed or otherwise iterative.

const NODE_COLOR: Record<"neutral" | "focus" | "pending" | "done" | "dead", string> = {
  neutral: "#1a1f2b",
  focus: COLORS.focus,
  pending: COLORS.pointer,
  done: COLORS.found,
  dead: COLORS.discarded,
};

const TEXT_COLOR: Record<"neutral" | "focus" | "pending" | "done" | "dead", string> = {
  neutral: COLORS.neutral,
  focus: "#1a1408",
  pending: "#04162e",
  done: "#062015",
  dead: COLORS.neutralDim,
};

// Undirected-edge status coloring, lifted verbatim from GraphView.
const EDGE_COLOR: Record<"inactive" | "active" | "used", string> = {
  inactive: COLORS.discarded,
  active: COLORS.focus,
  used: COLORS.found,
};

const NODE_SIZE: Record<LayoutKind, number> = {
  row: STRUCT.row.size,
  column: STRUCT.column.size,
  levels: STRUCT.levels.size,
  circle: STRUCT.circle.size,
};

const NODE_RADIUS: Record<LayoutKind, number> = {
  row: STRUCT.row.radius,
  column: STRUCT.column.radius,
  levels: STRUCT.levels.radius,
  circle: STRUCT.circle.size / 2,
};

// Circle-layout node labels are short (a graph's node ids, e.g. "A") and
// were sized smaller than a value-bearing node's digits even before this
// generalized — kept exactly as GraphView had it.
const NODE_FONT_SIZE: Record<LayoutKind, number> = {
  row: 44,
  column: 44,
  levels: 36,
  circle: TYPE_SCALE.label,
};

interface Point {
  x: number;
  y: number;
}

function trim(a: Point, b: Point, size: number): { start: Point; end: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    start: { x: a.x + ux * (size / 2), y: a.y + uy * (size / 2) },
    end: { x: b.x - ux * (size / 2), y: b.y - uy * (size / 2) },
  };
}

// One step before the first node, extrapolated from the gap between the
// first two nodes — where a pointer currently aimed at nothing (head
// before assignment, a reversal's first prev) renders. Falls back to a
// fixed offset above the lone node when there's only one.
function legendPosition(positions: LayoutResult["positions"], nodeIds: string[]): Point {
  if (nodeIds.length === 0) return { x: 0, y: 0 };
  const p0 = positions[nodeIds[0]!]!;
  if (nodeIds.length === 1) return { x: p0.x, y: p0.y - 80 };
  const p1 = positions[nodeIds[1]!]!;
  return { x: p0.x - (p1.x - p0.x), y: p0.y - (p1.y - p0.y) };
}

export const StructureView: React.FC<{ state: VisualState }> = ({ state }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 15 });

  const layout = state.structLayout;
  if (!layout || state.structNodes.length === 0) return null;

  const { positions, width, height } = computeLayout(layout, state.structNodes, state.structLinks);
  const size = NODE_SIZE[layout];
  const radius = NODE_RADIUS[layout];
  const fontSize = NODE_FONT_SIZE[layout];
  const isCircle = layout === "circle";

  // Circle-layout nodes (a graph) never carry pointer labels today and
  // GraphView never reserved space for them — keep its exact diameter x
  // diameter geometry rather than shifting it down inside extra padding
  // meant for the other three layouts' pointer labels.
  const topPad = isCircle ? 0 : 90;
  const bottomPad = isCircle ? 0 : 50;
  const arcRoom = layout === "row" ? STRUCT.row.arcHeight : 0;
  const containerHeight = height + topPad + bottomPad + arcRoom;

  const indexOf = new Map<string, number>();
  state.structNodes.forEach((node, i) => indexOf.set(node.id, i));

  const pointersByTarget: Record<string, string[]> = {};
  for (const [name, node] of Object.entries(state.structPointers)) {
    const key = node ?? "__null__";
    (pointersByTarget[key] ??= []).push(name);
  }

  const arrowId = "struct-arrow";

  return (
    <div style={{ position: "relative", width, height: containerHeight, opacity: pop }}>
      <svg width={width} height={containerHeight} style={{ position: "absolute", top: 0, left: 0 }}>
        <defs>
          <marker id={arrowId} markerWidth={10} markerHeight={10} refX={8} refY={3} orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill={COLORS.neutralDim} />
          </marker>
        </defs>

        {/* Undirected edges — a fixed, never-rewired set (a graph). */}
        {state.structEdges.map(([a, b]) => {
          const pa = positions[a]!;
          const pb = positions[b]!;
          const status = state.structLinkState[edgeKey(a, b)] ?? "inactive";
          return (
            <line
              key={edgeKey(a, b)}
              x1={pa.x}
              y1={pa.y + topPad}
              x2={pb.x}
              y2={pb.y + topPad}
              stroke={EDGE_COLOR[status]}
              strokeWidth={status === "inactive" ? 4 : 7}
            />
          );
        })}

        {/* Directed links — rewired one at a time (a list, a tree). Row
            layout arcs a non-adjacent link below the row so it never
            crosses a pointer label stacked above; every other layout
            (a tree's parent->child links only ever go one level down,
            never backward) draws a straight trimmed line. */}
        {state.structLinks.map((link) => {
          const pa = { x: positions[link.from]!.x, y: positions[link.from]!.y + topPad };
          const pb = { x: positions[link.to]!.x, y: positions[link.to]!.y + topPad };
          const isForwardAdjacent = layout === "row" && indexOf.get(link.to)! === indexOf.get(link.from)! + 1;
          const isRowBackward = layout === "row" && !isForwardAdjacent;
          const { start, end } = trim(pa, pb, size);

          if (!isRowBackward) {
            return (
              <line
                key={`${link.from}|${link.slot}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={COLORS.neutralDim}
                strokeWidth={4}
                markerEnd={`url(#${arrowId})`}
              />
            );
          }
          const arcY = Math.max(start.y, end.y) + STRUCT.row.arcHeight;
          const midX = (start.x + end.x) / 2;
          return (
            <path
              key={`${link.from}|${link.slot}`}
              d={`M${start.x},${start.y} Q${midX},${arcY} ${end.x},${end.y}`}
              stroke={COLORS.neutralDim}
              strokeWidth={4}
              fill="none"
              markerEnd={`url(#${arrowId})`}
            />
          );
        })}
      </svg>

      {state.structNodes.map((node) => {
        const style = state.structNodeState[node.id] ?? "neutral";
        const pos = positions[node.id]!;
        const left = pos.x - size / 2;
        const top = pos.y - size / 2 + topPad;
        return (
          <div key={node.id}>
            <div
              style={{
                position: "absolute",
                top,
                left,
                width: size,
                height: size,
                borderRadius: isCircle ? "50%" : radius,
                background: NODE_COLOR[style],
                color: TEXT_COLOR[style],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize,
                fontWeight: 700,
              }}
            >
              {node.value}
            </div>
            {pointersByTarget[node.id]?.map((name, j) => (
              <div
                key={name}
                style={{
                  position: "absolute",
                  top: top - 40 * (j + 1),
                  left,
                  width: size,
                  textAlign: "center",
                  color: COLORS.pointer,
                  fontSize: TYPE_SCALE.label,
                  fontWeight: 800,
                }}
              >
                {name}
                <div style={{ fontSize: 26 }}>▾</div>
              </div>
            ))}
          </div>
        );
      })}

      {pointersByTarget.__null__?.map((name, j) => {
        const pos = legendPosition(
          positions,
          state.structNodes.map((n) => n.id),
        );
        const left = pos.x - size / 2;
        const top = pos.y - size / 2 + topPad - 40 * (j + 1);
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              top,
              left,
              width: size,
              textAlign: "center",
              color: COLORS.pointer,
              fontSize: TYPE_SCALE.label,
              fontWeight: 800,
            }}
          >
            {name}
            <div style={{ fontSize: 26 }}>▾</div>
          </div>
        );
      })}
    </div>
  );
};

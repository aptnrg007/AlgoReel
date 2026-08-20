import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, NODE, TYPE_SCALE } from "../template/tokens";
import { edgeKey, type VisualState } from "./state";

const NODE_COLOR: Record<"unvisited" | "queued" | "current" | "visited", string> = {
  unvisited: "#1a1f2b",
  queued: COLORS.pointer,
  current: COLORS.focus,
  visited: COLORS.found,
};

const TEXT_COLOR: Record<"unvisited" | "queued" | "current" | "visited", string> = {
  unvisited: COLORS.neutral,
  queued: "#04162e",
  current: "#1a1408",
  visited: "#062015",
};

const EDGE_COLOR: Record<"inactive" | "active" | "used", string> = {
  inactive: COLORS.discarded,
  active: COLORS.focus,
  used: COLORS.found,
};

// Nodes sit evenly spaced around a fixed circle — deterministic purely from
// node order, no force-directed layout needed at this graph size (PLAN.md
// §6's "never resize per element count" discipline, applied to layout
// rather than a single element's geometry).
export const GraphView: React.FC<{ state: VisualState }> = ({ state }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 15 });

  const n = state.nodes.length;
  if (n === 0) return null;

  const diameter = NODE.radius * 2 + NODE.size;
  const center = diameter / 2;

  const positions: Record<string, { x: number; y: number }> = {};
  state.nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions[node] = { x: NODE.radius * Math.cos(angle), y: NODE.radius * Math.sin(angle) };
  });

  return (
    <div style={{ position: "relative", width: diameter, height: diameter, opacity: pop }}>
      <svg width={diameter} height={diameter} style={{ position: "absolute", top: 0, left: 0 }}>
        {state.edges.map(([a, b]) => {
          const pa = positions[a]!;
          const pb = positions[b]!;
          const status = state.edgeStatus[edgeKey(a, b)] ?? "inactive";
          return (
            <line
              key={edgeKey(a, b)}
              x1={pa.x + center}
              y1={pa.y + center}
              x2={pb.x + center}
              y2={pb.y + center}
              stroke={EDGE_COLOR[status]}
              strokeWidth={status === "inactive" ? 4 : 7}
            />
          );
        })}
      </svg>
      {state.nodes.map((node) => {
        const pos = positions[node]!;
        const status = state.nodeStatus[node] ?? "unvisited";
        return (
          <div
            key={node}
            style={{
              position: "absolute",
              top: center + pos.y - NODE.size / 2,
              left: center + pos.x - NODE.size / 2,
              width: NODE.size,
              height: NODE.size,
              borderRadius: "50%",
              background: NODE_COLOR[status],
              color: TEXT_COLOR[status],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: TYPE_SCALE.label,
              fontWeight: 700,
            }}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
};

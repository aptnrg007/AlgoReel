import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, LIST, TYPE_SCALE } from "../template/tokens";
import type { VisualState } from "./state";

const NODE_COLOR: Record<"neutral" | "focus", string> = {
  neutral: "#1a1f2b",
  focus: COLORS.focus,
};

const TEXT_COLOR: Record<"neutral" | "focus", string> = {
  neutral: COLORS.neutral,
  focus: "#1a1408",
};

// Nodes sit in one left-to-right row, with one permanently-drawn "∅" box
// one slot past the last node — the terminal every unmodified list ends
// at, and the default arrow target for whichever real node is currently
// last (see tokens.ts's LIST comment for the "never resize per element
// count" discipline this follows). Pointers currently pointing at null
// (head before assignment, a reversal's first prev) render one slot to
// the *left* of node 0 — floating outside the row's own width budget,
// the same tolerance ArrayView already gives pointer labels that don't
// count toward its width check.
export const LinkedListView: React.FC<{ state: VisualState }> = ({ state }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 15 });

  const n = state.listNodes.length;
  if (n === 0) return null;

  const BOX_SLOT = n;
  const totalSlots = n + 1;
  const totalWidth = totalSlots * LIST.size + (totalSlots - 1) * LIST.gap;
  const step = LIST.size + LIST.gap;
  const rowTop = 90;
  const centerY = rowTop + LIST.size / 2;

  const slotOf = new Map<string, number>();
  state.listNodes.forEach((node, i) => slotOf.set(node.id, i));

  const xOf = (slot: number) => slot * step;

  const pointersByTarget: Record<string, string[]> = {};
  for (const [name, node] of Object.entries(state.listPointers)) {
    const key = node ?? "__null__";
    (pointersByTarget[key] ??= []).push(name);
  }

  return (
    <div style={{ position: "relative", width: totalWidth, height: LIST.size + 140 + LIST.arcHeight, opacity: pop }}>
      <svg
        width={totalWidth}
        height={LIST.size + 140 + LIST.arcHeight}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <defs>
          <marker id="list-arrow" markerWidth={10} markerHeight={10} refX={8} refY={3} orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill={COLORS.neutralDim} />
          </marker>
        </defs>
        {state.listNodes.map((node) => {
          const fromSlot = slotOf.get(node.id)!;
          const nextId = state.listNext[node.id] ?? null;
          const isLastNode = fromSlot === n - 1;
          const startX = xOf(fromSlot) + LIST.size;
          const startY = centerY;

          if (nextId === null) {
            if (isLastNode) {
              // Adjacent to the box — same straight-line treatment as any
              // other forward-adjacent link.
              return (
                <line
                  key={node.id}
                  x1={startX}
                  y1={startY}
                  x2={xOf(BOX_SLOT)}
                  y2={centerY}
                  stroke={COLORS.neutralDim}
                  strokeWidth={4}
                  markerEnd="url(#list-arrow)"
                />
              );
            }
            // A non-last node pointing at null (e.g. a reversal's new
            // tail) gets a short local stub — its target isn't the shared
            // box, so a long cross-row arrow would misleadingly suggest a
            // link to that specific node's neighborhood.
            const stubX = startX + LIST.gap * 0.55;
            return (
              <g key={node.id}>
                <line x1={startX} y1={startY} x2={stubX} y2={startY} stroke={COLORS.neutralDim} strokeWidth={4} markerEnd="url(#list-arrow)" />
                <text x={stubX + 6} y={startY + 6} fontSize={TYPE_SCALE.label} fill={COLORS.neutralDim}>
                  ∅
                </text>
              </g>
            );
          }

          const toSlot = slotOf.get(nextId)!;
          if (toSlot === fromSlot + 1) {
            return (
              <line
                key={node.id}
                x1={startX}
                y1={startY}
                x2={xOf(toSlot)}
                y2={centerY}
                stroke={COLORS.neutralDim}
                strokeWidth={4}
                markerEnd="url(#list-arrow)"
              />
            );
          }
          // Any other node -> node link (a rewired, non-adjacent pointer)
          // arcs below the row so it never crosses the pointer labels
          // stacked above the nodes.
          const endX = xOf(toSlot);
          const midX = (startX + endX) / 2;
          const arcY = centerY + LIST.arcHeight;
          return (
            <path
              key={node.id}
              d={`M${startX},${startY} Q${midX},${arcY} ${endX},${centerY}`}
              stroke={COLORS.neutralDim}
              strokeWidth={4}
              fill="none"
              markerEnd="url(#list-arrow)"
            />
          );
        })}
      </svg>

      {state.listNodes.map((node) => {
        const style = state.listFocus.has(node.id) ? "focus" : "neutral";
        const slot = slotOf.get(node.id)!;
        const x = xOf(slot);
        return (
          <div key={node.id}>
            <div
              style={{
                position: "absolute",
                top: rowTop,
                left: x,
                width: LIST.size,
                height: LIST.size,
                borderRadius: LIST.radius,
                background: NODE_COLOR[style],
                color: TEXT_COLOR[style],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 44,
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
                  top: 0,
                  left: x,
                  width: LIST.size,
                  textAlign: "center",
                  color: COLORS.pointer,
                  fontSize: TYPE_SCALE.label,
                  fontWeight: 800,
                  transform: `translateY(${j * 34}px)`,
                }}
              >
                {name}
                <div style={{ fontSize: 26 }}>▾</div>
              </div>
            ))}
          </div>
        );
      })}

      {/* The permanent terminal box every unmodified list ends at. */}
      <div
        style={{
          position: "absolute",
          top: rowTop,
          left: xOf(BOX_SLOT),
          width: LIST.size,
          height: LIST.size,
          borderRadius: LIST.radius,
          background: COLORS.discarded,
          color: COLORS.neutralDim,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
          fontWeight: 700,
        }}
      >
        ∅
      </div>

      {pointersByTarget.__null__?.map((name, j) => (
        <div
          key={name}
          style={{
            position: "absolute",
            top: 0,
            left: xOf(-1),
            width: LIST.size,
            textAlign: "center",
            color: COLORS.pointer,
            fontSize: TYPE_SCALE.label,
            fontWeight: 800,
            transform: `translateY(${j * 34}px)`,
          }}
        >
          {name}
          <div style={{ fontSize: 26 }}>▾</div>
        </div>
      ))}
    </div>
  );
};

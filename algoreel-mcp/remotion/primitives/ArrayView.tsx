import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CELL, COLORS, POP_SPRING_CONFIG, POP_SPRING_DURATION_FRAMES, TYPE_SCALE } from "../template/tokens";
import type { VisualState } from "./state";

const CELL_COLOR: Record<"neutral" | "focus" | "found" | "dead", string> = {
  neutral: "#1a1f2b",
  focus: COLORS.focus,
  found: COLORS.found,
  dead: COLORS.discarded,
};

const TEXT_COLOR: Record<"neutral" | "focus" | "found" | "dead", string> = {
  neutral: COLORS.neutral,
  focus: "#1a1408",
  found: "#062015",
  dead: COLORS.neutralDim,
};

export const ArrayView: React.FC<{ state: VisualState }> = ({ state }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: POP_SPRING_CONFIG, durationInFrames: POP_SPRING_DURATION_FRAMES });

  const n = state.array.length;
  const totalWidth = n * CELL.size + (n - 1) * CELL.gap;
  const startX = -totalWidth / 2;

  const pointersByIndex: Record<number, string[]> = {};
  for (const [name, index] of Object.entries(state.pointers)) {
    (pointersByIndex[index] ??= []).push(name);
  }

  return (
    <div style={{ position: "relative", width: totalWidth, height: CELL.size + 140, opacity: pop }}>
      {state.array.map((value, i) => {
        const style = state.discarded.has(i) ? "dead" : state.highlights[i] ?? "neutral";
        const x = startX + i * (CELL.size + CELL.gap) + totalWidth / 2;
        return (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                top: 90,
                left: x - CELL.size / 2,
                width: CELL.size,
                height: CELL.size,
                borderRadius: CELL.radius,
                background: CELL_COLOR[style],
                color: TEXT_COLOR[style],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 44,
                fontWeight: 700,
                opacity: style === "dead" ? 0.4 : 1,
                transition: "none",
              }}
            >
              {value}
            </div>
            {pointersByIndex[i]?.map((name, j) => (
              <div
                key={name}
                style={{
                  position: "absolute",
                  top: 0,
                  left: x - CELL.size / 2,
                  width: CELL.size,
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
    </div>
  );
};

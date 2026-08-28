import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, POP_SPRING_CONFIG, POP_SPRING_DURATION_FRAMES, TYPE_SCALE } from "./tokens";

// 0–3s, full-bleed, always the same layout (PLAN.md §6).
export const Hook: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: POP_SPRING_CONFIG, durationInFrames: POP_SPRING_DURATION_FRAMES });

  return (
    <div
      style={{
        fontSize: TYPE_SCALE.hook,
        fontWeight: 800,
        color: COLORS.neutral,
        textAlign: "center",
        lineHeight: 1.15,
        padding: "0 70px",
        opacity: pop,
        transform: `scale(${0.9 + pop * 0.1})`,
      }}
    >
      {text}
    </div>
  );
};

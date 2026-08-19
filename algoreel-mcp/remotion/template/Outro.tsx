import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, TYPE_SCALE } from "./tokens";

// Complexity card, always the same layout (PLAN.md §6): every video ends
// hook -> algorithm animation -> complexity card.
export const Outro: React.FC<{
  time: string;
  space: string;
  caption: string;
  emphasis: string[];
}> = ({ time, space, caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 15 });

  return (
    <div style={{ textAlign: "center", opacity: pop, transform: `translateY(${(1 - pop) * 20}px)` }}>
      <div
        style={{
          display: "flex",
          gap: 40,
          justifyContent: "center",
          marginBottom: 60,
        }}
      >
        <ComplexityStat label="TIME" value={time} />
        <ComplexityStat label="SPACE" value={space} />
      </div>
      <div
        style={{
          fontSize: TYPE_SCALE.caption,
          fontWeight: 600,
          color: COLORS.neutral,
          lineHeight: 1.3,
          padding: "0 80px",
        }}
      >
        {caption}
      </div>
    </div>
  );
};

const ComplexityStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      border: `2px solid ${COLORS.pointer}`,
      borderRadius: 20,
      padding: "24px 36px",
      minWidth: 220,
    }}
  >
    <div style={{ fontSize: TYPE_SCALE.label, color: COLORS.neutralDim, fontWeight: 700, letterSpacing: 2 }}>
      {label}
    </div>
    <div style={{ fontSize: TYPE_SCALE.hook * 0.6, color: COLORS.found, fontWeight: 800, marginTop: 8 }}>
      {value}
    </div>
  </div>
);

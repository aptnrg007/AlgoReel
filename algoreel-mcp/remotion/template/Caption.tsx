import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, TYPE_SCALE } from "./tokens";

// Splits caption text on emphasis words (case-insensitive) and colors them.
// Emphasis words are chosen by the agent (spec.emphasis) — this component
// just applies the treatment consistently.
function splitEmphasis(text: string, emphasis: string[]): Array<{ text: string; emphasized: boolean }> {
  if (emphasis.length === 0) return [{ text, emphasized: false }];
  const pattern = new RegExp(`(${emphasis.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      emphasized: emphasis.some((w) => w.toLowerCase() === part.toLowerCase()),
    }));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const Caption: React.FC<{ text: string; emphasis: string[] }> = ({ text, emphasis }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });

  const parts = splitEmphasis(text, emphasis);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: 60,
        right: 60,
        textAlign: "center",
        fontSize: TYPE_SCALE.caption,
        lineHeight: 1.3,
        fontWeight: 600,
        color: COLORS.neutral,
        opacity: pop,
        transform: `translateY(${(1 - pop) * 20}px)`,
      }}
    >
      {parts.map((part, i) => (
        <span key={i} style={{ color: part.emphasized ? COLORS.emphasis : COLORS.neutral }}>
          {part.text}
        </span>
      ))}
    </div>
  );
};

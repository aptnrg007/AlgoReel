import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, POP_SPRING_CONFIG, SAFE_AREA, TYPE_SCALE } from "./tokens";

// Splits caption text on emphasis words (case-insensitive) and colors them.
// Emphasis words are chosen by the agent (spec.emphasis) — this component
// just applies the treatment consistently. Exported so Outro.tsx's caption
// (the only other place narration text renders) applies the exact same
// treatment instead of re-deriving it — src/spec/emphasis.ts's own comment
// already reasons about this function's exact behavior by name, so there's
// only ever one real implementation to stay consistent with.
export function splitEmphasis(text: string, emphasis: string[]): Array<{ text: string; emphasized: boolean }> {
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
  const pop = spring({ frame, fps, config: POP_SPRING_CONFIG, durationInFrames: 12 });

  const parts = splitEmphasis(text, emphasis);

  return (
    <div
      style={{
        position: "absolute",
        // Was a bare 60 — a `position: absolute` child ignores Frame's
        // paddingBottom (that padding only affects flow-positioned
        // children like Hook/Outro), so this sat 60px from the true
        // frame edge, deep inside the 280px band SAFE_AREA.bottom
        // reserves for YouTube's own UI overlay. Anchoring to
        // SAFE_AREA.bottom instead puts the caption's bottom edge
        // exactly at that boundary, clearing the covered zone entirely
        // (found in Phase 4 QA planning, confirmed on every rendered
        // video so far — see PLAN.md §7).
        bottom: SAFE_AREA.bottom,
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

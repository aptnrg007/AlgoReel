import React from "react";
import type { TimelineSpec } from "../../src/spec/timeline/types";
import { COLORS, TYPE_SCALE } from "../template/tokens";
import { TIMELINE, revealedCount, xForIndex } from "./timelineLayout";

const LABEL_FONT_SIZE = TYPE_SCALE.label * 0.8;

// TimelineSpec + animation progress -> SVG (mirrors TimeSeriesView.tsx's
// own contract — PLAN.md §27's recipe). No React hooks here —
// TimelineVideo.tsx is the only place progress comes from useCurrentFrame.
export const TimelineView: React.FC<{ spec: TimelineSpec; progress: number }> = ({ spec, progress }) => {
  const n = spec.events.length;
  const revealed = revealedCount(progress, n);
  const currentIndex = revealed - 1;
  const current = spec.events[currentIndex]!;

  const totalWidth = TIMELINE.width + TIMELINE.marginLeft + TIMELINE.marginRight;
  const lineY = 60;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: COLORS.neutral, textAlign: "center" }}>
        {spec.title}
      </div>
      <div style={{ fontSize: 56, fontWeight: 800, color: COLORS.focus, marginTop: 12 }}>{current.date}</div>
      <div style={{ fontSize: TYPE_SCALE.caption * 0.6, fontWeight: 600, color: COLORS.neutral, marginTop: 4, textAlign: "center", padding: "0 60px" }}>
        {current.title}
      </div>

      <svg width={totalWidth} height={lineY + 120} style={{ marginTop: 40, overflow: "visible" }}>
        <g transform={`translate(${TIMELINE.marginLeft}, ${lineY})`}>
          <line x1={0} y1={0} x2={xForIndex(revealed - 1, n)} y2={0} stroke={COLORS.pointer} strokeWidth={3} strokeLinecap="round" />
          <line
            x1={xForIndex(revealed - 1, n)}
            y1={0}
            x2={TIMELINE.width}
            y2={0}
            stroke={COLORS.neutralDim}
            strokeWidth={2}
            strokeDasharray="2 10"
            strokeLinecap="round"
          />

          {spec.events.map((e, i) => {
            if (i >= revealed) return null;
            const x = xForIndex(i, n);
            const isCurrent = i === currentIndex;
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={0}
                  r={isCurrent ? TIMELINE.leadDotRadius : TIMELINE.dotRadius}
                  fill={isCurrent ? COLORS.focus : COLORS.pointer}
                  stroke={COLORS.background}
                  strokeWidth={2}
                />
                <text
                  x={x}
                  y={-24}
                  fill={isCurrent ? COLORS.focus : COLORS.neutralDim}
                  fontSize={LABEL_FONT_SIZE}
                  fontWeight={isCurrent ? 800 : 600}
                  textAnchor="middle"
                >
                  {e.date}
                </text>
                <text
                  x={x}
                  y={30}
                  fill={isCurrent ? COLORS.neutral : COLORS.neutralDim}
                  fontSize={LABEL_FONT_SIZE * 0.85}
                  fontWeight={isCurrent ? 700 : 500}
                  textAnchor="middle"
                >
                  {e.title}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

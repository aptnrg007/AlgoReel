import React from "react";
import type { BarRaceSpec } from "../../src/spec/barRace/types";
import { CATEGORICAL_COLORS, COLORS, TYPE_SCALE } from "../template/tokens";
import { BAR, computeValueDomain, currentStepIndex, formatValue, rankEntries, rowY, stepPosition, barLength } from "./barRaceLayout";

const LABEL_FONT_SIZE = TYPE_SCALE.label * 0.8;

// BarRaceSpec + animation progress -> SVG (mirrors TimeSeriesView.tsx's
// own contract exactly — PLAN.md §27's recipe). No React hooks here —
// BarRaceVideo.tsx is the only place progress comes from useCurrentFrame,
// so this stays a pure function of its props, easy to render at any fixed
// progress for a still/screenshot check.
export const BarRaceView: React.FC<{ spec: BarRaceSpec; progress: number }> = ({ spec, progress }) => {
  const stepCount = spec.xAxis.values.length;
  const domain = computeValueDomain(spec);
  const pos = stepPosition(progress, stepCount);
  const ranked = rankEntries(spec, pos);
  const currentStep = spec.xAxis.values[currentStepIndex(progress, stepCount)];

  const totalWidth = BAR.labelColumnWidth + BAR.chartWidth + BAR.rightLabelSpace;
  const totalHeight = ranked.length > 0 ? rowY(ranked.length - 1) + BAR.rowHeight : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: COLORS.neutral, textAlign: "center" }}>
        {spec.title}
      </div>
      <div style={{ fontSize: 56, fontWeight: 800, color: COLORS.focus, marginTop: 12 }}>{currentStep}</div>
      <div style={{ fontSize: LABEL_FONT_SIZE, color: COLORS.neutralDim, marginTop: 4 }}>{spec.valueLabel}</div>

      <svg width={totalWidth} height={totalHeight + 20} style={{ marginTop: 24, overflow: "visible" }}>
        {ranked.map((entry) => {
          const color = CATEGORICAL_COLORS[entry.entryIndex % CATEGORICAL_COLORS.length]!;
          const y = rowY(entry.rank);
          const width = barLength(entry.value, domain);
          return (
            <g key={entry.name}>
              <text
                x={BAR.labelColumnWidth - 20}
                y={y + BAR.barHeight / 2}
                fill={COLORS.neutral}
                fontSize={LABEL_FONT_SIZE}
                fontWeight={700}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {entry.rank + 1}. {entry.name}
              </text>
              <rect
                x={BAR.labelColumnWidth}
                y={y}
                width={width}
                height={BAR.barHeight}
                rx={8}
                fill={color}
              />
              <text
                x={BAR.labelColumnWidth + width + 14}
                y={y + BAR.barHeight / 2}
                fill={COLORS.neutral}
                fontSize={LABEL_FONT_SIZE}
                fontWeight={700}
                dominantBaseline="middle"
              >
                {formatValue(entry.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

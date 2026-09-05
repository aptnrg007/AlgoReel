import React from "react";
import type { TimeSeriesSpec } from "../../src/spec/timeSeries/types";
import { COLORS, TYPE_SCALE } from "../template/tokens";
import { estimateTextWidth } from "./textBox";
import { CHART, computeYDomain, formatValue, labelStride, revealedCount, tickIndicesToLabel, xForIndex, yForValue } from "./timeSeriesLayout";

const LABEL_FONT_SIZE = TYPE_SCALE.label * 0.7;

// Fixed categorical order (dataviz skill's validated dark palette, checked
// live against this template's own COLORS.background) — series[i] always
// gets SERIES_COLORS[i], never reassigned by rank or value.
const SERIES_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
] as const;

// TimeSeriesSpec + animation progress -> SVG (PLAN.md §8). No React
// hooks here — TimeSeriesVideo.tsx is the only place progress comes from
// useCurrentFrame, so this stays a pure function of its props and is easy
// to render at any fixed progress for a still/screenshot check.
export const TimeSeriesView: React.FC<{ spec: TimeSeriesSpec; progress: number }> = ({ spec, progress }) => {
  const n = spec.xAxis.values.length;
  const domain = computeYDomain(spec);
  const revealed = revealedCount(progress, n);
  const currentIndex = revealed - 1;
  const showLegend = spec.series.length >= 2;
  const marginLeft = CHART.marginLeft;
  const marginTop = CHART.marginTop;

  // Every point still gets a tick mark below; only this thinned,
  // evenly-spaced subset also gets a text label, so a wide dataset never
  // has to lose points just because they can't all be labeled at once
  // (checkTimeSeriesRender's "x-axis-labels-thinned" is the QA-side half
  // of this same mechanism — PLAN.md Phase 9 step 1).
  const widestXLabel = Math.max(...spec.xAxis.values.map((v) => estimateTextWidth(String(v), LABEL_FONT_SIZE)));
  const labeledIndices = new Set(tickIndicesToLabel(n, labelStride(n, widestXLabel)));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: COLORS.neutral, textAlign: "center" }}>
        {spec.title}
      </div>
      <div style={{ fontSize: 56, fontWeight: 800, color: COLORS.focus, marginTop: 12 }}>
        {spec.xAxis.values[currentIndex]}
      </div>

      <svg
        width={CHART.width + marginLeft + CHART.rightLabelSpace}
        height={CHART.height + 120}
        style={{ marginTop: 24, overflow: "visible" }}
      >
        <g transform={`translate(${marginLeft}, ${marginTop})`}>
          {/* y-axis */}
          <line x1={0} y1={0} x2={0} y2={CHART.height} stroke={COLORS.neutralDim} strokeWidth={1} />
          {[domain.max, (domain.max + domain.min) / 2, domain.min].map((v, i) => {
            const y = yForValue(v, domain);
            return (
              <g key={i}>
                <line x1={-CHART.tickLength} y1={y} x2={0} y2={y} stroke={COLORS.neutralDim} strokeWidth={1} />
                <text
                  x={-CHART.tickLength - 10}
                  y={y}
                  fill={COLORS.neutralDim}
                  fontSize={TYPE_SCALE.label * 0.7}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {formatValue(v)}
                </text>
              </g>
            );
          })}
          <text
            x={-90}
            y={CHART.height / 2}
            fill={COLORS.neutralDim}
            fontSize={TYPE_SCALE.label * 0.7}
            textAnchor="middle"
            transform={`rotate(-90, -90, ${CHART.height / 2})`}
          >
            {spec.yAxis.label}
            {spec.yAxis.unit ? ` (${spec.yAxis.unit})` : ""}
          </text>

          {/* x-axis */}
          <line x1={0} y1={CHART.height} x2={CHART.width} y2={CHART.height} stroke={COLORS.neutralDim} strokeWidth={1} />
          {spec.xAxis.values.map((v, i) => {
            const x = xForIndex(i, n);
            const isCurrent = i === currentIndex;
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={CHART.height}
                  x2={x}
                  y2={CHART.height + CHART.tickLength}
                  stroke={isCurrent ? COLORS.focus : COLORS.neutralDim}
                  strokeWidth={isCurrent ? 3 : 1}
                />
                {labeledIndices.has(i) && (
                  <text
                    x={x}
                    y={CHART.height + CHART.tickLength + 26}
                    fill={isCurrent ? COLORS.focus : COLORS.neutralDim}
                    fontSize={LABEL_FONT_SIZE}
                    fontWeight={isCurrent ? 800 : 400}
                    textAnchor="middle"
                  >
                    {v}
                  </text>
                )}
              </g>
            );
          })}
          <text x={CHART.width / 2} y={CHART.height + 66} fill={COLORS.neutralDim} fontSize={TYPE_SCALE.label * 0.7} textAnchor="middle">
            {spec.xAxis.label}
          </text>

          {/* series */}
          {spec.series.map((s, si) => {
            const color = SERIES_COLORS[si % SERIES_COLORS.length]!;
            const points = s.values.slice(0, revealed).map((v, i) => ({ x: xForIndex(i, n), y: yForValue(v, domain) }));
            const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            const lead = points[points.length - 1];
            return (
              <g key={s.name}>
                <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === points.length - 1 ? CHART.leadPointRadius : CHART.pointRadius}
                    fill={color}
                    stroke={COLORS.background}
                    strokeWidth={2}
                  />
                ))}
                {/* Value-at-the-end label (marks-and-anatomy: "Lines -> value
                    at the end") — only when there's exactly one series, so
                    multi-series labels never collide where lines converge;
                    the legend below carries identity for those instead. */}
                {lead && spec.series.length === 1 && (
                  <text
                    x={lead.x + CHART.leadPointRadius + 10}
                    y={lead.y}
                    fill={COLORS.neutral}
                    fontSize={TYPE_SCALE.label * 0.8}
                    fontWeight={700}
                    dominantBaseline="middle"
                  >
                    {formatValue(s.values[currentIndex]!)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {showLegend && (
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center", marginTop: 8, maxWidth: CHART.width }}>
          {spec.series.map((s, i) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              <span style={{ color: COLORS.neutral, fontSize: TYPE_SCALE.label * 0.7, fontWeight: 600 }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

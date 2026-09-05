import { detectStandoutIndex } from "../detectStandout";
import type { TimeSeries, TimeSeriesAnnotation } from "./types";

// A deterministic, template-based default label — never agent-authored
// prose. "auto" here means "computed from the real numbers," not "written
// by a model"; PLAN.md Phase 9 step 3's rule (an agent may explain a
// finding, never invent one) isn't even in play here, since nothing in
// this file decides anything beyond formatting real arithmetic as a
// fixed-shape sentence. A future narration step could replace this
// template with real prose without changing where the *index* comes from.
export function autoAnnotateStandout(series: TimeSeries): TimeSeriesAnnotation | null {
  const index = detectStandoutIndex(series.values);
  if (index === null) return null;

  const prev = series.values[index - 1]!;
  const curr = series.values[index]!;
  const pctChange = ((curr - prev) / prev) * 100;
  const direction = pctChange >= 0 ? "increase" : "decrease";

  return {
    index,
    label: `Sharpest ${direction}: ${Math.abs(pctChange).toFixed(0)}%`,
  };
}

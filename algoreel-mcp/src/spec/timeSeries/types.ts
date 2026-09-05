// TimeSeriesSpec is a separate contract from StorySpec (PLAN.md's
// multi-video-type architecture) — no hook/narration/complexity, since a
// timelapse video isn't a hook -> steps -> outro story, just data animating
// over an axis. Kept in its own directory rather than folded into
// spec/types.ts, matching the "keep domain-specific state separate" rule.

export interface TimeSeriesXAxis {
  label: string;
  values: (string | number)[];
}

export interface TimeSeriesYAxis {
  label: string;
  unit?: string;
}

// A caller-supplied (never agent-invented at render time) callout on one
// specific point — PLAN.md Phase 9 step 3: an agent may explain a finding,
// never invent one. `index` is typically chosen deterministically (see
// src/spec/detectStandout.ts's detectStandoutIndex), and `label` is
// always plain data-derived text, whether templated or human-written —
// never something the renderer decides on its own.
export interface TimeSeriesAnnotation {
  index: number;
  label: string;
}

export interface TimeSeries {
  name: string;
  values: number[];
  annotations?: TimeSeriesAnnotation[];
}

export interface TimeSeriesSpec {
  title: string;
  xAxis: TimeSeriesXAxis;
  yAxis: TimeSeriesYAxis;
  series: TimeSeries[];
  animation?: { mode: "progressive" };
}

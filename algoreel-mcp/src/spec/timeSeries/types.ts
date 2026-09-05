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

export interface TimeSeries {
  name: string;
  values: number[];
}

export interface TimeSeriesSpec {
  title: string;
  xAxis: TimeSeriesXAxis;
  yAxis: TimeSeriesYAxis;
  series: TimeSeries[];
  animation?: { mode: "progressive" };
}

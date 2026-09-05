// BarRaceSpec is its own contract, not a TimeSeriesSpec variant — same
// "keep domain-specific state separate" rule timeSeries/types.ts already
// follows. It happens to share time_series's "x-axis + named series"
// shape (deliberately, so the same CSV normalization applies), but what
// it means is different: entities are *ranked* and reordered by value
// each step, not just plotted as a growing line.

export interface BarRaceXAxis {
  label: string;
  values: (string | number)[];
}

export interface BarRaceEntry {
  name: string;
  values: number[];
}

export interface BarRaceSpec {
  title: string;
  xAxis: BarRaceXAxis;
  // Shown next to each bar's current value (e.g. "GDP (USD billions)") —
  // no separate y-axis the way time_series has, since a bar race has no
  // numeric axis at all, only ranked bar lengths.
  valueLabel: string;
  entries: BarRaceEntry[];
}

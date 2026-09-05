// TimelineSpec is its own contract, not borrowed from TimeSeriesSpec or
// BarRaceSpec (PLAN.md §22's "avoid a universal VisualState") — no
// numeric axis at all, just events with a date label and a title,
// revealed left to right over the video. `date` is a plain display
// string, not a parsed value — "1945", "March 1945", and "Ancient Rome"
// are all valid; events are spaced evenly by index, not by real
// chronological distance (PLAN.md's own worked example shows this —
// equal-width dashes between events regardless of the real year gap).

export interface TimelineEvent {
  date: string;
  title: string;
}

export interface TimelineSpec {
  title: string;
  events: TimelineEvent[];
}

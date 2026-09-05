import type { StorySpec } from "../spec/types";
import type { TimeSeriesSpec } from "../spec/timeSeries/types";
import type { BarRaceSpec } from "../spec/barRace/types";
import type { TimelineSpec } from "../spec/timeline/types";

// The set of video types AlgoReel knows how to plan and render. A new type
// gets added here only once its validator/timeline/renderer actually exist,
// not speculatively ahead of them.
export type VideoType = "dsa" | "time_series" | "bar_race" | "timeline";

interface VideoPlanBase {
  version: number;
  videoType: VideoType;
  title: string;
  description?: string;
  targetDurationSec: number;
}

// "dsa" wraps the existing StorySpec unchanged (PLAN.md: preserve the
// existing DSA pipeline rather than folding it into a new schema) — the
// video-type boundary sits above StorySpec, not inside it.
export interface DsaVideoPlan extends VideoPlanBase {
  videoType: "dsa";
  payload: StorySpec;
}

// TimeSeriesSpec has no duration/title fields of its own — those are
// authoring-time decisions that live on the plan, same as DSA's targetDurationSec
// sitting beside StorySpec's own topic-derived one.
export interface TimeSeriesVideoPlan extends VideoPlanBase {
  videoType: "time_series";
  payload: TimeSeriesSpec;
}

// BarRaceSpec, like TimeSeriesSpec, has no duration/title of its own —
// same reasoning as TimeSeriesVideoPlan above.
export interface BarRaceVideoPlan extends VideoPlanBase {
  videoType: "bar_race";
  payload: BarRaceSpec;
}

// TimelineSpec, like TimeSeriesSpec/BarRaceSpec, has no duration/title of
// its own — same reasoning as those two above.
export interface TimelineVideoPlan extends VideoPlanBase {
  videoType: "timeline";
  payload: TimelineSpec;
}

export type VideoPlan = DsaVideoPlan | TimeSeriesVideoPlan | BarRaceVideoPlan | TimelineVideoPlan;

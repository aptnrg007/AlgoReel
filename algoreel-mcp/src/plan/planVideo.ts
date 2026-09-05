import { toDsaVideoPlan } from "./fromStorySpec";
import { toTimeSeriesVideoPlan } from "./fromTimeSeriesSpec";
import { toBarRaceVideoPlan } from "./fromBarRaceSpec";
import { selectVideoType, type SelectVideoTypeDeps } from "./selectVideoType";
import type { VideoPlan } from "./types";
import { checkTimeSeriesRender, minimumSufficientDurationSec } from "../spec/timeSeries/checkRender";
import type { CsvParseOptions } from "../spec/timeSeries/fromCsv";
import { parseCsvToTimeSeriesSpec } from "../spec/timeSeries/fromCsv";
import type { TimeSeriesSpec } from "../spec/timeSeries/types";
import { validateTimeSeriesSpec } from "../spec/timeSeries/validate";
import { checkBarRaceRender, MIN_DURATION_SEC as BAR_RACE_MIN_DURATION_SEC } from "../spec/barRace/checkRender";
import type { CsvParseOptions as BarRaceCsvParseOptions } from "../spec/barRace/fromCsv";
import { parseCsvToBarRaceSpec } from "../spec/barRace/fromCsv";
import type { BarRaceSpec } from "../spec/barRace/types";
import { validateBarRaceSpec } from "../spec/barRace/validate";
import { ensureSpec, type EnsureSpecDeps } from "../spec/ensureSpec";

export class PlanVideoError extends Error {}

const DEFAULT_TARGET_DURATION_SEC = 20;

// checkTimeSeriesRender failure codes that are exclusively about
// targetDurationSec — fixable by widening the duration alone, never by
// touching the caller's actual data. PLAN.md Phase 9 step 1's "narrow
// agent repair" — no agent at all, in the end: computing the smallest
// sufficient duration is pure arithmetic (minimumSufficientDurationSec),
// so there's nothing here an LLM call would add.
const DURATION_REPAIRABLE_CODES = new Set(["duration-too-short", "reveal-faster-than-frames"]);

export interface PlanVideoRequest {
  // Free-text request, e.g. "explain quicksort" or "create a timelapse
  // of India's GDP from 1990 to 2025". Required for a dsa video; optional
  // for time_series if data/csv is supplied directly.
  prompt?: string;
  // Already-structured data (a TimeSeriesSpec-shaped object) — PLAN.md §15:
  // the planner does not fetch external data itself, so this (or csv) must
  // be supplied by the caller for any time_series video.
  data?: unknown;
  // Raw CSV text, normalized via the classified type's own fromCsv.ts.
  // Which options are required depends on what selectVideoType decides
  // this csv is for — supply the one matching field.
  csv?: string;
  csvOptions?: CsvParseOptions;
  barRaceCsvOptions?: BarRaceCsvParseOptions;
  // time_series/bar_race only — neither spec carries a duration of its
  // own (plan/types.ts's *VideoPlan comments).
  targetDurationSec?: number;
  description?: string;
}

export interface PlanVideoDeps extends SelectVideoTypeDeps {
  ensureSpec?: typeof ensureSpec;
  ensureSpecDeps?: EnsureSpecDeps;
}

// The planner's full pipeline (PLAN.md §13-14): classify -> produce a
// video-type-specific spec -> wrap it as a VideoPlan. Never generates
// Remotion code and never invents data — a time_series request with no
// data/csv supplied is a clean, honest error, not a hallucinated dataset.
export async function planVideo(req: PlanVideoRequest, deps: PlanVideoDeps = {}): Promise<VideoPlan> {
  const classification = await selectVideoType(
    { prompt: req.prompt, data: req.data, csv: req.csv },
    { chooseVideoType: deps.chooseVideoType },
  );

  if (classification.videoType === "dsa") {
    // Provably true whenever selectVideoType returns "dsa": its own logic
    // only reaches a dsa decision via a prompt-dependent path (a keyword
    // match against req.prompt, or a ladder prompt built from it) — this
    // check guards that cross-module invariant against a future change to
    // selectVideoType.ts silently breaking it, not a real runtime scenario.
    if (!req.prompt) {
      throw new PlanVideoError("internal error: classified as dsa with no prompt");
    }
    const ensure = deps.ensureSpec ?? ensureSpec;
    const result = await ensure({ topic: req.prompt }, deps.ensureSpecDeps ?? {});
    return toDsaVideoPlan(result.spec);
  }

  if (!req.data && req.csv === undefined) {
    throw new PlanVideoError(
      `a ${classification.videoType} video needs data — this planner does not fetch external data itself (PLAN.md §15). ` +
        "Supply it via `data` (a spec-shaped object) or `csv` (a CSV string, with the matching csvOptions field).",
    );
  }

  if (classification.videoType === "bar_race") {
    return planBarRaceVideo(req);
  }
  return planTimeSeriesVideo(req);
}

async function planTimeSeriesVideo(req: PlanVideoRequest): Promise<VideoPlan> {
  let candidate: unknown;
  if (req.csv !== undefined) {
    if (!req.csvOptions) {
      throw new PlanVideoError("csv input requires csvOptions: { title, xAxisLabel, yAxisLabel, yAxisUnit? }");
    }
    try {
      candidate = parseCsvToTimeSeriesSpec(req.csv, req.csvOptions);
    } catch (err) {
      throw new PlanVideoError(`could not parse csv: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    candidate = req.data;
  }

  const validation = validateTimeSeriesSpec(candidate);
  if (!validation.valid) {
    throw new PlanVideoError(`supplied data is invalid: ${validation.errors.join("; ")}`);
  }
  const spec = candidate as TimeSeriesSpec;
  let targetDurationSec = req.targetDurationSec ?? DEFAULT_TARGET_DURATION_SEC;
  let check = checkTimeSeriesRender(spec, targetDurationSec);

  // Widen the duration once if it's the only thing wrong — covers both a
  // hard duration-too-short error and a reveal-faster-than-frames warning
  // (which never blocked pass on its own, but is still worth fixing for
  // free when the fix is unambiguous and touches no data). Never retried
  // a second time: if this doesn't clear it, the remaining problem isn't
  // duration-shaped and no further widening would help.
  if (check.failures.some((f) => DURATION_REPAIRABLE_CODES.has(f.code))) {
    const sufficient = minimumSufficientDurationSec(spec);
    if (sufficient > targetDurationSec) {
      targetDurationSec = sufficient;
      check = checkTimeSeriesRender(spec, targetDurationSec);
    }
  }

  if (!check.pass) {
    const errors = check.failures.filter((f) => f.severity === "error").map((f) => f.message);
    throw new PlanVideoError(`supplied data fails check_render: ${errors.join("; ")}`);
  }

  return toTimeSeriesVideoPlan(spec, { targetDurationSec, description: req.description });
}

async function planBarRaceVideo(req: PlanVideoRequest): Promise<VideoPlan> {
  let candidate: unknown;
  if (req.csv !== undefined) {
    if (!req.barRaceCsvOptions) {
      throw new PlanVideoError("csv input requires barRaceCsvOptions: { title, xAxisLabel, valueLabel }");
    }
    try {
      candidate = parseCsvToBarRaceSpec(req.csv, req.barRaceCsvOptions);
    } catch (err) {
      throw new PlanVideoError(`could not parse csv: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    candidate = req.data;
  }

  const validation = validateBarRaceSpec(candidate);
  if (!validation.valid) {
    throw new PlanVideoError(`supplied data is invalid: ${validation.errors.join("; ")}`);
  }
  const spec = candidate as BarRaceSpec;
  let targetDurationSec = req.targetDurationSec ?? DEFAULT_TARGET_DURATION_SEC;
  let check = checkBarRaceRender(spec, targetDurationSec);

  // Same "widen the duration once, never touch data" repair as
  // time_series's — bar_race only has one duration-shaped code so far
  // (no reveal-pacing check yet, since it interpolates continuously
  // rather than revealing discrete points).
  if (check.failures.some((f) => f.code === "duration-too-short")) {
    if (BAR_RACE_MIN_DURATION_SEC > targetDurationSec) {
      targetDurationSec = BAR_RACE_MIN_DURATION_SEC;
      check = checkBarRaceRender(spec, targetDurationSec);
    }
  }

  if (!check.pass) {
    const errors = check.failures.filter((f) => f.severity === "error").map((f) => f.message);
    throw new PlanVideoError(`supplied data fails check_render: ${errors.join("; ")}`);
  }

  return toBarRaceVideoPlan(spec, { targetDurationSec, description: req.description });
}

import { toDsaVideoPlan } from "./fromStorySpec";
import { toTimeSeriesVideoPlan } from "./fromTimeSeriesSpec";
import { toBarRaceVideoPlan } from "./fromBarRaceSpec";
import { selectVideoType, type SelectVideoTypeDeps } from "./selectVideoType";
import type { VideoPlan } from "./types";
import { checkTimeSeriesRender, minimumSufficientDurationSec } from "../spec/timeSeries/checkRender";
import type { CsvParseOptions } from "../spec/timeSeries/fromCsv";
import { parseCsvToTimeSeriesSpec } from "../spec/timeSeries/fromCsv";
import { fetchWorldBankTimeSeries } from "../spec/timeSeries/fromWorldBank";
import type { TimeSeriesSpec } from "../spec/timeSeries/types";
import { validateTimeSeriesSpec } from "../spec/timeSeries/validate";
import { extractWorldBankRequest, scaleForIndicatorCode } from "./extractWorldBankRequest";
import { checkBarRaceRender, MIN_DURATION_SEC as BAR_RACE_MIN_DURATION_SEC } from "../spec/barRace/checkRender";
import type { CsvParseOptions as BarRaceCsvParseOptions } from "../spec/barRace/fromCsv";
import { parseCsvToBarRaceSpec } from "../spec/barRace/fromCsv";
import type { BarRaceSpec } from "../spec/barRace/types";
import { validateBarRaceSpec } from "../spec/barRace/validate";
import { toTimelineVideoPlan } from "./fromTimelineSpec";
import { checkTimelineRender, MIN_DURATION_SEC as TIMELINE_MIN_DURATION_SEC } from "../spec/timeline/checkRender";
import type { CsvParseOptions as TimelineCsvParseOptions } from "../spec/timeline/fromCsv";
import { parseCsvToTimelineSpec } from "../spec/timeline/fromCsv";
import type { TimelineSpec } from "../spec/timeline/types";
import { validateTimelineSpec } from "../spec/timeline/validate";
import { ensureSpec, type EnsureSpecDeps } from "../spec/ensureSpec";
import { inspectDataset } from "../data/inspectDataset";
import { planDataset, type PlanDatasetDeps } from "../data/planDataset";
import { extractDataset } from "../data/extractDataset";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadKaggleFile, kaggleCredentialsFromEnv, listKaggleDatasetFiles } from "../data/kaggleClient";
import type { KaggleCredentials } from "../data/kaggleTypes";
import { selectDatasetFile, type SelectDatasetFileDeps } from "../data/selectDatasetFile";

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
  timelineCsvOptions?: TimelineCsvParseOptions;
  // Real data acquisition, time_series only, deliberately scoped to one
  // source (PLAN.md Phase 9 step 4) — an explicit override for precision;
  // if omitted, planVideo tries extractWorldBankRequest(prompt) before
  // giving up and demanding data/csv. Never fetched for dsa/bar_race.
  worldBank?: { countryCode: string; indicatorCode: string; startYear?: number; endYear?: number; yAxisUnit?: string; scale?: number };
  // PLAN.md Phase 10 — an arbitrary local CSV/JSON file, schema unknown
  // in advance. When set, this bypasses selectVideoType entirely (its
  // job — deciding time_series vs. bar_race — is folded into the
  // plan-dataset agent's own DataPlan, one agent call instead of two)
  // and goes through inspectDataset -> planDataset -> extractDataset
  // instead of any of the paths above. Requires `prompt` — there's no
  // deterministic shortcut for "which columns," it's a genuine
  // per-dataset judgment call the agent has to make.
  datasetSource?: string;
  // PLAN.md Phase 10 step 5 — a Kaggle dataset instead of a local file.
  // Resolved to a local file (via Kaggle's API) and then handled
  // identically to datasetSource above; everything downstream (inspect
  // -> plan -> extract -> video plan) is unchanged. `fileName` is an
  // explicit override for a multi-file dataset — if omitted, planVideo
  // lists the dataset's real files and lets selectDatasetFile.ts decide
  // (deterministically if there's only one real candidate, via a small
  // agent call otherwise). Requires Kaggle credentials, via
  // `kaggleCredentials` or the KAGGLE_USERNAME/KAGGLE_KEY env vars.
  //
  // Unlike every other live-network path in this project (World Bank,
  // every agent-ladder call), this one has not itself been run against
  // a real Kaggle account — this environment has no Kaggle credentials
  // configured, so there was nothing to verify live against. Built to
  // Kaggle's long-documented, stable public API surface and unit-tested
  // against a mocked fetch (kaggleClient.test.ts), but treat it as
  // best-effort pending a real credential to confirm against, not
  // live-confirmed the way this repo's other integrations are.
  kaggleDataset?: { ownerSlug: string; datasetSlug: string; fileName?: string };
  // time_series/bar_race only — neither spec carries a duration of its
  // own (plan/types.ts's *VideoPlan comments).
  targetDurationSec?: number;
  description?: string;
}

export interface PlanVideoDeps extends SelectVideoTypeDeps {
  ensureSpec?: typeof ensureSpec;
  ensureSpecDeps?: EnsureSpecDeps;
  fetchWorldBankTimeSeries?: typeof fetchWorldBankTimeSeries;
  planDataset?: PlanDatasetDeps["planDataset"];
  kaggleCredentials?: KaggleCredentials;
  listKaggleDatasetFiles?: typeof listKaggleDatasetFiles;
  downloadKaggleFile?: typeof downloadKaggleFile;
  chooseDatasetFile?: SelectDatasetFileDeps["chooseFile"];
}

const DEFAULT_WORLD_BANK_START_YEAR = 1960;

// The planner's full pipeline (PLAN.md §13-14): classify -> produce a
// video-type-specific spec -> wrap it as a VideoPlan. Never generates
// Remotion code and never invents data — a time_series request with no
// data/csv supplied is a clean, honest error, not a hallucinated dataset.
export async function planVideo(req: PlanVideoRequest, deps: PlanVideoDeps = {}): Promise<VideoPlan> {
  if (req.datasetSource !== undefined || req.kaggleDataset !== undefined) {
    return planDatasetDrivenVideo(req, deps);
  }

  const classification = await selectVideoType(
    { prompt: req.prompt, data: req.data, csv: req.csv, worldBank: req.worldBank },
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

  if (classification.videoType === "bar_race") {
    if (!req.data && req.csv === undefined) {
      throw new PlanVideoError(
        "a bar_race video needs data — this planner does not fetch external data itself (PLAN.md §15). " +
          "Supply it via `data` (a spec-shaped object) or `csv` (a CSV string, with barRaceCsvOptions).",
      );
    }
    return planBarRaceVideo(req);
  }

  if (classification.videoType === "timeline") {
    if (!req.data && req.csv === undefined) {
      throw new PlanVideoError(
        "a timeline video needs data — this planner does not fetch external data itself (PLAN.md §15). " +
          "Supply it via `data` (a spec-shaped object) or `csv` (a CSV string, with timelineCsvOptions).",
      );
    }
    return planTimelineVideo(req);
  }

  return planTimeSeriesVideo(req, deps);
}

async function planTimeSeriesVideo(req: PlanVideoRequest, deps: PlanVideoDeps): Promise<VideoPlan> {
  let candidate: unknown;
  let provenanceDescription: string | undefined;

  if (req.csv !== undefined) {
    if (!req.csvOptions) {
      throw new PlanVideoError("csv input requires csvOptions: { title, xAxisLabel, yAxisLabel, yAxisUnit? }");
    }
    try {
      candidate = parseCsvToTimeSeriesSpec(req.csv, req.csvOptions);
    } catch (err) {
      throw new PlanVideoError(`could not parse csv: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (req.data !== undefined) {
    candidate = req.data;
  } else {
    // No data/csv supplied — try real data acquisition (PLAN.md Phase 9
    // step 4) before giving up. The explicit `worldBank` field is tried
    // first (precise, e.g. a country/indicator the fixed keyword table
    // doesn't cover); extracting from the prompt is the fallback for a
    // natural request like "GDP timelapse for Brazil".
    const worldBank = req.worldBank ?? extractWorldBankRequest(req.prompt ?? "");
    if (!worldBank) {
      throw new PlanVideoError(
        "a time_series video needs data — this planner does not fetch external data itself (PLAN.md §15) beyond " +
          "the World Bank source it knows how to query. Supply `data`/`csv` directly, name a known country + " +
          "indicator (e.g. \"GDP timelapse for Brazil\"), or pass `worldBank` explicitly.",
      );
    }
    // A known indicator code still gets its sensible legible-scale
    // default even when it arrived via the explicit `worldBank` field
    // (e.g. the CLI's --world-bank-indicator flag) rather than a keyword
    // match — the code is the same either way, so the same table applies.
    const knownScale = scaleForIndicatorCode(worldBank.indicatorCode);
    const fetchFn = deps.fetchWorldBankTimeSeries ?? fetchWorldBankTimeSeries;
    let result;
    try {
      result = await fetchFn({
        countryCode: worldBank.countryCode,
        indicatorCode: worldBank.indicatorCode,
        startYear: worldBank.startYear ?? DEFAULT_WORLD_BANK_START_YEAR,
        endYear: worldBank.endYear ?? new Date().getFullYear(),
        yAxisUnit: worldBank.yAxisUnit ?? knownScale.yAxisUnit,
        scale: worldBank.scale ?? knownScale.scale,
      });
    } catch (err) {
      throw new PlanVideoError(`could not fetch World Bank data: ${err instanceof Error ? err.message : String(err)}`);
    }
    candidate = result.spec;
    provenanceDescription = `Source: World Bank API (${result.sourceUrl}), retrieved ${result.retrievedAt}`;
  }

  return finalizeTimeSeriesVideo(candidate, req, provenanceDescription);
}

// The validate -> check_render -> auto-repair-duration -> toXVideoPlan
// tail, shared by every path that produces a TimeSeriesSpec candidate
// (csv/data/worldBank above, and Phase 10's extractDataset below) —
// PLAN.md Phase 10 step 4's explicit point: a new *input path*, not a
// reason to duplicate logic that already exists.
function finalizeTimeSeriesVideo(candidate: unknown, req: PlanVideoRequest, provenanceDescription?: string): VideoPlan {
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

  return toTimeSeriesVideoPlan(spec, { targetDurationSec, description: req.description ?? provenanceDescription });
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

  return finalizeBarRaceVideo(candidate, req);
}

// Mirrors finalizeTimeSeriesVideo's shared tail — see its comment.
function finalizeBarRaceVideo(candidate: unknown, req: PlanVideoRequest, provenanceDescription?: string): VideoPlan {
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

  return toBarRaceVideoPlan(spec, { targetDurationSec, description: req.description ?? provenanceDescription });
}

async function planTimelineVideo(req: PlanVideoRequest): Promise<VideoPlan> {
  let candidate: unknown;
  if (req.csv !== undefined) {
    if (!req.timelineCsvOptions) {
      throw new PlanVideoError("csv input requires timelineCsvOptions: { title }");
    }
    try {
      candidate = parseCsvToTimelineSpec(req.csv, req.timelineCsvOptions);
    } catch (err) {
      throw new PlanVideoError(`could not parse csv: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    candidate = req.data;
  }

  const validation = validateTimelineSpec(candidate);
  if (!validation.valid) {
    throw new PlanVideoError(`supplied data is invalid: ${validation.errors.join("; ")}`);
  }
  const spec = candidate as TimelineSpec;
  let targetDurationSec = req.targetDurationSec ?? DEFAULT_TARGET_DURATION_SEC;
  let check = checkTimelineRender(spec, targetDurationSec);

  // Same "widen the duration once, never touch data" repair as
  // time_series's/bar_race's.
  if (check.failures.some((f) => f.code === "duration-too-short")) {
    if (TIMELINE_MIN_DURATION_SEC > targetDurationSec) {
      targetDurationSec = TIMELINE_MIN_DURATION_SEC;
      check = checkTimelineRender(spec, targetDurationSec);
    }
  }

  if (!check.pass) {
    const errors = check.failures.filter((f) => f.severity === "error").map((f) => f.message);
    throw new PlanVideoError(`supplied data fails check_render: ${errors.join("; ")}`);
  }

  return toTimelineVideoPlan(spec, { targetDurationSec, description: req.description });
}

// PLAN.md Phase 10 steps 4-5 — the dataset-driven path: resolve a real
// local file (either req.datasetSource directly, or a Kaggle dataset
// downloaded via resolveDatasetFile below) -> inspect -> agent produces
// a DataPlan -> extract -> the *existing* finalize* tails above. No
// selectVideoType call at all — plan-dataset.yaml's own DataPlan
// already carries the videoType decision, so this is one agent call,
// not two, for exactly the same "an agent picks labels" reason
// selectVideoType exists in the first place.
async function planDatasetDrivenVideo(req: PlanVideoRequest, deps: PlanVideoDeps): Promise<VideoPlan> {
  if (!req.prompt) {
    throw new PlanVideoError(
      "a datasetSource/kaggleDataset request also needs a prompt — there's no deterministic shortcut for which columns matter, the agent needs a real request to answer that.",
    );
  }

  const { filePath, cleanup, provenanceSource } = await resolveDatasetFile(req, deps);
  try {
    let schema;
    try {
      schema = inspectDataset(filePath);
    } catch (err) {
      throw new PlanVideoError(`could not read the dataset: ${err instanceof Error ? err.message : String(err)}`);
    }

    let planResult;
    try {
      planResult = await planDataset({ prompt: req.prompt, schema }, { planDataset: deps.planDataset });
    } catch (err) {
      throw new PlanVideoError(err instanceof Error ? err.message : String(err));
    }

    let spec;
    try {
      spec =
        planResult.plan.videoType === "time_series"
          ? extractDataset(filePath, planResult.plan)
          : extractDataset(filePath, planResult.plan);
    } catch (err) {
      throw new PlanVideoError(`could not extract dataset: ${err instanceof Error ? err.message : String(err)}`);
    }

    const provenanceDescription = `Source: ${provenanceSource} (data plan: ${JSON.stringify(planResult.plan)})`;

    return planResult.plan.videoType === "time_series"
      ? finalizeTimeSeriesVideo(spec, req, provenanceDescription)
      : finalizeBarRaceVideo(spec, req, provenanceDescription);
  } finally {
    cleanup?.();
  }
}

// A local file needs no resolution at all; a Kaggle dataset needs
// credentials, a real file listing, a file-selection decision (unless
// the caller already named one), and a real download — all of it
// unverified against a live Kaggle account (see kaggleDataset's own
// doc comment on PlanVideoRequest). The downloaded file lands in a
// throwaway temp dir, cleaned up by the caller's `finally` regardless
// of how the rest of the pipeline turns out.
async function resolveDatasetFile(
  req: PlanVideoRequest,
  deps: PlanVideoDeps,
): Promise<{ filePath: string; cleanup?: () => void; provenanceSource: string }> {
  if (req.datasetSource !== undefined) {
    return { filePath: req.datasetSource, provenanceSource: req.datasetSource };
  }

  const kaggle = req.kaggleDataset!;
  const credentials = deps.kaggleCredentials ?? kaggleCredentialsFromEnv();
  if (!credentials) {
    throw new PlanVideoError(
      "a kaggleDataset request needs Kaggle credentials — set KAGGLE_USERNAME/KAGGLE_KEY, or pass kaggleCredentials explicitly.",
    );
  }

  const listFiles = deps.listKaggleDatasetFiles ?? listKaggleDatasetFiles;
  const download = deps.downloadKaggleFile ?? downloadKaggleFile;

  let fileName = kaggle.fileName;
  if (!fileName) {
    let files;
    try {
      files = await listFiles(kaggle, credentials);
    } catch (err) {
      throw new PlanVideoError(`could not list Kaggle dataset files: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      fileName = await selectDatasetFile(req.prompt!, files, { chooseFile: deps.chooseDatasetFile });
    } catch (err) {
      throw new PlanVideoError(err instanceof Error ? err.message : String(err));
    }
  }

  const tempDir = mkdtempSync(join(tmpdir(), "algoreel-kaggle-"));
  let filePath: string;
  try {
    filePath = await download(kaggle, fileName, tempDir, credentials);
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new PlanVideoError(`could not download Kaggle dataset file: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    filePath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    provenanceSource: `kaggle:${kaggle.ownerSlug}/${kaggle.datasetSlug}/${fileName}`,
  };
}

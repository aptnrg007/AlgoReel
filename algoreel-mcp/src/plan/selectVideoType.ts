import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LadderExhaustedError, runLadder, type Rung } from "../agents/ladder";
import { parseJsonAnswer } from "../agents/runAgent";
import { keywordMatchAlgorithm } from "../spec/ensureSpec";
import { videoTypeChoiceSchema } from "./schema";
import type { VideoType } from "./types";

const AGENTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "algoreel-agents", "agents");
const SELECT_AGENT_PATH = join(AGENTS_ROOT, "select-video-type.yaml");
const SELECT_AGENT_PAID_PATH = join(AGENTS_ROOT, "select-video-type.anthropic.yaml");
const MAX_SELECT_ATTEMPTS = 3;

// Vocabulary strong enough to decide deterministically without a model call
// — the same "safe enough to skip the model" bar keywordMatchAlgorithm
// already applies to DSA topics, drawn directly from PLAN.md's own
// examples ("GDP values by year", "countries moving up and down the GDP
// rankings"). Deliberately narrow: this is not a general NLP classifier,
// it's a fast path for the obvious cases — anything it doesn't recognize
// falls through to the model ladder below, which handles open-ended
// phrasing neither list can enumerate.
const TIME_SERIES_KEYWORDS = [
  "gdp",
  "timelapse",
  "time-series",
  "time series",
  "over time",
  "over the years",
  "growth rate",
  "population growth",
  "stock price",
  "revenue growth",
  "rankings",
];
// "from 1990 to 2025" / "between 1990 and 2025" / "1990-2025" — a year
// range is a strong, independent signal a request is about data changing
// over a period, regardless of vocabulary.
const YEAR_RANGE_PATTERN = /\b(1[89]\d{2}|20\d{2})\b[^.]{0,20}\b(to|through|and|-|–)\b[^.]{0,20}\b(1[89]\d{2}|20\d{2})\b/i;

function looksLikeTimeSeriesRequest(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return TIME_SERIES_KEYWORDS.some((kw) => lower.includes(kw)) || YEAR_RANGE_PATTERN.test(prompt);
}

// Structural detection of already-supplied data (PLAN.md §15: support
// supplied data first, don't make the planner responsible for fetching
// or recognizing it via prose) — a candidate this shape is unambiguously
// meant to become a TimeSeriesSpec regardless of what any prompt says.
function looksLikeTimeSeriesData(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  const xAxis = d.xAxis as Record<string, unknown> | undefined;
  return typeof xAxis === "object" && xAxis !== null && Array.isArray(xAxis.values) && Array.isArray(d.series);
}

export interface SelectVideoTypeRequest {
  prompt?: string;
  data?: unknown;
  csv?: string;
}

export interface SelectVideoTypeResult {
  videoType: VideoType;
  // undefined when decided deterministically — no model call was made.
  rung?: number;
  notes: string[];
}

export interface SelectVideoTypeDeps {
  // Test seam mirroring ensureSpec.ts's deps.chooseAlgorithm — lets a test
  // drive the ladder without Ollama or a paid key.
  chooseVideoType?: (prompt: string, rungIndex: number) => Promise<string>;
}

function selectionRungs(): Rung[] {
  return [
    { agentPath: SELECT_AGENT_PATH, maxAttempts: MAX_SELECT_ATTEMPTS },
    { agentPath: SELECT_AGENT_PAID_PATH, requiresEnv: "ANTHROPIC_API_KEY", maxAttempts: 1 },
  ];
}

// The planner's entry point (PLAN.md §13): decides *what kind* of video a
// request is, deterministically wherever the request already makes that
// obvious, falling back to a toolless model call only for genuinely
// ambiguous prose — the same escalation discipline ensureSpec.ts's
// resolveAlgorithm already established for algorithm selection.
export async function selectVideoType(req: SelectVideoTypeRequest, deps: SelectVideoTypeDeps = {}): Promise<SelectVideoTypeResult> {
  const notes: string[] = [];

  if (req.csv !== undefined) {
    notes.push("csv input supplied — time_series, no model call needed");
    return { videoType: "time_series", notes };
  }
  if (req.data !== undefined && looksLikeTimeSeriesData(req.data)) {
    notes.push("supplied data already matches a TimeSeriesSpec shape (xAxis + series) — time_series, no model call needed");
    return { videoType: "time_series", notes };
  }

  if (!req.prompt) {
    throw new Error("selectVideoType needs a prompt, or data/csv shaped like a TimeSeriesSpec, to decide a video type");
  }

  const dsaMatch = keywordMatchAlgorithm(req.prompt) !== undefined;
  const timeSeriesMatch = looksLikeTimeSeriesRequest(req.prompt);

  if (dsaMatch && !timeSeriesMatch) {
    notes.push("matched a known algorithm by keyword — dsa, no model call needed");
    return { videoType: "dsa", notes };
  }
  if (timeSeriesMatch && !dsaMatch) {
    notes.push("matched time-series vocabulary/year-range — time_series, no model call needed");
    return { videoType: "time_series", notes };
  }

  const buildPrompt = (previous?: { output: string; error: string }) => {
    const correction = previous ? `\n\nYour previous answer was rejected: ${previous.error}\nFix it and answer again.` : "";
    return (
      `Request: ${req.prompt}\n\n` +
      `Decide what kind of video this should be:\n` +
      `- "dsa": explaining an algorithm or data structure (sorting, searching, graph traversal, tree operations, ...)\n` +
      `- "time_series": animating numeric data changing over time (a timelapse/trend chart — e.g. GDP over years, ` +
      `population growth, rankings changing over time)${correction}`
    );
  };

  try {
    const result = await runLadder(
      selectionRungs(),
      buildPrompt,
      (raw) => videoTypeChoiceSchema.parse(parseJsonAnswer(raw)),
      deps.chooseVideoType ? { generateText: deps.chooseVideoType } : {},
    );
    notes.push(`ambiguous request (matched ${dsaMatch ? "both" : "neither"} deterministic signal) — selected "${result.value.videoType}" via ${result.agentPath}`);
    return { videoType: result.value.videoType, rung: result.rungIndex, notes };
  } catch (err) {
    if (err instanceof LadderExhaustedError) {
      throw new Error(`could not classify video type for "${req.prompt}":\n${err.message}`);
    }
    throw err;
  }
}

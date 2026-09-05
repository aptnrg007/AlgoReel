import type { TimeSeriesSpec } from "./types";

// PLAN.md Phase 9 step 4: real data acquisition, deliberately scoped to
// one source and one call shape rather than "wire up every provider at
// once" — the same discipline structure: "graph" codegen only landing
// after structure: "array" was proven (PLAN.md §10). No auth/key needed;
// confirmed live against the real API before committing to this at all.
//
// This is deterministic TypeScript, not an LLM — the fetch and every
// number in the result is the real HTTP response, unmodified. An agent
// (or a human) may pick *which* country/indicator to ask for — that's a
// label decision, same as picking a video type — but never touches a
// value once the response comes back.
const WORLD_BANK_BASE = "https://api.worldbank.org/v2/country";

export interface WorldBankResult {
  spec: TimeSeriesSpec;
  // Provenance — PLAN.md's "the source URL and retrieval time get
  // stamped into the VideoPlan's description field" — so a viewer can
  // trace every number in the video back to where it came from.
  sourceUrl: string;
  retrievedAt: string;
}

interface WorldBankObservation {
  date: string;
  value: number | null;
  country: { id: string; value: string };
  indicator: { id: string; value: string };
}

export interface FetchWorldBankOptions {
  countryCode: string;
  indicatorCode: string;
  startYear: number;
  endYear: number;
  yAxisUnit?: string;
  // Found live: World Bank's raw GDP figures are actual dollars (a real
  // country's GDP is multiple trillions), which blows straight past
  // checkTimeSeriesRender's label-width budget — the same budget every
  // committed demo spec already respects by expressing its own numbers
  // "in USD billions" rather than raw dollars. This is a unit conversion
  // (2.19e12 -> 2190, still the exact same real quantity), never a
  // changed fact — divides every value before it ever reaches a spec.
  // Defaults to 1 (no scaling) for an indicator this file doesn't know.
  scale?: number;
}

export function worldBankUrl(opts: FetchWorldBankOptions): string {
  return `${WORLD_BANK_BASE}/${encodeURIComponent(opts.countryCode)}/indicator/${encodeURIComponent(opts.indicatorCode)}?format=json&date=${opts.startYear}:${opts.endYear}&per_page=1000`;
}

// Pure — no fetch, no Date.now() — the part of this file that's actually
// worth unit-testing against a canned response, same split
// fetchWorldBankTimeSeries's own callers rely on elsewhere in this repo
// (checkRender.ts is pure, renderVideo.ts does the I/O).
export function parseWorldBankResponse(body: unknown, opts: FetchWorldBankOptions): TimeSeriesSpec {
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) {
    throw new Error(`World Bank API response wasn't in the expected [metadata, observations] shape`);
  }
  const observations = body[1] as WorldBankObservation[];
  if (observations.length === 0) {
    throw new Error(`World Bank API has no data for country "${opts.countryCode}", indicator "${opts.indicatorCode}" in ${opts.startYear}-${opts.endYear}`);
  }

  // Real gaps are common (an indicator not yet reported for recent years,
  // or never reported for some countries) — value comes back as `null`,
  // never a fabricated number. Skipped entirely rather than guessed at.
  const withRealValues = observations.filter((o): o is WorldBankObservation & { value: number } => o.value !== null);
  if (withRealValues.length < 2) {
    throw new Error(
      `World Bank has fewer than 2 years of real data for country "${opts.countryCode}", indicator "${opts.indicatorCode}" ` +
        `in ${opts.startYear}-${opts.endYear} (${withRealValues.length} found) — need at least 2 points to animate.`,
    );
  }

  // The API returns newest-first; the chart needs oldest-first.
  const sorted = [...withRealValues].sort((a, b) => Number(a.date) - Number(b.date));
  const countryName = sorted[0]!.country.value;
  const indicatorName = sorted[0]!.indicator.value;
  const scale = opts.scale ?? 1;

  return {
    title: `${countryName}: ${indicatorName}`,
    xAxis: { label: "Year", values: sorted.map((o) => Number(o.date)) },
    yAxis: { label: indicatorName, unit: opts.yAxisUnit },
    series: [{ name: countryName, values: sorted.map((o) => o.value / scale) }],
  };
}

export async function fetchWorldBankTimeSeries(opts: FetchWorldBankOptions): Promise<WorldBankResult> {
  const url = worldBankUrl(opts);
  const retrievedAt = new Date().toISOString();

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`could not reach the World Bank API: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`World Bank API returned ${response.status} ${response.statusText} for ${url}`);
  }

  const body = (await response.json()) as unknown;
  const spec = parseWorldBankResponse(body, opts);
  return { spec, sourceUrl: url, retrievedAt };
}

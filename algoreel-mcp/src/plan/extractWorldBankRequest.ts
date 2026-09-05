// Deterministic keyword extraction, mirroring ensureSpec.ts's
// keywordMatchAlgorithm and selectVideoType.ts's looksLike* matchers —
// whole-word/whole-phrase matching against a small, deliberately narrow
// fixed table, never an LLM guessing a code from prose. PLAN.md Phase 9
// step 4: an agent (or a human) may pick *which* country/indicator a
// request implies — a label decision — but the actual World Bank codes
// come from this fixed table, not from anything a model asserts.
//
// Deliberately small — proving the mechanism on a handful of common
// countries/indicators, not attempting global coverage. A request naming
// something outside this table needs the exact ISO/indicator code
// supplied directly (planVideo.ts's `worldBank` field), same "supply the
// exact input, don't guess" fallback validateSpec's algorithm lookup uses.
const COUNTRY_CODES: Record<string, string> = {
  "united states": "US",
  usa: "US",
  china: "CN",
  india: "IN",
  brazil: "BR",
  japan: "JP",
  germany: "DE",
  "united kingdom": "GB",
  france: "FR",
  russia: "RU",
  canada: "CA",
  australia: "AU",
  mexico: "MX",
  "south korea": "KR",
  indonesia: "ID",
  nigeria: "NG",
  "south africa": "ZA",
  italy: "IT",
  spain: "ES",
  "saudi arabia": "SA",
  turkey: "TR",
};

export interface IndicatorMatch {
  code: string;
  yAxisUnit?: string;
  // World Bank's raw figures are actual dollars/head-counts — divided
  // down to a legible scale before a spec is built (fromWorldBank.ts's
  // own comment has the full reasoning); a real unit conversion, not a
  // changed fact.
  scale?: number;
}

const INDICATOR_CODES: Record<string, IndicatorMatch> = {
  gdp: { code: "NY.GDP.MKTP.CD", yAxisUnit: "USD billions", scale: 1e9 },
  population: { code: "SP.POP.TOTL", yAxisUnit: "millions", scale: 1e6 },
};

// Whole-word/whole-phrase matching, same discipline
// keywordMatchAlgorithm's own comment documents: a raw substring check
// would let "us" match inside "russia" or "discuss" — matching on
// tokenized words (and requiring every word of a multi-word phrase to be
// present) rules that out.
function findMatch<T>(prompt: string, table: Record<string, T>): { key: string; value: T } | null {
  const words = new Set(prompt.toLowerCase().match(/[a-z]+/g) ?? []);
  for (const [key, value] of Object.entries(table)) {
    const parts = key.split(" ");
    if (parts.length > 1 ? parts.every((p) => words.has(p)) : words.has(key)) {
      return { key, value };
    }
  }
  return null;
}

export interface ExtractedWorldBankRequest {
  countryCode: string;
  countryName: string;
  indicatorCode: string;
  yAxisUnit?: string;
  scale?: number;
  // Never set by extraction (prose doesn't reliably imply a year range) —
  // present only so this shape lines up with planVideo.ts's `worldBank`
  // request field, which does let a caller pin one explicitly.
  startYear?: number;
  endYear?: number;
}

// Returns null unless the prompt names *both* a known country and a known
// indicator — a partial match (country only, or indicator only) isn't
// enough to safely assume this is a World Bank request at all.
export function extractWorldBankRequest(prompt: string): ExtractedWorldBankRequest | null {
  const country = findMatch(prompt, COUNTRY_CODES);
  const indicator = findMatch(prompt, INDICATOR_CODES);
  if (!country || !indicator) return null;
  return {
    countryCode: country.value,
    countryName: country.key,
    indicatorCode: indicator.value.code,
    yAxisUnit: indicator.value.yAxisUnit,
    scale: indicator.value.scale,
  };
}

// The reverse lookup — by real World Bank indicator *code* rather than an
// English keyword — so a caller supplying the code directly (an explicit
// `worldBank` field, or the CLI's --world-bank-indicator flag) still gets
// the same sensible legible-scale default a keyword match would have,
// instead of raw unscaled figures blowing past checkTimeSeriesRender's
// label budget. Unknown to this table -> undefined, so the caller's data
// passes through unscaled and any real problem shows up as a normal,
// actionable check_render error rather than a silent guess.
export function scaleForIndicatorCode(indicatorCode: string): { yAxisUnit?: string; scale?: number } {
  const match = Object.values(INDICATOR_CODES).find((v) => v.code === indicatorCode);
  return match ? { yAxisUnit: match.yAxisUnit, scale: match.scale } : {};
}

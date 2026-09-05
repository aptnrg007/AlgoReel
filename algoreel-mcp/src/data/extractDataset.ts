import type { BarRaceSpec } from "../spec/barRace/types";
import type { TimeSeriesSpec } from "../spec/timeSeries/types";
import { readDataset } from "./readDataset";
import type { BarRaceDataPlan, CellValue, DataFilter, DataPlan, DataRange, TimeSeriesDataPlan } from "./types";

export interface ExtractDatasetOptions {
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  yAxisUnit?: string;
  valueLabel?: string;
}

// PLAN.md Phase 10 steps 3-4 — the only place in this phase a "fact" is
// ever produced. Takes a `DataPlan` (an agent's label choices) and the
// real file, re-parses it, and does plain arithmetic and string
// comparison — no model call, nothing here is allowed to be a guess.
// Every failure mode PLAN.md's step 4 names (unknown column, empty
// result, too few points, a non-numeric value in a column the plan
// called numeric, a duplicate (entity, period) pair) is a hard error
// naming the exact column/value, the same style validateTimeSeriesSpec/
// validateBarRaceSpec already use — never silently worked around.
export function extractDataset(filePath: string, plan: TimeSeriesDataPlan, opts?: ExtractDatasetOptions): TimeSeriesSpec;
export function extractDataset(filePath: string, plan: BarRaceDataPlan, opts?: ExtractDatasetOptions): BarRaceSpec;
export function extractDataset(filePath: string, plan: DataPlan, opts: ExtractDatasetOptions = {}): TimeSeriesSpec | BarRaceSpec {
  const { columnNames, rows } = readDataset(filePath);
  validateColumnsExist(plan, columnNames);

  const periodColumn = plan.videoType === "time_series" ? plan.xColumn : plan.periodColumn;
  if (plan.range) validateRangeColumn(plan.range, periodColumn);

  const filtered = applyFiltersAndRange(rows, plan.filters ?? [], plan.range);
  if (filtered.length === 0) {
    throw new Error(describeFilters(plan.filters ?? [], plan.range, "no rows matched"));
  }

  return plan.videoType === "time_series" ? extractTimeSeries(plan, filtered, opts) : extractBarRace(plan, filtered, opts);
}

// --- shared -----------------------------------------------------------

function referencedColumns(plan: DataPlan): string[] {
  const columns =
    plan.videoType === "time_series" ? [plan.xColumn, ...plan.yColumns] : [plan.entityColumn, plan.periodColumn, plan.valueColumn];
  if (plan.range) columns.push(plan.range.column);
  return [...columns, ...(plan.filters ?? []).map((f) => f.column)];
}

function validateColumnsExist(plan: DataPlan, columnNames: string[]): void {
  const known = new Set(columnNames);
  const unknown = [...new Set(referencedColumns(plan))].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`unknown column(s) in the data plan: ${unknown.join(", ")} — the file's real columns are: ${columnNames.join(", ")}`);
  }
}

// The agent is told to always put `range` on the x/period column — this
// catches a plan that didn't, rather than silently restricting some
// unrelated column instead.
function validateRangeColumn(range: DataRange, periodColumn: string): void {
  if (range.column !== periodColumn) {
    throw new Error(`range must be on the x/period column ("${periodColumn}"), not "${range.column}"`);
  }
}

function applyFiltersAndRange(rows: Record<string, CellValue>[], filters: DataFilter[], range?: DataRange): Record<string, CellValue>[] {
  return rows.filter((row) => {
    for (const f of filters) {
      if (String(row[f.column] ?? "") !== f.value) return false;
    }
    if (range && !withinRange(row[range.column] ?? null, range)) return false;
    return true;
  });
}

function describeFilters(filters: DataFilter[], range: DataRange | undefined, prefix: string): string {
  const parts = filters.map((f) => `${f.column} == "${f.value}"`);
  if (range) parts.push(`${range.column} in [${range.from ?? "-inf"}, ${range.to ?? "+inf"}]`);
  return parts.length > 0 ? `${prefix} for ${parts.join(" and ")}` : prefix;
}

function withinRange(cell: CellValue, range: DataRange): boolean {
  const cellStr = String(cell ?? "");
  const cellNum = Number(cellStr);
  const fromNum = range.from !== undefined ? Number(range.from) : undefined;
  const toNum = range.to !== undefined ? Number(range.to) : undefined;
  const numeric = Number.isFinite(cellNum) && (fromNum === undefined || Number.isFinite(fromNum)) && (toNum === undefined || Number.isFinite(toNum));

  if (numeric) {
    if (fromNum !== undefined && cellNum < fromNum) return false;
    if (toNum !== undefined && cellNum > toNum) return false;
    return true;
  }
  // String/lexicographic fallback — correct for ISO-shaped dates, a
  // known, accepted limitation for anything else (mirrors
  // inspectDataset.ts's own deliberately narrow date handling).
  if (range.from !== undefined && cellStr < range.from) return false;
  if (range.to !== undefined && cellStr > range.to) return false;
  return true;
}

// Same coercion as every fromCsv.ts's own toXValue — a numeric-looking
// value becomes a real number (so the axis sorts/animates numerically),
// anything else stays a label.
function toAxisValue(cell: CellValue): string | number {
  const str = String(cell ?? "");
  if (str === "") return str;
  const n = Number(str);
  return Number.isFinite(n) ? n : str;
}

function compareAxisValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

// Same fix fromWorldBank.ts already established for a known indicator
// table (raw GDP in dollars blows the chart's label-width budget),
// generalized here since an arbitrary dataset has no indicator-code
// table to consult — a round-number scale chosen from the data's own
// magnitude instead. A real unit conversion (divide, then say so in the
// label), never a changed fact; checkRender/formatValue are completely
// unchanged, this only keeps their existing width budget from being
// blown by a genuinely large raw number (population, GDP, revenue —
// all routinely in the hundreds of millions or more). Deliberately
// confined to this file — only the dataset-extraction path auto-scales;
// a caller supplying data/csv directly still controls its own units.
const VALUE_SCALES: { threshold: number; scale: number; unit: string }[] = [
  { threshold: 1e9, scale: 1e9, unit: "billions" },
  { threshold: 1e6, scale: 1e6, unit: "millions" },
];

function pickValueScale(maxAbs: number): { scale: number; unit?: string } {
  for (const s of VALUE_SCALES) {
    if (maxAbs >= s.threshold) return { scale: s.scale, unit: s.unit };
  }
  return { scale: 1 };
}

// Empty/null is a genuine, recognized gap (skipped, same discipline
// fromWorldBank.ts's null-handling already established). Anything else
// that fails to parse is a real data-quality problem or a sign the plan
// pointed at the wrong column — a hard error, not a silent drop.
function parseValueCell(cell: CellValue, column: string, context: string): number | undefined {
  const str = String(cell ?? "").trim();
  if (str === "") return undefined;
  const n = Number(str);
  if (!Number.isFinite(n)) {
    throw new Error(`${context}: column "${column}" has non-numeric value "${str}"`);
  }
  return n;
}

// --- time_series --------------------------------------------------------

function extractTimeSeries(plan: TimeSeriesDataPlan, rows: Record<string, CellValue>[], opts: ExtractDatasetOptions): TimeSeriesSpec {
  const points = rows.map((row) => {
    const x = toAxisValue(row[plan.xColumn] ?? null);
    const values = plan.yColumns.map((col) => parseValueCell(row[col] ?? null, col, `row with ${plan.xColumn}="${x}"`));
    return { x, values };
  });

  const seen = new Map<string, (typeof points)[number]>();
  for (const p of points) {
    const key = String(p.x);
    if (seen.has(key)) {
      throw new Error(`multiple rows share x-axis value "${p.x}" — narrow the plan's filters so each x-axis value appears once`);
    }
    seen.set(key, p);
  }

  // A row where any series has a real gap is dropped entirely — every
  // series must have exactly one value per x-axis point (the same
  // constraint validateTimeSeriesSpec already enforces), so a point
  // that's incomplete for even one series can't be kept for any of them.
  const complete = points.filter((p) => p.values.every((v) => v !== undefined)).sort((a, b) => compareAxisValues(a.x, b.x));

  if (complete.length < 2) {
    throw new Error(`fewer than 2 complete x-axis point(s) after filtering (${complete.length} found) — need at least 2 to animate`);
  }

  const maxAbs = Math.max(0, ...complete.flatMap((p) => p.values.map((v) => Math.abs(v as number))));
  const { scale, unit } = pickValueScale(maxAbs);

  return {
    title: opts.title ?? defaultTimeSeriesTitle(plan),
    xAxis: { label: opts.xAxisLabel ?? plan.xColumn, values: complete.map((p) => p.x) },
    yAxis: { label: opts.yAxisLabel ?? plan.yColumns.join(", "), unit: opts.yAxisUnit ?? unit },
    series: plan.yColumns.map((name, i) => ({ name, values: complete.map((p) => (p.values[i] as number) / scale) })),
  };
}

function defaultTimeSeriesTitle(plan: TimeSeriesDataPlan): string {
  const base = plan.yColumns.join(", ");
  const suffix = (plan.filters ?? []).map((f) => f.value).join(", ");
  return suffix ? `${base} (${suffix})` : base;
}

// --- bar_race -----------------------------------------------------------

function extractBarRace(plan: BarRaceDataPlan, rows: Record<string, CellValue>[], opts: ExtractDatasetOptions): BarRaceSpec {
  const perEntity = new Map<string, Map<string, { period: string | number; value: number }>>();

  for (const row of rows) {
    const entity = String(row[plan.entityColumn] ?? "").trim();
    const period = toAxisValue(row[plan.periodColumn] ?? null);
    const periodKey = String(period);
    const value = parseValueCell(row[plan.valueColumn] ?? null, plan.valueColumn, `entity "${entity}", period "${period}"`);

    const byPeriod = perEntity.get(entity) ?? new Map();
    if (byPeriod.has(periodKey)) {
      throw new Error(`duplicate (entity, period) pair: entity "${entity}" has more than one row for period "${period}"`);
    }
    if (value !== undefined) byPeriod.set(periodKey, { period, value });
    perEntity.set(entity, byPeriod);
  }

  const candidates = [...perEntity.entries()].filter(([, byPeriod]) => byPeriod.size > 0);
  if (candidates.length === 0) {
    throw new Error("no entity has a real (non-gap) value for the given plan");
  }

  // "Top N" ranks by each entity's own latest covered period — simple,
  // deterministic, and documented rather than an arbitrary tie-break.
  const ranked = [...candidates].sort((a, b) => {
    const latest = (byPeriod: Map<string, { period: string | number; value: number }>) =>
      [...byPeriod.values()].sort((x, y) => compareAxisValues(x.period, y.period)).at(-1)!.value;
    return latest(b[1]) - latest(a[1]);
  });
  const selected = plan.topN !== undefined ? ranked.slice(0, plan.topN) : ranked;

  // Every selected entity must have a value at every x-axis point
  // (BarRaceEntry.values aligns 1:1 with xAxis.values, same constraint
  // validateBarRaceSpec enforces) — the intersection of periods actually
  // covered by every *selected* entity, not the union. A gap in an
  // unselected entity never narrows the race; a gap in a selected one
  // does, the same "skipped, never fabricated" rule time_series follows.
  let commonPeriods: Set<string> | undefined;
  for (const [, byPeriod] of selected) {
    const keys = new Set(byPeriod.keys());
    commonPeriods = commonPeriods ? new Set([...commonPeriods].filter((k) => keys.has(k))) : keys;
  }
  const periodByKey = new Map<string, string | number>();
  for (const [, byPeriod] of selected) {
    for (const [key, { period }] of byPeriod) periodByKey.set(key, period);
  }
  const sortedPeriods = [...(commonPeriods ?? [])].map((key) => periodByKey.get(key)!).sort(compareAxisValues);

  if (sortedPeriods.length < 2) {
    throw new Error(
      `fewer than 2 period(s) are covered by every selected entity (${sortedPeriods.length} found) — need at least 2 to animate. ` +
        `Selected entities: ${selected.map(([name]) => name).join(", ")}`,
    );
  }

  const maxAbs = Math.max(0, ...selected.flatMap(([, byPeriod]) => [...byPeriod.values()].map((v) => Math.abs(v.value))));
  const { scale, unit } = pickValueScale(maxAbs);
  const defaultValueLabel = unit ? `${plan.valueColumn} (${unit})` : plan.valueColumn;

  return {
    title: opts.title ?? defaultBarRaceTitle(plan),
    xAxis: { label: opts.xAxisLabel ?? plan.periodColumn, values: sortedPeriods },
    valueLabel: opts.valueLabel ?? defaultValueLabel,
    entries: selected.map(([name, byPeriod]) => ({
      name,
      values: sortedPeriods.map((period) => byPeriod.get(String(period))!.value / scale),
    })),
  };
}

function defaultBarRaceTitle(plan: BarRaceDataPlan): string {
  const base = `${plan.valueColumn} by ${plan.entityColumn}`;
  const suffix = (plan.filters ?? []).map((f) => f.value).join(", ");
  return suffix ? `${base} (${suffix})` : base;
}

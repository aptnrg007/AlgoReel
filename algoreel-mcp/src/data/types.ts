// PLAN.md Phase 10 step 1 — the only thing an agent (step 2's
// plan-dataset.yaml) ever sees of a real dataset: column names, an
// inferred type per column, and a small sample. Never the whole file.
export type ColumnType = "numeric" | "date" | "categorical";

export interface ColumnSchema {
  name: string;
  type: ColumnType;
}

export type CellValue = string | number | boolean | null;

export interface DatasetSchema {
  columns: ColumnSchema[];
  rowCount: number;
  // A handful of real rows, verbatim — never fabricated or summarized.
  sampleRows: Record<string, CellValue>[];
}

// PLAN.md Phase 10 step 2 — the agent's only output. Every field below is
// a *label* (a column name, a filter value copied from the prompt, a
// requested count) — never a value read out of the dataset itself. The
// deterministic extractor (step 3) is what actually reads real cells.
export interface DataFilter {
  // Equality only for v1 — PLAN.md's own scope note: arbitrary
  // aggregation/operators are explicitly out of scope until a real
  // dataset needs them.
  column: string;
  value: string;
}

export interface DataRange {
  column: string;
  from?: string;
  to?: string;
}

export interface TimeSeriesDataPlan {
  videoType: "time_series";
  xColumn: string;
  yColumns: string[];
  filters?: DataFilter[];
  range?: DataRange;
}

export interface BarRaceDataPlan {
  videoType: "bar_race";
  entityColumn: string;
  periodColumn: string;
  valueColumn: string;
  filters?: DataFilter[];
  // Restricts periodColumn to a span — found live to be genuinely needed
  // here too, not just for time_series: without it, a request like "race
  // from 1990 to 2010" has no legitimate field to express the range in,
  // and a real run improvised two contradictory equality filters on the
  // period column instead (an AND of Year==1990 and Year==2010, which
  // can never match a row).
  range?: DataRange;
  // A request parameter like planVideo's targetDurationSec, not a fact
  // read from the data — "top 10" is something the caller asked for.
  topN?: number;
}

export type DataPlan = TimeSeriesDataPlan | BarRaceDataPlan;

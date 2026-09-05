import type { CellValue, ColumnSchema, ColumnType, DatasetSchema } from "./types";
import { readDataset } from "./readDataset";

// How many rows to look at to infer a column's type. Deliberately a fixed
// cap, not "all rows" — a type is either consistent across a real dataset
// or it isn't, and reading further doesn't buy more confidence in the
// common case, only slowness on the pathological one.
const TYPE_SAMPLE_ROWS = 200;
// How many rows the agent actually gets to see (PLAN.md Phase 10's whole
// point: metadata + a small sample, never the full file).
const DISPLAY_SAMPLE_ROWS = 5;

// A deliberately narrow date pattern — ISO-shaped only (YYYY-MM-DD,
// YYYY-MM, YYYY/MM/DD). Same discipline as fromCsv.ts's "minimal until a
// real input needs more": a column of plain years (1990, 1991, ...) is
// numeric, not a date, by design — that's the common case for
// time_series/bar_race's period column and it should classify as
// numeric, not force a separate code path.
const DATE_PATTERN = /^\d{4}-\d{2}(-\d{2})?$|^\d{4}\/\d{2}\/\d{2}$/;

// PLAN.md Phase 10 step 1 — deterministic dataset inspection, local
// CSV/JSON only. Reads the real file and reports its shape; never
// summarizes, guesses a type from a column's *name*, or fabricates a
// sample row. This is the only function in Phase 10 that touches the
// whole file — everything downstream (the plan-dataset agent, the
// extractor) works from either this schema or a `DataPlan` naming exact
// columns, never the raw file itself.
export function inspectDataset(filePath: string): DatasetSchema {
  const { columnNames, rows } = readDataset(filePath);
  const sample = rows.slice(0, TYPE_SAMPLE_ROWS);
  const columns: ColumnSchema[] = columnNames.map((name) => ({
    name,
    type: inferColumnType(sample.map((row) => row[name] ?? null)),
  }));

  return {
    columns,
    rowCount: rows.length,
    sampleRows: rows.slice(0, DISPLAY_SAMPLE_ROWS),
  };
}

function inferColumnType(values: CellValue[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonEmpty.length === 0) return "categorical";

  if (nonEmpty.every((v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))))) {
    return "numeric";
  }
  if (nonEmpty.every((v) => typeof v === "string" && DATE_PATTERN.test(v.trim()))) {
    return "date";
  }
  return "categorical";
}

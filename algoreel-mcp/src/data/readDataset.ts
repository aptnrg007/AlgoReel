import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { CellValue } from "./types";

export interface RawDataset {
  columnNames: string[];
  rows: Record<string, CellValue>[];
}

// The one place a local CSV/JSON dataset file is actually parsed —
// shared by inspectDataset.ts (step 1, a schema + a 5-row sample) and
// extractDataset.ts (step 3, every row) so the two can never drift on
// what a "row" is. Deliberately minimal CSV parsing (a comma-split, no
// quoted-field escaping), same scope decision as every other
// `fromCsv.ts` in this repo.
export function readDataset(filePath: string): RawDataset {
  const ext = extname(filePath).toLowerCase();
  const text = readFileSync(filePath, "utf8");

  if (ext === ".json") return readJson(text);
  if (ext === ".csv") return readCsv(text);
  throw new Error(`unsupported dataset file type "${ext}" (expected .csv or .json)`);
}

function readJson(text: string): RawDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("expected a JSON array of objects (one object per row)");
  }
  if (parsed.length === 0) {
    throw new Error("dataset has no rows");
  }
  const rows: Record<string, CellValue>[] = parsed.map((row, i) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`row ${i} is not a plain object`);
    }
    return row as Record<string, CellValue>;
  });

  return { columnNames: Object.keys(rows[0]!), rows };
}

function readCsv(text: string): RawDataset {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const columnNames = lines[0]!.split(",").map((cell) => cell.trim());
  const rows: Record<string, CellValue>[] = lines.slice(1).map((line, i) => {
    const rowNumber = i + 2; // +1 for the header row, +1 for 1-based counting
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== columnNames.length) {
      throw new Error(`row ${rowNumber} has ${cells.length} column(s), expected ${columnNames.length}`);
    }
    const row: Record<string, CellValue> = {};
    columnNames.forEach((name, col) => {
      row[name] = cells[col]!;
    });
    return row;
  });

  return { columnNames, rows };
}

import type { BarRaceSpec } from "./types";

export interface CsvParseOptions {
  title: string;
  xAxisLabel: string;
  valueLabel: string;
}

// Mirrors timeSeries/fromCsv.ts exactly — same shape (first column is the
// x-axis, every other column a named entry), same deliberate minimalism
// (no quoted-field escaping). The two video types happen to share this
// normalization shape because both are "one value per column per step,"
// not because bar_race depends on time_series in any way.
export function parseCsvToBarRaceSpec(csvText: string, opts: CsvParseOptions): BarRaceSpec {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const header = lines[0]!.split(",").map((cell) => cell.trim());
  const [xHeader, ...entryHeaders] = header;
  if (!xHeader || entryHeaders.length < 2) {
    throw new Error('CSV header must be "x-axis column, entry column, entry column, ..." (at least 3 columns — a race needs 2+ entries)');
  }

  const xValues: (string | number)[] = [];
  const entryValues: number[][] = entryHeaders.map(() => []);

  lines.slice(1).forEach((line, i) => {
    const rowNumber = i + 2;
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== header.length) {
      throw new Error(`row ${rowNumber} has ${cells.length} column(s), expected ${header.length}`);
    }

    const [xCell, ...rest] = cells;
    xValues.push(toXValue(xCell!));
    rest.forEach((cell, col) => {
      const n = Number(cell);
      if (cell === "" || !Number.isFinite(n)) {
        throw new Error(`row ${rowNumber}, column "${entryHeaders[col]}": "${cell}" is not a finite number`);
      }
      entryValues[col]!.push(n);
    });
  });

  return {
    title: opts.title,
    xAxis: { label: opts.xAxisLabel, values: xValues },
    valueLabel: opts.valueLabel,
    entries: entryHeaders.map((name, i) => ({ name, values: entryValues[i]! })),
  };
}

function toXValue(cell: string): string | number {
  if (cell === "") return cell;
  const n = Number(cell);
  return Number.isFinite(n) ? n : cell;
}

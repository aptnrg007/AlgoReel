import type { TimeSeriesSpec } from "./types";

export interface CsvParseOptions {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  yAxisUnit?: string;
}

// Raw Data -> Normalizer -> Canonical Data -> TimeSeriesSpec (PLAN.md §16).
// Deliberately minimal — a comma-split, no quoted-field escaping — since
// the shape this needs to cover is "a spreadsheet export of numbers," not
// arbitrary CSV; a real quoting/escaping parser is a dependency to add
// once a real input actually needs it, not before.
export function parseCsvToTimeSeriesSpec(csvText: string, opts: CsvParseOptions): TimeSeriesSpec {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const header = lines[0]!.split(",").map((cell) => cell.trim());
  const [xHeader, ...seriesHeaders] = header;
  if (!xHeader || seriesHeaders.length === 0) {
    throw new Error('CSV header must be "x-axis column, series column, ..." (at least 2 columns)');
  }

  const xValues: (string | number)[] = [];
  const seriesValues: number[][] = seriesHeaders.map(() => []);

  lines.slice(1).forEach((line, i) => {
    const rowNumber = i + 2; // +1 for the header row, +1 for 1-based counting
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== header.length) {
      throw new Error(`row ${rowNumber} has ${cells.length} column(s), expected ${header.length}`);
    }

    const [xCell, ...rest] = cells;
    xValues.push(toXValue(xCell!));
    rest.forEach((cell, col) => {
      const n = Number(cell);
      if (cell === "" || !Number.isFinite(n)) {
        throw new Error(`row ${rowNumber}, column "${seriesHeaders[col]}": "${cell}" is not a finite number`);
      }
      seriesValues[col]!.push(n);
    });
  });

  return {
    title: opts.title,
    xAxis: { label: opts.xAxisLabel, values: xValues },
    yAxis: { label: opts.yAxisLabel, unit: opts.yAxisUnit },
    series: seriesHeaders.map((name, i) => ({ name, values: seriesValues[i]! })),
  };
}

function toXValue(cell: string): string | number {
  if (cell === "") return cell;
  const n = Number(cell);
  return Number.isFinite(n) ? n : cell;
}

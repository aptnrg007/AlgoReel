import type { TimelineSpec } from "./types";

export interface CsvParseOptions {
  title: string;
}

// Mirrors timeSeries/fromCsv.ts's/barRace/fromCsv.ts's own shape and
// deliberate minimalism (no quoted-field escaping) — but simpler than
// either, since a timeline has exactly two columns, always: date, title.
export function parseCsvToTimelineSpec(csvText: string, opts: CsvParseOptions): TimelineSpec {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 3) {
    throw new Error("CSV must have a header row and at least 2 data rows (a timeline needs 2+ events)");
  }

  const header = lines[0]!.split(",").map((cell) => cell.trim());
  if (header.length !== 2) {
    throw new Error('CSV header must be exactly "date,title" (2 columns)');
  }

  const events = lines.slice(1).map((line, i) => {
    const rowNumber = i + 2;
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== 2) {
      throw new Error(`row ${rowNumber} has ${cells.length} column(s), expected 2`);
    }
    const [date, title] = cells;
    if (!date || !title) {
      throw new Error(`row ${rowNumber}: date and title must both be non-empty`);
    }
    return { date, title };
  });

  return { title: opts.title, events };
}

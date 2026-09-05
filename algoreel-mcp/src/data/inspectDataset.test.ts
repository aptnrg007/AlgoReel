import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { inspectDataset } from "./inspectDataset";

function withFile(name: string, contents: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "inspect-dataset-test-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("infers numeric, categorical, and date columns from a CSV", () => {
  const csv = "country,year,gdp,launch_date\nIndia,1990,320,1990-04-01\nChina,1991,360,1991-06-15\n";
  withFile("data.csv", csv, (path) => {
    const schema = inspectDataset(path);
    assert.deepEqual(schema.columns, [
      { name: "country", type: "categorical" },
      { name: "year", type: "numeric" },
      { name: "gdp", type: "numeric" },
      { name: "launch_date", type: "date" },
    ]);
    assert.equal(schema.rowCount, 2);
  });
});

test("returns real sample rows verbatim, not summarized", () => {
  const csv = "country,year\nIndia,1990\nChina,1991\n";
  withFile("data.csv", csv, (path) => {
    const schema = inspectDataset(path);
    assert.deepEqual(schema.sampleRows, [
      { country: "India", year: "1990" },
      { country: "China", year: "1991" },
    ]);
  });
});

test("caps sample rows at 5 even for a larger dataset", () => {
  const rows = Array.from({ length: 20 }, (_, i) => `x${i},${i}`).join("\n");
  const csv = `name,value\n${rows}\n`;
  withFile("data.csv", csv, (path) => {
    const schema = inspectDataset(path);
    assert.equal(schema.rowCount, 20);
    assert.equal(schema.sampleRows.length, 5);
  });
});

test("a CSV row with the wrong number of columns is a clear error", () => {
  const csv = "a,b\n1,2\n3\n";
  withFile("data.csv", csv, (path) => {
    assert.throws(() => inspectDataset(path), /row 3 has 1 column\(s\), expected 2/);
  });
});

test("parses a JSON array of objects, preserving native types in the sample", () => {
  const json = JSON.stringify([
    { country: "India", year: 1990, gdp: 320.5 },
    { country: "China", year: 1991, gdp: 360.1 },
  ]);
  withFile("data.json", json, (path) => {
    const schema = inspectDataset(path);
    assert.deepEqual(schema.columns, [
      { name: "country", type: "categorical" },
      { name: "year", type: "numeric" },
      { name: "gdp", type: "numeric" },
    ]);
    assert.equal(schema.sampleRows[0]!.year, 1990);
    assert.equal(typeof schema.sampleRows[0]!.year, "number");
  });
});

test("JSON that isn't an array of objects is a clear error", () => {
  withFile("data.json", JSON.stringify({ not: "an array" }), (path) => {
    assert.throws(() => inspectDataset(path), /expected a JSON array of objects/);
  });
});

test("a null value in a column doesn't force it to categorical", () => {
  const json = JSON.stringify([
    { name: "a", value: 1 },
    { name: "b", value: null },
    { name: "c", value: 3 },
  ]);
  withFile("data.json", json, (path) => {
    const schema = inspectDataset(path);
    const valueCol = schema.columns.find((c) => c.name === "value");
    assert.equal(valueCol?.type, "numeric");
  });
});

test("an unsupported file extension is a clear error", () => {
  withFile("data.txt", "irrelevant", (path) => {
    assert.throws(() => inspectDataset(path), /unsupported dataset file type "\.txt"/);
  });
});

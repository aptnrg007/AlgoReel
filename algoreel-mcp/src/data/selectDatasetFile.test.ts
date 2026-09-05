import assert from "node:assert/strict";
import { test } from "node:test";

import { selectDatasetFile } from "./selectDatasetFile";

test("a single recognized-extension file is picked deterministically, with zero model calls", async () => {
  const fileName = await selectDatasetFile(
    "population growth",
    [{ name: "data.csv" }, { name: "README.md" }],
    { chooseFile: () => { throw new Error("should not be called"); } },
  );
  assert.equal(fileName, "data.csv");
});

test("no recognized-extension file is a clear error, not a crash", async () => {
  await assert.rejects(
    () => selectDatasetFile("population growth", [{ name: "README.md" }, { name: "LICENSE" }]),
    /no \.csv\/\.json file found/,
  );
});

test("multiple candidates go through the ladder and the returned choice is used", async () => {
  const fileName = await selectDatasetFile(
    "population by country",
    [{ name: "population.csv" }, { name: "gdp.csv" }],
    { chooseFile: async () => JSON.stringify({ fileName: "population.csv" }) },
  );
  assert.equal(fileName, "population.csv");
});

test("an agent answer naming a file that doesn't exist is rejected, not silently accepted", async () => {
  await assert.rejects(
    () =>
      selectDatasetFile(
        "population by country",
        [{ name: "population.csv" }, { name: "gdp.csv" }],
        { chooseFile: async () => JSON.stringify({ fileName: "made-up.csv" }) },
      ),
    /could not select a file/,
  );
});

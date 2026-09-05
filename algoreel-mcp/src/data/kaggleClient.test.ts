import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { downloadKaggleFile, kaggleCredentialsFromEnv, listKaggleDatasetFiles, parseKaggleFileList } from "./kaggleClient";

const REF = { ownerSlug: "someone", datasetSlug: "world-population" };
const CREDENTIALS = { username: "user", key: "secret" };

// --- parseKaggleFileList (pure) -------------------------------------------

test("parses a well-formed file list response", () => {
  const files = parseKaggleFileList([
    { name: "population.csv", totalBytes: 12345 },
    { name: "README.md" },
  ]);
  assert.deepEqual(files, [
    { name: "population.csv", totalBytes: 12345 },
    { name: "README.md", totalBytes: undefined },
  ]);
});

test("a non-array response is a clear error", () => {
  assert.throws(() => parseKaggleFileList({ files: [] }), /expected array shape/);
});

test("an entry without a real name field is a clear error naming the index", () => {
  assert.throws(() => parseKaggleFileList([{ name: "a.csv" }, { size: 10 }]), /index 1.*without a real "name" field/s);
});

// --- listKaggleDatasetFiles / downloadKaggleFile (fetch injected) --------

test("listKaggleDatasetFiles calls the documented endpoint with Basic auth and parses the response", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: HeadersInit | undefined;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify([{ name: "data.csv", totalBytes: 100 }]), { status: 200 });
  }) as typeof fetch;

  const files = await listKaggleDatasetFiles(REF, CREDENTIALS, fetchImpl);

  assert.equal(capturedUrl, "https://www.kaggle.com/api/v1/datasets/list/someone/world-population");
  const auth = (capturedHeaders as Record<string, string>).Authorization;
  assert.equal(auth, `Basic ${Buffer.from("user:secret").toString("base64")}`);
  assert.deepEqual(files, [{ name: "data.csv", totalBytes: 100 }]);
});

test("listKaggleDatasetFiles surfaces a non-ok response as a clear error, not a crash", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 403, statusText: "Forbidden" })) as typeof fetch;
  await assert.rejects(() => listKaggleDatasetFiles(REF, CREDENTIALS, fetchImpl), /Kaggle API returned 403 Forbidden/);
});

test("listKaggleDatasetFiles surfaces a network failure as a clear error", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  await assert.rejects(() => listKaggleDatasetFiles(REF, CREDENTIALS, fetchImpl), /could not reach the Kaggle API/);
});

test("downloadKaggleFile calls the per-file endpoint (never the whole-dataset zip) and writes the real bytes", async () => {
  let capturedUrl: string | undefined;
  const fileContents = "Year,Population\n1990,870000000\n";
  const fetchImpl = (async (url: string) => {
    capturedUrl = url;
    return new Response(fileContents, { status: 200 });
  }) as typeof fetch;

  const dir = mkdtempSync(join(tmpdir(), "kaggle-client-test-"));
  try {
    const destPath = await downloadKaggleFile(REF, "population.csv", dir, CREDENTIALS, fetchImpl);
    assert.equal(capturedUrl, "https://www.kaggle.com/api/v1/datasets/download/someone/world-population/population.csv");
    assert.equal(destPath, join(dir, "population.csv"));
    assert.equal(readFileSync(destPath, "utf8"), fileContents);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadKaggleFile surfaces a non-ok response as a clear error", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 404, statusText: "Not Found" })) as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "kaggle-client-test-"));
  try {
    await assert.rejects(() => downloadKaggleFile(REF, "missing.csv", dir, CREDENTIALS, fetchImpl), /Kaggle API returned 404 Not Found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- kaggleCredentialsFromEnv ----------------------------------------------

test("kaggleCredentialsFromEnv reads both env vars, or returns undefined if either is missing", () => {
  const originalUser = process.env.KAGGLE_USERNAME;
  const originalKey = process.env.KAGGLE_KEY;
  try {
    delete process.env.KAGGLE_USERNAME;
    delete process.env.KAGGLE_KEY;
    assert.equal(kaggleCredentialsFromEnv(), undefined);

    process.env.KAGGLE_USERNAME = "u";
    assert.equal(kaggleCredentialsFromEnv(), undefined);

    process.env.KAGGLE_KEY = "k";
    assert.deepEqual(kaggleCredentialsFromEnv(), { username: "u", key: "k" });
  } finally {
    if (originalUser === undefined) delete process.env.KAGGLE_USERNAME;
    else process.env.KAGGLE_USERNAME = originalUser;
    if (originalKey === undefined) delete process.env.KAGGLE_KEY;
    else process.env.KAGGLE_KEY = originalKey;
  }
});

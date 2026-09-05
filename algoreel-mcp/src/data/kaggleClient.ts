import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { KaggleCredentials, KaggleDatasetRef, KaggleFile } from "./kaggleTypes";

// PLAN.md Phase 10 step 5 (the Kaggle connector) — deliberately last,
// and unlike every other live-network integration in this project
// (fromWorldBank.ts's real fetch, every agent-ladder call), this file
// has NOT been run against a real response: this environment has no
// KAGGLE_USERNAME/KAGGLE_KEY configured, so there was nothing to
// verify live against. The endpoint paths and Basic-auth scheme below
// are Kaggle's long-documented, stable public API surface (the same
// one the official `kaggle` CLI uses), but treat this as a best-effort
// implementation pending a real credential to confirm against — not a
// live-confirmed one like everything else in this repo. `fetchImpl` is
// injectable specifically so the URL-building/auth-header/file-writing
// logic below can still be exercised by a real (if fake) HTTP call in
// tests, rather than trusting the shape by inspection alone.
const KAGGLE_API_BASE = "https://www.kaggle.com/api/v1";

export type FetchImpl = typeof fetch;

function authHeader(credentials: KaggleCredentials): string {
  const encoded = Buffer.from(`${credentials.username}:${credentials.key}`).toString("base64");
  return `Basic ${encoded}`;
}

export function kaggleCredentialsFromEnv(): KaggleCredentials | undefined {
  const username = process.env.KAGGLE_USERNAME;
  const key = process.env.KAGGLE_KEY;
  return username && key ? { username, key } : undefined;
}

// Pure — no fetch — the part of this file actually worth unit-testing
// against a canned response, same split fromWorldBank.ts's
// parseWorldBankResponse already established for the same reason.
export function parseKaggleFileList(body: unknown): KaggleFile[] {
  if (!Array.isArray(body)) {
    throw new Error(`Kaggle API's file list response wasn't in the expected array shape`);
  }
  return body.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as Record<string, unknown>).name !== "string") {
      throw new Error(`Kaggle API's file list response had an entry at index ${i} without a real "name" field`);
    }
    const e = entry as Record<string, unknown>;
    return { name: e.name as string, totalBytes: typeof e.totalBytes === "number" ? e.totalBytes : undefined };
  });
}

// Lists the real files in a dataset so a caller (or selectDatasetFile's
// own agent) can see names/sizes before choosing one — mirrors
// inspectDataset.ts's own "metadata before committing" shape.
export async function listKaggleDatasetFiles(ref: KaggleDatasetRef, credentials: KaggleCredentials, fetchImpl: FetchImpl = fetch): Promise<KaggleFile[]> {
  const url = `${KAGGLE_API_BASE}/datasets/list/${encodeURIComponent(ref.ownerSlug)}/${encodeURIComponent(ref.datasetSlug)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: authHeader(credentials) } });
  } catch (err) {
    throw new Error(`could not reach the Kaggle API: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Kaggle API returned ${response.status} ${response.statusText} listing files for ${ref.ownerSlug}/${ref.datasetSlug}`);
  }
  const body = (await response.json()) as unknown;
  return parseKaggleFileList(body);
}

// Downloads exactly one named file from the dataset — never the whole
// dataset as a zip. Kaggle's per-file download endpoint returns the raw
// file directly, deliberately chosen over the whole-dataset endpoint so
// this connector never needs a zip-extraction dependency this project
// doesn't otherwise have any use for.
export async function downloadKaggleFile(
  ref: KaggleDatasetRef,
  fileName: string,
  destDir: string,
  credentials: KaggleCredentials,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const url = `${KAGGLE_API_BASE}/datasets/download/${encodeURIComponent(ref.ownerSlug)}/${encodeURIComponent(ref.datasetSlug)}/${encodeURIComponent(fileName)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: authHeader(credentials) } });
  } catch (err) {
    throw new Error(`could not reach the Kaggle API: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Kaggle API returned ${response.status} ${response.statusText} downloading ${ref.ownerSlug}/${ref.datasetSlug}/${fileName}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const destPath = join(destDir, fileName);
  writeFileSync(destPath, buffer);
  return destPath;
}

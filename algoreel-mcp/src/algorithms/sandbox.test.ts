import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { generateAndValidateAlgorithm, GenerateAlgorithmError } from "./sandbox";

const GENERATED_DIR = join(dirname(fileURLToPath(import.meta.url)), "generated");
const MANIFEST_PATH = join(GENERATED_DIR, "manifest.ts");

// manifest.ts is a required, committed baseline file (algorithms/index.ts
// has a hard static import on it) — deleting the whole directory would
// leave the repo unable to build until it's hand-recreated. Removes only
// the *other* generated files these tests produce and resets the
// manifest back to its empty baseline content, matching what's actually
// checked in.
function resetGeneratedDir(): void {
  if (existsSync(GENERATED_DIR)) {
    for (const f of readdirSync(GENERATED_DIR)) {
      if (f !== "manifest.ts") rmSync(join(GENERATED_DIR, f));
    }
  }
  writeFileSync(
    MANIFEST_PATH,
    `import type { AlgorithmResult } from "../types";

export interface GeneratedManifestEntry {
  description: string;
  run: (input: { array: number[] }) => AlgorithmResult;
}

export const GENERATED: Record<string, GeneratedManifestEntry> = {};
`,
  );
}

// Properly instrumented — real decisions route through trace.compare(),
// not a raw JS operator on values fetched via trace.get() (confirmed
// live: an implementation that skips trace.compare() entirely still
// sorts correctly, so the result-correctness check alone wouldn't catch
// it, but the resulting video would show zero comparison animations).
// A separate temp-buffer merge like this can't feed trace.compare()'s
// *return value* into the real decision (the buffered values may no
// longer match trace's live, already-partially-overwritten positions),
// so it calls trace.compare() once per pair for the animation/narration
// signal and makes the actual decision on the buffered copies — the
// same pattern script.yaml's contract documentation recommends.
const REAL_MERGE_SORT = `
function run(trace) {
  function merge(lo, mid, hi) {
    const left = [];
    for (let k = lo; k <= mid; k++) left.push(trace.get(k));
    const right = [];
    for (let k = mid + 1; k <= hi; k++) right.push(trace.get(k));
    let i = 0, j = 0, k = lo;
    while (i < left.length && j < right.length) {
      if (left[i] <= right[j]) { trace.set(k++, left[i++]); } else { trace.set(k++, right[j++]); }
    }
    while (i < left.length) trace.set(k++, left[i++]);
    while (j < right.length) trace.set(k++, right[j++]);
  }
  function sort(lo, hi) {
    if (lo >= hi) return;
    const mid = Math.floor((lo + hi) / 2);
    sort(lo, mid);
    sort(mid + 1, hi);
    for (let a = lo; a < hi; a++) trace.compare(a, a + 1);
    merge(lo, mid, hi);
  }
  sort(0, trace.length - 1);
}
`;

const DISGUISED_BUBBLE_SORT = `
function run(trace) {
  for (let i = 0; i < trace.length; i++) {
    for (let j = 0; j < trace.length - i - 1; j++) {
      if (trace.compare(j, j + 1) > 0) trace.swap(j, j + 1);
    }
  }
}
`;

const WRONG_RESULT_CODE = `
function run(trace) {
  trace.compare(0, 1);
  // deliberately doesn't sort anything
}
`;

const INFINITE_LOOP_CODE = `
function run(trace) {
  while (true) { trace.compare(0, 0); }
}
`;

const ESCAPE_ATTEMPT_CODE = `
function run(trace) {
  const fs = require("fs");
  trace.set(0, fs.readFileSync("/etc/passwd").length);
}
`;

// Correctly sorts, but never calls trace.compare() — a plain JS operator
// on values already fetched via trace.get() instead. Validator 1 (result
// correctness) passes clean; this exists specifically to exercise
// validator 2, which nothing else here does.
const NO_COMPARE_CODE = `
function run(trace) {
  for (let i = 0; i < trace.length; i++) {
    for (let j = 0; j < trace.length - i - 1; j++) {
      if (trace.get(j) > trace.get(j + 1)) trace.swap(j, j + 1);
    }
  }
}
`;

const INPUT = { array: [38, 27, 43, 3, 9, 82, 10, 15, 22, 5] };

before(resetGeneratedDir);
after(resetGeneratedDir);

// Each test uses a distinct algorithm name, deliberately — a name that
// already succeeded and got cached (by any earlier test, or a previous
// process) hits the fast path (getAlgorithm(key) already set) and runs
// the *cached* implementation directly, ignoring whatever new code a
// later test submits under the same name. Confirmed live while writing
// these: a "wrong result" test reusing "mergeSort" after the first test
// cached a real one didn't reject at all — it silently ran the real
// cached sort against the same input and passed.
//
// This is also why the first test below is named "mergeSortSandboxTest"
// rather than plain "mergeSort": the repo keeps a real, permanently
// committed generated/mergesort.ts example (see README's Algorithms
// section), which algorithms/index.ts imports into the in-memory
// registry at module load — *before* this file's before() hook ever
// runs. A test named "mergeSort" would hit that same fast path against
// the real committed file and never actually exercise the sandbox at
// all (confirmed live: its summary lacked the sorted-result text this
// test asserts on, because the fast path returns the cached file's own
// summary, not a fresh sandbox run's).

test("a correct, properly-instrumented merge sort passes and caches a file", async () => {
  const result = await generateAndValidateAlgorithm({
    name: "mergeSortSandboxTest",
    description: "test fixture",
    code: REAL_MERGE_SORT,
    input: INPUT,
  });
  assert.ok(result.summary.includes("[3, 5, 9, 10, 15, 22, 27, 38, 43, 82]"));
  assert.ok(existsSync(join(GENERATED_DIR, "mergesortsandboxtest.ts")), "expected a cached generated file");
});

// Was a warning-only result until the algorithm agent's retry loop
// (ensureAlgorithm.ts) needed a failed attempt to actually fail — a
// warning that still cached the bad implementation meant a retry's
// second attempt would hit the fast path and get the same bad code
// handed straight back, with no way to ever succeed.
test("a bubble sort submitted as quickSort is rejected by the scaling-based complexity check, not just cached with a warning", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({
      name: "quickSort",
      description: "test fixture — deliberately mislabeled",
      code: DISGUISED_BUBBLE_SORT,
      input: INPUT,
    }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /closer to n²/.test(err.message),
  );
  assert.ok(!existsSync(join(GENERATED_DIR, "quicksort.ts")), "a rejected implementation must not be cached");
});

test("a sort that never calls trace.compare() is rejected even though its result is correct", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({ name: "noCompareSortTest", description: "t", code: NO_COMPARE_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /never called trace\.compare/.test(err.message),
  );
});

test("wrong output fails the result-correctness check, not just a warning", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({ name: "heapSort", description: "t", code: WRONG_RESULT_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /not correctly sorted/.test(err.message),
  );
});

test("an infinite loop is killed and reported as a clean error, not a hang", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({ name: "shellSort", description: "t", code: INFINITE_LOOP_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError,
  );
});

test("code attempting require() is blocked by the sandbox", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({ name: "timSort", description: "t", code: ESCAPE_ATTEMPT_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /require is not defined/.test(err.message),
  );
});

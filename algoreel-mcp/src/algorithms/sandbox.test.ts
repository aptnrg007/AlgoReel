import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { generateAndValidateAlgorithm, GenerateAlgorithmError } from "./sandbox";
import { restoreDir, snapshotDir } from "./testGeneratedDirSnapshot";

const GENERATED_DIR = join(dirname(fileURLToPath(import.meta.url)), "generated");

// Captured once, at import time — before any test in this file (or its
// before() hook) has had a chance to run — so it reflects exactly what's
// really on disk/committed, not a hardcoded assumption. See
// testGeneratedDirSnapshot.ts for why that distinction matters.
const ORIGINAL_GENERATED = snapshotDir(GENERATED_DIR);

function resetGeneratedDir(): void {
  restoreDir(GENERATED_DIR, ORIGINAL_GENERATED);
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
// Type-annotated on both run()'s own parameter and its inner helpers'
// parameters — not just style. A real completion (this project's own
// algorithm.yaml/algorithm-graph.yaml/algorithm-tree.yaml all document
// the exact typed signature) always includes it, and it's structurally
// required for typeCheckGeneratedFile's own noUncheckedIndexedAccess
// check to have any teeth at all: an unannotated `trace` infers as
// implicit `any`, and `any` suppresses every downstream type error,
// including the exact class of bug that check exists to catch.
const REAL_MERGE_SORT = `
function run(trace: TracedArray) {
  function merge(lo: number, mid: number, hi: number) {
    const left = [];
    for (let k = lo; k <= mid; k++) left.push(trace.get(k));
    const right = [];
    for (let k = mid + 1; k <= hi; k++) right.push(trace.get(k));
    let i = 0, j = 0, k = lo;
    while (i < left.length && j < right.length) {
      if (left[i]! <= right[j]!) { trace.set(k++, left[i++]!); } else { trace.set(k++, right[j++]!); }
    }
    while (i < left.length) trace.set(k++, left[i++]!);
    while (j < right.length) trace.set(k++, right[j++]!);
  }
  function sort(lo: number, hi: number) {
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
function run(trace: TracedArray) {
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

// Found live: ensure_algorithm's `description` field is agent-supplied,
// not developer-controlled, and a caller (Claude Sonnet, trying to help
// a weak local model succeed on a hard algorithm) once passed a full
// multi-line pseudocode spec as the description. cacheGeneratedAlgorithm
// used to splice it straight into a single `// ` line comment — every
// line after the first leaked as raw, uncommented top-level text,
// producing a file that passed every validator (they only ever check
// req.code, sandboxed separately) but was syntactically broken TypeScript
// on disk, which then crashed the *next* dynamic import (and, before the
// import-before-manifest-rebuild fix, would have broken the whole
// server's static import chain on next startup). This locks in both
// fixes: the header comment survives a multi-line description, and the
// full text is still recoverable from the DESCRIPTION export.
const MULTILINE_DESCRIPTION = `Bidirectional bubble sort. Exact algorithm:

function cocktailSort(arr):
  sweep forward, then backward, swapping out-of-order neighbors
  repeat until a pass makes no swaps

Test your index arithmetic carefully.`;

test("a multi-line, agent-supplied description doesn't corrupt the cached file", async () => {
  await generateAndValidateAlgorithm({
    name: "multilineDescTest",
    description: MULTILINE_DESCRIPTION,
    code: DISGUISED_BUBBLE_SORT, // any real, correctly-instrumented sort works — this isn't testing correctness
    input: INPUT,
  });
  const filePath = join(GENERATED_DIR, "multilinedesctest.ts");
  assert.ok(existsSync(filePath));
  const contents = readFileSync(filePath, "utf8");
  // Every line of the header (before the first real import statement)
  // must be a comment or blank — the bug produced raw pseudocode
  // statements (e.g. a bare "function cocktailSort(arr):" line) there
  // instead, once the description had more than one line.
  for (const line of contents.split("\n")) {
    if (line.startsWith("import ")) break;
    assert.ok(
      line.trim() === "" || line.trim().startsWith("//"),
      `expected only comments in the header, got: ${JSON.stringify(line)}`,
    );
  }
  // The full multi-line text must still be recoverable, just safely
  // inside a real string literal rather than a broken comment.
  assert.ok(contents.includes(JSON.stringify(MULTILINE_DESCRIPTION)));
});

// Was a warning-only result until the algorithm agent's retry loop
// (ensureAlgorithm.ts) needed a failed attempt to actually fail — a
// warning that still cached the bad implementation meant a retry's
// second attempt would hit the fast path and get the same bad code
// handed straight back, with no way to ever succeed.
//
// Unlike every other fixture name in this file, this one can't be
// renamed to something synthetic — the complexity check is keyed off
// EXPECTED_COMPLEXITY in sandbox.ts, a fixed lookup of real algorithm
// names ("mergesort", "quicksort", "heapsort"), so this test has to use
// one of those to exercise it at all. "heapSort" is currently the least
// likely of the three to ever get a real committed example (mergesort
// succeeds easily; quicksort is a documented model-capability failure —
// see algorithm.yaml — that might get revisited and fixed later, making
// it the worse choice here). If generated/heapsort.ts is ever committed
// for real, rename this fixture the same way "mergeSort" and
// "selectionSort" already had to be (see the comment above the merge
// sort test).
test("a bubble sort submitted as heapSort is rejected by the scaling-based complexity check, not just cached with a warning", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({
      name: "heapSort",
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
    generateAndValidateAlgorithm({ name: "wrongResultSandboxTest", description: "t", code: WRONG_RESULT_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /not correctly sorted/.test(err.message),
  );
});

test("an infinite loop is killed and reported as a clean error, not a hang", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({ name: "infiniteLoopSandboxTest", description: "t", code: INFINITE_LOOP_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError,
  );
});

test("code attempting require() is blocked by the sandbox", async () => {
  await assert.rejects(
    generateAndValidateAlgorithm({ name: "escapeAttemptSandboxTest", description: "t", code: ESCAPE_ATTEMPT_CODE, input: INPUT }),
    (err: unknown) => err instanceof GenerateAlgorithmError && /require is not defined/.test(err.message),
  );
});

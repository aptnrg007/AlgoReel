import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { ensureAlgorithm, EnsureAlgorithmError } from "./ensureAlgorithm";

const GENERATED_DIR = join(dirname(fileURLToPath(import.meta.url)), "generated");
const MANIFEST_PATH = join(GENERATED_DIR, "manifest.ts");

// Same reset as sandbox.test.ts — manifest.ts is a required, committed
// baseline file (algorithms/index.ts has a hard static import on it), so
// only the files it lists get removed, and the manifest itself is
// rewritten back to empty rather than deleted.
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

before(resetGeneratedDir);
after(resetGeneratedDir);

// Correctly instrumented — same pattern sandbox.test.ts's REAL_MERGE_SORT
// uses, kept simple here since these tests are about the retry loop, not
// re-proving the sandbox's own validators.
const GOOD_SELECTION_SORT = `
function run(trace) {
  for (let i = 0; i < trace.length; i++) {
    let min = i;
    for (let j = i + 1; j < trace.length; j++) {
      if (trace.compare(j, min) < 0) min = j;
    }
    if (min !== i) trace.swap(i, min);
  }
}
`;

const BAD_CODE_NO_COMPARE = `
function run(trace) {
  for (let i = 0; i < trace.length; i++) {
    for (let j = 0; j < trace.length - i - 1; j++) {
      if (trace.get(j) > trace.get(j + 1)) trace.swap(j, j + 1);
    }
  }
}
`;

// Each test uses a distinct algorithm name — same fast-path collision
// reason documented in sandbox.test.ts: a name any earlier test already
// cached would short-circuit ensureAlgorithm's registry check before the
// injected generateCode is ever called.

test("a name that's already registered short-circuits with zero generator calls", async () => {
  let calls = 0;
  // "bfs" is one of the 3 hand-written algorithms, always registered.
  const result = await ensureAlgorithm({ algorithm: "bfs" }, { generateCode: async () => (calls++, "") });
  assert.equal(result.alreadyExisted, true);
  assert.equal(result.attempts, 0);
  assert.equal(calls, 0);
});

test("bad code followed by good code succeeds on the second attempt, with the error fed back", async () => {
  const prompts: string[] = [];
  let call = 0;
  const result = await ensureAlgorithm(
    { algorithm: "ensureLoopSelectionSort" },
    {
      generateCode: async (prompt) => {
        prompts.push(prompt);
        call++;
        return call === 1 ? BAD_CODE_NO_COMPARE : GOOD_SELECTION_SORT;
      },
    },
  );
  assert.equal(result.alreadyExisted, false);
  assert.equal(result.attempts, 2);
  assert.equal(prompts.length, 2);
  // The second prompt must carry the first attempt's actual failure back
  // to the model — that feedback loop is the entire point of doing this
  // in TypeScript instead of inside the agent's own turn loop.
  assert.match(prompts[1]!, /never called trace\.compare/);
  assert.match(prompts[1]!, /BAD_CODE_NO_COMPARE|trace\.get\(j\) > trace\.get\(j \+ 1\)/);
  assert.ok(existsSync(join(GENERATED_DIR, "ensureloopselectionsort.ts")));
});

test("three consecutive failures throw with every attempt's error", async () => {
  let calls = 0;
  await assert.rejects(
    ensureAlgorithm(
      { algorithm: "ensureLoopAlwaysBad" },
      {
        generateCode: async () => {
          calls++;
          return BAD_CODE_NO_COMPARE;
        },
      },
    ),
    (err: unknown) => {
      assert.ok(err instanceof EnsureAlgorithmError);
      assert.match(err.message, /attempt 1:/);
      assert.match(err.message, /attempt 2:/);
      assert.match(err.message, /attempt 3:/);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.ok(!existsSync(join(GENERATED_DIR, "ensureloopalwaysbad.ts")), "a never-succeeding name must not be cached");
});

test("structure other than \"array\" is rejected before any code is generated", async () => {
  let calls = 0;
  await assert.rejects(
    ensureAlgorithm({ algorithm: "reverse a linked list", structure: "linkedList" }, { generateCode: async () => (calls++, "") }),
    (err: unknown) => err instanceof EnsureAlgorithmError && /only supports structure: "array"/.test(err.message),
  );
  assert.equal(calls, 0);
});

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { ROOT } from "../config/paths";
import { getAlgorithmByNormalizedName, normalizeAlgorithmName, registerGenerated, type AlgorithmEntry } from "./index";
import { GenerateAlgorithmError, type GenerateAlgorithmResult, runInSandboxRaw, typeCheckGeneratedFile } from "./sandboxCore";
import type { Operation } from "./types";

// Array-family codegen (Phase A, PLAN.md): sorting only — the only class
// with a cheap, unambiguous correctness oracle ("does the result equal
// the array sorted ascending?"). See sandboxGraph.ts/sandboxTree.ts for
// the other two families' different oracle shapes.

const GENERATED_DIR = join(ROOT, "src", "algorithms", "generated");
if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });

export interface GenerateAlgorithmInput {
  name: string;
  description: string;
  code: string; // TypeScript source defining `function run(trace: TracedArray): void`
  input: { array: number[] };
}

// Rough expected compare-count class for names we have real prior
// knowledge of — deliberately small and best-effort. An unrecognized
// name skips this check silently rather than guessing; this exists
// specifically to catch the failure mode that motivated this feature: a
// slower algorithm (e.g. bubble sort) submitted under a faster
// algorithm's name (e.g. "mergeSort"). Normalized to lowercase with
// non-letters stripped before lookup.
const EXPECTED_COMPLEXITY: Record<string, "nlogn"> = {
  mergesort: "nlogn",
  quicksort: "nlogn",
  heapsort: "nlogn",
};

interface SandboxRunResult {
  operations: Operation[];
  result: number[];
}

function runInSandbox(transpiledCode: string, array: number[]): Promise<SandboxRunResult> {
  return runInSandboxRaw<SandboxRunResult>({ kind: "array", code: transpiledCode, array });
}

export async function generateAndValidateAlgorithm(req: GenerateAlgorithmInput): Promise<GenerateAlgorithmResult> {
  const key = normalizeAlgorithmName(req.name);
  if (!key) throw new GenerateAlgorithmError("algorithm name must not be empty");

  // Registry entries are last-write-wins (registry.set) — without this
  // guard, generated code named e.g. "binarySearch" would silently
  // replace the hand-written, trusted implementation of that name.
  // Compared by normalized name on both sides (getAlgorithmByNormalizedName),
  // not a plain registry.get(key) — hand-written entries are registered
  // under their real camelCase name, not a normalized one, so a plain
  // lookup by the normalized key missed every hand-written collision
  // except "bfs" (found live while building the algorithm agent).
  const existing = getAlgorithmByNormalizedName(key);
  if (existing && !existing.generated) {
    throw new GenerateAlgorithmError(
      `"${req.name}" collides with an existing hand-written algorithm — call list_algorithms and use it directly instead of generating a new one under the same name.`,
    );
  }

  // Fast path: this name was already generated, validated, and cached in
  // a previous run (or earlier in this same process) — run the trusted
  // cached implementation directly instead of re-sandboxing submitted
  // code. Every request for the same algorithm after the first is then
  // exactly as deterministic and fast as a hand-written one.
  if (existing) {
    const result = existing.run(req.input as never);
    return {
      operations: result.operations,
      summary: result.summary,
    };
  }

  let transpiled: string;
  try {
    transpiled = esbuild.transformSync(req.code, { loader: "ts" }).code;
  } catch (err) {
    throw new GenerateAlgorithmError(`code does not compile as TypeScript: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = await runInSandbox(transpiled, req.input.array);

  // Validator 1: result correctness. Phase A only supports "sorts a
  // number array" — the only class with a cheap, unambiguous oracle.
  const expectedSorted = [...req.input.array].sort((a, b) => a - b);
  if (JSON.stringify(parsed.result) !== JSON.stringify(expectedSorted)) {
    throw new GenerateAlgorithmError(
      `the algorithm's output is not correctly sorted — got [${parsed.result.join(", ")}], expected [${expectedSorted.join(", ")}]. Fix the implementation, don't just relabel it.`,
    );
  }

  // Validator 2: every real comparison must go through trace.compare(),
  // not a raw < or > on values already fetched with trace.get(). A sort
  // that skips it still produces a correctly sorted result (validator 1
  // passes clean) but the rendered video shows zero comparison
  // highlights — silently boring rather than visibly broken. Both
  // server.ts and script.yaml warned about this in prose only; nothing
  // actually enforced it before the algorithm agent's retry loop made a
  // small model's tendency to skip instrumentation a real, live problem.
  const compareCount = parsed.operations.filter((o) => o.type === "compare").length;
  if (compareCount === 0) {
    throw new GenerateAlgorithmError(
      `the algorithm never called trace.compare() — it produced a correct result, but the video would show zero comparison highlights. Route every real comparison through trace.compare(i, j), even if the actual decision is made on local copies (e.g. in a merge step).`,
    );
  }

  // Validator 3: complexity-class sanity, by *measured growth rate*, not
  // a single-point threshold. At the small n this project actually uses
  // (5-10 elements for a 30s video), n·log(n) and n² haven't diverged
  // enough for any fixed multiplier on one run's compare count to
  // reliably tell them apart — confirmed live: a real bubble sort at
  // n=10 (45 compares) sat comfortably under a "generous 4x" n·log(n)
  // bound (133), the exact false negative this check exists to prevent.
  // Instead, run the *same* code again against a synthetically larger
  // array and compare how the compare-count actually grew against how
  // each candidate complexity class predicts it should grow — n·log(n)
  // vs n² pull apart sharply once n has room to grow, regardless of
  // constant factors.
  //
  // This used to be a warning that still let the file get cached. Now
  // fatal, by necessity: the algorithm agent's retry loop (ensureAlgorithm.ts)
  // needs a failed attempt to actually fail — a warning that still cached
  // the bad implementation meant attempt 2 would hit the fast path above
  // and get the same bad code handed straight back, with no way to retry.
  const expectedClass = EXPECTED_COMPLEXITY[key];
  if (expectedClass === "nlogn") {
    const n1 = req.input.array.length;
    const compareCount1 = compareCount;
    if (n1 >= 2 && compareCount1 > 0) {
      const n2 = Math.max(n1 * 4, 40);
      const syntheticArray = Array.from({ length: n2 }, (_, i) => n2 - i); // worst-case-ish: descending
      const scaled = await runInSandbox(transpiled, syntheticArray);
      const compareCount2 = scaled.operations.filter((o) => o.type === "compare").length;

      const nlognRatio = (n2 * Math.log2(n2)) / (n1 * Math.log2(n1));
      const n2Ratio = (n2 / n1) ** 2;
      const actualRatio = compareCount2 / compareCount1;
      // Geometric mean of the two candidate ratios: closer to whichever
      // model actually matches, regardless of the absolute scale.
      const midpoint = Math.sqrt(nlognRatio * n2Ratio);

      if (actualRatio > midpoint) {
        throw new GenerateAlgorithmError(
          `"${req.name}" is expected to scale like n·log(n) (~${nlognRatio.toFixed(1)}x when n grows from ${n1} to ${n2}), but its compare count actually grew ~${actualRatio.toFixed(1)}x — much closer to n² (~${n2Ratio.toFixed(1)}x). This is almost certainly a slower algorithm (e.g. bubble/selection/insertion sort) mislabeled as ${req.name}. Implement the real ${req.name} algorithm, don't just relabel a simpler one.`,
        );
      }
    }
  }

  // Any file already sitting at this path is untrusted debris, not a
  // trusted cache — if it were trusted, manifest.ts would already
  // reference it, which means it would already have been registered at
  // module load, which means `existing` above would have been truthy and
  // returned already. The only way to reach this line with a file
  // already here is a previous attempt that wrote it but never got as
  // far as registering it (a crash, a Ctrl+C, or — the case that
  // motivated this comment — an import failure below). Always overwrite
  // it rather than trying to preserve it.
  const filePath = join(GENERATED_DIR, `${key}.ts`);
  await cacheGeneratedAlgorithm(req, key, filePath);

  // Real type-check, not just "does it transpile" — see
  // typeCheckGeneratedFile's own comment (sandboxCore.ts). Checked (and
  // cleaned up on failure, same as the import step below) before the
  // dynamic import, since there's no point importing something that
  // fails the project's own tsc --noEmit regardless of whether the
  // import itself succeeds.
  try {
    typeCheckGeneratedFile(filePath);
  } catch (err) {
    rmSync(filePath, { force: true });
    throw err;
  }

  // Load the file we just wrote and register it in-memory directly —
  // this dynamic import is fine here (unlike algorithms/index.ts, this
  // file is never reachable from Remotion's webpack-bundled render path,
  // only from server.ts's plain Node process), and means a second
  // request for the same algorithm within this same process also skips
  // the sandbox, not just after the next restart's static manifest load.
  //
  // Done BEFORE rebuildManifest() and wrapped in a try/catch, not after —
  // found live: a bug in cacheGeneratedAlgorithm's template once produced
  // a syntactically broken file (see that function's comment) that still
  // passed every validator above (they only ever check req.code, sandboxed
  // separately, never the cached file's own text). rebuildManifest() had
  // already added a static import of it by the time this import failed,
  // which is a much worse state to be in: a broken import in manifest.ts
  // breaks the *entire* server at startup, not just this one algorithm.
  // Importing first means a broken file is caught and deleted before
  // manifest.ts ever learns it exists, so the next attempt starts clean.
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(filePath).href);
  } catch (err) {
    rmSync(filePath, { force: true });
    throw new GenerateAlgorithmError(
      `generated code passed every check but the cached file itself failed to load: ${err instanceof Error ? err.message : String(err)}. This is a caching bug, not a problem with the algorithm — please retry.`,
    );
  }
  const run = mod[key];
  if (typeof run === "function") {
    rebuildManifest();
    registerGenerated(key, req.description, run as AlgorithmEntry["run"]);
  }

  return {
    operations: parsed.operations,
    summary: `Ran the generated "${req.name}" implementation on ${req.input.array.length} elements; result: [${parsed.result.join(", ")}].`,
  };
}

async function cacheGeneratedAlgorithm(req: GenerateAlgorithmInput, key: string, filePath: string): Promise<void> {
  // The header comment gets only a short excerpt, not the full
  // description verbatim — found live: an agent-supplied description can
  // be arbitrarily long and multi-line (a caller once passed a full
  // pseudocode algorithm spec, hundreds of words, to help a weak model
  // succeed on a hard one), and splicing that into a single `// ` prefix
  // left every line after the first as raw, uncommented top-level text —
  // syntactically broken TypeScript that still got cached, because this
  // function has no way to validate its own template output. The full
  // text is never lost — it's always in the DESCRIPTION export below, a
  // real JS string literal via JSON.stringify, safe with newlines by
  // construction.
  const firstLine = req.description.split("\n")[0]!.trim();
  const excerpt = firstLine.length > 300 ? `${firstLine.slice(0, 300)}...` : firstLine;
  const headerComment = excerpt.replace(/\*\//g, "*\\/");
  const contents = `// AUTO-GENERATED and validated by AlgoReel's codegen path
// (algoreel-mcp/src/algorithms/sandboxArray.ts) on ${new Date().toISOString()}.
// ${headerComment}
//
// Validated once via sandboxed execution (result-correctness +
// complexity-class checks — see sandboxArray.ts) before being cached
// here. From this point on it's a real, permanent algorithm file, run
// in-process like any hand-written one — no further sandboxing on load.
import { createTracedArray } from "../trace";
import type { AlgorithmResult } from "../types";
import type { TracedArray } from "../trace";

export const DESCRIPTION = ${JSON.stringify(req.description)};

export interface GeneratedInput {
  array: number[];
}

${req.code}

export function ${key}({ array }: GeneratedInput): AlgorithmResult {
  const { trace, operations } = createTracedArray(array);
  run(trace);
  return { operations, summary: "Ran the generated \\"${req.name}\\" implementation on " + array.length + " elements." };
}
`;
  // Re-ensured here, not just at module load — a test (or a long-running
  // process) that clears the directory shouldn't take down every
  // subsequent generation attempt.
  if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(filePath, contents);
}

// Regenerates generated/manifest.ts in full from whatever .ts files
// currently exist in this directory — see manifest.ts's own header
// comment for why this has to be static imports rather than the runtime
// directory scan an earlier version of this used (broke every Remotion
// render — see that comment for the exact error).
function rebuildManifest(): void {
  const keys = readdirSync(GENERATED_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "manifest.ts")
    .map((f) => f.replace(/\.ts$/, ""));

  const imports = keys.map((k) => `import { ${k}, DESCRIPTION as ${k}_DESCRIPTION } from "./${k}";`).join("\n");
  const entries = keys.map((k) => `  ${k}: { description: ${k}_DESCRIPTION, run: ${k} },`).join("\n");

  const contents = `// AUTO-MAINTAINED by sandboxArray.ts — regenerated in full every time a
// new algorithm is generated and cached, listing every file in this
// directory as a plain static import.
//
// This has to be static imports, not a runtime directory scan
// (readdirSync + dynamic import()) — algorithms/index.ts, which imports
// this file, is also on Remotion's render path (remotion/buildTimeline.ts
// -> algorithms/index.ts -> runAlgorithm), and that path gets bundled by
// webpack for execution inside a headless-Chrome context, not plain
// Node. Confirmed live: adding Node fs/dynamic-import to that shared
// module broke every render with "UnhandledSchemeError: Reading from
// 'node:fs' is not handled by plugins" — a browser-context bundle simply
// can't include Node builtins, and can't resolve a dynamic import()
// whose path isn't known until runtime either. A plain object of static
// imports is something webpack (and Node/tsx) can both bundle exactly
// the same way, so a generated algorithm works identically whether it's
// the long-lived MCP server or a fresh \`npx remotion render\` process
// that needs it.
import type { AlgorithmResult } from "../types";

export interface GeneratedManifestEntry {
  description: string;
  run: (input: { array: number[] }) => AlgorithmResult;
}

${imports}

export const GENERATED: Record<string, GeneratedManifestEntry> = {
${entries}
};
`;
  writeFileSync(join(GENERATED_DIR, "manifest.ts"), contents);
}

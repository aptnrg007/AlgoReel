import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import {
  getAlgorithmByNormalizedName,
  normalizeAlgorithmName,
  registerGenerated,
  registerGeneratedGraph,
  type AlgorithmEntry,
} from "./index";
import type { Operation } from "./types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER_PATH = join(ROOT, "src", "algorithms", "sandboxRunner.js");
const GENERATED_DIR = join(ROOT, "src", "algorithms", "generated");
if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
// Kept separate from GENERATED_DIR, not mixed in — rebuildManifest() below
// treats every .ts file in GENERATED_DIR as array-shaped; a graph-shaped
// file sitting in the same directory would get silently (and wrongly)
// imported into the array manifest by that logic. See rebuildGraphManifest's
// own comment for the graph-side equivalent.
const GENERATED_GRAPH_DIR = join(ROOT, "src", "algorithms", "generated-graph");
if (!existsSync(GENERATED_GRAPH_DIR)) mkdirSync(GENERATED_GRAPH_DIR, { recursive: true });

export interface GenerateAlgorithmInput {
  name: string;
  description: string;
  code: string; // TypeScript source defining `function run(trace: TracedArray): void`
  input: { array: number[] };
}

export interface GenerateAlgorithmResult {
  operations: Operation[];
  summary: string;
}

export class GenerateAlgorithmError extends Error {}

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

// Runs generated code in an isolated child process (PLAN.md's Phase A
// codegen redesign): the LLM never emits an Operation directly, it
// writes ordinary code against the TracedArray contract (trace.ts), and
// this function is the only thing that actually executes it — the
// operation log is a mechanical record of real execution, not something
// the model had to get right by construction. Two independent
// isolation layers, both confirmed live against this Node version: the
// child is spawned with `--permission` and no --allow-fs-* flags (blocks
// filesystem access at the runtime level even if the vm sandbox below
// had a gap), and inside the child, vm.Script's `timeout` option
// genuinely aborts a synchronous infinite loop (V8's execution-interrupt
// mechanism), not just a cooperative check.
interface SandboxRunResult {
  operations: Operation[];
  result: number[];
}

// No --allow-fs-* flags at all — the runner talks over stdin/stdout
// only, never touches the filesystem, so the permission model can stay
// at its strictest (deny everything) rather than carving out an
// allowance nothing actually needs. Confirmed live: node's own
// bootstrap loading of the entry script file doesn't require
// --allow-fs-read itself; that flag only gates fs *calls* made by JS
// code after startup.
//
// Uses spawn(), not execFile() — execFile's `input` option only exists
// on the *Sync variant; the async one silently ignores it, so stdin
// must be written and closed by hand (found live: without this, the
// child hangs waiting for stdin it's never given).
function runInSandbox(transpiledCode: string, array: number[]): Promise<SandboxRunResult> {
  return runInSandboxRaw<SandboxRunResult>({ kind: "array", code: transpiledCode, array });
}

interface GraphSandboxRunResult {
  operations: Operation[];
}

function runInSandboxGraph(
  transpiledCode: string,
  nodes: string[],
  edges: [string, string][],
  start: string,
): Promise<GraphSandboxRunResult> {
  return runInSandboxRaw<GraphSandboxRunResult>({ kind: "graph", code: transpiledCode, nodes, edges, start });
}

// Shared subprocess mechanics for both sandbox kinds (array and graph) —
// sandboxRunner.js branches on `payload.kind` internally; this function
// is just the parent-side spawn/stdin/stdout plumbing, identical either
// way.
function runInSandboxRaw<T>(payload: Record<string, unknown>): Promise<T> {
  const stdinPayload = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--permission", RUNNER_PATH], {
      env: {}, // no inherited secrets — the sandbox never sees .env
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    const killTimer = setTimeout(() => child.kill("SIGKILL"), 8_000); // headroom over the runner's own 5s vm timeout

    child.on("error", (spawnErr) => {
      clearTimeout(killTimer);
      reject(new GenerateAlgorithmError(`failed to start sandbox: ${spawnErr.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        let message = out || err || `sandbox exited with code ${code}`;
        try {
          message = JSON.parse(out).error ?? message;
        } catch {
          // out wasn't JSON — keep the fallback message above.
        }
        reject(new GenerateAlgorithmError(`sandboxed execution failed: ${message}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new GenerateAlgorithmError(`sandbox produced unparseable output: ${out.slice(0, 500)}`));
      }
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
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
// (algoreel-mcp/src/algorithms/sandbox.ts) on ${new Date().toISOString()}.
// ${headerComment}
//
// Validated once via sandboxed execution (result-correctness +
// complexity-class checks — see sandbox.ts) before being cached here.
// From this point on it's a real, permanent algorithm file, run
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

  const contents = `// AUTO-MAINTAINED by sandbox.ts — regenerated in full every time a new
// algorithm is generated and cached, listing every file in this
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

// --- Graph traversal codegen (bfs/dfs family) -------------------------
//
// Array codegen's whole safety net is one cheap, universal oracle: "does
// the result equal the array sorted ascending?" No single check like
// that exists for structures in general. But BFS and DFS are each fully
// deterministic given a fixed neighbor tie-break (sorted ascending —
// graphTrace.ts's TracedGraph.neighbors() and bfs.ts's own adjacency
// lists both already use this), so the harness can compute the *one
// correct answer* independently and compare exactly — the same shape as
// arrays' sort reference, just for this family.

export interface GenerateGraphAlgorithmInput {
  name: string;
  description: string;
  code: string; // TypeScript source defining `function run(trace: TracedGraph): void`
  input: { nodes: string[]; edges: [string, string][]; start: string };
}

function buildAdjacency(nodes: string[], edges: [string, string][]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const [a, b] of edges) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  for (const list of adjacency.values()) list.sort();
  return adjacency;
}

function referenceBFSOrder(nodes: string[], edges: [string, string][], start: string): string[] {
  const adjacency = buildAdjacency(nodes, edges);
  const visited = new Set([start]);
  const queue = [start];
  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adjacency.get(node)!) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return order;
}

function referenceDFSOrder(nodes: string[], edges: [string, string][], start: string): string[] {
  const adjacency = buildAdjacency(nodes, edges);
  const visited = new Set<string>();
  const order: string[] = [];
  function visit(node: string): void {
    visited.add(node);
    order.push(node);
    for (const neighbor of adjacency.get(node)!) {
      if (!visited.has(neighbor)) visit(neighbor);
    }
  }
  visit(start);
  return order;
}

// Keyed by normalized name (normalizeAlgorithmName) — a name that
// doesn't match either family is rejected immediately, before any
// sandbox run at all. Mechanically enforced this time, unlike array
// codegen's "linear search" case (sandbox.ts has no cheap way to detect
// "this is a search" from a name string alone) — "is this bfs or dfs" is
// exactly checkable up front.
const GRAPH_REFERENCE: Record<string, (nodes: string[], edges: [string, string][], start: string) => string[]> = {
  bfs: referenceBFSOrder,
  breadthfirstsearch: referenceBFSOrder,
  dfs: referenceDFSOrder,
  depthfirstsearch: referenceDFSOrder,
};

export async function generateAndValidateGraphAlgorithm(req: GenerateGraphAlgorithmInput): Promise<GenerateAlgorithmResult> {
  const key = normalizeAlgorithmName(req.name);
  if (!key) throw new GenerateAlgorithmError("algorithm name must not be empty");

  // Same collision guard as the array path — never let generated code
  // silently replace a trusted hand-written entry of the same name
  // (e.g. the real bfs.ts).
  const existing = getAlgorithmByNormalizedName(key);
  if (existing && !existing.generated) {
    throw new GenerateAlgorithmError(
      `"${req.name}" collides with an existing hand-written algorithm — call list_algorithms and use it directly instead of generating a new one under the same name.`,
    );
  }
  if (existing) {
    const result = existing.run(req.input as never);
    return { operations: result.operations, summary: result.summary };
  }

  const reference = GRAPH_REFERENCE[key];
  if (!reference) {
    throw new GenerateAlgorithmError(
      `"${req.name}" isn't a graph traversal this codegen path knows how to validate — it only supports "bfs" and "dfs" ` +
        `(by name), since both have one deterministic correct answer to check against. Anything else (Dijkstra, MST, ` +
        `weighted graphs, ...) isn't covered.`,
    );
  }

  let transpiled: string;
  try {
    transpiled = esbuild.transformSync(req.code, { loader: "ts" }).code;
  } catch (err) {
    throw new GenerateAlgorithmError(`code does not compile as TypeScript: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { nodes, edges, start } = req.input;
  const parsed = await runInSandboxGraph(transpiled, nodes, edges, start);

  // Validator 1: order correctness. The visit order is derived
  // mechanically from the operation log itself (every "focus" nodeState,
  // in order) — the same way compareCount is derived from the array
  // path's operations, rather than trusting a separately-reported value.
  // An exact match against the reference's order implies both "visited
  // every reachable node" and "visited them in the right order" at once.
  const actualOrder = parsed.operations
    .filter((op): op is Extract<Operation, { type: "nodeState" }> => op.type === "nodeState" && op.state === "focus")
    .flatMap((op) => op.nodes);
  const expectedOrder = reference(nodes, edges, start);
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    throw new GenerateAlgorithmError(
      `"${req.name}" produced visit order [${actualOrder.join(", ")}], but the correct ${req.name} order from "${start}" ` +
        `is [${expectedOrder.join(", ")}]. Fix the traversal logic, don't just relabel a different one.`,
    );
  }

  // Validator 2: every real edge traversal must go through
  // trace.traverseEdge(), not just trace.visit() on its own — a
  // traversal that gets the right order without ever calling it would
  // still pass validator 1 but render with zero edge highlights.
  const edgeUsedCount = parsed.operations.filter((o) => o.type === "linkState" && o.state === "active").length;
  if (edgeUsedCount === 0 && edges.length > 0) {
    throw new GenerateAlgorithmError(
      `"${req.name}" never called trace.traverseEdge() — it produced the correct visit order, but the video would show ` +
        `zero edge highlights. Call it every time you move to a new node along a real edge.`,
    );
  }

  const filePath = join(GENERATED_GRAPH_DIR, `${key}.ts`);
  await cacheGeneratedGraphAlgorithm(req, key, filePath);

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
    rebuildGraphManifest();
    registerGeneratedGraph(key, req.description, run as AlgorithmEntry["run"]);
  }

  return {
    operations: parsed.operations,
    summary: `Ran the generated "${req.name}" implementation from "${start}"; visited: [${actualOrder.join(", ")}].`,
  };
}

async function cacheGeneratedGraphAlgorithm(req: GenerateGraphAlgorithmInput, key: string, filePath: string): Promise<void> {
  const firstLine = req.description.split("\n")[0]!.trim();
  const excerpt = firstLine.length > 300 ? `${firstLine.slice(0, 300)}...` : firstLine;
  const headerComment = excerpt.replace(/\*\//g, "*\\/");
  const contents = `// AUTO-GENERATED and validated by AlgoReel's codegen path
// (algoreel-mcp/src/algorithms/sandbox.ts) on ${new Date().toISOString()}.
// ${headerComment}
//
// Validated once via sandboxed execution against a real bfs/dfs
// reference (see sandbox.ts's referenceBFSOrder/referenceDFSOrder)
// before being cached here. From this point on it's a real, permanent
// algorithm file, run in-process like any hand-written one — no further
// sandboxing on load.
import { createTracedGraph } from "../graphTrace";
import type { AlgorithmResult } from "../types";
import type { TracedGraph } from "../graphTrace";

export const DESCRIPTION = ${JSON.stringify(req.description)};

export interface GeneratedGraphInput {
  nodes: string[];
  edges: [string, string][];
  start: string;
}

${req.code}

export function ${key}({ nodes, edges, start }: GeneratedGraphInput): AlgorithmResult {
  const { trace, operations } = createTracedGraph(nodes, edges, start);
  run(trace);
  return { operations, summary: "Ran the generated \\"${req.name}\\" implementation from \\"" + start + "\\"." };
}
`;
  if (!existsSync(GENERATED_GRAPH_DIR)) mkdirSync(GENERATED_GRAPH_DIR, { recursive: true });
  writeFileSync(filePath, contents);
}

// Graph-side twin of rebuildManifest() — same static-import constraint
// (Remotion's webpack render path can't resolve node:fs or a runtime
// import()), kept in a fully separate directory/manifest so this scan
// never has to reason about array-shaped files living alongside it.
function rebuildGraphManifest(): void {
  const keys = readdirSync(GENERATED_GRAPH_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "manifest.ts")
    .map((f) => f.replace(/\.ts$/, ""));

  const imports = keys.map((k) => `import { ${k}, DESCRIPTION as ${k}_DESCRIPTION } from "./${k}";`).join("\n");
  const entries = keys.map((k) => `  ${k}: { description: ${k}_DESCRIPTION, run: ${k} },`).join("\n");

  const contents = `// AUTO-MAINTAINED by sandbox.ts — regenerated in full every time a new
// graph algorithm is generated and cached, listing every file in this
// directory as a plain static import. See generated/manifest.ts's own
// comment for why static imports are required at all; this is the
// graph-shaped twin, kept in its own directory so this scan never mixes
// in an array-shaped file.
import type { AlgorithmResult } from "../types";

export interface GeneratedGraphManifestEntry {
  description: string;
  run: (input: { nodes: string[]; edges: [string, string][]; start: string }) => AlgorithmResult;
}

${imports}

export const GENERATED_GRAPH: Record<string, GeneratedGraphManifestEntry> = {
${entries}
};
`;
  writeFileSync(join(GENERATED_GRAPH_DIR, "manifest.ts"), contents);
}

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { ROOT } from "../config/paths";
import { getAlgorithmByNormalizedName, normalizeAlgorithmName, registerGeneratedGraph, type AlgorithmEntry } from "./index";
import { GenerateAlgorithmError, type GenerateAlgorithmResult, runInSandboxRaw, typeCheckGeneratedFile } from "./sandboxCore";
import type { Operation } from "./types";

// Graph traversal codegen (bfs/dfs family) —
//
// Array codegen's whole safety net is one cheap, universal oracle: "does
// the result equal the array sorted ascending?" No single check like
// that exists for structures in general. But BFS and DFS are each fully
// deterministic given a fixed neighbor tie-break (sorted ascending —
// graphTrace.ts's TracedGraph.neighbors() and bfs.ts's own adjacency
// lists both already use this), so the harness can compute the *one
// correct answer* independently and compare exactly — the same shape as
// arrays' sort reference, just for this family.

// Kept separate from array codegen's GENERATED_DIR, not mixed in —
// rebuildGraphManifest() below treats every .ts file in this directory as
// graph-shaped; an array-shaped file sitting in the same directory would
// get silently (and wrongly) imported into the graph manifest by that
// logic. See sandboxTree.ts's own comment for the tree-side equivalent.
const GENERATED_GRAPH_DIR = join(ROOT, "src", "algorithms", "generated-graph");
if (!existsSync(GENERATED_GRAPH_DIR)) mkdirSync(GENERATED_GRAPH_DIR, { recursive: true });

export interface GenerateGraphAlgorithmInput {
  name: string;
  description: string;
  code: string; // TypeScript source defining `function run(trace: TracedGraph): void`
  input: { nodes: string[]; edges: [string, string][]; start: string };
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
// codegen's "linear search" case (sandboxArray.ts has no cheap way to
// detect "this is a search" from a name string alone) — "is this bfs or
// dfs" is exactly checkable up front.
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

  // Real type-check — see typeCheckGeneratedFile's own comment
  // (sandboxCore.ts) and sandboxArray.ts's identical use of it.
  try {
    typeCheckGeneratedFile(filePath);
  } catch (err) {
    rmSync(filePath, { force: true });
    throw err;
  }

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
// (algoreel-mcp/src/algorithms/sandboxGraph.ts) on ${new Date().toISOString()}.
// ${headerComment}
//
// Validated once via sandboxed execution against a real bfs/dfs
// reference (see sandboxGraph.ts's referenceBFSOrder/referenceDFSOrder)
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

// Graph-side twin of sandboxArray.ts's rebuildManifest() — same
// static-import constraint (Remotion's webpack render path can't resolve
// node:fs or a runtime import()), kept in a fully separate
// directory/manifest so this scan never has to reason about array-shaped
// files living alongside it.
function rebuildGraphManifest(): void {
  const keys = readdirSync(GENERATED_GRAPH_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "manifest.ts")
    .map((f) => f.replace(/\.ts$/, ""));

  const imports = keys.map((k) => `import { ${k}, DESCRIPTION as ${k}_DESCRIPTION } from "./${k}";`).join("\n");
  const entries = keys.map((k) => `  ${k}: { description: ${k}_DESCRIPTION, run: ${k} },`).join("\n");

  const contents = `// AUTO-MAINTAINED by sandboxGraph.ts — regenerated in full every time a
// new graph algorithm is generated and cached, listing every file in this
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

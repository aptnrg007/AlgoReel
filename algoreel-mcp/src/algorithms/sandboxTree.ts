import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { ROOT } from "../config/paths";
import { isOrderedBst, isSameMultiset, structSnapshotFromTrace } from "./invariants";
import { getAlgorithmByNormalizedName, normalizeAlgorithmName, registerGeneratedTree, type AlgorithmEntry } from "./index";
import { GenerateAlgorithmError, type GenerateAlgorithmResult, runInSandboxRaw, typeCheckGeneratedFile } from "./sandboxCore";
import type { Operation } from "./types";

// BST insertion codegen (tree family) —
//
// Array codegen's oracle is "does the result equal the array sorted
// ascending?"; graph codegen's is "does the visit order equal a real
// bfs/dfs reference?" — both compare against one computed correct
// answer. This family uses a different kind of check, found and
// validated in invariants.ts before being wired in here: isOrderedBst +
// isSameMultiset are *structural* — they check the shape the trace ended
// up in, not whether it matches one specific reference run of "the"
// correct insertion order. Any code that produces a valid, ordered BST
// containing exactly the input values passes, regardless of exactly how
// it walked down to place each one. See invariants.ts's header comment
// for the honest limits of this approach on other families (it doesn't
// generalize to order-sensitive traversals like bfs/dfs — that's exactly
// why sandboxGraph.ts still uses a reference order).

// Same isolation reasoning as sandboxGraph.ts's GENERATED_GRAPH_DIR — kept
// in its own directory so rebuildTreeManifest()'s scan never mixes in an
// array- or graph-shaped file.
const GENERATED_TREE_DIR = join(ROOT, "src", "algorithms", "generated-tree");
if (!existsSync(GENERATED_TREE_DIR)) mkdirSync(GENERATED_TREE_DIR, { recursive: true });

export interface GenerateTreeAlgorithmInput {
  name: string;
  description: string;
  code: string; // TypeScript source defining `function run(trace: TracedTree): void`
  input: { values: number[] };
}

interface TreeSandboxRunResult {
  operations: Operation[];
}

function runInSandboxTree(transpiledCode: string, values: number[]): Promise<TreeSandboxRunResult> {
  return runInSandboxRaw<TreeSandboxRunResult>({ kind: "tree", code: transpiledCode, values });
}

// Only "bstinsert" (by normalized name) is accepted — mechanically
// enforced, the same way GRAPH_REFERENCE only accepts "bfs"/"dfs" by
// name. Unlike that lookup, this isn't picking between multiple
// reference functions — isOrderedBst/isSameMultiset are shape checks
// with no algorithm-specific parameters — but the name is still checked
// up front so a request for something this contract can't express
// (deletion, rotation, a non-BST tree) fails immediately, honestly,
// before ever running a sandbox, instead of silently accepting whatever
// happens to produce an ordered tree.
const TREE_SUPPORTED_NAMES = new Set(["bstinsert", "binarysearchtreeinsert", "binarysearchtreeinsertion"]);

export async function generateAndValidateTreeAlgorithm(req: GenerateTreeAlgorithmInput): Promise<GenerateAlgorithmResult> {
  const key = normalizeAlgorithmName(req.name);
  if (!key) throw new GenerateAlgorithmError("algorithm name must not be empty");

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

  if (!TREE_SUPPORTED_NAMES.has(key)) {
    throw new GenerateAlgorithmError(
      `"${req.name}" isn't a tree algorithm this codegen path knows how to validate — it only supports building a ` +
        `binary search tree by inserting values one at a time ("bstInsert"). Deletion, rotation, AVL/red-black ` +
        `rebalancing, and any non-BST tree shape aren't covered.`,
    );
  }

  let transpiled: string;
  try {
    transpiled = esbuild.transformSync(req.code, { loader: "ts" }).code;
  } catch (err) {
    throw new GenerateAlgorithmError(`code does not compile as TypeScript: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { values } = req.input;
  const parsed = await runInSandboxTree(transpiled, values);

  // Validator 1: shape correctness — no reference implementation of "the"
  // correct insertion order, just the two structural invariants a real
  // BST must satisfy regardless of strategy (invariants.ts).
  const snapshot = structSnapshotFromTrace(parsed.operations);
  if (!isOrderedBst(snapshot)) {
    throw new GenerateAlgorithmError(
      `"${req.name}" produced a tree that isn't a valid binary search tree — every node's entire left subtree must ` +
        `be strictly less than it, and its entire right subtree strictly greater. Fix the comparison/attachment ` +
        `logic, don't just relabel a different structure.`,
    );
  }
  const finalValues = snapshot.nodes.map((n) => Number(n.value));
  if (!isSameMultiset(values, finalValues)) {
    throw new GenerateAlgorithmError(
      `"${req.name}" produced a tree containing [${finalValues.join(", ")}], but every one of the input values ` +
        `[${values.join(", ")}] must appear exactly once. A node was dropped, duplicated, or invented.`,
    );
  }

  // Validator 2: every real comparison must go through trace.focus() while
  // walking down — a submission that reaches the right final shape without
  // ever calling it still passes validator 1 (the shape is a pure function
  // of value order, not of what got animated) but the video would show
  // zero walk-down highlights before each node settles. Every insertRoot/
  // insertChild call also emits one "focus" as part of settling
  // (treeTrace.ts), so any focus beyond that count is a real, standalone
  // trace.focus() call made during descent.
  const focusCount = parsed.operations.filter((o) => o.type === "nodeState" && o.state === "focus").length;
  const standaloneFocusCount = focusCount - values.length;
  if (values.length > 1 && standaloneFocusCount <= 0) {
    throw new GenerateAlgorithmError(
      `"${req.name}" never called trace.focus() while walking down comparing — it produced a correct tree, but the ` +
        `video would show no comparison highlights before each node settles. Call trace.focus(node) on every node ` +
        `you compare against while deciding which way to go.`,
    );
  }

  const filePath = join(GENERATED_TREE_DIR, `${key}.ts`);
  await cacheGeneratedTreeAlgorithm(req, key, filePath);

  // Real type-check — see typeCheckGeneratedFile's own comment
  // (sandboxCore.ts). This is the exact path where the gap was found
  // live: this file's own TracedTree.values being a plain readonly array
  // makes trace.values[i] a natural thing for a model to write, and
  // esbuild's transpile-only compile check above never catches the
  // resulting noUncheckedIndexedAccess violation.
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
    rebuildTreeManifest();
    registerGeneratedTree(key, req.description, run as AlgorithmEntry["run"]);
  }

  return {
    operations: parsed.operations,
    summary: `Ran the generated "${req.name}" implementation on ${values.length} values; final tree contains: [${finalValues.join(", ")}].`,
  };
}

async function cacheGeneratedTreeAlgorithm(req: GenerateTreeAlgorithmInput, key: string, filePath: string): Promise<void> {
  const firstLine = req.description.split("\n")[0]!.trim();
  const excerpt = firstLine.length > 300 ? `${firstLine.slice(0, 300)}...` : firstLine;
  const headerComment = excerpt.replace(/\*\//g, "*\\/");
  const contents = `// AUTO-GENERATED and validated by AlgoReel's codegen path
// (algoreel-mcp/src/algorithms/sandboxTree.ts) on ${new Date().toISOString()}.
// ${headerComment}
//
// Validated once via sandboxed execution against invariants.ts's
// isOrderedBst/isSameMultiset (no reference implementation — see
// sandboxTree.ts's own header comment) before being cached here. From
// this point on it's a real, permanent algorithm file, run in-process
// like any hand-written one — no further sandboxing on load.
import { createTracedTree } from "../treeTrace";
import type { AlgorithmResult } from "../types";
import type { TracedTree } from "../treeTrace";

export const DESCRIPTION = ${JSON.stringify(req.description)};

export interface GeneratedTreeInput {
  values: number[];
}

${req.code}

export function ${key}({ values }: GeneratedTreeInput): AlgorithmResult {
  const { trace, operations } = createTracedTree(values);
  run(trace);
  return { operations, summary: "Ran the generated \\"${req.name}\\" implementation on " + values.length + " values." };
}
`;
  if (!existsSync(GENERATED_TREE_DIR)) mkdirSync(GENERATED_TREE_DIR, { recursive: true });
  writeFileSync(filePath, contents);
}

// Tree-side twin of sandboxArray.ts's rebuildManifest()/sandboxGraph.ts's
// rebuildGraphManifest() — same static-import constraint, kept in its own
// directory/manifest so this scan never mixes in an array- or
// graph-shaped file.
function rebuildTreeManifest(): void {
  const keys = readdirSync(GENERATED_TREE_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "manifest.ts")
    .map((f) => f.replace(/\.ts$/, ""));

  const imports = keys.map((k) => `import { ${k}, DESCRIPTION as ${k}_DESCRIPTION } from "./${k}";`).join("\n");
  const entries = keys.map((k) => `  ${k}: { description: ${k}_DESCRIPTION, run: ${k} },`).join("\n");

  const contents = `// AUTO-MAINTAINED by sandboxTree.ts — regenerated in full every time a
// new tree algorithm is generated and cached, listing every file in this
// directory as a plain static import. See generated/manifest.ts's own
// comment for why static imports are required at all; this is the
// tree-shaped twin, kept in its own directory so this scan never mixes
// in an array- or graph-shaped file.
import type { AlgorithmResult } from "../types";

export interface GeneratedTreeManifestEntry {
  description: string;
  run: (input: { values: number[] }) => AlgorithmResult;
}

${imports}

export const GENERATED_TREE: Record<string, GeneratedTreeManifestEntry> = {
${entries}
};
`;
  writeFileSync(join(GENERATED_TREE_DIR, "manifest.ts"), contents);
}

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

import * as ts from "typescript";

import { ROOT } from "../config/paths";
import type { Operation } from "./types";

// Shared by all three codegen families (sandboxArray.ts, sandboxGraph.ts,
// sandboxTree.ts) — the sandbox subprocess plumbing, the error type, and
// the real type-check validator. Split out of a single 946-line sandbox.ts
// once it had grown three full families plus this validator; each family
// file below is otherwise self-contained (its own directory constant, its
// own cache/manifest functions, its own generateAndValidateXAlgorithm).

export const RUNNER_PATH = join(ROOT, "src", "algorithms", "sandboxRunner.js");

export interface GenerateAlgorithmResult {
  operations: Operation[];
  summary: string;
}

export class GenerateAlgorithmError extends Error {}

const TSCONFIG_PATH = join(ROOT, "tsconfig.json");

// Real type-checking, not just "does it transpile" — found live to be a
// real gap: esbuild.transformSync (every codegen family's own compile
// check) only strips types, it doesn't check them, so generated code can
// pass every sandbox validator and still fail the project's own real
// `tsc --noEmit` once cached (noUncheckedIndexedAccess flagged an
// unguarded `trace.values[i]` in a real generated tree file — the model
// indexing `readonly number[]` directly is exactly the kind of thing
// esbuild's loader never catches). Latent for array/graph too — neither
// generated/cocktailsort.ts nor generated-graph/dfs.ts happens to index a
// raw array directly, so it never surfaced there, but nothing about
// those paths' own validators would have caught it either.
//
// Loaded once and memoized, not per call — tsconfig.json doesn't change
// during this process's lifetime, and re-parsing it on every attempt
// would be pure overhead across up to 3 retry attempts per request.
let cachedCompilerOptions: ts.CompilerOptions | undefined;
function loadCompilerOptions(): ts.CompilerOptions {
  if (cachedCompilerOptions) return cachedCompilerOptions;
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(TSCONFIG_PATH));
  cachedCompilerOptions = { ...parsed.options, noEmit: true };
  return cachedCompilerOptions;
}

// Type-checks exactly one file — rootNames is just [filePath], not the
// whole project's include list, so this only processes filePath and
// whatever it transitively imports (the real TracedArray/TracedGraph/
// TracedTree contract files and their own dependencies), not every file
// under src/ and remotion/. Confirmed live: ~300-700ms per call, not the
// multi-second cost a full project type-check would be — negligible
// against the sandbox's own subprocess spawn, and trivial against a
// retry attempt's real model completion time.
//
// Filtered to diagnostics on filePath itself — a candidate file's own
// errors are what this is checking for, not incidentally surfacing
// something unrelated the Program happened to pull in.
export function typeCheckGeneratedFile(filePath: string): void {
  const options = loadCompilerOptions();
  const program = ts.createProgram({ rootNames: [filePath], options });
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === filePath);
  if (diagnostics.length === 0) return;

  const messages = diagnostics.map((d) => {
    const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `line ${line + 1}, column ${character + 1}: ${text}`;
    }
    return text;
  });
  throw new GenerateAlgorithmError(
    `generated code passed every runtime check but fails the project's real type-check:\n${messages.join("\n")}\n` +
      `Fix the type error(s) — a common one is indexing an array (e.g. trace.values[i]) without accounting for ` +
      `it possibly being undefined; use a local variable with a runtime check, or a non-null assertion only where ` +
      `the index is already known in range.`,
  );
}

// Runs generated code in an isolated child process (PLAN.md's Phase A
// codegen redesign): the LLM never emits an Operation directly, it
// writes ordinary code against the TracedArray/TracedGraph/TracedTree
// contract, and this function is the only thing that actually executes
// it — the operation log is a mechanical record of real execution, not
// something the model had to get right by construction. Two independent
// isolation layers, both confirmed live against this Node version: the
// child is spawned with `--permission` and no --allow-fs-* flags (blocks
// filesystem access at the runtime level even if the vm sandbox below
// had a gap), and inside the child, vm.Script's `timeout` option
// genuinely aborts a synchronous infinite loop (V8's execution-interrupt
// mechanism), not just a cooperative check.
//
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
//
// Shared subprocess mechanics for every sandbox kind (array, graph, tree)
// — sandboxRunner.js branches on `payload.kind` internally; this function
// is just the parent-side spawn/stdin/stdout plumbing, identical either
// way.
export function runInSandboxRaw<T>(payload: Record<string, unknown>): Promise<T> {
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

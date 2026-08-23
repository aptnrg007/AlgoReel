import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getAlgorithmByNormalizedName, normalizeAlgorithmName } from "./index";
import { generateAndValidateAlgorithm, GenerateAlgorithmError } from "./sandbox";

// The algorithm agent (PLAN.md's follow-up to Phase A): script.yaml no
// longer writes algorithm implementations itself — it asks for one by
// name via ensure_algorithm, which either finds it already cached or
// gets a dedicated, toolless specialist agent (algorithm.yaml) to write
// one, feeding sandbox.ts's real validator errors back on failure. The
// retry loop lives here, in TypeScript, not inside algorithm.yaml's own
// AgentForge turn loop — algorithm.yaml runs on a small local model, and
// a toolless "read prompt, emit code" turn is the most reliable thing to
// ask of one; multi-round tool-call self-correction is exactly what this
// project's local-model testing already found qwen3 unreliable at (see
// script.free.yaml's STATUS comment).
// Sorting only, not searching — sandbox.ts's correctness check compares
// the sandboxed result against the array sorted ascending, which has no
// meaning for a search. Not mechanically enforced here (there's no cheap
// way to detect "this is a search" from a name string alone); found live
// instead, the expensive way: asking for "linear search" burned all 3
// retry attempts every time, because a correct linear search never
// produces a sorted array, so validator 1 rejected it regardless of code
// quality. script.yaml's instructions are the actual guardrail — they
// tell the agent not to call this for a search.
const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALGORITHM_AGENT_PATH = join(MCP_ROOT, "..", "algoreel-agents", "agents", "algorithm.yaml");
const AGENTFORGE_BIN = process.env.AGENTFORGE_BIN || "agentforge";
const MAX_ATTEMPTS = 3;

// A fixed sample, not whatever input the eventual video will use —
// ensure_algorithm's job is only to guarantee the algorithm exists and
// works; validating it once against a canonical array (same shape
// sandbox.test.ts already uses) decouples "does this implementation
// work" from "what array does this particular video visualize". Once
// cached, run_algorithm's registry fast path runs it against any real
// input with no re-validation.
const VALIDATION_ARRAY = [38, 27, 43, 3, 9, 82, 10, 15, 22, 5];

export class EnsureAlgorithmError extends Error {}

export interface EnsureAlgorithmResult {
  name: string; // normalized registry key — pass this to run_algorithm
  description: string;
  attempts: number;
  alreadyExisted: boolean;
}

export interface EnsureAlgorithmDeps {
  // Test seam: the default implementation shells out to `agentforge run
  // algorithm.yaml`. Injecting this lets the retry loop itself be tested
  // without Ollama running at all.
  generateCode?: (prompt: string) => Promise<string>;
}

function buildPrompt(algorithm: string, description: string | undefined, previous?: { code: string; error: string }): string {
  const header = `Algorithm: ${algorithm}${description ? `\nDescription: ${description}` : ""}`;
  if (!previous) {
    return `${header}\n\nWrite a fresh implementation.`;
  }
  return (
    `${header}\n\n` +
    `Your previous attempt failed validation. Previous code:\n\`\`\`ts\n${previous.code}\n\`\`\`\n\n` +
    `Validator error:\n${previous.error}\n\n` +
    `Fix the implementation and try again. Emit the corrected code the same way — one fenced TypeScript block, nothing else.`
  );
}

// Strips a single ```ts / ```typescript / ``` fence if the model wrapped
// its answer in one — same tolerance preview.sh already applies to
// script.yaml's JSON answers, since small models reliably do this even
// when told not to.
function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:ts|typescript|js|javascript)?\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
}

async function runAlgorithmAgent(prompt: string): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "algoreel-algo-"));
  try {
    const promptPath = join(work, "prompt.txt");
    const outputPath = join(work, "result.json");
    const dbPath = join(work, "agentforge.db");
    writeFileSync(promptPath, prompt);

    await new Promise<void>((resolve, reject) => {
      // stdio: stdout/stderr both piped and ignored, never inherited —
      // this process is itself an MCP stdio server whose stdout IS the
      // JSON-RPC channel; letting a child's progress output land on it
      // would corrupt the session. --output-format json routes
      // AgentForge's own progress lines to stderr and writes the run
      // envelope to outputPath instead, so nothing needs stdout at all.
      // A dedicated --db keeps this from sharing (and lock-contending
      // on) ~/.agentforge/agentforge.db with any concurrent run.
      const child = spawn(
        AGENTFORGE_BIN,
        ["run", ALGORITHM_AGENT_PATH, "-m", `@${promptPath}`, "--output-format", "json", "--output", outputPath, "--db", dbPath],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => reject(new EnsureAlgorithmError(`failed to start algorithm agent: ${err.message}`)));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new EnsureAlgorithmError(`algorithm agent exited with code ${code}: ${stderr.slice(-2000) || "(no stderr)"}`));
          return;
        }
        resolve();
      });
    });

    let raw: string;
    try {
      raw = readFileSync(outputPath, "utf8");
    } catch {
      throw new EnsureAlgorithmError("algorithm agent produced no output file");
    }
    if (!raw.trim()) {
      throw new EnsureAlgorithmError("algorithm agent run was cancelled (empty output)");
    }

    let envelope: { state: string; output?: string; error?: string };
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new EnsureAlgorithmError(`algorithm agent produced unparseable output: ${raw.slice(0, 500)}`);
    }

    // awaiting_approval can't happen for a toolless agent, but the state
    // must be checked regardless — AgentForge exits 0 for it too, and a
    // script that only checks the exit code would treat a stalled run as
    // success.
    if (envelope.state !== "completed") {
      throw new EnsureAlgorithmError(`algorithm agent run did not complete (state: ${envelope.state}): ${envelope.error || "no error message"}`);
    }
    if (!envelope.output) {
      throw new EnsureAlgorithmError("algorithm agent completed with no output");
    }
    return stripFence(envelope.output);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function ensureAlgorithm(
  req: { algorithm: string; description?: string; structure?: string },
  deps: EnsureAlgorithmDeps = {},
): Promise<EnsureAlgorithmResult> {
  // Phase A (and this agent) only cover array-shaped algorithms — the
  // same boundary script.yaml's instructions previously enforced only in
  // prose. Enforcing it here means a caller can't accidentally slip a
  // linked-list/tree request through and get a mismatched array
  // algorithm back with a straight face.
  if (req.structure !== undefined && req.structure !== "array") {
    throw new EnsureAlgorithmError(
      `ensure_algorithm only supports structure: "array" right now (got "${req.structure}") — linked lists, trees, and graphs aren't covered by this codegen path.`,
    );
  }

  const key = normalizeAlgorithmName(req.algorithm);
  if (!key) throw new EnsureAlgorithmError("algorithm name must not be empty");

  const existing = getAlgorithmByNormalizedName(key);
  if (existing) {
    return { name: key, description: existing.description, attempts: 0, alreadyExisted: true };
  }

  const generateCode = deps.generateCode ?? runAlgorithmAgent;
  const description = req.description || `Implementation of ${req.algorithm}, generated by the algorithm agent.`;

  const errors: string[] = [];
  let previous: { code: string; error: string } | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(req.algorithm, req.description, previous);
    const code = await generateCode(prompt);

    try {
      await generateAndValidateAlgorithm({
        name: req.algorithm,
        description,
        code,
        input: { array: VALIDATION_ARRAY },
      });
      return { name: key, description, attempts: attempt, alreadyExisted: false };
    } catch (err) {
      const message = err instanceof GenerateAlgorithmError ? err.message : err instanceof Error ? err.message : String(err);
      errors.push(`attempt ${attempt}: ${message}`);
      previous = { code, error: message };
    }
  }

  throw new EnsureAlgorithmError(
    `could not generate a working implementation of "${req.algorithm}" in ${MAX_ATTEMPTS} attempts:\n${errors.join("\n")}`,
  );
}

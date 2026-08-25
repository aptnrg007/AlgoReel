import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runAgent, RunAgentError, stripFence } from "../agents/runAgent";
import { getAlgorithmByNormalizedName, normalizeAlgorithmName } from "./index";
import { generateAndValidateAlgorithm, generateAndValidateGraphAlgorithm, GenerateAlgorithmError } from "./sandbox";

// The algorithm agent (PLAN.md's follow-up to Phase A): script.yaml no
// longer writes algorithm implementations itself — it asks for one by
// name via ensure_algorithm, which either finds it already cached or
// gets a dedicated, toolless specialist agent to write one (algorithm.yaml
// for arrays, algorithm-graph.yaml for graphs — STRUCTURE_DISPATCH below
// picks which), feeding sandbox.ts's real validator errors back on
// failure. The retry loop lives here, in TypeScript, not inside either
// agent's own AgentForge turn loop — both run on a small local model, and
// a toolless "read prompt, emit code" turn is the most reliable thing to
// ask of one; multi-round tool-call self-correction is exactly what this
// project's local-model testing already found qwen3 unreliable at (see
// script.free.yaml's STATUS comment).
//
// Array structure: sorting only, not searching — sandbox.ts's
// correctness check compares the sandboxed result against the array
// sorted ascending, which has no meaning for a search. Not mechanically
// enforced here (there's no cheap way to detect "this is a search" from
// a name string alone); found live instead, the expensive way: asking
// for "linear search" burned all 3 retry attempts every time, because a
// correct linear search never produces a sorted array, so validator 1
// rejected it regardless of code quality. script.yaml's instructions are
// the actual guardrail — they tell the agent not to call this for a
// search.
//
// Graph structure: bfs/dfs only, and *this* one IS mechanically enforced
// (sandbox.ts's GRAPH_REFERENCE lookup rejects anything else immediately,
// before ever running the sandbox) — unlike "is this a search," "is this
// bfs or dfs" is exactly checkable from the name.
const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALGORITHM_AGENT_PATH = join(MCP_ROOT, "..", "algoreel-agents", "agents", "algorithm.yaml");
const ALGORITHM_GRAPH_AGENT_PATH = join(MCP_ROOT, "..", "algoreel-agents", "agents", "algorithm-graph.yaml");
const MAX_ATTEMPTS = 3;

// A fixed sample, not whatever input the eventual video will use —
// ensure_algorithm's job is only to guarantee the algorithm exists and
// works; validating it once against a canonical array (same shape
// sandbox.test.ts already uses) decouples "does this implementation
// work" from "what array does this particular video visualize". Once
// cached, run_algorithm's registry fast path runs it against any real
// input with no re-validation.
const VALIDATION_ARRAY = [38, 27, 43, 3, 9, 82, 10, 15, 22, 5];

// Same idea, for the graph path — reuses specs/bfs-demo.json's exact
// graph (A..F, plus an unreachable G to exercise "don't visit what isn't
// reachable"), so its correct BFS order is already cross-checked against
// that demo's own known-correct narration, not just this file's say-so.
const VALIDATION_GRAPH: { nodes: string[]; edges: [string, string][]; start: string } = {
  nodes: ["A", "B", "C", "D", "E", "F", "G"],
  edges: [
    ["A", "B"],
    ["A", "C"],
    ["B", "D"],
    ["C", "D"],
    ["C", "E"],
    ["E", "F"],
  ],
  start: "A",
};

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

// Thin wrapper over the shared runAgent (src/agents/runAgent.ts, originally
// lifted from this exact function) that translates its RunAgentError into
// this module's own EnsureAlgorithmError, so every caller below still only
// has to catch one error type.
async function runAlgorithmAgent(prompt: string, agentPath: string): Promise<string> {
  try {
    return stripFence(await runAgent(prompt, agentPath));
  } catch (err) {
    if (err instanceof RunAgentError) throw new EnsureAlgorithmError(err.message);
    throw err;
  }
}

// One dispatch table entry per supported structure — everything that
// differs between the array and graph codegen paths (which agent writes
// the code, which sandbox.ts validator checks it, what fixed input
// validates it) lives here; the retry loop below (attempt counting,
// feeding each failure's error into the next prompt) is identical either
// way and never needs to know which structure it's driving.
const STRUCTURE_DISPATCH: Record<
  string,
  { agentPath: string; validate: (name: string, description: string, code: string) => Promise<unknown> }
> = {
  array: {
    agentPath: ALGORITHM_AGENT_PATH,
    validate: (name, description, code) =>
      generateAndValidateAlgorithm({ name, description, code, input: { array: VALIDATION_ARRAY } }),
  },
  graph: {
    agentPath: ALGORITHM_GRAPH_AGENT_PATH,
    validate: (name, description, code) =>
      generateAndValidateGraphAlgorithm({ name, description, code, input: VALIDATION_GRAPH }),
  },
};

export async function ensureAlgorithm(
  req: { algorithm: string; description?: string; structure?: string },
  deps: EnsureAlgorithmDeps = {},
): Promise<EnsureAlgorithmResult> {
  const structureKey = req.structure ?? "array";
  const dispatch = STRUCTURE_DISPATCH[structureKey];
  if (!dispatch) {
    throw new EnsureAlgorithmError(
      `ensure_algorithm only supports structure: "array" or "graph" right now (got "${req.structure}") — ` +
        `linked lists, trees, and stacks aren't covered by this codegen path yet (they're hand-written instead — ` +
        `call list_algorithms to see what's already available).`,
    );
  }

  const key = normalizeAlgorithmName(req.algorithm);
  if (!key) throw new EnsureAlgorithmError("algorithm name must not be empty");

  const existing = getAlgorithmByNormalizedName(key);
  if (existing) {
    return { name: key, description: existing.description, attempts: 0, alreadyExisted: true };
  }

  const generateCode = deps.generateCode ?? ((prompt: string) => runAlgorithmAgent(prompt, dispatch.agentPath));
  const description = req.description || `Implementation of ${req.algorithm}, generated by the algorithm agent.`;

  const errors: string[] = [];
  let previous: { code: string; error: string } | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(req.algorithm, req.description, previous);
    const code = await generateCode(prompt);

    try {
      await dispatch.validate(req.algorithm, description, code);
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

import { runAgent, RunAgentError } from "./runAgent";

// A "rung" is one agent config to try. AgentForge resolves ${VAR} at config
// LOAD time and hard-errors if the variable is unset (confirmed live against
// AgentForge/internal/config/env.go) — so a paid rung can never be a
// commented-out block inside a local-default agent's YAML the way earlier
// script.free.yaml-style variants did; it has to be a genuinely separate
// config file that this ladder only invokes once it has confirmed the env
// var is actually set. requiresEnv absent (or already satisfied) means
// "always available" — every local rung.
export interface Rung {
  agentPath: string;
  // Name of an env var that must be non-empty for this rung to run at all
  // (e.g. "ANTHROPIC_API_KEY"). A rung whose var is missing is skipped
  // silently — that's a deployment choice ("no paid key configured"), not a
  // failure worth reporting the same way an attempt that actually ran and
  // produced a bad answer is.
  requiresEnv?: string;
  maxAttempts: number;
}

export interface LadderAttempt {
  rung: number;
  attempt: number;
  error: string;
}

export interface LadderResult<T> {
  value: T;
  rungIndex: number;
  agentPath: string;
  attempts: LadderAttempt[];
}

export class LadderExhaustedError extends Error {
  constructor(public readonly attempts: LadderAttempt[]) {
    super(
      `every rung exhausted its attempts:\n${attempts.map((a) => `  rung ${a.rung} attempt ${a.attempt}: ${a.error}`).join("\n")}`,
    );
  }
}

export interface LadderDeps {
  // Test seam mirroring ensureAlgorithm.ts's deps.generateCode — lets a
  // caller's test drive the retry logic without Ollama or a paid key.
  // Receives the rung index it's standing in for, so a test can vary
  // behavior per rung (e.g. "local always fails, paid always succeeds").
  generateText?: (prompt: string, rungIndex: number) => Promise<string>;
}

// Runs rungs in order, retrying each one up to its own maxAttempts, feeding
// the real error from the previous attempt back into buildPrompt so a
// single-shot local model gets the same kind of corrective feedback
// ensureAlgorithm.ts's retry loop already gives codegen. A rung is skipped
// entirely (not counted as a failed attempt) when requiresEnv names a var
// that isn't set. Escalates to the next rung only once the current one's
// attempts are exhausted — never speculatively, so a working local model
// never costs a paid call.
export async function runLadder<T>(
  rungs: Rung[],
  buildPrompt: (previous?: { output: string; error: string }) => string,
  parseAndValidate: (raw: string) => T,
  deps: LadderDeps = {},
): Promise<LadderResult<T>> {
  const attempts: LadderAttempt[] = [];

  for (let rungIndex = 0; rungIndex < rungs.length; rungIndex++) {
    const rung = rungs[rungIndex]!;
    if (rung.requiresEnv && !process.env[rung.requiresEnv]) continue;

    let previous: { output: string; error: string } | undefined;
    for (let attempt = 1; attempt <= rung.maxAttempts; attempt++) {
      const prompt = buildPrompt(previous);
      let raw = "";
      try {
        raw = deps.generateText ? await deps.generateText(prompt, rungIndex) : await runAgent(prompt, rung.agentPath);
        const value = parseAndValidate(raw);
        return { value, rungIndex, agentPath: rung.agentPath, attempts };
      } catch (err) {
        const message = err instanceof RunAgentError || err instanceof Error ? err.message : String(err);
        attempts.push({ rung: rungIndex, attempt, error: message });
        previous = { output: raw, error: message };
      }
    }
  }

  throw new LadderExhaustedError(attempts);
}

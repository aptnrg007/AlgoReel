import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shared subprocess plumbing for shelling out to `agentforge run <agent>.yaml`
// against a toolless, single-shot local agent. Originally
// algorithms/ensureAlgorithm.ts's runAlgorithmAgent — lifted here so
// ensureSpec.ts's script-generation orchestrator can reuse the exact same
// hygiene rather than re-deriving it, and ensureAlgorithm.ts now imports it
// too (see its own file). Every comment below survives from there because
// each one documents something found live, not just style.
export class RunAgentError extends Error {}

const AGENTFORGE_BIN = process.env.AGENTFORGE_BIN || "agentforge";

export async function runAgent(prompt: string, agentPath: string): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "algoreel-agent-"));
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
        ["run", agentPath, "-m", `@${promptPath}`, "--output-format", "json", "--output", outputPath, "--db", dbPath],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => reject(new RunAgentError(`failed to start agent: ${err.message}`)));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new RunAgentError(`agent exited with code ${code}: ${stderr.slice(-2000) || "(no stderr)"}`));
          return;
        }
        resolve();
      });
    });

    let raw: string;
    try {
      raw = readFileSync(outputPath, "utf8");
    } catch {
      throw new RunAgentError("agent produced no output file");
    }
    if (!raw.trim()) {
      throw new RunAgentError("agent run was cancelled (empty output)");
    }

    // envelope.output is declared `unknown`, not `string`, on purpose:
    // AgentForge's runEnvelope.Output is a json.RawMessage
    // (internal/cli/output.go's finalOutputJSON) that's a real embedded
    // JSON value — not a JSON-encoded string — whenever the agent's
    // output.schema is set and the run completed (found live, the
    // expensive way: a schema-constrained agent's output came back as an
    // actual JS object after JSON.parse below, and calling .trim() on it
    // downstream threw "text.trim is not a function"). A schema-less
    // agent (e.g. algorithm.yaml) still gets a plain JSON string. Both
    // are normalized to a string below so every caller has one contract.
    let envelope: { state: string; output?: unknown; error?: string };
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new RunAgentError(`agent produced unparseable output: ${raw.slice(0, 500)}`);
    }

    // awaiting_approval can't happen for a toolless agent, but the state
    // must be checked regardless — AgentForge exits 0 for it too, and a
    // script that only checks the exit code would treat a stalled run as
    // success.
    if (envelope.state !== "completed") {
      throw new RunAgentError(`agent run did not complete (state: ${envelope.state}): ${envelope.error || "no error message"}`);
    }
    if (envelope.output === undefined || envelope.output === null) {
      throw new RunAgentError("agent completed with no output");
    }
    return typeof envelope.output === "string" ? envelope.output : JSON.stringify(envelope.output);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Strips a single ```json / ```ts / ``` fence if the model wrapped its
// answer in one, and returns the interior trimmed — small local models
// reliably do this even when told not to (found across script.yaml,
// ensureAlgorithm.ts's algorithm.yaml, and run.sh/preview.sh's own
// extract_spec, independently, before this was one function).
export function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|ts|typescript|js|javascript)?\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
}

// Parses a model's answer as JSON, tolerating a fenced wrapper. Throws
// RunAgentError with the raw text (truncated) on failure, so a caller's
// retry-loop error message shows the model what it actually got wrong.
export function parseJsonAnswer<T = unknown>(text: string): T {
  const stripped = stripFence(text);
  try {
    return JSON.parse(stripped) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RunAgentError(`model answer is not valid JSON (${message}): ${stripped.slice(0, 500)}`);
  }
}

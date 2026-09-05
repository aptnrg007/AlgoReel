import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LadderExhaustedError, runLadder, type Rung } from "../agents/ladder";
import { parseJsonAnswer } from "../agents/runAgent";
import { dataPlanSchema } from "./dataPlanSchema";
import type { DataPlan, DatasetSchema } from "./types";

const AGENTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "algoreel-agents", "agents");
const PLAN_AGENT_PATH = join(AGENTS_ROOT, "plan-dataset.yaml");
const PLAN_AGENT_PAID_PATH = join(AGENTS_ROOT, "plan-dataset.anthropic.yaml");
const MAX_PLAN_ATTEMPTS = 3;

export interface PlanDatasetRequest {
  prompt: string;
  schema: DatasetSchema;
}

export interface PlanDatasetResult {
  plan: DataPlan;
  rung: number;
  notes: string[];
}

export interface PlanDatasetDeps {
  // Test seam mirroring selectVideoType.ts's deps.chooseVideoType — lets a
  // test drive the ladder without Ollama or a paid key.
  planDataset?: (prompt: string, rungIndex: number) => Promise<string>;
}

function planningRungs(): Rung[] {
  return [
    { agentPath: PLAN_AGENT_PATH, maxAttempts: MAX_PLAN_ATTEMPTS },
    { agentPath: PLAN_AGENT_PAID_PATH, requiresEnv: "ANTHROPIC_API_KEY", maxAttempts: 1 },
  ];
}

// Every column name a DataPlan actually references — the only thing this
// function checks against the real DatasetSchema. Everything else (does a
// filter's value actually appear in that column, are there enough
// distinct periods, ...) needs real row data and is step 3's
// (extractDataset.ts) job, not this one's — this step only has the
// schema, deliberately, per PLAN.md Phase 10's "never the whole file"
// rule for what an agent gets to see.
function referencedColumns(plan: DataPlan): string[] {
  const columns: string[] =
    plan.videoType === "time_series"
      ? [plan.xColumn, ...plan.yColumns]
      : [plan.entityColumn, plan.periodColumn, plan.valueColumn];
  if (plan.range) columns.push(plan.range.column);
  return [...columns, ...(plan.filters ?? []).map((f) => f.column)];
}

function buildPrompt(prompt: string, schema: DatasetSchema, previous?: { output: string; error: string }): string {
  const correction = previous ? `\n\nYour previous answer was rejected: ${previous.error}\nFix it and answer again.` : "";
  const columnsDescription = schema.columns.map((c) => `- "${c.name}" (${c.type})`).join("\n");
  const sample = JSON.stringify(schema.sampleRows, null, 2);
  return (
    `Request: ${prompt}\n\n` +
    `Dataset has ${schema.rowCount} row(s) with these columns:\n${columnsDescription}\n\n` +
    `Sample rows (for context only — these are not the only rows; don't add a filter just because ` +
    `every sample happens to share a value):\n${sample}${correction}`
  );
}

// PLAN.md Phase 10 step 2's entry point: prompt + a dataset's shape (never
// the dataset itself) in, a DataPlan out — the same deterministic-first
// discipline this project's other planning steps use isn't available here
// (there's no keyword shortcut for "which columns," it's genuinely a
// per-dataset judgment call), so this always goes through the ladder.
export async function planDataset(req: PlanDatasetRequest, deps: PlanDatasetDeps = {}): Promise<PlanDatasetResult> {
  const notes: string[] = [];
  const knownColumns = new Set(req.schema.columns.map((c) => c.name));

  const parseAndValidate = (raw: string): DataPlan => {
    const candidate = dataPlanSchema.parse(parseJsonAnswer(raw));
    const unknown = referencedColumns(candidate).filter((name) => !knownColumns.has(name));
    if (unknown.length > 0) {
      throw new Error(`unknown column(s): ${unknown.join(", ")} — known columns: ${[...knownColumns].join(", ")}`);
    }
    return candidate;
  };

  try {
    const result = await runLadder(
      planningRungs(),
      (previous) => buildPrompt(req.prompt, req.schema, previous),
      parseAndValidate,
      deps.planDataset ? { generateText: deps.planDataset } : {},
    );
    notes.push(`selected a "${result.value.videoType}" data plan via ${result.agentPath}`);
    return { plan: result.value, rung: result.rungIndex, notes };
  } catch (err) {
    if (err instanceof LadderExhaustedError) {
      throw new Error(`could not produce a data plan for "${req.prompt}":\n${err.message}`);
    }
    throw err;
  }
}

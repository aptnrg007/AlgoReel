import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { LadderExhaustedError, runLadder, type Rung } from "../agents/ladder";
import { parseJsonAnswer } from "../agents/runAgent";
import type { KaggleFile } from "./kaggleTypes";

const AGENTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "algoreel-agents", "agents");
const SELECT_AGENT_PATH = join(AGENTS_ROOT, "select-dataset-file.yaml");
const SELECT_AGENT_PAID_PATH = join(AGENTS_ROOT, "select-dataset-file.anthropic.yaml");
const MAX_SELECT_ATTEMPTS = 3;

const fileChoiceSchema = z.object({ fileName: z.string() });

// Deliberately narrow — the same two extensions inspectDataset.ts
// itself understands. A Kaggle file this connector can't even read
// isn't a real candidate regardless of how well its name matches.
const RECOGNIZED_EXTENSIONS = [".csv", ".json"];

function isRecognized(name: string): boolean {
  return RECOGNIZED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

export interface SelectDatasetFileDeps {
  // Test seam mirroring selectVideoType.ts's deps.chooseVideoType.
  chooseFile?: (prompt: string, rungIndex: number) => Promise<string>;
}

function selectionRungs(): Rung[] {
  return [
    { agentPath: SELECT_AGENT_PATH, maxAttempts: MAX_SELECT_ATTEMPTS },
    { agentPath: SELECT_AGENT_PAID_PATH, requiresEnv: "ANTHROPIC_API_KEY", maxAttempts: 1 },
  ];
}

// PLAN.md Phase 10 step 5's "one more small agent decision, which
// file" — deterministic when there's exactly one obvious candidate (a
// single recognized-extension file), the same "skip the model when the
// answer is already obvious" discipline every other planner step in
// this project follows; a real ladder call only for genuine ambiguity
// (more than one CSV/JSON file in the dataset).
export async function selectDatasetFile(prompt: string, files: KaggleFile[], deps: SelectDatasetFileDeps = {}): Promise<string> {
  const candidates = files.filter((f) => isRecognized(f.name));
  if (candidates.length === 0) {
    throw new Error(`no .csv/.json file found in this dataset (files: ${files.map((f) => f.name).join(", ") || "(none)"})`);
  }
  if (candidates.length === 1) {
    return candidates[0]!.name;
  }

  const fileList = candidates.map((f) => `- "${f.name}"${f.totalBytes !== undefined ? ` (${f.totalBytes} bytes)` : ""}`).join("\n");
  const buildPrompt = (previous?: { output: string; error: string }) => {
    const correction = previous ? `\n\nYour previous answer was rejected: ${previous.error}\nFix it and answer again.` : "";
    return `Request: ${prompt}\n\nThis dataset has more than one file:\n${fileList}${correction}`;
  };

  const knownNames = new Set(candidates.map((f) => f.name));
  const parseAndValidate = (raw: string): string => {
    const { fileName } = fileChoiceSchema.parse(parseJsonAnswer(raw));
    if (!knownNames.has(fileName)) {
      throw new Error(`"${fileName}" isn't one of the real files in this dataset — known files: ${[...knownNames].join(", ")}`);
    }
    return fileName;
  };

  try {
    const result = await runLadder(selectionRungs(), buildPrompt, parseAndValidate, deps.chooseFile ? { generateText: deps.chooseFile } : {});
    return result.value;
  } catch (err) {
    if (err instanceof LadderExhaustedError) {
      throw new Error(`could not select a file for "${prompt}":\n${err.message}`);
    }
    throw err;
  }
}

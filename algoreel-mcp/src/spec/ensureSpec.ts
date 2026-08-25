import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTimeline } from "../../remotion/buildTimeline";
import { FRAME } from "../../remotion/template/tokens";
import { LadderExhaustedError, runLadder, type Rung } from "../agents/ladder";
import { parseJsonAnswer } from "../agents/runAgent";
import { getAlgorithm, getAlgorithmByNormalizedName, listAlgorithms, normalizeAlgorithmName, runAlgorithm } from "../algorithms/index";
import { planBeats } from "./beatBudget";
import { checkRender, maxArrayLength } from "./checkRender";
import { deriveEmphasis } from "./emphasis";
import { algorithmChoiceSchema, narrationDraftSchema } from "./schema";
import { sanitizeNarrationText } from "./sanitizeText";
import type { StorySpec } from "./types";
import { validateSpec } from "./validate";

// ensureSpec generalizes ensureAlgorithm.ts's pattern (PLAN.md's algorithm
// agent) from codegen to script generation: script.yaml used to ask one
// tool-using Anthropic agent to hold an open-ended authoring task *and* a
// multi-round validate_spec self-correction loop in the same conversation —
// exactly the combination this project measured a local model (qwen3:8b)
// failing at, 1 success in 5 (script.free.yaml's STATUS comment). The fix
// is the same one that already works for codegen: move the loop into
// TypeScript, and give a local model only single-shot, narrowly-scoped
// completions it can't hold a multi-turn conversation about.
//
// Every invariant that's mechanically checkable is enforced mechanically
// here, never left to a prompt: op:N beats are zipped from a plain ordered
// array (no beat *labels* for the model to get wrong — see schema.ts's
// narrationDraftSchema comment), the input is a fixed canonical sample (no
// array-too-wide risk), the opBeatCount and per-beat word budget come from
// beatBudget.ts's real checkpoint math (no invisible-checkpoints risk), and
// targetDurationSec is set from buildTimeline's real computed duration (no
// duration-off-target risk). What's left for a model to get wrong is
// genuinely just prose quality — which validateSpec/checkRender can't
// grade, so a bounded local retry ladder with a paid escalation rung
// (only invoked if ANTHROPIC_API_KEY is actually set) exists for the case
// where the local model's narration keeps failing checks that DO exist
// (e.g. an emphasis or narration-length regression introduced by a bad
// rewrite on repair).

export class EnsureSpecError extends Error {}

const AGENTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "algoreel-agents", "agents");
const SELECT_AGENT_PATH = join(AGENTS_ROOT, "select-algorithm.yaml");
const SELECT_AGENT_PAID_PATH = join(AGENTS_ROOT, "select-algorithm.anthropic.yaml");
const NARRATE_AGENT_PATH = join(AGENTS_ROOT, "narrate.yaml");
const NARRATE_AGENT_PAID_PATH = join(AGENTS_ROOT, "narrate.anthropic.yaml");

const MAX_SELECT_ATTEMPTS = 3;
const MAX_NARRATE_ATTEMPTS = 3;
const MAX_REPAIR_ROUNDS = 3;
const PREFERRED_MAX_OP_BEATS = 5;

// Fixed canonical inputs, the same "fixed sample, not whatever the video
// needs" philosophy ensureAlgorithm.ts's own VALIDATION_ARRAY/
// VALIDATION_GRAPH already use — and every committed demo spec's input is
// already a generic example rather than derived from the topic's wording
// (specs/binary-search-demo.json's [2,5,8,12,16,23,38] has nothing to do
// with "explain binary search"). This also fully closes array-too-wide and
// struct-too-large/overlap by construction: every array here is well under
// maxArrayLength(), and the graph/list/tree samples are the same sizes
// already proven clean in committed specs.
const HAND_WRITTEN_CANONICAL_INPUT: Record<string, Record<string, unknown>> = {
  binarySearch: { array: [2, 5, 8, 12, 16, 23, 38], target: 23 },
  bubbleSort: { array: [5, 2, 8, 1, 4] },
  bfs: { nodes: ["A", "B", "C", "D", "E"], edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["C", "E"]], start: "A" },
  reverseLinkedList: { list: [1, 2, 3, 4, 5] },
  inorderTraversal: { tree: [5, 3, 8, 1, 4, 7, 9] },
  checkBalancedParens: { expression: "(()(()))" },
};
const DEFAULT_ARRAY_INPUT: Record<string, unknown> = { array: [38, 12, 27, 5, 43, 9] };
const DEFAULT_GRAPH_INPUT: Record<string, unknown> = HAND_WRITTEN_CANONICAL_INPUT.bfs!;

// Asserted once at module load, not just asserted in a comment: every
// canonical array here really is at or under checkRender.ts's own
// array-too-wide threshold (maxArrayLength() elements is the last size
// that's still error-free — checkRender.test.ts's "array-near-edge warns
// at n=7 without failing the render" pins n===maxArrayLength() as clean,
// only n>maxArrayLength() is an error; binarySearch's canonical array
// below sits at exactly n=7), so "array-too-wide can never fire on a
// canonical input" stays true even if tokens.ts's cell geometry changes
// later and quietly shrinks maxArrayLength() below one of these literals.
for (const [name, input] of Object.entries(HAND_WRITTEN_CANONICAL_INPUT)) {
  const array = input.array as number[] | undefined;
  if (array && array.length > maxArrayLength()) {
    throw new Error(`HAND_WRITTEN_CANONICAL_INPUT.${name}'s array (${array.length}) is past maxArrayLength() (${maxArrayLength()})`);
  }
}
if ((DEFAULT_ARRAY_INPUT.array as number[]).length > maxArrayLength()) {
  throw new Error(`DEFAULT_ARRAY_INPUT's array is past maxArrayLength() (${maxArrayLength()})`);
}

export interface EnsureSpecResult {
  spec: StorySpec;
  selectRung?: number;
  narrateRung: number;
  repairRounds: number;
  notes: string[];
}

export interface EnsureSpecDeps {
  // Test seams mirroring ensureAlgorithm.ts's deps.generateCode — receive
  // (prompt, rungIndex) so a test can drive the ladder without Ollama/a
  // paid key. rungIndex 0 is always the local rung.
  chooseAlgorithm?: (prompt: string, rungIndex: number) => Promise<string>;
  writeNarration?: (prompt: string, rungIndex: number) => Promise<string>;
  // Test seam for the codegen fallback (structure: array/graph, no
  // registry match) — defaults to the real ensureAlgorithm.ts. Injectable
  // so a test never actually shells out to algorithm.yaml.
  ensureAlgorithm?: (req: { algorithm: string; structure: string }) => Promise<{ name: string }>;
}

// --- deterministic algorithm matching, tried before any model call ---
// PLAN.md's "is this algorithm known" list is short (5-8 entries even with
// codegen additions) — a keyword match against each entry's name and
// description handles a direct topic ("explain bubble sort") without ever
// asking a model. select-algorithm.yaml only gets called for a genuinely
// indirect topic ("how do you efficiently find something in a phone book
// that's already alphabetized").
function keywordMatchAlgorithm(topic: string): { name: string } | undefined {
  const words = new Set(topic.toLowerCase().match(/[a-z]+/g) ?? []);
  for (const entry of listAlgorithms()) {
    // camelCase -> ["bubble", "sort"] / ["bfs"] / ["reverse", "linked", "list"]
    const parts = entry.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/);
    if (parts.length > 1) {
      // Every part of a multi-word name present as its own word is a safe
      // signal ("explain bubble sort" -> {explain,bubble,sort} covers
      // "bubble"+"sort") — a topic would have to coincidentally use both
      // words for an unrelated reason to false-match.
      if (parts.every((p) => words.has(p))) return { name: entry.name };
    } else if (parts[0]!.length >= 4 && words.has(parts[0]!)) {
      // A single-word name only counts deterministically once it's long
      // enough that a whole-word match is unlikely to be coincidental —
      // "bfs"/"dfs" (3 letters) go to the model call instead, which
      // already handles them correctly on indirect topics too (verified
      // live: qwen3:8b picked binarySearch from "find something in an
      // alphabetized phone book" with zero algorithm names in the prompt).
      return { name: entry.name };
    }
  }
  return undefined;
}

// Classifies a registry entry's structure from its inputHint string (plain
// data, e.g. "{ array: number[] }" or "{ nodes: string[], ... }") rather
// than introspecting inputSchema's zod internals — AlgorithmEntry declares
// inputSchema as the generic z.ZodTypeAny, so there's no type-safe way to
// read its shape without a runtime cast, and every entry's inputHint
// already says the same thing in the one place a human is meant to read it.
function structureOf(entry: { inputHint: string }): "array" | "graph" | "other" {
  if (entry.inputHint.includes("array")) return "array";
  if (entry.inputHint.includes("nodes")) return "graph";
  return "other";
}

function canonicalInputFor(algorithmName: string, structure: "array" | "graph" | "other"): Record<string, unknown> {
  const exact = HAND_WRITTEN_CANONICAL_INPUT[algorithmName];
  if (exact) return exact;
  return structure === "graph" ? DEFAULT_GRAPH_INPUT : DEFAULT_ARRAY_INPUT;
}

function selectionRungs(): Rung[] {
  return [
    { agentPath: SELECT_AGENT_PATH, maxAttempts: MAX_SELECT_ATTEMPTS },
    { agentPath: SELECT_AGENT_PAID_PATH, requiresEnv: "ANTHROPIC_API_KEY", maxAttempts: 1 },
  ];
}

function narrateRungs(): Rung[] {
  return [
    { agentPath: NARRATE_AGENT_PATH, maxAttempts: MAX_NARRATE_ATTEMPTS },
    { agentPath: NARRATE_AGENT_PAID_PATH, requiresEnv: "ANTHROPIC_API_KEY", maxAttempts: 1 },
  ];
}

async function resolveAlgorithm(
  topic: string,
  deps: EnsureSpecDeps,
  notes: string[],
): Promise<{ algorithm: string; structure: "array" | "graph" | "other"; selectRung?: number }> {
  const catalog = listAlgorithms()
    .map((a) => `- ${a.name} (${a.generated ? "generated" : "hand-written"}): ${a.description}`)
    .join("\n");

  const direct = keywordMatchAlgorithm(topic);
  if (direct) {
    notes.push(`matched "${direct.name}" by keyword, no model call needed`);
    const entry = getAlgorithm(direct.name)!;
    return { algorithm: direct.name, structure: structureOf(entry) };
  }

  const buildPrompt = (previous?: { output: string; error: string }) => {
    const correction = previous ? `\n\nYour previous answer was rejected: ${previous.error}\nFix it and answer again.` : "";
    return (
      `Topic: ${topic}\n\nKnown algorithms:\n${catalog}\n\n` +
      `Pick the algorithm that best fits this topic. If it's genuinely a sorting or searching problem on a ` +
      `list of numbers but nothing above matches, answer with a made-up but reasonable name (e.g. "insertionSort") ` +
      `and structure "array" — a new implementation will be generated. If it's graph traversal (most likely ` +
      `breadth-first or depth-first search) and nothing above matches, answer "bfs" or "dfs" with structure ` +
      `"graph". If it's none of those, answer with the closest existing name and structure "other" — never invent ` +
      `an "other"-structure algorithm, only array/graph ones can be generated.${correction}`
    );
  };

  const result = await runLadder(
    selectionRungs(),
    buildPrompt,
    (raw) => algorithmChoiceSchema.parse(parseJsonAnswer(raw)),
    deps.chooseAlgorithm ? { generateText: deps.chooseAlgorithm } : {},
  );
  notes.push(`selected "${result.value.algorithm}" (structure: ${result.value.structure}) via ${result.agentPath}`);
  return { algorithm: result.value.algorithm, structure: result.value.structure, selectRung: result.rungIndex };
}

async function resolveRegisteredName(
  algorithm: string,
  structure: "array" | "graph" | "other",
  deps: EnsureSpecDeps,
): Promise<string> {
  const exact = getAlgorithm(algorithm) ?? getAlgorithmByNormalizedName(normalizeAlgorithmName(algorithm));
  if (exact) return exact.name;

  if (structure === "other") {
    // The model was asked to name the closest existing registry entry for
    // an "other"-structure topic, but might not reproduce that entry's
    // exact string — one more keyword pass against its own answer (same
    // helper resolveAlgorithm's deterministic path uses) before giving up,
    // cheaper than escalating a whole extra rung for what's usually just a
    // phrasing mismatch, not a real "nothing fits" case.
    const fuzzy = keywordMatchAlgorithm(algorithm);
    if (fuzzy) return fuzzy.name;
    throw new EnsureSpecError(
      `"${algorithm}" isn't a known algorithm and structure "other" isn't codegen-eligible (only "array"/"graph" ` +
        `are) — call list_algorithms to see what's really available rather than force-fitting an existing one.`,
    );
  }

  const ensure = deps.ensureAlgorithm ?? (await import("../algorithms/ensureAlgorithm")).ensureAlgorithm;
  try {
    const result = await ensure({ algorithm, structure });
    return result.name;
  } catch (err) {
    // Wrapped in EnsureSpecError, not left as whatever ensureAlgorithm.ts
    // throws (EnsureAlgorithmError), so every caller of ensureSpec only
    // ever has to catch one error type — a real, honest failure (this
    // project's own local-model testing already documents insertion sort
    // and quicksort failing this way, PLAN.md §10) surfaces with a clean
    // message instead of an uncaught exception's raw stack trace.
    const message = err instanceof Error ? err.message : String(err);
    throw new EnsureSpecError(`couldn't generate a working implementation of "${algorithm}": ${message}`);
  }
}

function assembleSpec(
  topic: string,
  algorithm: string,
  input: Record<string, unknown>,
  draft: { hook: string; opTexts: string[]; outroText: string; complexity: { time: string; space: string }; youtube: { title: string; description: string; tags: string[] } },
): StorySpec {
  const hook = sanitizeNarrationText(draft.hook);
  const opTexts = draft.opTexts.map(sanitizeNarrationText);
  const outroText = sanitizeNarrationText(draft.outroText);

  const narration: StorySpec["narration"] = [
    ...opTexts.map((text, i) => ({ beat: `op:${i}` as const, text })),
    { beat: "outro" as const, text: outroText },
  ];

  const spec: StorySpec = {
    version: 1,
    topic,
    targetDurationSec: 30, // placeholder, overwritten below from the real timeline
    hook,
    narration,
    // hook is deliberately excluded — validate.ts's semanticErrors only
    // checks emphasis words against spec.narration text, and Hook.tsx
    // renders spec.hook as plain text with no emphasis coloring at all
    // (only Caption.tsx, used for op:N/outro beats, does). An emphasis word
    // that only appeared in the hook would fail validate_spec even though
    // it looked present in a naive "does it appear anywhere" reading.
    emphasis: deriveEmphasis([...opTexts, outroText]),
    complexity: draft.complexity,
    youtube: {
      title: sanitizeNarrationText(draft.youtube.title),
      description: sanitizeNarrationText(draft.youtube.description),
      tags: draft.youtube.tags,
    },
    algorithm,
    input,
  };

  const timeline = buildTimeline(spec, FRAME.fps);
  spec.targetDurationSec = Math.round(timeline.totalDurationInFrames / FRAME.fps);
  return spec;
}

export async function ensureSpec(req: { topic: string }, deps: EnsureSpecDeps = {}): Promise<EnsureSpecResult> {
  const notes: string[] = [];

  const { algorithm: chosenName, structure, selectRung } = await resolveAlgorithm(req.topic, deps, notes);
  const registeredName = await resolveRegisteredName(chosenName, structure, deps);
  if (registeredName !== chosenName) notes.push(`generated a new implementation, registered as "${registeredName}"`);

  const entry = getAlgorithm(registeredName)!;
  const input = canonicalInputFor(registeredName, structureOf(entry));

  // Only `summary` is needed here — planBeats and buildTimeline (inside
  // assembleSpec) each re-run the algorithm themselves for the operations
  // they actually need; it's a pure, cheap function, so re-running it isn't
  // worth threading operations through three call sites just to avoid.
  const { summary } = runAlgorithm({ algorithm: registeredName, input });

  const budget = planBeats({ algorithm: registeredName, input }, PREFERRED_MAX_OP_BEATS);
  if (!budget.feasible) {
    throw new EnsureSpecError(`"${registeredName}" on its canonical input can't be narrated: ${budget.infeasibleReason}`);
  }
  const opBudget = budget.perBeat.filter((b) => b.beat.startsWith("op:"));

  const budgetTable = opBudget.map((b) => `  ${b.beat}: ${b.minWords}-${b.maxWords} words`).join("\n");

  let repairError: string | undefined;
  let lastSpec: StorySpec | undefined;
  let narrateRungUsed = 0;

  for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
    const buildPrompt = (previous?: { output: string; error: string }) => {
      const correction = previous
        ? `\n\nYour previous answer was rejected: ${previous.error}\nFix it and answer again, keeping exactly ${opBudget.length} opTexts entries.`
        : repairError
          ? `\n\nThe previously assembled video failed a check: ${repairError}\nWrite different narration that avoids this.`
          : "";
      return (
        `Topic: ${req.topic}\nAlgorithm: ${registeredName} — ${entry.description}\n` +
        `Input for this video: ${JSON.stringify(input)}\n` +
        `What actually happens: ${summary}\n\n` +
        `Write exactly ${opBudget.length} "opTexts" entries, one per animation beat below, in order, each within ` +
        `its word range (a beat needs at least that many words or its animation step won't get enough screen ` +
        `time to render):\n${budgetTable}\n\n` +
        `Also write a short hook, an outro line, the complexity (time/space), and YouTube title/description/tags. ` +
        `Never invent what the algorithm does beyond what's stated above — describe only real values from the ` +
        `given input.${correction}`
      );
    };

    let result;
    try {
      result = await runLadder(
        narrateRungs(),
        buildPrompt,
        (raw) => narrationDraftSchema.parse(parseJsonAnswer(raw)),
        deps.writeNarration ? { generateText: deps.writeNarration } : {},
      );
    } catch (err) {
      if (err instanceof LadderExhaustedError) {
        throw new EnsureSpecError(`narration generation exhausted every rung:\n${err.message}`);
      }
      throw err;
    }
    narrateRungUsed = result.rungIndex;

    if (result.value.opTexts.length !== opBudget.length) {
      repairError = `expected exactly ${opBudget.length} opTexts, got ${result.value.opTexts.length}`;
      continue;
    }
    const tooShort = result.value.opTexts
      .map((text, i) => ({ i, words: text.trim().split(/\s+/).filter(Boolean).length }))
      .filter(({ i, words }) => words < opBudget[i]!.minWords);
    if (tooShort.length > 0) {
      repairError = tooShort.map(({ i }) => `${opBudget[i]!.beat} needs at least ${opBudget[i]!.minWords} words`).join("; ");
      continue;
    }

    const spec = assembleSpec(req.topic, registeredName, input, result.value);
    lastSpec = spec;

    const validation = validateSpec(spec);
    const render = checkRender(spec);
    if (validation.valid && render.pass) {
      return { spec, selectRung, narrateRung: narrateRungUsed, repairRounds: round - 1, notes };
    }
    repairError = [...validation.errors, ...render.failures.filter((f) => f.severity === "error").map((f) => f.message)].join("; ");
  }

  throw new EnsureSpecError(
    `could not assemble a spec that passes validate_spec/check_render in ${MAX_REPAIR_ROUNDS} rounds. ` +
      `Last error: ${repairError}. Last attempted spec: ${JSON.stringify(lastSpec)}`,
  );
}

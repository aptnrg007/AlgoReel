import { z } from "zod";

const narrationBeatSchema = z.object({
  beat: z
    .string()
    .regex(/^(intro|outro|op:\d+)$/, "beat must be 'intro', 'outro', or 'op:<N>'"),
  text: z.string().min(1, "narration text must not be empty"),
});

const complexitySchema = z.object({
  time: z.string().min(1),
  space: z.string().min(1),
});

const youtubeSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});

const baseSpecShape = {
  version: z.literal(1),
  topic: z.string().min(1),
  targetDurationSec: z.number().positive(),
  hook: z.string().min(1),
  narration: z.array(narrationBeatSchema).min(1),
  emphasis: z.array(z.string()),
  complexity: complexitySchema,
  youtube: youtubeSchema,
};

// Per-algorithm input schemas used to live here as a discriminatedUnion's
// branches (one literal per known algorithm). Moved to
// algorithms/index.ts's dynamic registry (each AlgorithmEntry carries its
// own inputSchema) as part of the codegen redesign — see spec/types.ts's
// StorySpec comment for the full reasoning. This schema now only checks
// the algorithm-agnostic base shape; validateSpec (spec/validate.ts) does
// a second pass afterward, looking up `input`'s expected schema from the
// registry by `algorithm`'s runtime value.
//
// Mirrors src/spec/types.ts's StorySpec. Kept as a separate zod schema
// (rather than deriving types.ts from this, or vice versa) because the two
// serve different jobs: types.ts is compile-time-only and free to use
// template-literal types like `op:${number}`; this is the runtime shape an
// agent's JSON actually gets checked against (PLAN.md §5 — cheap, no
// render, so an agent can self-correct before spending render time).
export const storySpecSchema = z.object({
  ...baseSpecShape,
  algorithm: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});

export type StorySpecParsed = z.infer<typeof storySpecSchema>;

// --- Narrow per-call schemas for ensureSpec.ts's toolless local agents ---
//
// script.yaml used to ask one tool-using agent to author an entire
// StorySpec while also holding a multi-round validate_spec self-correction
// loop — the exact combination this project measured a local model failing
// at (script.free.yaml's qwen3 trial: 1 success in 5). ensureSpec.ts
// generalizes ensureAlgorithm.ts's fix: move the loop into TypeScript, and
// give a local model only single-shot, narrowly-scoped completions. These
// two schemas are what those completions are constrained to via AgentForge's
// output.schema (which, for a *toolless* Ollama agent, becomes real
// grammar-constrained decoding — see internal/provider/ollama.go's
// ollamaFormat, which only withholds native `format` when tools are
// registered). Regenerated into algoreel-agents/agents/schemas/ by
// scripts/generate-story-spec-schema.ts, same as storySpecSchema above.

// select-algorithm.yaml's output. Deliberately generic (no registry-derived
// enum on `algorithm`) so this schema stays static and committed rather
// than regenerated per call from whatever's in the live registry at that
// moment — ensureSpec.ts validates the choice against the real registry
// (src/algorithms/index.ts) afterward and retries with a corrective prompt
// on a miss, the same shape ensureAlgorithm.ts's own retry loop already
// uses for a different kind of failure.
//
// No `input` field, deliberately — confirmed live against Ollama 0.32.14
// that an open-shaped z.record() field (needed since different algorithms
// take different input shapes) breaks under grammar-constrained decoding:
// asking for {array:[1,2,3], target:3} came back as
// {array: {type:"integer", values:[1,2,3]}, target: {type:"integer",
// value:3}} — the JSON-Schema-to-GBNF conversion mishandles an
// additionalProperties-typed object once real values need to fit inside
// it. ensureSpec.ts picks input deterministically from a small canonical
// table instead (the same "fixed sample, not whatever the video needs"
// philosophy ensureAlgorithm.ts's own VALIDATION_ARRAY/VALIDATION_GRAPH
// already use, and every committed demo spec's input is already a generic
// example rather than topic-derived — see specs/*.json).
export const algorithmChoiceSchema = z.object({
  algorithm: z.string().min(1),
  structure: z.enum(["array", "graph", "other"]),
});

// narrate.yaml's output. Notably NOT { narration: [{beat, text}] } — that
// shape makes "op:N beats numbered consecutively from 0, no gaps" the
// model's problem, and validate.ts's semanticErrors shows that's exactly
// one of the invariants local models break most. opTexts is a plain
// ordered array of strings instead: the model only ever writes content, and
// ensureSpec.ts zips opTexts[i] to "op:i" mechanically, which makes a
// numbering gap structurally impossible rather than merely checked for.
// Also deliberately excludes version/topic/algorithm/input/emphasis/
// targetDurationSec — every one of those is set or derived mechanically in
// ensureSpec.ts from facts the orchestrator already has (the chosen
// algorithm, run_algorithm's real trace, buildTimeline's real duration), so
// asking a model to restate them is one more way to introduce drift.
export const narrationDraftSchema = z.object({
  hook: z.string().min(1),
  opTexts: z.array(z.string().min(1)).min(1),
  outroText: z.string().min(1),
  complexity: complexitySchema,
  youtube: youtubeSchema,
});

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

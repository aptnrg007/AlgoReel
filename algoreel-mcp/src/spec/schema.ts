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

export const binarySearchInputSchema = z.object({
  array: z.array(z.number()).min(1),
  target: z.number(),
});

export const bubbleSortInputSchema = z.object({
  array: z.array(z.number()).min(1),
});

// Keyed the same way as src/algorithms/index.ts's ALGORITHMS registry, so
// the MCP `run_algorithm` tool can validate a bare (algorithm, input) pair
// without needing a full StorySpec around it.
export const ALGORITHM_INPUT_SCHEMAS = {
  binarySearch: binarySearchInputSchema,
  bubbleSort: bubbleSortInputSchema,
} as const;

// Mirrors src/spec/types.ts's StorySpec. Kept as a separate zod schema
// (rather than deriving types.ts from this, or vice versa) because the two
// serve different jobs: types.ts is compile-time-only and free to use
// template-literal types like `op:${number}`; this is the runtime shape an
// agent's JSON actually gets checked against (PLAN.md §5 — cheap, no
// render, so an agent can self-correct before spending render time).
export const storySpecSchema = z.discriminatedUnion("algorithm", [
  z.object({ ...baseSpecShape, algorithm: z.literal("binarySearch"), input: binarySearchInputSchema }),
  z.object({ ...baseSpecShape, algorithm: z.literal("bubbleSort"), input: bubbleSortInputSchema }),
]);

export type StorySpecParsed = z.infer<typeof storySpecSchema>;

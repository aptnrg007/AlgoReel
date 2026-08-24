import { z } from "zod";

import { bfs } from "./bfs";
import { binarySearch } from "./binarySearch";
import { bubbleSort } from "./bubbleSort";
import { checkBalancedParens } from "./checkBalancedParens";
import { GENERATED } from "./generated/manifest";
import { inorderTraversal } from "./inorderTraversal";
import { reverseLinkedList } from "./reverseLinkedList";
import type { AlgorithmResult } from "./types";

// One registry entry per algorithm — consolidates what used to be split
// across this file's ALGORITHMS map and spec/schema.ts's
// ALGORITHM_INPUT_SCHEMAS into a single place, so "is this algorithm
// known" and "does its input match" are one lookup instead of two things
// that could drift out of sync.
export interface AlgorithmEntry {
  name: string;
  description: string;
  inputHint: string;
  inputSchema: z.ZodTypeAny;
  generated: boolean;
  run: (input: never) => AlgorithmResult;
}

const registry = new Map<string, AlgorithmEntry>();

function register(entry: AlgorithmEntry): void {
  registry.set(entry.name, entry);
}

register({
  name: "binarySearch",
  description: "Find a target in a sorted array by repeatedly halving the search range.",
  inputHint: "{ array: number[] (sorted ascending), target: number }",
  inputSchema: z.object({ array: z.array(z.number()).min(1), target: z.number() }),
  generated: false,
  run: binarySearch as AlgorithmEntry["run"],
});

register({
  name: "bubbleSort",
  description: "Sort an array by repeatedly swapping adjacent out-of-order elements.",
  inputHint: "{ array: number[] }",
  inputSchema: z.object({ array: z.array(z.number()).min(1) }),
  generated: false,
  run: bubbleSort as AlgorithmEntry["run"],
});

register({
  name: "bfs",
  description: "Traverse a graph breadth-first from a start node, visiting nearest nodes first.",
  inputHint: "{ nodes: string[], edges: [string, string][], start: string }",
  inputSchema: z.object({
    nodes: z.array(z.string().min(1)).min(1),
    edges: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
    start: z.string().min(1),
  }),
  generated: false,
  run: bfs as AlgorithmEntry["run"],
});

register({
  name: "reverseLinkedList",
  description: "Reverse a singly linked list in one pass by rewiring each node's next pointer to its predecessor.",
  inputHint: "{ list: number[] }",
  inputSchema: z.object({ list: z.array(z.number()).min(2) }),
  generated: false,
  run: reverseLinkedList as AlgorithmEntry["run"],
});

register({
  name: "inorderTraversal",
  description: "Visit every node of a binary tree in left-node-right order, recursively.",
  inputHint: "{ tree: number[] } (level-order complete binary tree — index i's children at 2i+1, 2i+2)",
  inputSchema: z.object({ tree: z.array(z.number()).min(1) }),
  generated: false,
  run: inorderTraversal as AlgorithmEntry["run"],
});

register({
  name: "checkBalancedParens",
  description: "Check whether a string's brackets are balanced by pushing openers and popping on closers.",
  inputHint: '{ expression: string } (e.g. "(()())")',
  inputSchema: z.object({ expression: z.string().min(1) }),
  generated: false,
  run: checkBalancedParens as AlgorithmEntry["run"],
});

// Every algorithm named here at module load is hand-written and known at
// compile time. Anything produced by sandbox.ts's codegen path
// (PLAN.md's Phase A) is loaded via the static GENERATED import above —
// see generated/manifest.ts's own comment for why it has to be a static
// import rather than a runtime directory scan. This is the deliberate
// tradeoff that comes with a dynamic registry instead of the old
// exhaustive switch: adding an algorithm is no longer a compile-time-
// checked event, but the registry can now grow without editing this file.
for (const [name, { description, run }] of Object.entries(GENERATED)) {
  registerGenerated(name, description, run as AlgorithmEntry["run"]);
}

// Registers a codegen-produced algorithm (PLAN.md's Phase A) into the
// live in-memory registry — called both when loading previously-cached
// files at startup and immediately after sandbox.ts validates and caches
// a brand new one, so a second request for the same algorithm within the
// same process also skips the sandbox, not just after a restart. Phase A
// is array-only, so the input contract is fixed for every generated
// entry regardless of name.
export function registerGenerated(name: string, description: string, run: AlgorithmEntry["run"]): void {
  register({
    name,
    description,
    inputHint: "{ array: number[] }",
    inputSchema: z.object({ array: z.array(z.number()).min(1) }),
    generated: true,
    run,
  });
}

export function listAlgorithms(): Array<{ name: string; description: string; inputHint: string; generated: boolean }> {
  return [...registry.values()].map(({ name, description, inputHint, generated }) => ({ name, description, inputHint, generated }));
}

export function getAlgorithm(name: string): AlgorithmEntry | undefined {
  return registry.get(name);
}

// Normalizes the same way sandbox.ts's generated-file keys already are —
// lowercase, letters only. Exported so sandbox.ts's collision/fast-path
// checks compare apples to apples: generated entries are registered under
// an already-normalized name (e.g. "mergesort"), but hand-written entries
// are registered under their real camelCase name ("binarySearch",
// "bubbleSort"), so a plain registry.get(normalizedKey) silently misses
// every hand-written entry except "bfs" (the one name that happens to
// normalize to itself). Found live while building the algorithm agent's
// retry loop.
export function normalizeAlgorithmName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export function getAlgorithmByNormalizedName(key: string): AlgorithmEntry | undefined {
  for (const entry of registry.values()) {
    if (normalizeAlgorithmName(entry.name) === key) return entry;
  }
  return undefined;
}

export function isKnownAlgorithm(name: string): boolean {
  return registry.has(name);
}

export function runAlgorithmByName(name: string, input: unknown): AlgorithmResult {
  const entry = registry.get(name);
  if (!entry) {
    throw new Error(`unknown algorithm "${name}" — call list_algorithms first, or submit new code via run_algorithm's {name, code, input} form`);
  }
  return entry.run(input as never);
}

export function runAlgorithm(spec: { algorithm: string; input: unknown }): AlgorithmResult {
  return runAlgorithmByName(spec.algorithm, spec.input);
}

import type { AlgorithmResult, Operation } from "./types";

export interface ReverseLinkedListInput {
  list: number[];
}

/**
 * Pure, deterministic — same boundary as binarySearch.ts/bubbleSort.ts/
 * bfs.ts (PLAN.md §2). Hand-written, not sandboxed codegen: this was the
 * first algorithm to prove the node/link operation vocabulary (types.ts's
 * struct/link/nodeState/nodePointer) the same way the three original
 * hand-written algorithms proved the array vocabulary before Phase A's
 * codegen generalized it. `input.list` is turned into id-keyed nodes
 * (n0, n1, ...) because every "link" addresses nodes by id, not array
 * index — a rewired next-pointer has to be able to point anywhere, not
 * just to a neighboring index.
 *
 * The real, honest mechanism: one pass, three pointers (prev/curr/next),
 * each node's next-pointer rewired to its predecessor. Never compares or
 * swaps a value — this is exactly the distinction script.yaml's honesty
 * instructions call out as the thing past specs got wrong.
 */
export function reverseLinkedList({ list }: ReverseLinkedListInput): AlgorithmResult {
  const ids = list.map((_, i) => `n${i}`);
  const nodes = list.map((value, i) => ({ id: ids[i]!, value }));
  const nextOf = new Map<string, string | null>();
  ids.forEach((id, i) => nextOf.set(id, ids[i + 1] ?? null));

  const operations: Operation[] = [{ type: "struct", layout: "row", nodes }];
  // "struct" only declares the nodes, not their links (a directed
  // structure's shape isn't known up front the way a graph's fixed edge
  // set is) — so the initial forward chain has to be built explicitly,
  // one "link" per node, exactly like every link this algorithm rewires
  // later. The last node's next is null, which is simply the absence of
  // a "next" link for it, not a link to emit.
  for (let i = 0; i < ids.length - 1; i++) {
    operations.push({ type: "link", from: ids[i]!, slot: "next", to: ids[i + 1]! });
  }
  operations.push({ type: "nodePointer", name: "head", node: ids[0]! });
  operations.push({ type: "nodePointer", name: "prev", node: null });
  operations.push({ type: "nodePointer", name: "curr", node: ids[0]! });

  let prev: string | null = null;
  let curr: string | null = ids[0]!;
  while (curr !== null) {
    // A "focus" nodeState is the step boundary (src/spec/beats.ts) — one
    // primary step per node visited, the node analog of one comparison in
    // bubbleSort or one node processed in bfs.
    operations.push({ type: "nodeState", nodes: [curr], state: "focus" });
    const next: string | null = nextOf.get(curr) ?? null;
    operations.push({ type: "link", from: curr, slot: "next", to: prev });
    operations.push({ type: "nodePointer", name: "prev", node: curr });
    operations.push({ type: "nodePointer", name: "curr", node: next });
    prev = curr;
    curr = next;
  }

  operations.push({ type: "nodePointer", name: "head", node: prev });
  operations.push({ type: "done" });

  const summary =
    list.length < 2
      ? `Reversed a ${list.length}-node linked list — nothing to rewire.`
      : `Reversed a ${list.length}-node linked list in one pass by rewiring each node's next pointer to ` +
        `point at its predecessor. Head moved from ${list[0]} to ${list[list.length - 1]}. No values were ` +
        `ever compared or swapped — only pointers changed.`;

  return { operations, summary };
}

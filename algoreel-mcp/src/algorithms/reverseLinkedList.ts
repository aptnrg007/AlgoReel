import type { AlgorithmResult, Operation } from "./types";

export interface ReverseLinkedListInput {
  list: number[];
}

/**
 * Pure, deterministic — same boundary as binarySearch.ts/bubbleSort.ts/
 * bfs.ts (PLAN.md §2). Hand-written, not sandboxed codegen: this proves
 * the new linked-list operation vocabulary (types.ts's list/relink/
 * listPointer/listFocus) the same way the three original hand-written
 * algorithms proved the array vocabulary before Phase A's codegen
 * generalized it. `input.list` is turned into id-keyed nodes (n0, n1, ...)
 * because every list operation addresses nodes by id, not array index —
 * a rewired next-pointer has to be able to point anywhere, not just to a
 * neighboring index.
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

  const operations: Operation[] = [{ type: "list", nodes }];
  operations.push({ type: "listPointer", name: "head", node: ids[0]! });
  operations.push({ type: "listPointer", name: "prev", node: null });
  operations.push({ type: "listPointer", name: "curr", node: ids[0]! });

  let prev: string | null = null;
  let curr: string | null = ids[0]!;
  while (curr !== null) {
    // "listFocus" is the step boundary (src/spec/beats.ts) — one primary
    // step per node visited, the linked-list analog of one comparison in
    // bubbleSort or one node processed in bfs.
    operations.push({ type: "listFocus", nodes: [curr] });
    const next: string | null = nextOf.get(curr) ?? null;
    operations.push({ type: "relink", from: curr, to: prev });
    operations.push({ type: "listPointer", name: "prev", node: curr });
    operations.push({ type: "listPointer", name: "curr", node: next });
    prev = curr;
    curr = next;
  }

  operations.push({ type: "listPointer", name: "head", node: prev });
  operations.push({ type: "done" });

  const summary =
    list.length < 2
      ? `Reversed a ${list.length}-node linked list — nothing to rewire.`
      : `Reversed a ${list.length}-node linked list in one pass by rewiring each node's next pointer to ` +
        `point at its predecessor. Head moved from ${list[0]} to ${list[list.length - 1]}. No values were ` +
        `ever compared or swapped — only pointers changed.`;

  return { operations, summary };
}

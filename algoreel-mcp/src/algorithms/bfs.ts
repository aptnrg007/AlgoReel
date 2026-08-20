import type { AlgorithmResult, Operation } from "./types";

export interface BFSInput {
  nodes: string[];
  edges: [string, string][];
  start: string;
}

/**
 * Pure, deterministic — same boundary as binarySearch.ts and bubbleSort.ts
 * (PLAN.md §2). Reuses the existing graph operation types (graph/enqueue/
 * dequeue/visit/edge/done) with no new variants beyond "graph" itself,
 * which types.ts documents as the graph analog of "init".
 */
export function bfs({ nodes, edges, start }: BFSInput): AlgorithmResult {
  if (!nodes.includes(start)) {
    throw new Error(`bfs requires start ("${start}") to be one of nodes`);
  }
  for (const [a, b] of edges) {
    if (!nodes.includes(a) || !nodes.includes(b)) {
      throw new Error(`bfs edge [${a}, ${b}] references a node not in nodes`);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const [a, b] of edges) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  // Sort each node's neighbors so traversal order is deterministic
  // regardless of the order edges were declared in.
  for (const list of adjacency.values()) list.sort();

  const operations: Operation[] = [{ type: "graph", nodes: [...nodes], edges: [...edges] }];
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  const order: string[] = [];

  operations.push({ type: "enqueue", node: start });

  while (queue.length > 0) {
    const node = queue.shift()!;
    // "dequeue" is the step boundary (see src/spec/beats.ts) — one primary
    // step per node processed, the graph analog of one comparison in
    // bubbleSort or one loop iteration in binarySearch.
    operations.push({ type: "dequeue", node });
    operations.push({ type: "visit", node });
    order.push(node);

    for (const neighbor of adjacency.get(node)!) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        operations.push({ type: "edge", from: node, to: neighbor, state: "active" });
        operations.push({ type: "enqueue", node: neighbor });
        queue.push(neighbor);
      }
    }
  }

  operations.push({ type: "done" });

  const unreachable = nodes.length - order.length;
  const summary =
    unreachable > 0
      ? `Visited ${order.length} of ${nodes.length} nodes from "${start}" in BFS order (${unreachable} unreachable): ${order.join(" -> ")}.`
      : `Visited all ${nodes.length} nodes from "${start}" in BFS order: ${order.join(" -> ")}.`;

  return { operations, summary };
}

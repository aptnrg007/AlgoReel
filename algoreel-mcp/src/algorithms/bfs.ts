import { inferLayout } from "../../remotion/primitives/layout";
import type { AlgorithmResult, Operation } from "./types";

export interface BFSInput {
  nodes: string[];
  edges: [string, string][];
  start: string;
}

/**
 * Pure, deterministic — same boundary as binarySearch.ts and bubbleSort.ts
 * (PLAN.md §2). Reuses the generic node/link operation vocabulary
 * (types.ts's struct/nodeState/linkState) — a graph is a "circle"-layout
 * structure with a fixed, undirected edge set, no different in kind from
 * a linked list's "row"-layout directed one.
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

  const operations: Operation[] = [
    { type: "struct", layout: inferLayout("graph"), nodes: nodes.map((id) => ({ id, value: id })), edges: [...edges] },
  ];
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  const order: string[] = [];
  // Edges lit "active" the moment they discover a new neighbor settle to
  // "used" (still visible, just no longer the newest thing) the next time
  // any node is dequeued — the graph analog of a "focus" highlight
  // settling once a new step begins. Tracked here, not in the generic
  // renderer (remotion/primitives/state.ts): this is bfs's own traversal
  // semantics, not something every node/link structure needs.
  let activeEdges: [string, string][] = [];

  operations.push({ type: "nodeState", nodes: [start], state: "pending" });

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const [a, b] of activeEdges) {
      operations.push({ type: "linkState", from: a, to: b, state: "used" });
    }
    activeEdges = [];

    // "focus" is the step boundary (src/spec/beats.ts) — one primary step
    // per node processed, the graph analog of one comparison in
    // bubbleSort or one rewired pointer in reverseLinkedList.
    operations.push({ type: "nodeState", nodes: [node], state: "focus" });
    operations.push({ type: "nodeState", nodes: [node], state: "done" });
    order.push(node);

    for (const neighbor of adjacency.get(node)!) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        operations.push({ type: "linkState", from: node, to: neighbor, state: "active" });
        activeEdges.push([node, neighbor]);
        operations.push({ type: "nodeState", nodes: [neighbor], state: "pending" });
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

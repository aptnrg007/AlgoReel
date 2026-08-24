import type { Operation } from "./types";

// The instrumentation boundary for generated graph-traversal algorithms
// (mirrors trace.ts's TracedArray exactly, one level up the determinism
// boundary — PLAN.md §2): an LLM never writes an Operation directly, it
// writes ordinary-looking traversal code against this graph API instead,
// and every meaningful action is logged as a side effect. Deliberately
// minimal — the same reason TracedArray is just get/set/compare/swap:
// a small, simple API is what makes this a realistic ask of a 14B local
// model.
export interface TracedGraph {
  readonly nodes: readonly string[];
  readonly start: string;
  // Sorted ascending — deterministic regardless of the order edges were
  // declared in, the same convention bfs.ts's own adjacency lists use.
  // This determinism is exactly what makes a reference implementation a
  // valid oracle (sandbox.ts's referenceBFSOrder/referenceDFSOrder): any
  // correct BFS or DFS built on this exact neighbor order produces one
  // specific, predictable visit order.
  neighbors(node: string): string[];
  isVisited(node: string): boolean;
  // Marks a node visited — logs a "focus" nodeState (the step boundary,
  // src/spec/beats.ts) then "done", the same pair bfs.ts's own
  // dequeue+visit sequence produces by hand.
  visit(node: string): void;
  // Logs a link actually being used to move between two nodes — the
  // graph analog of trace.compare() being the thing that must actually
  // get called for the video to show anything happening on an edge.
  traverseEdge(from: string, to: string): void;
}

export function createTracedGraph(
  nodes: string[],
  edges: [string, string][],
  start: string,
): { trace: TracedGraph; operations: Operation[] } {
  const operations: Operation[] = [
    { type: "struct", layout: "circle", nodes: nodes.map((id) => ({ id, value: id })), edges: [...edges] },
  ];

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const [a, b] of edges) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  for (const list of adjacency.values()) list.sort();

  const visited = new Set<string>();

  const trace: TracedGraph = {
    nodes: [...nodes],
    start,
    neighbors(node) {
      return [...(adjacency.get(node) ?? [])];
    },
    isVisited(node) {
      return visited.has(node);
    },
    visit(node) {
      visited.add(node);
      operations.push({ type: "nodeState", nodes: [node], state: "focus" });
      operations.push({ type: "nodeState", nodes: [node], state: "done" });
    },
    traverseEdge(from, to) {
      operations.push({ type: "linkState", from, to, state: "active" });
    },
  };

  return { trace, operations };
}

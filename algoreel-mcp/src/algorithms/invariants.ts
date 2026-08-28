import { replay } from "../../remotion/primitives/state";
import type { Operation } from "./types";

// A small library of *structural* correctness invariants, checkable from
// an algorithm's real, already-executed trace (via remotion/primitives/
// state.ts's replay — the same interpreter the renderer itself uses, so
// this never becomes a second, driftable definition of "what state did
// this trace produce"). The point, concretely: sandbox.ts's existing
// oracles are one bespoke correctness check per algorithm *family*
// (array sort-order comparison, referenceBFSOrder/referenceDFSOrder) —
// this file asks whether a small, reusable, name-free set of properties
// can replace some of those without writing a new reference
// implementation for every new structure. The honest answer, found by
// actually building and testing this against bubbleSort/bfs/the real
// committed generated dfs/bstInsert (invariants.test.ts): partially.
//
// Where it's a real win, no reference implementation needed at all:
// - isSorted + isSameMultiset (array family) — and this is not a new
//   idea, it's a *retroactive* finding: sandbox.ts's actual array oracle
//   ("does the result equal the input sorted ascending") is already
//   logically identical to this pair, just written as one bespoke
//   comparison instead of two named, reusable checks.
// - isOrderedBst + isSameMultiset (tree family) — genuinely checks
//   *shape*, independent of which strategy (insert, delete, rebuild)
//   produced it. No referenceBstInsert needed.
// - satisfiesShortestPathCertificate (shortest-path family) — a real,
//   standalone mathematical certificate (the relaxation / triangle-
//   inequality condition), not a simulation of "the right algorithm."
//
// Where it's reusable but NOT cheaper — a finding worth keeping, not
// hiding:
// - reachableAll + parentConsistency are genuinely reference-free (pure
//   structural properties), but BFS and DFS both satisfy them equally —
//   they can't tell a DFS submitted under the name "bfs" from the real
//   thing (exactly the case sandbox.test.ts's "a real DFS submitted
//   under the name 'breadthfirstsearch'... is rejected" exists to catch).
// - matchesQueueDiscipline/matchesStackDiscipline close that gap, but by
//   simulating the correct order — which is exactly what
//   referenceBFSOrder/referenceDFSOrder already do. Renaming them
//   doesn't eliminate the reference computation for an order-sensitive
//   family; the only real gain is that one generic simulator now serves
//   any future queue/stack-discipline algorithm, not just bfs/dfs by name.

export function isSorted(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false;
  }
  return true;
}

export function isSameMultiset(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

export function finalArrayFromTrace(operations: Operation[]): number[] {
  return replay(operations).array;
}

export interface StructSnapshot {
  nodes: { id: string; value: string | number }[];
  links: { from: string; slot: string; to: string }[];
}

export function structSnapshotFromTrace(operations: Operation[]): StructSnapshot {
  const state = replay(operations);
  return { nodes: state.structNodes, links: state.structLinks };
}

// Classic BST invariant, checked directly against a node/link snapshot —
// for every node, its entire left subtree is strictly less and its
// entire right subtree is strictly greater. No notion of "insert" or
// "delete" anywhere in this function; it only ever looks at the shape a
// trace ended up in.
export function isOrderedBst(snapshot: StructSnapshot): boolean {
  const valueOf = new Map(snapshot.nodes.map((n) => [n.id, Number(n.value)]));
  const leftOf = new Map<string, string>();
  const rightOf = new Map<string, string>();
  const hasParent = new Set<string>();
  for (const link of snapshot.links) {
    if (link.slot === "left") leftOf.set(link.from, link.to);
    else if (link.slot === "right") rightOf.set(link.from, link.to);
    hasParent.add(link.to);
  }
  const roots = snapshot.nodes.filter((n) => !hasParent.has(n.id));
  if (roots.length !== 1) return false;

  function valid(id: string | undefined, lo: number, hi: number): boolean {
    if (id === undefined) return true;
    const value = valueOf.get(id);
    if (value === undefined || !(value > lo && value < hi)) return false;
    return valid(leftOf.get(id), lo, value) && valid(rightOf.get(id), value, hi);
  }
  return valid(roots[0]!.id, -Infinity, Infinity);
}

export function buildAdjacency(nodeIds: string[], edges: [string, string][]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const [a, b] of edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  for (const list of adjacency.values()) list.sort();
  return adjacency;
}

// Every node reachable from start was actually visited, and nothing
// outside the reachable set was, with no duplicate visits. Order-free —
// BFS and DFS satisfy this equally.
export function reachableAll(adjacency: Map<string, string[]>, start: string, visitOrder: string[]): boolean {
  const reached = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const n of adjacency.get(node) ?? []) {
      if (!reached.has(n)) {
        reached.add(n);
        stack.push(n);
      }
    }
  }
  const visited = new Set(visitOrder);
  if (visited.size !== visitOrder.length) return false;
  if (reached.size !== visited.size) return false;
  for (const id of reached) if (!visited.has(id)) return false;
  return true;
}

// Every non-start node was visited only after some node adjacent to it
// (a real graph edge, not a fabricated jump) had already been visited.
// Also order-free.
export function parentConsistency(adjacency: Map<string, string[]>, start: string, visitOrder: string[]): boolean {
  if (visitOrder[0] !== start) return false;
  const visitedSoFar = new Set<string>([start]);
  for (let i = 1; i < visitOrder.length; i++) {
    const node = visitOrder[i]!;
    const neighbors = adjacency.get(node) ?? [];
    if (!neighbors.some((n) => visitedSoFar.has(n))) return false;
    visitedSoFar.add(node);
  }
  return true;
}

// Order-sensitive — see this file's header comment: this is
// referenceBFSOrder (sandbox.ts) under a name that doesn't mention BFS,
// not a cheaper way to check the same thing.
export function matchesQueueDiscipline(adjacency: Map<string, string[]>, start: string, visitOrder: string[]): boolean {
  const visited = new Set([start]);
  const queue = [start];
  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return order.length === visitOrder.length && order.every((v, i) => v === visitOrder[i]);
}

// referenceDFSOrder under a name that doesn't mention DFS — same honest
// limit as matchesQueueDiscipline above.
export function matchesStackDiscipline(adjacency: Map<string, string[]>, start: string, visitOrder: string[]): boolean {
  const visited = new Set<string>();
  const order: string[] = [];
  function visit(node: string): void {
    visited.add(node);
    order.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!visited.has(neighbor)) visit(neighbor);
    }
  }
  visit(start);
  return order.length === visitOrder.length && order.every((v, i) => v === visitOrder[i]);
}

// "done" is every structure's settle-state (bfs.ts/graphTrace.ts's
// visit(), bstInsert.ts's placement) — its emission order is visit order
// for any traversal-shaped algorithm, not just bfs/dfs.
export function visitOrderFromTrace(operations: Operation[]): string[] {
  const order: string[] = [];
  for (const op of operations) {
    if (op.type === "nodeState" && op.state === "done") order.push(...op.nodes);
  }
  return order;
}

export interface WeightedEdge {
  from: string;
  to: string;
  weight: number;
}

// A self-contained proof that `dist` is a correct shortest-distance
// assignment from `start` — no Dijkstra/Bellman-Ford run required to
// check it. Not wired to any algorithm yet (none in this codebase
// produces weighted distances), but tested directly against a hand-built
// certificate (invariants.test.ts) so this is a validated claim, not
// just an assertion.
export function satisfiesShortestPathCertificate(
  nodeIds: string[],
  edges: WeightedEdge[],
  start: string,
  dist: Record<string, number>,
): boolean {
  if (dist[start] !== 0) return false;
  for (const id of nodeIds) {
    if (id === start && dist[id] !== 0) return false;
    if (id !== start && (dist[id] === undefined || dist[id]! < 0)) return false;
  }
  for (const edge of edges) {
    const du = dist[edge.from];
    const dv = dist[edge.to];
    if (du === undefined || dv === undefined) return false;
    if (dv > du + edge.weight) return false;
    if (du > dv + edge.weight) return false;
  }
  return true;
}

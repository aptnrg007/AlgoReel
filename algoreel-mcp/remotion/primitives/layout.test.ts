import assert from "node:assert/strict";
import { test } from "node:test";

import { STRUCT } from "../template/tokens";
import { computeLayout, inferLayout, type StructLink, type StructNode } from "./layout";

function nodes(ids: string[]): StructNode[] {
  return ids.map((id) => ({ id, value: id }));
}

test("row layout places nodes left to right at a fixed step, all at the same y", () => {
  const { positions, width, height } = computeLayout("row", nodes(["a", "b", "c"]), []);
  const step = STRUCT.row.size + STRUCT.row.gap;
  assert.equal(positions.a!.y, positions.b!.y);
  assert.equal(positions.b!.y, positions.c!.y);
  assert.equal(positions.b!.x - positions.a!.x, step);
  assert.equal(positions.c!.x - positions.b!.x, step);
  assert.equal(width, 2 * step + STRUCT.row.size);
  assert.equal(height, STRUCT.row.size);
});

test("column layout places nodes top to bottom at a fixed step, all at the same x", () => {
  const { positions, width, height } = computeLayout("column", nodes(["a", "b"]), []);
  const step = STRUCT.column.size + STRUCT.column.gap;
  assert.equal(positions.a!.x, positions.b!.x);
  assert.equal(positions.b!.y - positions.a!.y, step);
  assert.equal(width, STRUCT.column.size);
  assert.equal(height, step + STRUCT.column.size);
});

test("circle layout places nodes at equal radius from a shared center", () => {
  const { positions, width, height } = computeLayout("circle", nodes(["a", "b", "c", "d"]), []);
  assert.equal(width, height);
  const center = width / 2;
  for (const id of ["a", "b", "c", "d"]) {
    const p = positions[id]!;
    const dist = Math.hypot(p.x - center, p.y - center);
    assert.ok(Math.abs(dist - STRUCT.circle.radius) < 0.01, `node ${id} should sit exactly on the radius`);
  }
});

test("levels layout puts a left child left of its parent and a right child right of it", () => {
  const links: StructLink[] = [
    { from: "root", slot: "left", to: "l" },
    { from: "root", slot: "right", to: "r" },
  ];
  const { positions } = computeLayout("levels", nodes(["root", "l", "r"]), links);
  assert.ok(positions.l!.x < positions.root!.x);
  assert.ok(positions.r!.x > positions.root!.x);
  assert.ok(positions.l!.y > positions.root!.y, "a child sits one level below its parent");
  assert.equal(positions.l!.y, positions.r!.y, "siblings sit at the same depth");
});

// A tree deep enough that the pre-generalization graph/list checks could
// never have caught (both only ever looked at initial node *count*, never
// shape) — this is exactly the case checkRender.ts's structGeometryChecks
// was written to catch that its predecessors couldn't. A left-only chain
// is the classic degenerate-BST worst case, and correctly renders as a
// diagonal staircase (each deeper left child one slot further left than
// its parent) — the standard way an unbalanced tree is drawn, not a bug
// to avoid — so it grows in *both* dimensions, not just depth.
test("levels layout grows in both dimensions for a deep skewed chain", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const links: StructLink[] = ids.slice(0, -1).map((id, i) => ({ from: id, slot: "left", to: ids[i + 1]! }));
  const { width, height, positions } = computeLayout("levels", nodes(ids), links);
  assert.equal(width, 11 * (STRUCT.levels.size + STRUCT.levels.hGap) + STRUCT.levels.size);
  assert.equal(height, 11 * STRUCT.levels.vGap + STRUCT.levels.size);
  // Each deeper node sits further left than its parent.
  for (let i = 1; i < ids.length; i++) {
    assert.ok(positions[ids[i]!]!.x < positions[ids[i - 1]!]!.x);
  }
});

test("levels layout never hangs or crashes on a cyclic link", () => {
  const links: StructLink[] = [
    { from: "a", slot: "left", to: "b" },
    { from: "b", slot: "left", to: "a" },
  ];
  const { positions } = computeLayout("levels", nodes(["a", "b"]), links);
  assert.ok(positions.a);
  assert.ok(positions.b);
});

test("a node not yet reachable from any root gets its own position, not a crash", () => {
  const { positions } = computeLayout("levels", nodes(["a", "b", "c"]), []);
  assert.ok(positions.a);
  assert.ok(positions.b);
  assert.ok(positions.c);
  assert.equal(positions.a!.y, positions.b!.y, "unlinked nodes float on the same row");
});

test("empty node list produces a zero-size layout for every kind, not a crash", () => {
  for (const layout of ["row", "column", "circle", "levels"] as const) {
    const result = computeLayout(layout, [], []);
    assert.equal(result.width, 0);
    assert.deepEqual(result.positions, {});
  }
});

// inferLayout is the one place a StructureShape becomes a LayoutKind
// (types.ts's StructureShape doc-comment) — every algorithm file that
// used to hardcode a LayoutKind literal at its "struct" call site now
// calls this instead, so the mapping only needs to be right in one place.
test("inferLayout maps each structure shape to its one correct layout", () => {
  assert.equal(inferLayout("chain"), "row");
  assert.equal(inferLayout("tree"), "levels");
  assert.equal(inferLayout("graph"), "circle");
  assert.equal(inferLayout("stack"), "column");
});

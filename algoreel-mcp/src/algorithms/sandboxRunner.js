#!/usr/bin/env node
"use strict";
// The child-process side of sandbox.ts's isolation (PLAN.md's Phase A
// codegen redesign, later extended to graph traversal). Deliberately
// plain JavaScript, not TypeScript — running via `npx tsx` needs tsx's
// own module-resolution reads, which fights `node --permission`'s strict
// default-deny (confirmed live: tsx's loader can't even read its own
// files under a bare --permission). Plain `node --permission
// sandboxRunner.js` has no such friction, so this file has zero
// dependencies beyond Node's own `vm` and stdin.
//
// Consequence: the trace objects below are deliberate duplicates of
// src/algorithms/trace.ts (TracedArray) and src/algorithms/graphTrace.ts
// (TracedGraph), not shared imports — same "no clean sharing mechanism,
// so duplicate and document it" convention already used elsewhere in
// this project (script.yaml/script.free.yaml, qa.yaml/publish.yaml).
// Keep these in sync by hand if either source changes; the TypeScript
// files are the ones with real unit tests, so treat them as reference.
//
// Protocol: reads one JSON object from stdin —
//   { kind: "array", code: string, array: number[] }, or
//   { kind: "graph", code: string, nodes: string[], edges: [string,string][], start: string }
// (`code` already transpiled to plain JS by the parent) — and writes
// exactly one JSON object to stdout: { operations, result } on success
// (array kind only produces `result`; graph kind's "result" — the visit
// order — is derived by the parent from `operations` itself, the same
// way it already derives compare counts, rather than trusting a second
// value out of the sandbox), or { error } (with a non-zero exit code) on
// failure. The parent process (sandbox.ts) is the only intended caller.
const vm = require("node:vm");

const TIMEOUT_MS = 5000;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }));
  process.exit(1);
}

// A fresh context with only __trace injected — no require, no process,
// no fs; standard built-in JS globals (Array, Math, ...) are always
// present in any V8 context, but nothing Node-specific is. `timeout`
// genuinely aborts a synchronous infinite loop (V8's execution-interrupt
// mechanism, confirmed against this Node version) — the outer
// child-process boundary plus --permission is defense in depth on top of
// this, not the only thing stopping a hang.
function runInVm(code, trace) {
  const context = vm.createContext({ __trace: trace });
  const script = new vm.Script(
    `"use strict";\n${code}\nif (typeof run !== "function") { throw new Error("submitted code must define a function named 'run'"); }\nrun(__trace);`,
  );
  script.runInContext(context, { timeout: TIMEOUT_MS });
}

function runArray(payload) {
  const { code, array } = payload;
  if (typeof code !== "string" || !Array.isArray(array)) {
    return fail('expected { kind: "array", code: string, array: number[] } on stdin');
  }

  const state = array.slice();
  const operations = [{ type: "init", array: state.slice() }];

  // Mirrors src/algorithms/trace.ts's TracedArray exactly — see the
  // header comment for why this isn't a shared import.
  const trace = {
    get length() {
      return state.length;
    },
    get(i) {
      return state[i];
    },
    set(i, value) {
      state[i] = value;
      operations.push({ type: "write", index: i, value });
    },
    compare(i, j) {
      const a = state[i];
      const b = state[j];
      operations.push({ type: "highlight", indices: [i, j], style: "focus" });
      const result = a < b ? -1 : a > b ? 1 : 0;
      operations.push({ type: "compare", a, b, result: result === -1 ? "lt" : result === 1 ? "gt" : "eq" });
      return result;
    },
    swap(i, j) {
      const tmp = state[i];
      state[i] = state[j];
      state[j] = tmp;
      operations.push({ type: "swap", i, j });
    },
    toArray() {
      return state.slice();
    },
  };

  try {
    runInVm(code, trace);
  } catch (err) {
    return fail(String((err && err.message) || err));
  }
  process.stdout.write(JSON.stringify({ operations, result: trace.toArray() }));
}

function runGraph(payload) {
  const { code, nodes, edges, start } = payload;
  if (typeof code !== "string" || !Array.isArray(nodes) || !Array.isArray(edges) || typeof start !== "string") {
    return fail('expected { kind: "graph", code: string, nodes: string[], edges: [string,string][], start: string } on stdin');
  }

  const operations = [
    { type: "struct", layout: "circle", nodes: nodes.map((id) => ({ id, value: id })), edges: edges.slice() },
  ];

  // Mirrors src/algorithms/graphTrace.ts's TracedGraph exactly — see the
  // header comment for why this isn't a shared import.
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node, []);
  for (const [a, b] of edges) {
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  for (const list of adjacency.values()) list.sort();

  const visited = new Set();

  const trace = {
    nodes: nodes.slice(),
    start,
    neighbors(node) {
      return (adjacency.get(node) || []).slice();
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

  try {
    runInVm(code, trace);
  } catch (err) {
    return fail(String((err && err.message) || err));
  }
  process.stdout.write(JSON.stringify({ operations }));
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch (err) {
    return fail(`invalid input JSON: ${err.message}`);
  }

  if (payload.kind === "graph") return runGraph(payload);
  if (payload.kind === "array") return runArray(payload);
  return fail(`unknown or missing "kind" on stdin payload — expected "array" or "graph"`);
}

main().catch((err) => fail(String((err && err.message) || err)));

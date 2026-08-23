#!/usr/bin/env node
"use strict";
// The child-process side of sandbox.ts's isolation (PLAN.md's Phase A
// codegen redesign). Deliberately plain JavaScript, not TypeScript —
// running via `npx tsx` needs tsx's own module-resolution reads, which
// fights `node --permission`'s strict default-deny (confirmed live:
// tsx's loader can't even read its own files under a bare --permission).
// Plain `node --permission sandboxRunner.js` has no such friction, so
// this file has zero dependencies beyond Node's own `vm` and stdin.
//
// Consequence: the TracedArray logic below is a deliberate duplicate of
// src/algorithms/trace.ts, not a shared import — same "no clean sharing
// mechanism, so duplicate and document it" convention already used
// elsewhere in this project (script.yaml/script.free.yaml,
// qa.yaml/publish.yaml). Keep the two in sync by hand if either changes;
// trace.ts is the one with real unit tests, so treat it as the reference.
//
// Protocol: reads one JSON object from stdin — { code: string (already
// transpiled to plain JS by the parent), array: number[] } — and writes
// exactly one JSON object to stdout: { operations, result } on success,
// or { error } (with a non-zero exit code) on failure. The parent
// process (sandbox.ts) is the only intended caller.
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

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch (err) {
    return fail(`invalid input JSON: ${err.message}`);
  }

  const { code, array } = payload;
  if (typeof code !== "string" || !Array.isArray(array)) {
    return fail("expected { code: string, array: number[] } on stdin");
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
    // A fresh context with only __trace injected — no require, no
    // process, no fs; standard built-in JS globals (Array, Math, ...)
    // are always present in any V8 context, but nothing Node-specific
    // is. `timeout` genuinely aborts a synchronous infinite loop (V8's
    // execution-interrupt mechanism, confirmed against this Node
    // version) — the outer child-process boundary plus --permission is
    // defense in depth on top of this, not the only thing stopping a
    // hang.
    const context = vm.createContext({ __trace: trace });
    const script = new vm.Script(
      `"use strict";\n${code}\nif (typeof run !== "function") { throw new Error("submitted code must define a function named 'run'"); }\nrun(__trace);`,
    );
    script.runInContext(context, { timeout: TIMEOUT_MS });
  } catch (err) {
    return fail(String((err && err.message) || err));
  }

  process.stdout.write(JSON.stringify({ operations, result: trace.toArray() }));
}

main().catch((err) => fail(String((err && err.message) || err)));

import assert from "node:assert/strict";
import { test } from "node:test";

import { LadderExhaustedError, runLadder } from "./ladder";

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

test("first rung succeeding never calls a later rung", async () => {
  const calls: number[] = [];
  const result = await runLadder(
    [
      { agentPath: "local.yaml", maxAttempts: 3 },
      { agentPath: "paid.yaml", maxAttempts: 1 },
    ],
    () => "prompt",
    parseJson,
    {
      generateText: async (_prompt, rungIndex) => {
        calls.push(rungIndex);
        return JSON.stringify({ ok: true });
      },
    },
  );
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.rungIndex, 0);
  assert.deepEqual(calls, [0]);
});

test("a rung's real error is fed into the next attempt's prompt", async () => {
  const prompts: string[] = [];
  let call = 0;
  const result = await runLadder(
    [{ agentPath: "local.yaml", maxAttempts: 3 }],
    (previous) => {
      const prompt = previous ? `retry after: ${previous.error}` : "first attempt";
      prompts.push(prompt);
      return prompt;
    },
    (raw) => {
      if (raw === "bad") throw new Error("model produced garbage");
      return parseJson(raw);
    },
    {
      generateText: async () => {
        call++;
        return call === 1 ? "bad" : JSON.stringify({ ok: true });
      },
    },
  );
  assert.deepEqual(result.value, { ok: true });
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], "first attempt");
  assert.match(prompts[1]!, /model produced garbage/);
});

test("a rung is skipped entirely when its requiresEnv var is unset", async () => {
  delete process.env.ALGOREEL_TEST_FAKE_KEY;
  const calls: number[] = [];
  const result = await runLadder(
    [
      { agentPath: "paid.yaml", requiresEnv: "ALGOREEL_TEST_FAKE_KEY", maxAttempts: 1 },
      { agentPath: "local.yaml", maxAttempts: 1 },
    ],
    () => "prompt",
    parseJson,
    {
      generateText: async (_prompt, rungIndex) => {
        calls.push(rungIndex);
        return JSON.stringify({ ok: true });
      },
    },
  );
  assert.equal(result.rungIndex, 1);
  assert.deepEqual(calls, [1], "the paid rung must never be called when its env var is unset");
});

test("escalates to a later rung only after the earlier one exhausts its attempts, and only then calls it", async () => {
  process.env.ALGOREEL_TEST_FAKE_KEY = "present";
  try {
    const calls: number[] = [];
    const result = await runLadder(
      [
        { agentPath: "local.yaml", maxAttempts: 2 },
        { agentPath: "paid.yaml", requiresEnv: "ALGOREEL_TEST_FAKE_KEY", maxAttempts: 1 },
      ],
      () => "prompt",
      (raw) => {
        if (raw === "bad") throw new Error("still bad");
        return parseJson(raw);
      },
      {
        generateText: async (_prompt, rungIndex) => {
          calls.push(rungIndex);
          return rungIndex === 0 ? "bad" : JSON.stringify({ ok: true, via: "paid" });
        },
      },
    );
    assert.equal(result.rungIndex, 1);
    assert.deepEqual(result.value, { ok: true, via: "paid" });
    // local.yaml called exactly maxAttempts (2) times before escalating, not
    // fewer (no speculative escalation) and not more (exhausted, not retried
    // forever).
    assert.deepEqual(calls, [0, 0, 1]);
  } finally {
    delete process.env.ALGOREEL_TEST_FAKE_KEY;
  }
});

test("every rung exhausted throws LadderExhaustedError carrying every attempt's error", async () => {
  await assert.rejects(
    runLadder(
      [{ agentPath: "local.yaml", maxAttempts: 3 }],
      () => "prompt",
      () => {
        throw new Error("always bad");
      },
      { generateText: async () => "irrelevant" },
    ),
    (err: unknown) => {
      assert.ok(err instanceof LadderExhaustedError);
      assert.equal(err.attempts.length, 3);
      assert.ok(err.attempts.every((a) => a.error === "always bad"));
      return true;
    },
  );
});

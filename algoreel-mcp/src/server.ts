#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getAlgorithm, listAlgorithms, runAlgorithmByName } from "./algorithms/index";
import { ensureAlgorithm, EnsureAlgorithmError } from "./algorithms/ensureAlgorithm";
import { generateAndValidateAlgorithm, GenerateAlgorithmError } from "./algorithms/sandbox";
import type { Operation } from "./algorithms/types";
import { splitPrimarySteps } from "./spec/beats";
import { checkRender } from "./spec/checkRender";
import { sampleFrames } from "./render/frameSampler";
import { validateSpec } from "./spec/validate";
import type { StorySpec } from "./spec/types";
import { buildTimeline } from "../remotion/buildTimeline";
import { FRAME } from "../remotion/template/tokens";
import { estimateBeatFrames, HOOK_DURATION_SEC } from "../remotion/timing";

const execFileAsync = promisify(execFile);

// This file is the MCP boundary described in PLAN.md §3: everything above
// this line (src/algorithms, src/spec) is pure TypeScript with no LLM
// involvement anywhere. This server exposes that engine as tools; it never
// makes an algorithmic decision itself, only runs the deterministic code
// and reports back.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "out");
const OPERATIONS_DIR = join(OUT_DIR, "operations");
const PREVIEWS_DIR = join(OUT_DIR, "previews");
const FINAL_DIR = join(OUT_DIR, "final");
const TMP_DIR = join(OUT_DIR, "tmp");
for (const dir of [OPERATIONS_DIR, PREVIEWS_DIR, FINAL_DIR, TMP_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const server = new McpServer({ name: "algoreel", version: "0.1.0" });

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

server.registerTool(
  "list_algorithms",
  {
    description:
      "List the algorithms available to build a StorySpec around, with their input shapes. Includes both hand-written algorithms and any previously generated-and-validated ones (see run_algorithm's {name, description, code} form) — a name already listed here should always be run via {algorithm, input}, never regenerated.",
  },
  async () => {
    const list = listAlgorithms().map(({ name, description, inputHint, generated }) => ({
      name,
      description,
      input: inputHint,
      generated,
    }));
    return text(JSON.stringify(list, null, 2));
  },
);

server.registerTool(
  "validate_spec",
  {
    description:
      "Check a full StorySpec (topic, algorithm, input, hook, narration, emphasis, complexity, youtube) for shape and semantic errors, without rendering anything. Call this before render_preview — it's free.",
    inputSchema: { spec: z.record(z.string(), z.unknown()) },
  },
  async ({ spec }) => {
    const result = validateSpec(spec);
    return text(JSON.stringify(result, null, 2), !result.valid);
  },
);

server.registerTool(
  "check_render",
  {
    description:
      "Check whether a StorySpec will render into a watchable video — things validate_spec can't see because they're about layout and pacing, not spec shape: an array too wide for the frame, animation steps that get zero screen time, or a render whose real duration is far from targetDurationSec. Free, no render. Call this before render_preview.",
    inputSchema: { spec: z.record(z.string(), z.unknown()) },
  },
  async ({ spec }) => {
    const validation = validateSpec(spec);
    if (!validation.valid) {
      return text(JSON.stringify({ error: "spec is invalid, cannot check render", details: validation.errors }, null, 2), true);
    }
    const result = checkRender(spec as unknown as StorySpec);
    return text(JSON.stringify(result, null, 2), !result.pass);
  },
);

server.registerTool(
  "sample_frames",
  {
    description:
      "Render 4-6 sample frames from a StorySpec as images, so you can visually check for clipped text or overlapping elements before paying for the real preview render (PLAN.md §7's Layer 2). Only check for those two structural problems, never whether it looks good — check_render already caught everything checkable without pixels. Call this only after check_render and validate_spec both pass.",
    inputSchema: { spec: z.record(z.string(), z.unknown()) },
  },
  async ({ spec }) => {
    const validation = validateSpec(spec);
    if (!validation.valid) {
      return text(JSON.stringify({ error: "spec is invalid, cannot sample frames", details: validation.errors }, null, 2), true);
    }
    const images = await sampleFrames(spec as unknown as StorySpec);
    return {
      content: images.flatMap((img) => [
        { type: "text" as const, text: `Frame ${img.frame} (${img.label}):` },
        { type: "image" as const, data: img.pngBase64, mimeType: "image/png" },
      ]),
    };
  },
);

server.registerTool(
  "run_algorithm",
  {
    description:
      "Run an algorithm on a given input and get back a summary of what happened, without writing a video. Useful for sanity-checking an input (e.g. the search actually finds the target) before writing narration around it. The returned primaryStepCount is the maximum number of \"op:N\" narration beats the StorySpec can use — more than that and validate_spec will reject it.\n\n" +
      "Two ways to call this:\n" +
      "1. {algorithm, input} — for a name list_algorithms already returned, or the name ensure_algorithm just made available. This is the form to use for a real, chosen video input.\n" +
      "2. {name, description, code, input} — a lower-level form that submits raw TypeScript directly to the same sandbox/validator pipeline ensure_algorithm uses. Prefer calling ensure_algorithm instead when the topic doesn't match anything in list_algorithms — it handles writing and validating the code for you.",
    inputSchema: {
      algorithm: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      code: z.string().optional(),
      input: z.record(z.string(), z.unknown()),
    },
  },
  async ({ algorithm, name, description, code, input }) => {
    let resolvedAlgorithm: string;
    let result: { operations: Operation[]; summary: string };

    if (name && code) {
      // The codegen path (PLAN.md's Phase A) — see sandbox.ts for the
      // sandboxing/validation this goes through before it's trusted.
      // generateAndValidateAlgorithm already returns the full
      // operations/summary (from the sandboxed run, or from the cached
      // implementation if this name was already generated earlier), so
      // there's no separate re-run — the result below came from that one
      // execution, whichever path it took.
      resolvedAlgorithm = name;
      try {
        const generated = await generateAndValidateAlgorithm({
          name,
          description: description ?? "",
          code,
          input: input as { array: number[] },
        });
        result = { operations: generated.operations, summary: generated.summary };
      } catch (err) {
        const message = err instanceof GenerateAlgorithmError ? err.message : err instanceof Error ? err.message : String(err);
        return text(JSON.stringify({ error: message }, null, 2), true);
      }
    } else if (algorithm) {
      resolvedAlgorithm = algorithm;
      const entry = getAlgorithm(resolvedAlgorithm);
      if (!entry) {
        return text(JSON.stringify({ error: `unknown algorithm "${resolvedAlgorithm}" — call list_algorithms first` }, null, 2), true);
      }
      const parsedInput = entry.inputSchema.safeParse(input);
      if (!parsedInput.success) {
        const errors = parsedInput.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
        return text(JSON.stringify({ error: "invalid input", details: errors }, null, 2), true);
      }
      try {
        result = runAlgorithmByName(resolvedAlgorithm, parsedInput.data);
      } catch (err) {
        return text(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2), true);
      }
    } else {
      return text(JSON.stringify({ error: "provide either {algorithm, input} or {name, description, code, input}" }, null, 2), true);
    }

    // Never hand the full operation log to the model (PLAN.md §5 sizing
    // constraint) — write it out and return a path plus the summary.
    const opsPath = join(OPERATIONS_DIR, `${resolvedAlgorithm}-${randomUUID().slice(0, 8)}.json`);
    writeFileSync(opsPath, JSON.stringify(result.operations, null, 2));

    // The narration's "op:N" beat count must not exceed this — a surplus
    // beat gets no animation step and renders a frozen array (see
    // validate_spec's matching check, src/spec/validate.ts). Surfacing it
    // here lets the spec get written right the first time instead of
    // discovering the ceiling through a validate_spec rejection.
    const primaryStepCount = splitPrimarySteps(result.operations).primarySteps.length;

    return text(
      JSON.stringify(
        {
          summary: result.summary,
          operationCount: result.operations.length,
          primaryStepCount,
          operationsPath: opsPath,
          algorithm: resolvedAlgorithm,
        },
        null,
        2,
      ),
    );
  },
);

server.registerTool(
  "ensure_algorithm",
  {
    description:
      "Guarantee a sorting algorithm on a number array is available to run, generating and validating it if it isn't already. Call this when a topic doesn't genuinely match anything in list_algorithms, instead of forcing a mismatched existing algorithm into the slot. This tool does NOT run the algorithm on your video's input — call run_algorithm({algorithm: <the returned name>, input}) afterward for that. " +
      "SORTING ONLY — its correctness check compares the result against the array sorted ascending, which has no meaning for a search or anything else. Do not call this for a search algorithm (binarySearch, from list_algorithms, is the only search available) or any non-array structure (linked list, tree, graph) — be honest that those aren't supported instead of asking for a sort as a stand-in. " +
      "Internally this hands the job to a dedicated algorithm-writing agent and retries with real validator feedback on failure (up to 3 attempts), so it can take a while — expect tens of seconds to a few minutes on a genuinely new algorithm, and near-instant if it's already cached.",
    inputSchema: {
      algorithm: z.string().min(1),
      description: z.string().optional(),
      structure: z.enum(["array"]).optional(),
    },
  },
  async ({ algorithm, description, structure }) => {
    try {
      const result = await ensureAlgorithm({ algorithm, description, structure });
      return text(JSON.stringify(result, null, 2));
    } catch (err) {
      const message = err instanceof EnsureAlgorithmError ? err.message : err instanceof Error ? err.message : String(err);
      return text(JSON.stringify({ error: message }, null, 2), true);
    }
  },
);

server.registerTool(
  "generate_voice",
  {
    description:
      "Estimate per-beat timing for a list of narration beats. No real text-to-speech is wired in yet (open decision — see PLAN.md §11), so this returns word-count-based duration estimates, not real audio.",
    inputSchema: {
      narration: z.array(z.object({ beat: z.string(), text: z.string() })).min(1),
    },
  },
  async ({ narration }) => {
    const perBeatDurations: Record<string, number> = {};
    for (const beat of narration) {
      const opts = beat.beat === "outro" ? { minSec: 3.5, maxSec: 8 } : undefined;
      perBeatDurations[beat.beat] = estimateBeatFrames(beat.text, FRAME.fps, opts) / FRAME.fps;
    }
    const totalSec = HOOK_DURATION_SEC + Object.values(perBeatDurations).reduce((a, b) => a + b, 0);
    return text(
      JSON.stringify(
        {
          audioPath: null,
          note: "estimated from word count, not real TTS audio",
          perBeatDurations,
          totalSec: Math.round(totalSec * 10) / 10,
        },
        null,
        2,
      ),
    );
  },
);

server.registerTool(
  "render_preview",
  {
    description:
      "Render a low-resolution, fast preview video from a full StorySpec. Validates the spec first (same checks as validate_spec) and fails without rendering if it's invalid.",
    inputSchema: { spec: z.record(z.string(), z.unknown()) },
  },
  async ({ spec }) => {
    const validation = validateSpec(spec);
    if (!validation.valid) {
      return text(JSON.stringify({ error: "spec is invalid, not rendering", details: validation.errors }, null, 2), true);
    }
    const storySpec = spec as unknown as StorySpec;

    const id = randomUUID().slice(0, 8);
    const propsPath = join(TMP_DIR, `props-${id}.json`);
    const outputPath = join(PREVIEWS_DIR, `preview-${id}.mp4`);
    writeFileSync(propsPath, JSON.stringify({ spec: storySpec }));

    const timeline = buildTimeline(storySpec, FRAME.fps);
    const durationSec = Math.round((timeline.totalDurationInFrames / FRAME.fps) * 10) / 10;

    try {
      await execFileAsync(
        "npx",
        ["remotion", "render", "remotion/index.ts", "Video", outputPath, `--props=${propsPath}`, "--scale=0.5"],
        { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 180_000 },
      );
    } catch (err) {
      const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : String(err);
      return text(JSON.stringify({ error: "render failed", details: stderr.slice(-4000) }, null, 2), true);
    }

    return text(
      JSON.stringify(
        { videoPath: outputPath, durationSec, targetDurationSec: storySpec.targetDurationSec },
        null,
        2,
      ),
    );
  },
);

server.registerTool(
  "render_final",
  {
    description:
      "Render the real, full-resolution video from a validated StorySpec — the actual publishable asset, not a fast preview. Validates the spec first (same checks as validate_spec) and fails without rendering if it's invalid. Slower than render_preview; only call this once check_render/validate_spec/sample_frames are all clean.",
    inputSchema: { spec: z.record(z.string(), z.unknown()) },
  },
  async ({ spec }) => {
    const validation = validateSpec(spec);
    if (!validation.valid) {
      return text(JSON.stringify({ error: "spec is invalid, not rendering", details: validation.errors }, null, 2), true);
    }
    const storySpec = spec as unknown as StorySpec;

    const id = randomUUID().slice(0, 8);
    const propsPath = join(TMP_DIR, `props-${id}.json`);
    const outputPath = join(FINAL_DIR, `final-${id}.mp4`);
    writeFileSync(propsPath, JSON.stringify({ spec: storySpec }));

    const timeline = buildTimeline(storySpec, FRAME.fps);
    const durationSec = Math.round((timeline.totalDurationInFrames / FRAME.fps) * 10) / 10;

    try {
      // No --scale flag, unlike render_preview — full 1080x1920
      // resolution, since this is the actual publishable asset. Longer
      // timeout than render_preview's for the same reason (roughly 4x
      // the pixels of a --scale=0.5 preview).
      await execFileAsync(
        "npx",
        ["remotion", "render", "remotion/index.ts", "Video", outputPath, `--props=${propsPath}`],
        { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 300_000 },
      );
    } catch (err) {
      const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : String(err);
      return text(JSON.stringify({ error: "render failed", details: stderr.slice(-4000) }, null, 2), true);
    }

    const sizeBytes = statSync(outputPath).size;

    return text(
      JSON.stringify(
        { videoPath: outputPath, durationSec, targetDurationSec: storySpec.targetDurationSec, sizeBytes },
        null,
        2,
      ),
    );
  },
);

async function main() {
  // Anything sandbox.ts previously generated and cached is already
  // registered by now — algorithms/index.ts loads it via a plain static
  // import of generated/manifest.ts, so it's populated as part of this
  // module graph loading at all, not a separate async step to await here.
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("algoreel-mcp server failed to start:", err);
  process.exit(1);
});

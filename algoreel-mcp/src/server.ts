#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ALGORITHMS, runAlgorithmByName, type AlgorithmName } from "./algorithms/index";
import { splitPrimarySteps } from "./spec/beats";
import { checkRender } from "./spec/checkRender";
import { sampleFrames } from "./render/frameSampler";
import { ALGORITHM_INPUT_SCHEMAS } from "./spec/schema";
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
const TMP_DIR = join(OUT_DIR, "tmp");
for (const dir of [OPERATIONS_DIR, PREVIEWS_DIR, TMP_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const server = new McpServer({ name: "algoreel", version: "0.1.0" });

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

server.registerTool(
  "list_algorithms",
  {
    description: "List the algorithms available to build a StorySpec around, with their input shapes.",
  },
  async () => {
    const list = Object.values(ALGORITHMS).map(({ name, description, inputHint }) => ({
      name,
      description,
      input: inputHint,
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
      "Run a deterministic algorithm on a given input and get back a summary of what happened, without writing a video. Useful for sanity-checking an input (e.g. the search actually finds the target) before writing narration around it. The returned primaryStepCount is the maximum number of \"op:N\" narration beats the StorySpec can use — more than that and validate_spec will reject it.",
    inputSchema: {
      algorithm: z.enum(Object.keys(ALGORITHMS) as [AlgorithmName, ...AlgorithmName[]]),
      input: z.record(z.string(), z.unknown()),
    },
  },
  async ({ algorithm, input }) => {
    const inputSchema = ALGORITHM_INPUT_SCHEMAS[algorithm];
    const parsedInput = inputSchema.safeParse(input);
    if (!parsedInput.success) {
      const errors = parsedInput.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      return text(JSON.stringify({ error: "invalid input", details: errors }, null, 2), true);
    }

    let result;
    try {
      result = runAlgorithmByName(algorithm, parsedInput.data);
    } catch (err) {
      return text(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2), true);
    }

    // Never hand the full operation log to the model (PLAN.md §5 sizing
    // constraint) — write it out and return a path plus the summary.
    const opsPath = join(OPERATIONS_DIR, `${algorithm}-${randomUUID().slice(0, 8)}.json`);
    writeFileSync(opsPath, JSON.stringify(result.operations, null, 2));

    // The narration's "op:N" beat count must not exceed this — a surplus
    // beat gets no animation step and renders a frozen array (see
    // validate_spec's matching check, src/spec/validate.ts). Surfacing it
    // here lets the spec get written right the first time instead of
    // discovering the ceiling through a validate_spec rejection.
    const primaryStepCount = splitPrimarySteps(result.operations).primarySteps.length;

    return text(
      JSON.stringify(
        { summary: result.summary, operationCount: result.operations.length, primaryStepCount, operationsPath: opsPath },
        null,
        2,
      ),
    );
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("algoreel-mcp server failed to start:", err);
  process.exit(1);
});

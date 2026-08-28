#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getAlgorithm, listAlgorithms, runAlgorithmByName } from "./algorithms/index";
import { ensureAlgorithm } from "./algorithms/ensureAlgorithm";
import { generateAndValidateAlgorithm } from "./algorithms/sandboxArray";
import type { Operation } from "./algorithms/types";
import { ROOT } from "./config/paths";
import { renderVideo } from "./mcp/renderVideo";
import { SPEC_INPUT_SCHEMA, text, validateSpecOrRespond } from "./mcp/respond";
import { splitPrimarySteps } from "./spec/beats";
import { checkRender } from "./spec/checkRender";
import { sampleFrames } from "./render/frameSampler";
import { validateSpec } from "./spec/validate";
import type { StorySpec } from "./spec/types";
import { FRAME, OUTRO_TIMING } from "../remotion/template/tokens";
import { estimateBeatFrames, HOOK_DURATION_SEC } from "../remotion/timing";

// This file is the MCP boundary described in PLAN.md §3: everything above
// this line (src/algorithms, src/spec) is pure TypeScript with no LLM
// involvement anywhere. This server exposes that engine as tools; it never
// makes an algorithmic decision itself, only runs the deterministic code
// and reports back.
const OUT_DIR = join(ROOT, "out");
const OPERATIONS_DIR = join(OUT_DIR, "operations");
const PREVIEWS_DIR = join(OUT_DIR, "previews");
const FINAL_DIR = join(OUT_DIR, "final");
const TMP_DIR = join(OUT_DIR, "tmp");
for (const dir of [OPERATIONS_DIR, PREVIEWS_DIR, FINAL_DIR, TMP_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const server = new McpServer({ name: "algoreel", version: "0.1.0" });

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
    inputSchema: SPEC_INPUT_SCHEMA,
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
    inputSchema: SPEC_INPUT_SCHEMA,
  },
  async ({ spec }) => {
    const validated = validateSpecOrRespond(spec, "cannot check render");
    if ("response" in validated) return validated.response;
    const result = checkRender(validated.storySpec);
    return text(JSON.stringify(result, null, 2), !result.pass);
  },
);

server.registerTool(
  "sample_frames",
  {
    description:
      "Render 4-6 sample frames from a StorySpec as images, so you can visually check for clipped text or overlapping elements before paying for the real preview render (PLAN.md §7's Layer 2). Only check for those two structural problems, never whether it looks good — check_render already caught everything checkable without pixels. Call this only after check_render and validate_spec both pass.",
    inputSchema: SPEC_INPUT_SCHEMA,
  },
  async ({ spec }) => {
    const validated = validateSpecOrRespond(spec, "cannot sample frames");
    if ("response" in validated) return validated.response;
    const images = await sampleFrames(validated.storySpec);
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
        // GenerateAlgorithmError extends Error, so an X-then-Error double
        // check here just repeats the same branch — this is the simpler
        // equivalent, same message either way.
        const message = err instanceof Error ? err.message : String(err);
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
      "Guarantee an algorithm is available to run, generating and validating it if it isn't already. Call this when a topic doesn't genuinely match anything in list_algorithms, instead of forcing a mismatched existing algorithm into the slot. This tool does NOT run the algorithm on your video's input — call run_algorithm({algorithm: <the returned name>, input}) afterward for that. " +
      "Three structures, each with a real correctness check, nothing else covered: " +
      "structure:\"array\" is SORTING ONLY — its check compares the result against the array sorted ascending, which has no meaning for a search or anything else. Do not call this for a search algorithm (binarySearch, from list_algorithms, is the only search available). " +
      "structure:\"graph\" is BFS/DFS ONLY (unweighted, by name) — its check compares the visit order against a real reference traversal. Do not call this for Dijkstra, a minimum spanning tree, or anything needing edge weights. " +
      "structure:\"tree\" is BST INSERTION ONLY (name \"bstInsert\") — its check is structural (does the result obey BST ordering and contain every input value exactly once), not a reference traversal. Do not call this for deletion, rotation, or AVL/red-black rebalancing. " +
      "Any other structure (linked list, stack) isn't covered by this tool at all — be honest that it's unsupported instead of asking for one of the above as a stand-in. " +
      "Internally this hands the job to a dedicated algorithm-writing agent and retries with real validator feedback on failure (up to 3 attempts), so it can take a while — expect tens of seconds to a few minutes on a genuinely new algorithm, and near-instant if it's already cached.",
    inputSchema: {
      algorithm: z.string().min(1),
      description: z.string().optional(),
      structure: z.enum(["array", "graph", "tree"]).optional(),
    },
  },
  async ({ algorithm, description, structure }) => {
    try {
      const result = await ensureAlgorithm({ algorithm, description, structure });
      return text(JSON.stringify(result, null, 2));
    } catch (err) {
      // Same simplification as run_algorithm's codegen branch above:
      // EnsureAlgorithmError extends Error, so both branches are identical.
      const message = err instanceof Error ? err.message : String(err);
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
      const opts = beat.beat === "outro" ? OUTRO_TIMING : undefined;
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
    inputSchema: SPEC_INPUT_SCHEMA,
  },
  async ({ spec }) => {
    const validated = validateSpecOrRespond(spec, "not rendering");
    if ("response" in validated) return validated.response;
    const { storySpec } = validated;

    const result = await renderVideo(storySpec, { tmpDir: TMP_DIR, outputDir: PREVIEWS_DIR, filenamePrefix: "preview", scale: 0.5, timeoutMs: 180_000 });
    if (!result.ok) {
      return text(JSON.stringify({ error: "render failed", details: result.error }, null, 2), true);
    }

    return text(
      JSON.stringify(
        { videoPath: result.videoPath, durationSec: result.durationSec, targetDurationSec: storySpec.targetDurationSec },
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
    inputSchema: SPEC_INPUT_SCHEMA,
  },
  async ({ spec }) => {
    const validated = validateSpecOrRespond(spec, "not rendering");
    if ("response" in validated) return validated.response;
    const { storySpec } = validated;

    // No scale option, unlike render_preview — full 1080x1920 resolution,
    // since this is the actual publishable asset. Longer timeout than
    // render_preview's for the same reason (roughly 4x the pixels of a
    // --scale=0.5 preview).
    const result = await renderVideo(storySpec, { tmpDir: TMP_DIR, outputDir: FINAL_DIR, filenamePrefix: "final", timeoutMs: 300_000 });
    if (!result.ok) {
      return text(JSON.stringify({ error: "render failed", details: result.error }, null, 2), true);
    }
    const sizeBytes = statSync(result.videoPath).size;

    return text(
      JSON.stringify(
        { videoPath: result.videoPath, durationSec: result.durationSec, targetDurationSec: storySpec.targetDurationSec, sizeBytes },
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

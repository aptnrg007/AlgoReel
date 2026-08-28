import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildTimeline } from "../../remotion/buildTimeline";
import { FRAME } from "../../remotion/template/tokens";
import { REMOTION_ENTRYPOINT, ROOT, VIDEO_COMPOSITION_ID } from "../config/paths";
import type { StorySpec } from "../spec/types";

const execFileAsync = promisify(execFile);

export interface RenderVideoOptions {
  tmpDir: string;
  outputDir: string;
  filenamePrefix: string;
  // Present for render_preview (0.5), absent for render_final — full
  // 1080x1920 resolution, the actual publishable asset.
  scale?: number;
  timeoutMs: number;
}

export type RenderVideoResult = { ok: true; videoPath: string; durationSec: number } | { ok: false; error: string };

// Shared by render_preview and render_final (src/server.ts) — previously
// two ~40-line near-identical blocks (write props, buildTimeline for the
// duration estimate, spawn `npx remotion render`, catch/slice stderr),
// differing only in output dir, filename prefix, scale, and timeout.
export async function renderVideo(storySpec: StorySpec, options: RenderVideoOptions): Promise<RenderVideoResult> {
  const id = randomUUID().slice(0, 8);
  const propsPath = join(options.tmpDir, `props-${id}.json`);
  const outputPath = join(options.outputDir, `${options.filenamePrefix}-${id}.mp4`);
  writeFileSync(propsPath, JSON.stringify({ spec: storySpec }));

  const timeline = buildTimeline(storySpec, FRAME.fps);
  const durationSec = Math.round((timeline.totalDurationInFrames / FRAME.fps) * 10) / 10;

  const args = ["remotion", "render", REMOTION_ENTRYPOINT, VIDEO_COMPOSITION_ID, outputPath, `--props=${propsPath}`];
  if (options.scale !== undefined) args.push(`--scale=${options.scale}`);

  try {
    await execFileAsync("npx", args, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: options.timeoutMs });
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : String(err);
    return { ok: false, error: stderr.slice(-4000) };
  }

  return { ok: true, videoPath: outputPath, durationSec };
}

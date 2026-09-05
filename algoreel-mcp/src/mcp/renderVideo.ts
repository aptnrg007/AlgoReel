import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { FRAME } from "../../remotion/template/tokens";
import { calculateDurationInFrames } from "../../remotion/videoTypes";
import { REMOTION_ENTRYPOINT, ROOT, VIDEO_COMPOSITION_ID } from "../config/paths";
import type { VideoPlan } from "../plan/types";

const execFileAsync = promisify(execFile);

export interface RenderVideoOptions {
  tmpDir: string;
  outputDir: string;
  filenamePrefix: string;
  // Present for render_preview (0.5), absent for render_final — full
  // 1080x1920 resolution, the actual publishable asset.
  scale?: number;
  timeoutMs: number;
  // Overrides the derived `${outputDir}/${filenamePrefix}-<id>.mp4` name
  // with an exact path — used by renderTimeSeries.ts's CLI so a demo spec
  // renders to a predictable filename next to its input, not a random one.
  outputPath?: string;
}

export type RenderVideoResult = { ok: true; videoPath: string; durationSec: number } | { ok: false; error: string };

// Shared by render_preview/render_final (src/server.ts, dsa-only today)
// and renderTimeSeries.ts (the time-series CLI) — videoType-agnostic;
// every caller wraps its own spec into a VideoPlan first
// (fromStorySpec.ts/fromTimeSeriesSpec.ts).
export async function renderVideo(plan: VideoPlan, options: RenderVideoOptions): Promise<RenderVideoResult> {
  const id = randomUUID().slice(0, 8);
  const propsPath = join(options.tmpDir, `props-${id}.json`);
  const outputPath = options.outputPath ?? join(options.outputDir, `${options.filenamePrefix}-${id}.mp4`);
  writeFileSync(propsPath, JSON.stringify({ plan }));

  const durationInFrames = calculateDurationInFrames(plan, FRAME.fps);
  const durationSec = Math.round((durationInFrames / FRAME.fps) * 10) / 10;

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

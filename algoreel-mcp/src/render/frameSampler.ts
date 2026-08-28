import { join } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { buildTimeline } from "../../remotion/buildTimeline";
import { pickSampleFrames } from "../../remotion/sampleFrames";
import { FRAME } from "../../remotion/template/tokens";
import { REMOTION_ENTRYPOINT, ROOT, VIDEO_COMPOSITION_ID } from "../config/paths";
import type { StorySpec } from "../spec/types";

export interface FrameImage {
  label: string;
  frame: number;
  pngBase64: string;
}

// Bundling (webpack, via @remotion/bundler) is the slow, spec-independent
// part of rendering a still — cache it once per long-lived MCP server
// process (same "amortize the expensive setup once" principle as
// AgentForge's mcp.Registry sharing one process per server config) rather
// than re-bundling on every sample_frames call.
let bundlePromise: Promise<string> | null = null;
function getServeUrl(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: join(ROOT, REMOTION_ENTRYPOINT) });
  }
  return bundlePromise;
}

// logLevel: "error" on selectComposition/renderStill below (the two calls
// that actually launch Chromium — bundle() doesn't) is load-bearing, not
// cosmetic. With no logLevel passed, @remotion/renderer's
// isEqualOrBelowLogLevel(undefined, "verbose") resolves true
// (Array.indexOf on an unset value returns -1, which compares as "below"
// every real level), which silently turns on "dumpio": Chromium's own
// stdout/stderr (including its "DevTools listening on ws://..." startup
// line) gets piped back and re-emitted via console.log — landing on
// *this* process's real stdout, which an MCP stdio server reserves
// exclusively for JSON-RPC. That corrupts every tool response for the
// rest of the session. Confirmed live: this exact line was what an
// AgentForge Go client saw and failed to parse.

// Renders a handful of stills from a StorySpec for a vision-capable model
// to inspect (PLAN.md §7's Layer 2), using @remotion/renderer's
// programmatic API directly rather than shelling out to the CLI like
// render_preview does — renderStill can hand back an in-memory Buffer
// (output: null), so nothing touches disk and there's nothing to clean up.
export async function sampleFrames(spec: StorySpec): Promise<FrameImage[]> {
  const serveUrl = await getServeUrl();
  const inputProps = { spec };
  const composition = await selectComposition({ serveUrl, id: VIDEO_COMPOSITION_ID, inputProps, logLevel: "error" });

  const timeline = buildTimeline(spec, FRAME.fps);
  const samples = pickSampleFrames(timeline);

  const images: FrameImage[] = [];
  for (const s of samples) {
    // scale: 0.5 matches render_preview's existing choice — smaller
    // images cost fewer vision tokens without losing the two things
    // Layer 2 actually checks for (clipped text, overlapping elements).
    const { buffer } = await renderStill({
      serveUrl,
      composition,
      frame: s.frame,
      inputProps,
      imageFormat: "png",
      scale: 0.5,
      output: null,
      logLevel: "error",
    });
    images.push({ label: s.label, frame: s.frame, pngBase64: buffer!.toString("base64") });
  }
  return images;
}

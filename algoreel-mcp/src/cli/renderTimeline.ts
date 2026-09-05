// Mirrors renderTimeSeries.ts/renderBarRace.ts exactly (PLAN.md §27's
// recipe, item 8's "a demo spec + a real render"). Takes a bare
// TimelineSpec (JSON) or a plain CSV, runs it through
// validate -> check -> render, and writes a real mp4 next to the input.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { renderVideo } from "../mcp/renderVideo";
import { toTimelineVideoPlan } from "../plan/fromTimelineSpec";
import { checkTimelineRender } from "../spec/timeline/checkRender";
import { parseCsvToTimelineSpec } from "../spec/timeline/fromCsv";
import type { TimelineSpec } from "../spec/timeline/types";
import { validateTimelineSpec } from "../spec/timeline/validate";
import { ROOT } from "../config/paths";

const USAGE =
  'usage: renderTimeline.ts <path-to-spec.json | path-to-data.csv> [--duration=20] [--out=path.mp4]\n' +
  "  CSV input additionally requires: --title=... (CSV columns are fixed: date,title)";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) flags[match[1]!] = match[2]!;
  }
  return flags;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const flags = parseFlags(process.argv.slice(3));

  const resolvedInput = resolve(inputPath);
  if (!existsSync(resolvedInput)) {
    console.error(`error: no such file: ${resolvedInput}`);
    process.exitCode = 1;
    return;
  }
  const text = readFileSync(resolvedInput, "utf8");

  let candidate: unknown;
  if (extname(resolvedInput).toLowerCase() === ".csv") {
    if (!flags.title) {
      console.error(`error: CSV input requires --title\n${USAGE}`);
      process.exitCode = 1;
      return;
    }
    try {
      candidate = parseCsvToTimelineSpec(text, { title: flags.title });
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
  } else {
    try {
      candidate = JSON.parse(text);
    } catch (err) {
      console.error(`error: ${resolvedInput} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
  }

  const validation = validateTimelineSpec(candidate);
  if (!validation.valid) {
    console.error("error: spec is invalid:");
    for (const e of validation.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  const spec = candidate as TimelineSpec;

  const targetDurationSec = Number(flags.duration ?? "20");
  if (!Number.isFinite(targetDurationSec) || targetDurationSec <= 0) {
    console.error(`error: --duration must be a positive number (got "${flags.duration}")`);
    process.exitCode = 1;
    return;
  }

  const renderCheck = checkTimelineRender(spec, targetDurationSec);
  for (const f of renderCheck.failures) console.error(`  [${f.severity}] ${f.code}: ${f.message}`);
  if (!renderCheck.pass) {
    console.error("error: spec fails check_render (see errors above) — not rendering");
    process.exitCode = 1;
    return;
  }

  const plan = toTimelineVideoPlan(spec, { targetDurationSec, description: flags.description });

  const outputPath = flags.out ? resolve(flags.out) : join(dirname(resolvedInput), `${basename(resolvedInput, extname(resolvedInput))}.mp4`);
  const tmpDir = join(ROOT, "out", "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  console.error(`rendering ${outputPath} (${targetDurationSec}s)...`);
  const result = await renderVideo(plan, {
    tmpDir,
    outputDir: dirname(outputPath),
    filenamePrefix: basename(outputPath, ".mp4"),
    outputPath,
    timeoutMs: 300_000,
  });

  if (!result.ok) {
    console.error(`error: render failed:\n${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.error(`done: ${result.videoPath} (${result.durationSec}s)`);
}

main();

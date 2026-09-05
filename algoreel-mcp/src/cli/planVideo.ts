// PLAN.md's multi-video-type architecture, Phase 4: the first entry point
// that goes straight from a bare request to a VideoPlan without the caller
// having to already know which video type it wants. Mirrors makeSpec.ts's
// shape (print diagnostics to stderr, the finished JSON to stdout) so it
// composes with run.sh/preview.sh-style pipelines the same way.
import { readFileSync } from "node:fs";

import { PlanVideoError, planVideo } from "../plan/planVideo";

const USAGE =
  'usage: planVideo.ts "<prompt>" [--data=path.json] [--csv=path.csv --title=... --x-label=... --y-label=... [--y-unit=...]] [--duration=20]';

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) flags[match[1]!] = match[2]!;
  }
  return flags;
}

async function main(): Promise<void> {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const flags = parseFlags(process.argv.slice(3));

  try {
    const data = flags.data ? JSON.parse(readFileSync(flags.data, "utf8")) : undefined;
    const csv = flags.csv ? readFileSync(flags.csv, "utf8") : undefined;
    const duration = flags.duration ? Number(flags.duration) : undefined;

    const plan = await planVideo({
      prompt,
      data,
      csv,
      csvOptions: csv
        ? { title: flags.title ?? prompt, xAxisLabel: flags["x-label"] ?? "", yAxisLabel: flags["y-label"] ?? "", yAxisUnit: flags["y-unit"] }
        : undefined,
      targetDurationSec: duration,
    });

    console.error(`planned a "${plan.videoType}" video: "${plan.title}"`);
    process.stdout.write(JSON.stringify(plan, null, 2));
  } catch (err) {
    if (err instanceof PlanVideoError) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main();

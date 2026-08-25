// run.sh/preview.sh's replacement for `agentforge run script.yaml` + the
// ```json-fence-stripping extract_spec shell helper. script.yaml (a single
// tool-using agent holding both open-ended authoring and a multi-round
// validate_spec self-correction loop) needed Anthropic to be reliable —
// see script.yaml's own STATUS comment and README's Phase 3 section for
// the measured local-model failure this replaces. ensureSpec.ts is the
// local-first, TypeScript-orchestrated equivalent (PLAN.md's algorithm
// agent pattern generalized to script generation); this file is just its
// CLI wrapper, printing the finished StorySpec as clean JSON on stdout so
// run.sh/preview.sh can pipe it straight into qa.yaml/publish.yaml with no
// fence-stripping needed (ensureSpec.ts's own JSON never comes wrapped
// in one — it's built mechanically, not parsed out of a model's prose).
import { EnsureSpecError, ensureSpec } from "../spec/ensureSpec";

async function main(): Promise<void> {
  const topic = process.argv[2];
  if (!topic) {
    console.error('usage: makeSpec.ts "a topic, e.g. explain breadth-first search"');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await ensureSpec({ topic });
    // Diagnostics go to stderr, not stdout — stdout is the one thing
    // run.sh's `> "$WORK/spec.json"` redirect captures, so it has to be
    // exactly the spec JSON and nothing else.
    for (const note of result.notes) console.error(`  ${note}`);
    console.error(
      `  narration rung: ${result.narrateRung === 0 ? "local" : "paid escalation"}, repair rounds: ${result.repairRounds}`,
    );
    process.stdout.write(JSON.stringify(result.spec, null, 2));
  } catch (err) {
    if (err instanceof EnsureSpecError) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main();

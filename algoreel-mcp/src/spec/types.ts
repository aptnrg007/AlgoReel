export interface NarrationBeat {
  beat: "intro" | "outro" | `op:${number}`;
  text: string;
}

interface StorySpecBase {
  version: 1;
  topic: string;
  targetDurationSec: number;
  hook: string;
  narration: NarrationBeat[];
  emphasis: string[];
  complexity: { time: string; space: string };
  youtube: { title: string; description: string; tags: string[] };
}

// `algorithm` was a 3-literal discriminated union (PLAN.md §4's original
// "adding an algorithm means adding a branch here"). Loosened to `string`
// for the codegen redesign: the set of algorithms is no longer fixed at
// compile time (algoreel-mcp/src/algorithms/index.ts's dynamic registry,
// populated by hand-written modules plus anything sandbox.ts generates
// and caches). This is a deliberate loss of compile-time input-shape
// narrowing — validateSpec (spec/validate.ts) and checkRender
// (spec/checkRender.ts) now check `input`'s actual shape at runtime
// (does it have `.array`? `.nodes`?) instead of switching on a known
// algorithm name, which is a real improvement of its own: a newly
// generated array algorithm gets the same checks for free.
export interface StorySpec extends StorySpecBase {
  algorithm: string;
  input: Record<string, unknown>;
}

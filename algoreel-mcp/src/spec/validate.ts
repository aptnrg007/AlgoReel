import { getAlgorithm, runAlgorithm } from "../algorithms/index";
import { splitPrimarySteps } from "./beats";
import { storySpecSchema } from "./schema";
import type { StorySpec } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Cheap, no render (PLAN.md §5) — shape-checks the spec, then layers on
// semantic checks the zod schema can't express: things the renderer or
// algorithm engine would otherwise fail on much later, or silently
// mis-render instead of failing at all.
export function validateSpec(candidate: unknown): ValidationResult {
  const parsed = storySpecSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return { valid: false, errors };
  }

  const spec = parsed.data as StorySpec;

  // Second validation pass, now that the base shape is confirmed: is
  // `algorithm` actually a registered name, and does `input` match what
  // *that specific* algorithm expects? This replaced a discriminatedUnion
  // that hardcoded exactly 3 algorithm literals — see spec/types.ts's
  // StorySpec comment for why. A generated algorithm's entry carries the
  // same kind of inputSchema a hand-written one does, so this one lookup
  // covers both without needing to know which kind it is.
  const entry = getAlgorithm(spec.algorithm);
  if (!entry) {
    return { valid: false, errors: [`algorithm: unknown algorithm "${spec.algorithm}" — call list_algorithms first`] };
  }
  const inputParsed = entry.inputSchema.safeParse(spec.input);
  if (!inputParsed.success) {
    const errors = inputParsed.error.issues.map((issue) => `input.${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return { valid: false, errors };
  }

  const errors: string[] = [...semanticErrors(spec)];
  return { valid: errors.length === 0, errors };
}

function semanticErrors(spec: StorySpec): string[] {
  const errors: string[] = [];

  // These two checks are genuinely specific to these named algorithms'
  // semantics (a generic array-sorting algorithm has no such
  // "must already be sorted" precondition) — they stay name-keyed, unlike
  // checkRender.ts's layout checks, which generalized to input *shape*.
  if (spec.algorithm === "binarySearch") {
    const array = spec.input.array as number[];
    for (let i = 1; i < array.length; i++) {
      if (array[i]! < array[i - 1]!) {
        errors.push(`input.array must be sorted ascending for binarySearch (found ${array[i - 1]} before ${array[i]})`);
        break;
      }
    }
  }

  if (spec.algorithm === "bfs") {
    const nodes = spec.input.nodes as string[];
    const edges = spec.input.edges as [string, string][];
    const start = spec.input.start as string;
    if (!nodes.includes(start)) {
      errors.push(`input.start ("${start}") must be one of input.nodes`);
    }
    for (const [a, b] of edges) {
      if (!nodes.includes(a) || !nodes.includes(b)) {
        errors.push(`input.edges entry [${a}, ${b}] references a node not in input.nodes`);
      }
    }
  }

  const outroCount = spec.narration.filter((n) => n.beat === "outro").length;
  if (outroCount !== 1) {
    errors.push(`narration must contain exactly one "outro" beat (found ${outroCount})`);
  }

  const opIndices = spec.narration
    .map((n) => n.beat.match(/^op:(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  if (opIndices.length === 0) {
    errors.push('narration must contain at least one "op:N" beat');
  } else {
    const expected = opIndices.map((_, i) => i);
    if (JSON.stringify(opIndices) !== JSON.stringify(expected)) {
      errors.push(
        `"op:N" beats must be numbered consecutively starting at op:0 (found op:${opIndices.join(", op:")}) — a gap or duplicate means that beat's animation steps silently vanish`,
      );
    }
  }

  // Only meaningful once the spec is otherwise well-formed — in particular
  // binarySearch's engine *throws* on an unsorted array, already reported
  // above, and opIndices being non-consecutive makes "how many op:N beats"
  // ambiguous to begin with.
  if (errors.length === 0) {
    errors.push(...primaryStepBudgetErrors(spec, opIndices.length));
  }

  const allCaptionText = spec.narration.map((n) => n.text.toLowerCase()).join(" ");
  for (const word of spec.emphasis) {
    if (!allCaptionText.includes(word.toLowerCase())) {
      errors.push(`emphasis word "${word}" does not appear in any narration text, so it will never render`);
    }
  }

  return errors;
}

// A narration beat with no animation step behind it renders a caption over a
// completely frozen array (remotion/primitives/state.ts, groupOperationsByBeat
// distributes primary steps across op:N beats — surplus beats get none).
// validate_spec is documented as free and safe to call, so this must never
// throw across the MCP boundary even though runAlgorithm can (binarySearch on
// an unsorted array) — that case is already unreachable here since the caller
// only invokes this once earlier checks passed, but the try/catch keeps that
// guarantee independent of call order.
function primaryStepBudgetErrors(spec: StorySpec, opBeatCount: number): string[] {
  let primaryStepCount: number;
  try {
    const { operations } = runAlgorithm(spec);
    primaryStepCount = splitPrimarySteps(operations).primarySteps.length;
  } catch {
    return [];
  }

  if (opBeatCount > primaryStepCount) {
    const overflow = Array.from({ length: opBeatCount - primaryStepCount }, (_, i) => `op:${primaryStepCount + i}`);
    return [
      `narration has ${opBeatCount} "op:N" beats but ${spec.algorithm} on this input produces only ` +
        `${primaryStepCount} animation step${primaryStepCount === 1 ? "" : "s"} — beat${overflow.length === 1 ? "" : "s"} ` +
        `${overflow.join(", ")} would render a frozen array. Use at most ${primaryStepCount} "op:N" beat${primaryStepCount === 1 ? "" : "s"}.`,
    ];
  }
  return [];
}

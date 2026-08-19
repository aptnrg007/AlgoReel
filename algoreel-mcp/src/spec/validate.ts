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
  const errors: string[] = [...semanticErrors(spec)];
  return { valid: errors.length === 0, errors };
}

function semanticErrors(spec: StorySpec): string[] {
  const errors: string[] = [];

  if (spec.algorithm === "binarySearch") {
    const { array } = spec.input;
    for (let i = 1; i < array.length; i++) {
      if (array[i]! < array[i - 1]!) {
        errors.push(`input.array must be sorted ascending for binarySearch (found ${array[i - 1]} before ${array[i]})`);
        break;
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

  const allCaptionText = spec.narration.map((n) => n.text.toLowerCase()).join(" ");
  for (const word of spec.emphasis) {
    if (!allCaptionText.includes(word.toLowerCase())) {
      errors.push(`emphasis word "${word}" does not appear in any narration text, so it will never render`);
    }
  }

  return errors;
}

import { timeSeriesSchema } from "./schema";
import type { TimeSeriesSpec } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Mirrors src/spec/validate.ts's shape-then-semantics split for StorySpec:
// zod catches structural shape (including finiteness — confirmed live:
// zod v4's z.number() already rejects NaN/Infinity as invalid_type before
// this ever runs, so semanticErrors only needs cross-field agreement zod
// can't express on its own). Cheap, no render.
export function validateTimeSeriesSpec(candidate: unknown): ValidationResult {
  const parsed = timeSeriesSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return { valid: false, errors };
  }

  const errors = semanticErrors(parsed.data as TimeSeriesSpec);
  return { valid: errors.length === 0, errors };
}

function semanticErrors(spec: TimeSeriesSpec): string[] {
  const errors: string[] = [];
  const n = spec.xAxis.values.length;

  for (const s of spec.series) {
    if (s.values.length !== n) {
      errors.push(
        `series "${s.name}" has ${s.values.length} value(s) but xAxis has ${n} — every series must have exactly one value per x-axis point`,
      );
    }

    const indices = (s.annotations ?? []).map((a) => a.index);
    for (const index of indices) {
      if (index >= n) {
        errors.push(`series "${s.name}" has an annotation at index ${index}, but xAxis only has ${n} point(s) (0-${n - 1})`);
      }
    }
    const duplicateIndices = [...new Set(indices.filter((i, pos) => indices.indexOf(i) !== pos))];
    if (duplicateIndices.length > 0) {
      errors.push(`series "${s.name}" has more than one annotation at the same index (${duplicateIndices.join(", ")}) — one label per point`);
    }
  }

  const names = spec.series.map((s) => s.name);
  const duplicateNames = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (duplicateNames.length > 0) {
    errors.push(`series names must be unique (duplicated: ${duplicateNames.join(", ")})`);
  }

  return errors;
}

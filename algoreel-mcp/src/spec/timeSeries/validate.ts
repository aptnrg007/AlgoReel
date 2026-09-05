import { timeSeriesSchema } from "./schema";
import type { TimeSeriesSpec } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Mirrors src/spec/validate.ts's shape-then-semantics split for StorySpec:
// zod catches structural shape, semanticErrors catches everything a schema
// can't express (cross-field agreement, finiteness). Cheap, no render.
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
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        errors.push(`series "${s.name}" value at index ${i} is not a finite number (${JSON.stringify(v)})`);
      }
    });
  }

  const names = spec.series.map((s) => s.name);
  const duplicateNames = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (duplicateNames.length > 0) {
    errors.push(`series names must be unique (duplicated: ${duplicateNames.join(", ")})`);
  }

  return errors;
}

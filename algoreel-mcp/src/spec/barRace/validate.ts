import { barRaceSchema } from "./schema";
import type { BarRaceSpec } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Mirrors timeSeries/validate.ts's shape-then-semantics split: zod catches
// structural shape (including finiteness — zod v4's z.number() already
// rejects NaN/Infinity, see timeSeries/validate.ts's comment on the same
// point); semanticErrors catches cross-field agreement zod can't express.
export function validateBarRaceSpec(candidate: unknown): ValidationResult {
  const parsed = barRaceSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return { valid: false, errors };
  }

  const errors = semanticErrors(parsed.data as BarRaceSpec);
  return { valid: errors.length === 0, errors };
}

function semanticErrors(spec: BarRaceSpec): string[] {
  const errors: string[] = [];
  const n = spec.xAxis.values.length;

  for (const entry of spec.entries) {
    if (entry.values.length !== n) {
      errors.push(
        `entry "${entry.name}" has ${entry.values.length} value(s) but xAxis has ${n} — every entry must have exactly one value per x-axis step`,
      );
    }
  }

  const names = spec.entries.map((e) => e.name);
  const duplicateNames = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (duplicateNames.length > 0) {
    errors.push(`entry names must be unique (duplicated: ${duplicateNames.join(", ")})`);
  }

  return errors;
}

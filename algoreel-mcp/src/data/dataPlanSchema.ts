import { z } from "zod";

// plan-dataset.yaml/.anthropic.yaml's output. The JSON schema handed to
// the agent (schemas/data-plan.json) is deliberately flatter than this —
// one object with every field optional except videoType, since a
// discriminated oneOf is more grammar-constrained-decoding risk than
// this project takes on elsewhere (video-type-choice.json is flat for
// the same reason). The real per-videoType shape enforcement happens
// here, in TypeScript, the same layering src/spec/*/validate.ts already
// uses (zod for shape, a second pass for anything zod can't express).
const dataFilterSchema = z.object({ column: z.string(), value: z.string() });
const dataRangeSchema = z.object({ column: z.string(), from: z.string().optional(), to: z.string().optional() });

const timeSeriesDataPlanSchema = z.object({
  videoType: z.literal("time_series"),
  xColumn: z.string(),
  yColumns: z.array(z.string()).min(1),
  filters: z.array(dataFilterSchema).optional(),
  range: dataRangeSchema.optional(),
});

const barRaceDataPlanSchema = z.object({
  videoType: z.literal("bar_race"),
  entityColumn: z.string(),
  periodColumn: z.string(),
  valueColumn: z.string(),
  filters: z.array(dataFilterSchema).optional(),
  range: dataRangeSchema.optional(),
  topN: z.number().int().positive().optional(),
});

export const dataPlanSchema = z.discriminatedUnion("videoType", [timeSeriesDataPlanSchema, barRaceDataPlanSchema]);

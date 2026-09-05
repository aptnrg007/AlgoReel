import { z } from "zod";

// Mirrors src/spec/schema.ts's split: this is the runtime shape a candidate
// gets checked against; types.ts is the compile-time-only mirror. At least 2
// x-axis points — a single point has no "over time" to animate.
export const timeSeriesSchema = z.object({
  title: z.string().min(1),
  xAxis: z.object({
    label: z.string().min(1),
    values: z.array(z.union([z.string(), z.number()])).min(2),
  }),
  yAxis: z.object({
    label: z.string().min(1),
    unit: z.string().optional(),
  }),
  series: z
    .array(
      z.object({
        name: z.string().min(1),
        values: z.array(z.number()),
      }),
    )
    .min(1),
  animation: z.object({ mode: z.literal("progressive") }).optional(),
});

export type TimeSeriesSpecParsed = z.infer<typeof timeSeriesSchema>;

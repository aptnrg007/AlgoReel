import { z } from "zod";

// Mirrors src/spec/timeSeries/schema.ts's split: this is the runtime
// shape a candidate gets checked against; types.ts is the compile-time
// mirror. At least 2 x-axis steps (nothing to "race" over with only one)
// and at least 2 entries (a race with one entry has nothing to rank
// against).
export const barRaceSchema = z.object({
  title: z.string().min(1),
  xAxis: z.object({
    label: z.string().min(1),
    values: z.array(z.union([z.string(), z.number()])).min(2),
  }),
  valueLabel: z.string().min(1),
  entries: z
    .array(
      z.object({
        name: z.string().min(1),
        values: z.array(z.number()),
      }),
    )
    .min(2),
});

export type BarRaceSpecParsed = z.infer<typeof barRaceSchema>;

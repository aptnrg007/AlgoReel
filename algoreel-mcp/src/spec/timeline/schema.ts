import { z } from "zod";

// Mirrors src/spec/timeSeries/schema.ts's split: this is the runtime
// shape a candidate gets checked against; types.ts is the compile-time
// mirror. At least 2 events — a single event has nothing to reveal "over
// time."
export const timelineSchema = z.object({
  title: z.string().min(1),
  events: z
    .array(
      z.object({
        date: z.string().min(1),
        title: z.string().min(1),
      }),
    )
    .min(2),
});

export type TimelineSpecParsed = z.infer<typeof timelineSchema>;

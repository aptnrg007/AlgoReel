import { z } from "zod";

// select-video-type.yaml/.anthropic.yaml's output — mirrors
// src/spec/schema.ts's algorithmChoiceSchema in spirit (a narrow,
// closed-enum answer for a toolless local model's constrained decoding),
// scoped to the two video types that actually have implementations
// (src/plan/types.ts's VideoType comment).
export const videoTypeChoiceSchema = z.object({
  videoType: z.enum(["dsa", "time_series"]),
});

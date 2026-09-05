import type { ComponentType } from "react";
import { buildTimeline } from "./buildTimeline";
import { AlgorithmVideo } from "./AlgorithmVideo";
import { TimeSeriesVideo } from "./TimeSeriesVideo";
import type { DsaVideoPlan, TimeSeriesVideoPlan, VideoPlan, VideoType } from "../src/plan/types";
import { validateSpec } from "../src/spec/validate";
import { checkTimeSeriesRender } from "../src/spec/timeSeries/checkRender";
import { validateTimeSeriesSpec } from "../src/spec/timeSeries/validate";

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

// PLAN.md §11's registry, made real: every video-type-specific concern
// this file's consumers used to switch on independently — Video.tsx's
// render dispatch, videoPlanDuration.ts's duration dispatch (now folded
// into this file), and every ad hoc validate call a caller had to know to
// make — collapses into one lookup table. Adding a video type means
// adding one entry here (plus its own spec/validator/renderer files, same
// as dsa/time_series each already are) — nothing in Video.tsx or Root.tsx
// changes (PLAN.md §28: prove the mechanism on two types before adding a
// third).
export interface VideoTypeDefinition<Plan extends VideoPlan = VideoPlan> {
  validate: (plan: Plan) => PlanValidationResult;
  calculateDurationInFrames: (plan: Plan, fps: number) => number;
  render: ComponentType<{ plan: Plan }>;
}

function validateDsaPlan(plan: DsaVideoPlan): PlanValidationResult {
  return validateSpec(plan.payload);
}

// Combines TimeSeriesSpec's own shape/semantic validation with the
// geometry check that needs the plan's targetDurationSec too — the two
// checks src/cli/renderTimeSeries.ts already runs in sequence, unified
// into the one-result shape this registry's `validate` contract expects.
// Warnings (e.g. "x-axis-labels-tight") don't fail validation here, same
// as they don't fail check_render itself — only real errors do.
function validateTimeSeriesPlan(plan: TimeSeriesVideoPlan): PlanValidationResult {
  const shape = validateTimeSeriesSpec(plan.payload);
  if (!shape.valid) return shape;
  const render = checkTimeSeriesRender(plan.payload, plan.targetDurationSec);
  const errors = render.failures.filter((f) => f.severity === "error").map((f) => f.message);
  return { valid: errors.length === 0, errors };
}

export const VIDEO_TYPES: { [K in VideoType]: VideoTypeDefinition<Extract<VideoPlan, { videoType: K }>> } = {
  dsa: {
    validate: validateDsaPlan,
    calculateDurationInFrames: (plan, fps) => buildTimeline(plan.payload, fps).totalDurationInFrames,
    render: AlgorithmVideo,
  },
  time_series: {
    validate: validateTimeSeriesPlan,
    calculateDurationInFrames: (plan, fps) => Math.round(plan.targetDurationSec * fps),
    render: TimeSeriesVideo,
  },
};

// A keyed table of per-variant functions can't statically prove "the
// function selected by plan.videoType accepts this same plan" — TypeScript
// has no way to distribute that call over the union the way a switch's own
// case narrowing would. True by construction here regardless: `plan` is
// only ever handed to the definition its own `videoType` selected. Widening
// to VideoTypeDefinition<VideoPlan> is the one sanctioned cast in this
// file, not a way to skirt real type-checking elsewhere.
function definitionFor(plan: VideoPlan): VideoTypeDefinition<VideoPlan> {
  return VIDEO_TYPES[plan.videoType] as VideoTypeDefinition<VideoPlan>;
}

export function calculateDurationInFrames(plan: VideoPlan, fps: number): number {
  return definitionFor(plan).calculateDurationInFrames(plan, fps);
}

export function validateVideoPlan(plan: VideoPlan): PlanValidationResult {
  return definitionFor(plan).validate(plan);
}

export function renderComponentFor(plan: VideoPlan): ComponentType<{ plan: VideoPlan }> {
  return definitionFor(plan).render;
}

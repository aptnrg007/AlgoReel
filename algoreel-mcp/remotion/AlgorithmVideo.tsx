import React from "react";
import { AbsoluteFill, Sequence, Series, useVideoConfig } from "remotion";
import type { StorySpec } from "../src/spec/types";
import { buildTimeline } from "./buildTimeline";
import { inputShape } from "../src/spec/inputShape";
import { ArrayView } from "./primitives/ArrayView";
import { StructureView } from "./primitives/StructureView";
import { Caption } from "./template/Caption";
import { Frame } from "./template/Frame";
import { Hook } from "./template/Hook";
import { Outro } from "./template/Outro";

// The existing DSA pipeline (PLAN.md §6). hook -> algorithm animation ->
// complexity card. Always this skeleton (PLAN.md §6). The agent supplied
// spec.narration and spec.hook; everything about layout, timing, and
// correctness of the algorithm state is decided here. Moved out of
// Video.tsx (now a videoType router) unchanged — this is exactly the
// dsa-specific renderer the router dispatches to.
export const AlgorithmVideo: React.FC<{ spec: StorySpec }> = ({ spec }) => {
  const { fps } = useVideoConfig();
  const timeline = buildTimeline(spec, fps);
  const VIEW_BY_SHAPE = { array: ArrayView, struct: StructureView } as const;
  const StateView = VIEW_BY_SHAPE[inputShape(spec.input)];

  return (
    <Series>
      <Series.Sequence durationInFrames={timeline.hookDurationInFrames}>
        <Frame>
          <Hook text={spec.hook} />
        </Frame>
      </Series.Sequence>

      {timeline.steps.map((step) => (
        <Series.Sequence key={step.beat} durationInFrames={step.durationInFrames}>
          <Frame>
            {step.checkpoints.map((cp, i) => (
              <Sequence key={i} from={cp.startFrame} durationInFrames={cp.durationInFrames}>
                <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                  <StateView state={cp.state} />
                </AbsoluteFill>
              </Sequence>
            ))}
            <Caption text={step.text} emphasis={spec.emphasis} />
          </Frame>
        </Series.Sequence>
      ))}

      <Series.Sequence durationInFrames={timeline.outroDurationInFrames}>
        <Frame>
          <Outro
            time={spec.complexity.time}
            space={spec.complexity.space}
            caption={timeline.outroText}
            emphasis={spec.emphasis}
          />
        </Frame>
      </Series.Sequence>
    </Series>
  );
};

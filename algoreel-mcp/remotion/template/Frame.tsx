import React from "react";
import { AbsoluteFill } from "remotion";
import { COLORS, FONT_FAMILY, SAFE_AREA } from "./tokens";

// The 9:16 shell every scene renders inside: flat background and a
// safe-area-padded content region (PLAN.md §6). One skeleton, reused
// everywhere, so the videos are recognizable as the same product.
//
// Note: an earlier version added a subtle grain via an SVG feTurbulence
// filter layered under this content box. It produced a faint but visible
// seam at the safe-area boundary (a Chrome compositing-layer artifact from
// stacking a filtered SVG under an absolutely-positioned flex box) — cut
// rather than chased, since a flat background reads better than a flawed one.
export const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        fontFamily: FONT_FAMILY,
        paddingTop: SAFE_AREA.top,
        paddingBottom: SAFE_AREA.bottom,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

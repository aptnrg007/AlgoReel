import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The algoreel-mcp package root, computed once here instead of
// independently in every file that needs it. Found during a cleanup pass:
// four call sites (src/server.ts, src/render/frameSampler.ts,
// src/algorithms/sandbox.ts, src/algorithms/ensureAlgorithm.ts) each
// recomputed this same path, three different ways (".." / "../.." /
// ["..", ".."]) under two different names (ROOT / MCP_ROOT), all correct
// only because each site happened to get its own directory depth right by
// hand. This file lives at src/config/ — exactly two levels below the
// package root, the same depth src/algorithms/ and src/render/ already
// were — so this is the one place that depth has to be right.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The Remotion entrypoint and the generic MCP-render composition id
// (remotion/Root.tsx's "Video" entry, whose defaultProps spec is always
// overridden at render time via --props). Previously three independent
// string-literal copies each in src/server.ts and src/render/
// frameSampler.ts, plus remotion/Root.tsx's own declaration of the id.
export const REMOTION_ENTRYPOINT = "remotion/index.ts";
export const VIDEO_COMPOSITION_ID = "Video";

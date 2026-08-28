import { z } from "zod";

import { validateSpec } from "../spec/validate";
import type { StorySpec } from "../spec/types";

// The MCP tool-response shape shared by both servers in this repo
// (src/server.ts's algoreel.* tools and src/youtube-server.ts's
// youtube.upload) — previously two byte-identical copies. The servers
// themselves stay deliberately separate (see youtube-server.ts's own
// header comment for why); this is just the one trivial formatting
// helper both happen to need.
export function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

// Every spec-taking tool in server.ts declares this exact shape —
// z.record can't express "a StorySpec" directly (validate_spec/
// check_render need to run on a possibly-invalid candidate first), so
// every handler receives it unparsed and calls validateSpec itself.
// Previously five independent copies of the same literal.
export const SPEC_INPUT_SCHEMA = { spec: z.record(z.string(), z.unknown()) };

// The validate-then-bail preamble four server.ts handlers need
// (check_render, sample_frames, render_preview, render_final) — only the
// "cannot ..."/"not rendering" phrase differed between them. Returns the
// parsed StorySpec on success, or a ready-to-return MCP response
// (already marked isError) to short-circuit with on failure.
export function validateSpecOrRespond(
  spec: unknown,
  failureNote: string,
): { storySpec: StorySpec } | { response: ReturnType<typeof text> } {
  const validation = validateSpec(spec);
  if (!validation.valid) {
    return { response: text(JSON.stringify({ error: `spec is invalid, ${failureNote}`, details: validation.errors }, null, 2), true) };
  }
  return { storySpec: spec as unknown as StorySpec };
}

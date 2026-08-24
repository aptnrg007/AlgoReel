// Single source of truth for "what kind of structure is this spec about,"
// shared by Video.tsx (which view to mount) and checkRender.ts (which
// layout check to run) so the two can't drift into disagreeing the way
// Video.tsx's old name-based dispatch and checkRender.ts's old shape-based
// checks quietly did. Keyed off input *shape*, not algorithm name, for the
// same reason checkRender.ts's original comment gives: a newly registered
// algorithm gets the right view/check for free without this file needing
// to know its name.
export type InputShape = "array" | "graph" | "list";

export function inputShape(input: Record<string, unknown>): InputShape {
  if (Array.isArray(input.list)) return "list";
  if (Array.isArray(input.nodes)) return "graph";
  return "array";
}

// Single source of truth for "what kind of structure is this spec about,"
// shared by Video.tsx (which view to mount) and checkRender.ts (which
// layout check to run) so the two can't drift into disagreeing the way
// Video.tsx's old name-based dispatch and checkRender.ts's old shape-based
// checks quietly did. Keyed off input *shape*, not algorithm name, for the
// same reason checkRender.ts's original comment gives: a newly registered
// algorithm gets the right view/check for free without this file needing
// to know its name.
//
// Only two shapes now, not one per structure — every node/link structure
// (linked list, tree, graph, stack, ...) renders through the same
// StructureView (remotion/primitives/StructureView.tsx), which reads
// which layout to use from the operation log itself (the "struct" op),
// not from the spec. This file only needs to know "array of numbers, or
// something else."
export type InputShape = "array" | "struct";

// Every field name here is one hand-written algorithm's own input shape
// (index.ts's inputSchema for that entry) — a new structure still needs
// one line added here, the one place this file's own "gets it for free"
// claim doesn't quite hold, the same caveat checkRender.ts's original
// comment already carried for a newly generated *array* algorithm vs. a
// hand-written non-array one.
export function inputShape(input: Record<string, unknown>): InputShape {
  if (
    Array.isArray(input.list) ||
    Array.isArray(input.nodes) ||
    Array.isArray(input.tree) ||
    typeof input.expression === "string"
  ) {
    return "struct";
  }
  return "array";
}

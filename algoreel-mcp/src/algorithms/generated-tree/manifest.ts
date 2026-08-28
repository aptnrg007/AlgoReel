// AUTO-MAINTAINED by sandbox.ts — regenerated in full every time a new
// tree algorithm is generated and cached, listing every file in this
// directory as a plain static import. See generated/manifest.ts's own
// comment for why static imports are required at all; this is the
// tree-shaped twin, kept in its own directory so this scan never mixes
// in an array- or graph-shaped file.
import type { AlgorithmResult } from "../types";

export interface GeneratedTreeManifestEntry {
  description: string;
  run: (input: { values: number[] }) => AlgorithmResult;
}

export const GENERATED_TREE: Record<string, GeneratedTreeManifestEntry> = {};

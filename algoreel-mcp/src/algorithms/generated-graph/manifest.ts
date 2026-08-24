// AUTO-MAINTAINED by sandbox.ts — regenerated in full every time a new
// graph algorithm is generated and cached, listing every file in this
// directory as a plain static import. See generated/manifest.ts's own
// comment for why static imports are required at all; this is the
// graph-shaped twin, kept in its own directory so this scan never mixes
// in an array-shaped file.
import type { AlgorithmResult } from "../types";

export interface GeneratedGraphManifestEntry {
  description: string;
  run: (input: { nodes: string[]; edges: [string, string][]; start: string }) => AlgorithmResult;
}

import { dfs, DESCRIPTION as dfs_DESCRIPTION } from "./dfs";

export const GENERATED_GRAPH: Record<string, GeneratedGraphManifestEntry> = {
  dfs: { description: dfs_DESCRIPTION, run: dfs },
};

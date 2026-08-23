// AUTO-MAINTAINED by sandbox.ts — regenerated in full every time a new
// algorithm is generated and cached, listing every file in this
// directory as a plain static import.
//
// This has to be static imports, not a runtime directory scan
// (readdirSync + dynamic import()) — algorithms/index.ts, which imports
// this file, is also on Remotion's render path (remotion/buildTimeline.ts
// -> algorithms/index.ts -> runAlgorithm), and that path gets bundled by
// webpack for execution inside a headless-Chrome context, not plain
// Node. Confirmed live: adding Node fs/dynamic-import to that shared
// module broke every render with "UnhandledSchemeError: Reading from
// 'node:fs' is not handled by plugins" — a browser-context bundle simply
// can't include Node builtins, and can't resolve a dynamic import()
// whose path isn't known until runtime either. A plain object of static
// imports is something webpack (and Node/tsx) can both bundle exactly
// the same way, so a generated algorithm works identically whether it's
// the long-lived MCP server or a fresh `npx remotion render` process
// that needs it.
import type { AlgorithmResult } from "../types";

export interface GeneratedManifestEntry {
  description: string;
  run: (input: { array: number[] }) => AlgorithmResult;
}

import { cocktailsort, DESCRIPTION as cocktailsort_DESCRIPTION } from "./cocktailsort";

export const GENERATED: Record<string, GeneratedManifestEntry> = {
  cocktailsort: { description: cocktailsort_DESCRIPTION, run: cocktailsort },
};

// Generates algoreel-agents/agents/schemas/*.json from the canonical zod
// schemas (src/spec/schema.ts) via zod v4's native z.toJSONSchema().
// AgentForge agent configs point their `output.schema` at these generated
// files so a model's final answer gets validated (and auto-retried on
// mismatch) against the exact same shape the TypeScript side checks — one
// source of truth, not two schemas that can drift apart.
//
// Regenerate with `npm run generate:schema` whenever spec/schema.ts
// changes. Do not hand-edit the output files.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { algorithmChoiceSchema, narrationDraftSchema } from "../src/spec/schema";

const outDir = new URL("../../algoreel-agents/agents/schemas", import.meta.url);

// story-spec.json (from src/spec/schema.ts's storySpecSchema, still very
// much alive — it backs validateSpec/validate.ts) used to be generated
// here too, but its only consumers were script.yaml/script.free.yaml's
// commented-out output.schema lines — both agents deprecated in place and
// then deleted once ensureSpec.ts fully replaced them, with no live agent
// ever actually pointing output.schema at this file. Removed rather than
// regenerated indefinitely for nothing to read it.
const files: Array<[string, z.ZodTypeAny]> = [
  ["algorithm-choice.json", algorithmChoiceSchema],
  ["narration-draft.json", narrationDraftSchema],
];

mkdirSync(outDir, { recursive: true });
for (const [name, schema] of files) {
  const outFile = new URL(`../../algoreel-agents/agents/schemas/${name}`, import.meta.url);
  writeFileSync(outFile, JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n");
  console.log(`Wrote ${outFile.pathname}`);
}

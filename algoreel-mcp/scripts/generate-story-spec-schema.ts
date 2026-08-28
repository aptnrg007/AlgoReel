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
import { algorithmChoiceSchema, narrationDraftSchema, storySpecSchema } from "../src/spec/schema";

const outDir = new URL("../../algoreel-agents/agents/schemas", import.meta.url);

const files: Array<[string, z.ZodTypeAny]> = [
  ["story-spec.json", storySpecSchema],
  ["algorithm-choice.json", algorithmChoiceSchema],
  ["narration-draft.json", narrationDraftSchema],
];

mkdirSync(outDir, { recursive: true });
for (const [name, schema] of files) {
  const outFile = new URL(`../../algoreel-agents/agents/schemas/${name}`, import.meta.url);
  writeFileSync(outFile, JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n");
  console.log(`Wrote ${outFile.pathname}`);
}

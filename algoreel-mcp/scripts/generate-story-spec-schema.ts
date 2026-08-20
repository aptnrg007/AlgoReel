// Generates algoreel-agents/agents/schemas/story-spec.json from the
// canonical zod schema (src/spec/schema.ts) via zod v4's native
// z.toJSONSchema(). AgentForge's script.yaml agent config points its
// `output.schema` at the generated file so a weak local model's final
// answer gets validated (and auto-retried on mismatch) against the exact
// same shape validate_spec checks — one source of truth, not two schemas
// that can drift apart.
//
// Regenerate with `npm run generate:schema` whenever spec/schema.ts
// changes. Do not hand-edit the output file.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { storySpecSchema } from "../src/spec/schema";

const outDir = new URL("../../algoreel-agents/agents/schemas", import.meta.url);
const outFile = new URL("../../algoreel-agents/agents/schemas/story-spec.json", import.meta.url);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(z.toJSONSchema(storySpecSchema), null, 2) + "\n");

console.log(`Wrote ${outFile.pathname}`);

#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// A deliberately separate, tiny MCP server from src/server.ts's algoreel
// tools (PLAN.md §5 already namespaces "youtube.upload" apart from
// "algoreel.*") — when real credentials land (PLAN.md §11), only this
// file changes; algoreel-mcp's main server never touches Google's API.
//
// STUB: no Google Cloud OAuth project exists yet, so `upload` validates
// real YouTube constraints and returns a clearly-marked fake result
// instead of calling any real API. publish.yaml still gates this call
// behind approval exactly as the real thing would need — swapping the
// stub body for a real upload requires no change to that approval policy.
const server = new McpServer({ name: "youtube", version: "0.1.0" });

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

server.registerTool(
  "upload",
  {
    description:
      "Upload a rendered video to YouTube. STUB: validates real YouTube constraints (title length, non-empty description, at least one tag, that the video file actually exists) but does not call any real API — no OAuth credentials are configured yet (see PLAN.md §11). Returns a clearly-marked fake videoId/url, never a real one.",
    inputSchema: {
      videoPath: z.string(),
      title: z.string().min(1).max(100),
      description: z.string().min(1),
      tags: z.array(z.string()).min(1),
      visibility: z.enum(["public", "unlisted", "private"]),
    },
  },
  async ({ videoPath, title, description, tags, visibility }) => {
    if (!existsSync(videoPath)) {
      return text(JSON.stringify({ error: `videoPath does not exist: ${videoPath}` }, null, 2), true);
    }

    // Real YouTube video ids are 11 URL-safe characters — matching that
    // shape (prefixed so it's unmistakably fake) rather than a UUID.
    const videoId = "STUB_" + randomBytes(9).toString("base64url").slice(0, 11);

    return text(
      JSON.stringify(
        {
          videoId,
          url: `https://youtube.com/watch?v=${videoId}`,
          stub: true,
          note: "No real upload happened — youtube-server.ts is a stub (PLAN.md §11: no OAuth credentials configured yet).",
          wouldHaveUploaded: { videoPath, title, description, tags, visibility },
        },
        null,
        2,
      ),
    );
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("algoreel youtube-server failed to start:", err);
  process.exit(1);
});

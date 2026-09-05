# AlgoReel

![AlgoReel](AlgoReel.png)

An autonomous content pipeline that turns a topic or a dataset into a
rendered vertical video — an agent (or deterministic keyword match) decides
what the video is about, and plain TypeScript/Remotion, never an LLM,
decides what actually appears on screen. Built on
[AgentForge](https://github.com/aptnrg007/AgentForge) as its first real
workload.

Two kinds of video today:

- **Algorithm explainers** — hook → animated algorithm walkthrough →
  complexity card, for a DSA topic like "explain bubble sort" or "how does
  breadth-first search work."
- **Time-series timelapses** — a chart animating over an axis (e.g. GDP by
  year), given JSON or CSV data you supply.

## How it works

The one design decision everything else follows from: **the agent decides
the story, deterministic code decides what happens.** An LLM never touches
what an algorithm actually does or what a data point's value is — it picks
a topic, writes narration, or classifies a request; the algorithm itself
runs as real, tested TypeScript that emits an operation log, and every
frame of the render comes from that log plus fixed layout math, not from
anything a model asserted. See `PLAN.md` for the full reasoning, and
`STATUS.md` for the phase-by-phase history of how this got built (including
every real bug found while building it, live).

## Layout

```
algoreel-mcp/       TypeScript: the algorithm/spec engine, Remotion template, CLIs, and MCP server
algoreel-agents/    AgentForge agent configs that drive algoreel-mcp
PLAN.md             design doc, architecture, and phased roadmap
STATUS.md           phase-by-phase build history and what's been verified live
```

`algoreel-mcp` is deliberately flat: `src/` is the pure, LLM-free engine
(algorithms, spec schemas/validators, MCP server, CLIs); `remotion/` is the
visual template (locked constants in `remotion/template/tokens.ts`) and the
per-video-type renderers.

## Setup

```bash
cd algoreel-mcp
npm install
```

Nothing beyond Node is required to render the committed demos or run the
time-series CLIs. Generating a *new* algorithm video from a topic (rather
than a committed demo) needs [AgentForge](https://github.com/aptnrg007/AgentForge)
on your `PATH` (or `AGENTFORGE_BIN` pointing at it) and a local model —
this repo defaults to `qwen3:8b` via [Ollama](https://ollama.com), with no
API key required; set `ANTHROPIC_API_KEY` in a repo-root `.env` only if you
want it to escalate to `claude-sonnet-5` when the local model struggles.

## Usage

### Algorithm explainer videos

Render one of the committed demos with no agent involved:

```bash
npm run render:binary-search   # out/binary-search.mp4
npm run render:bubble-sort     # out/bubble-sort.mp4
npm run render:bfs             # out/bfs.mp4
```

Turn a bare topic into a video, agent-authored narration included — no API
key needed by default:

```bash
export AGENTFORGE_BIN=/path/to/AgentForge/agentforge   # if not on PATH
./preview.sh "explain linked lists"
# renders a preview mp4 after one approval prompt
```

`./run.sh "a topic"` does the same but continues through to a (currently
stubbed) YouTube upload step. Both accept `AUTO_APPROVE=1` for a
non-interactive run.

For programmatic access, `algoreel-mcp/src/server.ts` exposes the same
pipeline as an MCP server (`list_algorithms`, `validate_spec`,
`check_render`, `render_preview`, `render_final`, ...) — run it standalone
with `npx tsx src/server.ts`, or drive it through AgentForge's own agent
configs in `algoreel-agents/agents/`.

Six algorithms are hand-written (`binarySearch`, `bubbleSort`,
`bfs`, `reverseLinkedList`, `inorderTraversal`, `checkBalancedParens`,
covering array, graph, linked-list, tree, and stack visuals). Beyond
those, a topic that doesn't match anything can have its implementation
*generated* on demand — any other sorting algorithm, or BFS/DFS by
name — written by a local model, sandboxed, and checked against a real
correctness oracle before being cached and trusted like a hand-written one.

### Time-series timelapse videos

From a JSON spec:

```json
// my-gdp.json
{
  "title": "India GDP: 1990–2025",
  "xAxis": { "label": "Year", "values": [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025] },
  "yAxis": { "label": "GDP", "unit": "USD billions" },
  "series": [{ "name": "India", "values": [320, 480, 710, 900, 1700, 2100, 2700, 3900] }]
}
```

```bash
npx tsx src/cli/renderTimeSeries.ts my-gdp.json --duration=20
# -> my-gdp.mp4, next to the input file
```

From a CSV (first column is the x-axis, every other column its own series):

```bash
npx tsx src/cli/renderTimeSeries.ts gdp.csv \
  --title="GDP: India vs China" --x-label=Year --y-label=GDP --y-unit="USD billions" \
  --duration=15 --out=gdp.mp4
```

Or let a planner classify a plain request as a timelapse (vs. an algorithm
video) and produce the same kind of validated plan the CLI above renders —
this prints the plan as JSON rather than rendering directly, useful once
you're driving AlgoReel from something other than a human typing a CLI flag:

```bash
npx tsx src/cli/planVideo.ts "GDP timelapse" \
  --csv=gdp.csv --title="GDP: India vs China" --x-label=Year --y-label=GDP --duration=15
```

Either way, an invalid or badly-shaped spec (mismatched series lengths, too
many x-axis points to label legibly, too short a duration) is refused with
a specific reason — nothing renders until it would actually look right.

## Learn more

- **`PLAN.md`** — the full architecture and design rationale: the
  determinism boundary, data contracts, the MCP tool surface, and the
  phased roadmap (including how to add a new video type).
- **`STATUS.md`** — what's actually been built and verified live, phase by
  phase, including every real bug found along the way.

# AlgoReel

![AlgoReel](AlgoReel.png)

An autonomous content pipeline that turns a DSA topic into a rendered
explainer Short — an agent writes the story, deterministic TypeScript runs
the algorithm and drives the animation. Built on
[AgentForge](https://github.com/aptnrg007/AgentForge) as its first real
workload.

## The determinism boundary

The one design decision everything else here follows from: **the agent
decides the story, deterministic code decides what happens.**

An LLM never touches what an algorithm actually does — `binarySearch` and
`bubbleSort` are plain, tested TypeScript functions that emit an operation
log (`init`, `highlight`, `compare`, `swap`, `discard`, `done`, ...). An
agent's job is entirely upstream and downstream of that: pick a topic,
write the hook and narration, choose emphasis words and pacing, decide
whether a render passed QA and what to retry. It never invents a frame
number, a comparison result, or a sorted position. See `PLAN.md` §1-2 for
the full reasoning.

## Layout

```
algoreel-mcp/       TypeScript: the algorithm engine, Remotion template, and MCP server
algoreel-agents/     AgentForge agent configs that drive algoreel-mcp's tools
PLAN.md              the full design doc and phased roadmap
```

`algoreel-mcp` is deliberately flat — `src/` is the pure, LLM-free engine
(algorithms, StorySpec schema, MCP server); `remotion/` is the visual
template (locked constants in `remotion/template/tokens.ts`) and the
timeline logic that turns a StorySpec + an operation log into frames.

## Status

Following the phased plan in `PLAN.md` §9:

- **Phase 0 — done.** Hand-written StorySpec → rendered `binarySearch`
  video, zero agents involved.
- **Phase 1 — done.** Added `bubbleSort` with no new operation types and no
  special-casing in the renderer, confirming the template/timeline layer
  actually generalizes.
- **Phase 2 — done.** `algoreel-mcp` is wrapped as an MCP server
  (`src/server.ts`, five tools) and `animate.yaml` drives it through
  AgentForge with every tool call gated for approval. Verified live,
  end-to-end: `list_algorithms` → `run_algorithm` → a full StorySpec →
  `validate_spec` (the agent self-corrected through several real
  errors — a wrong `complexity` shape, an emphasis word missing from
  the narration — before it validated clean) → `render_preview`,
  producing an actual playable preview mp4. Running locally via Ollama
  needed a model that gets two things right at once — real structured
  tool calls *and* correctly nested JSON arguments even with a dotted,
  namespaced tool name — which took three rejected models to find (see
  `algoreel-agents/agents/animate.yaml`'s comments and
  `algoreel-agents/Modelfile`).
- **Phase 3 — verified live, not yet at PLAN.md §9's full bar.**
  `script.yaml` (topic → StorySpec) needs open-ended authoring *and*
  multi-round self-correction discipline at once — the one combination
  `algoreel-llama` (qwen3:8b) measurably couldn't hold, across repeated
  runs skipping `validate_spec`, looping unproductively, or answering
  empty. Fixed by routing it to Google AI Studio's free-tier Gemini
  instead of a paid API, via a **new native `gemini` provider added to
  AgentForge** (`internal/provider/gemini.go`) rather than its existing
  OpenAI-compat route — Gemini's thinking models attach an opaque
  `thoughtSignature` to tool calls that the generic OpenAI provider had
  nowhere to carry, breaking every multi-turn tool loop on the second
  turn; a second fix sanitizes tool schemas, since Gemini's function
  declarations reject standard JSON Schema keywords
  (`additionalProperties`, `propertyNames`, `$schema`) that a real MCP
  tool schema actually emits. Both confirmed against the live API, not
  just unit tests. Ran end-to-end on a topic outside the existing demo
  set: the agent picked `bfs` on its own from an indirect description (no
  algorithm named in the prompt), called `validate_spec` three times
  fixing real errors, and only then answered — see
  `algoreel-mcp/specs/bfs-party-intro-demo.json`. One run doesn't clear
  PLAN.md §9's five-consecutive-topic exit bar yet, but it cleanly avoids
  every qwen3 failure mode above. Also fixed along the way: `animate.yaml`
  was missing the same "`targetDurationSec` is a sibling of `youtube`, not
  nested inside it" warning `script.yaml` already had, which was sending
  qwen3 into the identical unproductive loop on the render side.

## Quickstart

```
cd algoreel-mcp
npm install
```

Render the demo videos (no agent involved):

```
npm run render:binary-search   # out/binary-search.mp4
npm run render:bubble-sort     # out/bubble-sort.mp4
npm run render:bfs             # out/bfs.mp4
```

Run the MCP server standalone (for use by any MCP client, including
AgentForge):

```
npx tsx src/server.ts
```

Drive it through AgentForge — from the `AgentForge` repo, with Ollama
running locally and the `algoreel-llama` model built from
`algoreel-agents/Modelfile` (or see `animate.yaml`'s comments to switch
to Anthropic instead):

```
ollama create algoreel-llama -f /path/to/AlgoReel/algoreel-agents/Modelfile
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
./agentforge chat /path/to/AlgoReel/algoreel-agents/agents/animate.yaml
```

Turn a bare topic into a validated StorySpec — `script.yaml` runs on
Google AI Studio's free-tier Gemini via AgentForge's native `gemini`
provider (get a key at https://aistudio.google.com/apikey; `script.yaml`'s
comments show how to swap in Anthropic or xAI instead):

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
export GOOGLE_API_KEY=...
./agentforge run /path/to/AlgoReel/algoreel-agents/agents/script.yaml \
  -m "explain breadth-first search"
```

## Algorithms

Three chosen for visual variety, not difficulty (`PLAN.md` §10), and all
three are built: `binarySearch`, `bubbleSort`, and `bfs`. Adding `bfs`
extended the operation vocabulary by exactly one type — `graph`, the
graph-shaped analog of `init` (declares the full node/edge set up front,
the same way `init` gives array algorithms a fixed set of cells from frame
0) — reusing the `visit`/`enqueue`/`dequeue`/`edge` operations that were
already defined but unused. Rendering picks `ArrayView` or `GraphView`
based on the spec's algorithm; both fold from the same operation log
through the same `VisualState`, `buildTimeline`, and beat-grouping
pipeline with no other special-casing.

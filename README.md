# AlgoReel

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
- **Phase 2 — in progress.** `algoreel-mcp` is wrapped as an MCP server
  (`src/server.ts`, five tools) and there's an `animate.yaml` agent to
  drive it through AgentForge. Verified directly with a scripted MCP
  client and with `agentforge run` connecting and discovering tools; the
  live interactive `agentforge chat` run is pending a working model
  backend (see `algoreel-agents/agents/animate.yaml`'s comments).

## Quickstart

```
cd algoreel-mcp
npm install
```

Render the two demo videos (no agent involved):

```
npm run render:binary-search   # out/binary-search.mp4
npm run render:bubble-sort     # out/bubble-sort.mp4
```

Run the MCP server standalone (for use by any MCP client, including
AgentForge):

```
npx tsx src/server.ts
```

Drive it through AgentForge — from the `AgentForge` repo, with
`algoreel-mcp` built and a model backend configured (see
`algoreel-agents/agents/animate.yaml` for Ollama vs Anthropic setup):

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
./agentforge chat /path/to/AlgoReel/algoreel-agents/agents/animate.yaml
```

## Algorithms

Three chosen for visual variety, not difficulty (`PLAN.md` §10):
`binarySearch` and `bubbleSort` are built; `bfs` is next, to prove the
operation vocabulary extends to a graph/queue primitive without special
cases either.

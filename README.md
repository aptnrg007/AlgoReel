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
- **Phase 3 — done, PLAN.md §9's bar met.**
  `script.yaml` (topic → StorySpec) needs open-ended authoring *and*
  multi-round self-correction discipline at once — the one combination
  `algoreel-llama` (qwen3:8b) measurably couldn't hold, across repeated
  runs skipping `validate_spec`, looping unproductively, or answering
  empty. First fixed by routing it to Google AI Studio's free-tier Gemini
  instead of a paid API, via a **new native `gemini` provider added to
  AgentForge** (`internal/provider/gemini.go`) rather than its existing
  OpenAI-compat route — Gemini's thinking models attach an opaque
  `thoughtSignature` to tool calls that the generic OpenAI provider had
  nowhere to carry, breaking every multi-turn tool loop on the second
  turn; a second fix sanitizes tool schemas, since Gemini's function
  declarations reject standard JSON Schema keywords
  (`additionalProperties`, `propertyNames`, `$schema`) that a real MCP
  tool schema actually emits. Both confirmed against the live API. Ran
  end-to-end on a topic outside the existing demo set: the agent picked
  `bfs` on its own from an indirect description (no algorithm named in
  the prompt), called `validate_spec` three times fixing real errors, and
  only then answered — see `algoreel-mcp/specs/bfs-party-intro-demo.json`.

  Before giving up on a free/local path, tried giving `script.yaml` the
  same scaffold that already makes `animate.yaml` reliable on qwen3: a
  `run_algorithm` step before drafting, so the agent gets the real
  `primaryStepCount` ceiling as a fact up front instead of discovering it
  from a `validate_spec` rejection. It shifted *where* qwen3 failed (now
  dying right after `run_algorithm` instead of right after
  `list_algorithms`) but not *whether* — still only 1 success in 5
  direct-topic trials (`bfs`, `binary search`, `bubble sort` x2, `linked
  list`), the rest silently giving no final answer. This is decent
  evidence the gap is a genuine multi-turn-tool-calling ceiling in the
  model, not an instructions problem — no amount of scaffolding closed it.

  The `run_algorithm` step is a real, provider-agnostic improvement
  though (kept for every provider), and while adding it a second real
  option showed up: **Anthropic now works too.** It first failed outright
  with `tools.0.custom.name: String should match pattern
  '^[a-zA-Z0-9_-]{1,128}$'` — AgentForge's MCP tool names are namespaced
  `<server>.<tool>` with a dot, which Anthropic's tool-name schema
  rejects, and unlike the `openai` provider (which already translates
  dots via `toWireToolName`/`fromWireToolName`), `anthropic.go` had no
  such translation. Fixed by applying that same round-trip to
  `anthropic.go`'s four tool-name call sites. After that fix,
  `claude-sonnet-5` went 3/3 clean on `script.yaml` — two indirect topics
  plus one direct — each finishing in exactly 3 tool calls
  (`list_algorithms` → `run_algorithm` → `validate_spec`, valid on the
  first attempt). **`script.yaml` now defaults to Anthropic.**

  A free/local-only variant, **`script.free.yaml`**, carries the Gemini
  (default) and qwen3-via-Ollama (commented) config side by side with
  real drawbacks documented in its own STATUS comment: Gemini's
  20-requests/day cap on the non-lite model plus the native-provider
  dependency above, and qwen3's 1-in-5 ceiling described above. Use it
  only if avoiding a paid API key matters more than those tradeoffs.
  **5/5 clean runs on Anthropic** (a mix of direct and indirect topics,
  every one valid on the first `validate_spec` call) clears PLAN.md §9's
  five-consecutive-topic exit bar. Also fixed along the way: `animate.yaml`
  was missing the same
  "`targetDurationSec` is a sibling of `youtube`, not nested inside it"
  warning `script.yaml` already had, which was sending qwen3 into the
  identical unproductive loop on the render side.
- **Phase 4 — Layer 1 done, Layer 2 blocked on AgentForge.** A spec that
  passes `validate_spec` can still render into something unwatchable —
  proven live: a 40-element `bubbleSort` spec with two short narration
  beats validates cleanly, then produces 1601 animation checkpoints of
  which **1598 get zero frames**, because `buildTimeline`'s frame budget
  divides evenly across far more checkpoints than a short beat has frames
  for. New `check_render` MCP tool (`algoreel-mcp/src/spec/checkRender.ts`)
  catches this and three other classes of failure — an array too wide for
  the 1080px frame, graph nodes overlapping past 24 on the fixed layout
  circle, and a real render duration drifting from `targetDurationSec` —
  as a **pure function of the spec**, not a rendered video: every check
  turned out to need nothing but `buildTimeline()`'s existing timeline math
  and the fixed geometry in `tokens.ts`, so it runs before the expensive
  render instead of after. That last check alone caught two specs already
  sitting in the repo silently missing their target duration by 8+
  seconds (`specs/binary-search-demo.json`, and Phase 3's own
  `bfs-party-intro-demo.json`) — `validate_spec` had no way to see either.
  New **`qa.yaml`** agent drives `check_render` → fix → `check_render` →
  `validate_spec` → `render_preview` (gated, same principle as
  `animate.yaml`); verified live end-to-end on Phase 4's own exit case: a
  deliberately broken 40-element/90-second-target spec was rewritten down
  to 6 elements across 6 beats with a matching `targetDurationSec: 32`,
  unaided, and rendered to a real mp4. **Vision QA (Layer 2) is not
  built** — traced into AgentForge and confirmed its MCP client
  stringifies image tool results into raw base64 text
  (`internal/mcp/content.go`), so a screenshot would reach the model as
  ~90K tokens of noise, not something it can see; no `BlockImage` type,
  no image support in any provider, `Capabilities.Vision` declared but
  never read. Fixing it is a breaking change across roughly five files —
  tracked as a separate follow-up, not attempted here. Also found but
  deliberately **not fixed here**: `Caption.tsx` renders captions at
  `bottom: 60px`, inside the bottom 280px `SAFE_AREA` reserved because
  YouTube's UI overlays it — every video rendered so far has its caption
  in that covered band. It's constant across every spec (a template bug,
  not a per-spec one) and deserves its own look against a real render
  rather than a fix bundled into a QA-focused phase.

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

Turn a bare topic into a validated StorySpec — `script.yaml` defaults to
Anthropic's `claude-sonnet-5` (get a key at
https://console.anthropic.com/settings/keys):

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
export ANTHROPIC_API_KEY=...
./agentforge run /path/to/AlgoReel/algoreel-agents/agents/script.yaml \
  -m "explain breadth-first search"
```

To avoid a paid API key, use **`script.free.yaml`** instead — same agent,
running on Google AI Studio's free-tier Gemini via AgentForge's native
`gemini` provider (get a key at https://aistudio.google.com/apikey) or
fully local qwen3 via Ollama. See that file's STATUS comment and the
Phase 3 status bullet above for the real tradeoffs before relying on it:

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
export GOOGLE_API_KEY=...
./agentforge run /path/to/AlgoReel/algoreel-agents/agents/script.free.yaml \
  -m "explain breadth-first search"
```

Check a StorySpec for layout/pacing problems and render it once it's
clean — **`qa.yaml`** takes a StorySpec directly (paste the JSON as the
message), fixes anything `check_render` flags, then renders. Like
`animate.yaml`, `render_preview` needs a separate approval:

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
export ANTHROPIC_API_KEY=...
./agentforge run /path/to/AlgoReel/algoreel-agents/agents/qa.yaml \
  -m "$(cat some-spec.json)" --output-format json
# then, once it reports state: awaiting_approval:
./agentforge runs approve <run-id> <call-id>
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

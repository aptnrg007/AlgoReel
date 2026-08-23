# AlgoReel — Plan

**An agent-driven pipeline that produces and publishes DSA explainer Shorts, running on AgentForge.**

---

## 1. What this is, and why

Two framings, and only one of them is worth building.

**Weak framing:** "A tool that makes DSA animation videos." There are a hundred of these. The interesting part (Remotion) is someone else's library.

**Strong framing:** "AgentForge's first real workload." An autonomous content pipeline where an agent picks a topic, writes a script, drives a deterministic animation engine, inspects its own output, retries when it fails, and publishes — with a human approval gate on the upload.

The second framing is the one to build, because it makes two repos validate each other:

- **AgentForge** stops being a runtime with toy demos (filesystem assistant, notes assistant) and becomes a runtime that does real work. Every design decision in it — persisted runs, resumability, approval gates, inspectable traces — gets a concrete justification.
- **AlgoReel** stops being "video automation" and becomes a demonstration of agent orchestration with a hard correctness requirement.

The portfolio line is: *"I built a local-first agent runtime, then used it to run an autonomous content pipeline that publishes to YouTube. Here's the trace of how video #7 got made."*

There is no ship deadline. Optimise for the pipeline being genuinely good and the code being worth reading.

---

## 2. The single most important design decision

**The agent decides the story. Deterministic code decides what happens.**

If an LLM is ever responsible for "what does bubble sort do on `[5,2,8,1,4]`", the output will eventually be wrong in a way that is embarrassing on a public channel. Correctness is not negotiable in educational content.

| The agent decides | Deterministic code decides |
| --- | --- |
| Which topic to cover | Algorithm execution |
| The hook and narration script | The operation log |
| Which words get emphasis treatment | Frame timings derived from audio duration |
| Pacing (fast/slow sections) | Whether the render passed QA |
| Retry strategy when a stage fails | Layout, spacing, safe-area compliance |
| Title, description, tags | Final MP4 encoding |

Concretely: the agent emits `{"algorithm": "bubbleSort", "input": [5,2,8,1,4]}`. Your TypeScript runs it and emits the operation log. The agent never touches the log's contents.

---

## 3. Architecture

Three repos. The MCP boundary conveniently also solves the Go/TypeScript split — AgentForge is Go, Remotion is Node, and MCP is a process boundary.

```
AgentForge/              (existing, Go)      the runtime
algoreel-mcp/          (new, TypeScript)   the toolset + animation engine
algoreel-agents/       (new, YAML + sh)    the agent definitions + orchestrator
```

### algoreel-mcp

Deliberately flat until it earns structure. No monorepo, no packages/, no workspaces.

```
algoreel-mcp/
├── src/
│   ├── server.ts              # MCP stdio server, tool registration
│   ├── algorithms/
│   │   ├── types.ts           # Operation union type
│   │   ├── binarySearch.ts
│   │   ├── bubbleSort.ts
│   │   ├── bfs.ts
│   │   └── index.ts           # registry: name -> {run, inputSchema}
│   ├── spec/
│   │   ├── schema.ts          # StorySpec zod schema
│   │   └── validate.ts
│   ├── render/
│   │   ├── renderPreview.ts   # low-res, fast, samples frames
│   │   ├── renderFinal.ts     # 1080x1920 h264
│   │   └── checkRender.ts     # deterministic QA assertions
│   ├── audio/
│   │   ├── tts.ts
│   │   └── captions.ts
│   └── youtube/
│       └── upload.ts
├── remotion/
│   ├── Root.tsx               # composition registry
│   ├── template/              # THE visual language — see §6
│   │   ├── tokens.ts
│   │   ├── Frame.tsx          # 9:16 shell, safe areas, background
│   │   ├── Hook.tsx
│   │   ├── Caption.tsx
│   │   └── Outro.tsx
│   ├── primitives/
│   │   ├── Array.tsx
│   │   ├── Pointer.tsx
│   │   ├── Highlight.tsx
│   │   ├── Graph.tsx
│   │   └── Queue.tsx
│   └── Video.tsx               # operation log -> timeline
├── out/                       # gitignored: renders, audio, logs
└── package.json
```

### algoreel-agents

```
algoreel-agents/
├── agents/
│   ├── script.yaml            # topic -> StorySpec
│   ├── animate.yaml           # StorySpec -> rendered preview
│   ├── qa.yaml                # preview -> pass/fail + fix instructions
│   └── publish.yaml           # final -> YouTube (gated)
├── run.sh                     # the orchestrator
└── state/                     # per-video working dirs
```

### Orchestration: do not build a multi-agent framework

AgentForge explicitly defers multi-agent workflows, and that deferral is correct. Do not undo it for this.

Instead: four separate `agentforge run` invocations chained by a shell script. `agentforge run` already exits non-zero on failure, which makes it safe to chain. Each stage gets its own persisted run ID, its own trace, its own `agentforge runs get <id>`.

```bash
#!/usr/bin/env bash
set -euo pipefail
TOPIC="$1"
VID=$(date +%Y%m%d-%H%M%S)
WORK="state/$VID"; mkdir -p "$WORK"

agentforge run agents/script.yaml  -m "$TOPIC"          --output "$WORK/spec.json"
agentforge run agents/animate.yaml -m "@$WORK/spec.json" --output "$WORK/preview.json"

for attempt in 1 2 3; do
  if agentforge run agents/qa.yaml -m "@$WORK/preview.json" --output "$WORK/qa.json"; then
    break
  fi
  agentforge run agents/animate.yaml -m "@$WORK/qa.json" --output "$WORK/preview.json"
done

agentforge run agents/publish.yaml -m "@$WORK/final.json"   # pauses on approval gate
```

This is a better story than a bespoke orchestrator, because the per-stage traces are inspectable after the fact. It does require two AgentForge features that don't exist yet (`--output`, `@file` message input) — see the companion roadmap.

---

## 4. Data contracts

Everything downstream depends on these two schemas being stable. Write them first.

### StorySpec — what the script agent produces

```jsonc
{
  "version": 1,
  "topic": "binary search",
  "algorithm": "binarySearch",          // must exist in the registry
  "input": { "array": [2,5,8,12,16,23,38], "target": 23 },
  "targetDurationSec": 45,
  "hook": "Why does binary search find anything in 7 steps?",
  "narration": [
    { "beat": "intro",   "text": "Binary search only works on sorted arrays." },
    { "beat": "op:0",    "text": "Check the middle element." },
    { "beat": "op:1",    "text": "23 is bigger, so throw away the left half." },
    { "beat": "outro",   "text": "Log n. Every step halves the problem." }
  ],
  "emphasis": ["HALF", "SORTED", "LOG N"],
  "complexity": { "time": "O(log n)", "space": "O(1)" },
  "youtube": {
    "title": "Binary Search in 45 Seconds",
    "description": "...",
    "tags": ["dsa", "algorithms", "binarysearch"]
  }
}
```

Note `"beat": "op:N"` — narration is anchored to operation indices, not timestamps. Timing is derived later from actual TTS audio duration. The agent never invents frame numbers.

### Operation log — what the algorithm engine produces

Discriminated union, one entry per visual event. The renderer must handle every variant exhaustively (TypeScript `never` check in the switch).

```ts
type Operation =
  | { type: "init";      array: number[] }
  | { type: "pointer";   name: string; index: number }
  | { type: "compare";   a: number; b: number; result: "lt" | "eq" | "gt" }
  | { type: "swap";      i: number; j: number }
  | { type: "highlight"; indices: number[]; style: "focus" | "found" | "dead" }
  | { type: "discard";   from: number; to: number }
  | { type: "visit";     node: string }
  | { type: "enqueue";   node: string }
  | { type: "dequeue";   node: string }
  | { type: "edge";      from: string; to: string; state: "active" | "used" }
  | { type: "done";      result?: number | string };
```

Rule: adding an algorithm must not require adding an operation type. If it does, the operation vocabulary was wrong. Get to five algorithms before extending it.

---

## 5. MCP tool surface

```
algoreel.list_algorithms()
  -> [{ name, description, inputSchema }]

algoreel.validate_spec(spec)
  -> { valid: bool, errors: string[] }
  # cheap, no render. Agent calls this before anything expensive.

algoreel.run_algorithm(name, input)
  -> { operations: Operation[], summary: string }
  # pure deterministic. NO LLM anywhere in here.

algoreel.generate_voice(narration)
  -> { audioPath, perBeatDurations: {beat: seconds}, totalSec }

algoreel.render_preview(specPath)
  -> { videoPath, framePaths: string[], durationSec }
  # 540x960, low quality, fast. Samples ~6 frames as PNGs.

algoreel.check_render(spec)
  -> { pass: bool, failures: Check[] }
  # deterministic assertions, see §7. Built: takes the spec, not a
  # previewPath — every check turned out to be a pure function of the
  # spec + buildTimeline()'s existing timeline math, so it runs before
  # the expensive render, not after. See §7.

algoreel.sample_frames(spec)
  -> MCP content: alternating text labels + image blocks, one pair per
     sampled frame (4-6 frames: hook, up to 4 steps, outro)
  # Layer 2 vision QA, see §7. Built: also takes the spec, not a
  # rendered video — renders its own stills via @remotion/renderer's
  # programmatic API (bundle cached once per server process), no
  # dependency on render_preview having run first.

algoreel.render_final(spec)
  -> { videoPath, durationSec, targetDurationSec, sizeBytes }
  # Built: takes the spec directly, same deviation as check_render/
  # sample_frames/render_preview above, for the same reason — every tool
  # in this server takes a spec object, and nothing in the pipeline
  # persists one to a path first. Same as render_preview minus
  # --scale=0.5 (full 1080x1920 resolution) and a longer timeout.

algoreel.get_analytics(videoIds)
  -> [{ id, views, avgViewPct, retentionCurve }]
  # Phase 6, not built yet.

youtube.upload(videoPath, title, description, tags, visibility)
  -> { videoId, url }
  # ALWAYS behind approvals.require. Built as a STUB (no Google Cloud
  # OAuth project exists yet — §11): validates real YouTube constraints
  # and returns a clearly-marked fake videoId/url, no network call. Lives
  # in its own MCP server (algoreel-mcp/src/youtube-server.ts), separate
  # from algoreel's — swapping in a real upload only ever touches that
  # one file.
```

**Sizing constraint:** `run_algorithm` on a 40-element sort returns hundreds of operations. Never hand the full log to the model — return `summary` plus a path, and let the renderer read the file. Tool results going into a 16k-context local model must stay small.

---

## 6. The visual template

This is the part most likely to be skipped and most responsible for whether the videos are watchable. A mediocre animation in a strong, consistent visual language beats a beautiful animation with no identity.

Lock these before building more than one primitive:

| Decision | Commit to one value |
| --- | --- |
| Resolution | 1080 × 1920, 30fps |
| Safe area | 120px top, 280px bottom (YouTube UI overlays the bottom) |
| Background | one flat dark colour + subtle grain; no gradients that fight the elements |
| Type scale | 3 sizes only: hook, caption, label |
| Font | one family, two weights |
| Array cell | fixed size, fixed gap, fixed corner radius — never resize per element count |
| Colour roles | neutral / focus / found / discarded / pointer — five, no more |
| Transition | one enter, one exit, one emphasis pop. Reuse everywhere. |
| Hook | 0–3s, full-bleed text, always the same layout |
| Outro | complexity card, always the same layout |

Every video is: **hook → algorithm animation → complexity card**. Same skeleton, always. The recognisability *is* the brand.

---

## 7. QA without eyes

"Agent inspects the render and decides it looks bad" is the weakest link in any agentic-video diagram. A local coder model cannot see, and even a vision model asked "does this look good?" gives useless answers.

**Layer 1 — deterministic checks. Built** (`algoreel-mcp/src/spec/checkRender.ts`, wired up as the `check_render` MCP tool and driven by `qa.yaml`). Turned out every check with real signal is a pure function of the spec + `buildTimeline()`'s existing timeline math + the fixed geometry in `tokens.ts` — no pixels needed, so `check_render` runs on the spec directly, before the expensive render:

- `array-too-wide` / `array-near-edge` — array width vs frame width, computed from element count and `CELL` (an 8-element array is already 1114px, wider than the 1080px frame — caught live: Phase 3's own trial 4 spec had this and nothing noticed).
- `graph-nodes-overlap` — adjacent node spacing on the fixed layout circle vs `NODE.size` (breaks past 24 nodes).
- `invisible-checkpoints` — any animation checkpoint that gets `durationInFrames: 0` because a beat has more real animation steps than its narration duration allows. This is the headline finding: a 40-element bubbleSort spec with 2 short op beats produces 1601 checkpoints, of which **1598 get zero frames** — `validate_spec` passes this spec cleanly today.
- `blank-checkpoint` — a checkpoint with no array and no graph nodes (the renders-nothing failure `buildTimeline`'s intro-seeding comment already documents having happened once).
- `duration-off-target` — real computed duration vs `targetDurationSec`, >5s drift. Also live: the committed `binary-search-demo.json` and Phase 3's `bfs-party-intro-demo.json` both claim 30s and actually render to ~21.5s — neither was ever caught before this.

Three of the originally sketched checks are **not implemented**, each for a concrete reason found while building this: "every operation maps to a frame range" is superseded by `invisible-checkpoints` (checking checkpoints, not raw operations, since `compare`/`done` are deliberate visual no-ops that never produce a checkpoint); "every emphasis word appears in a caption" already lives in `validate.ts`; "no frame is >98% single-colour" would be a false-positive machine against this template — a 7-cell array covers ~5.6% of the frame against a flat background, so *every valid render* is already >90% single-colour, and the "did anything render" signal it's chasing is what `blank-checkpoint` already covers geometrically. `abs(audioDuration − timelineDuration) < 0.5s` is vacuous until real TTS lands (§11) — `generate_voice` estimates from the same function the timeline itself uses.

**Layer 2 — vision. Built.** Was blocked on AgentForge: its MCP client
(`internal/mcp/content.go`'s `contentToText`) used to flatten any
non-text MCP content block — including a real `ImageContent` — into raw
base64 JSON *text*, ~90K tokens of unreadable noise instead of something
a model could see. Fixed there first (a real `BlockImage` content type,
an optional `ExecuteRich` tool executor, and Anthropic's translator
building a genuine nested-image `tool_result` — verified live against
the real Messages API before wiring anything up here).

On the AlgoReel side: `remotion/sampleFrames.ts` picks 4-6 frame numbers
from a `Timeline` (hook, up to 4 evenly-spread steps, outro — pure, unit
tested, no browser needed); `src/render/frameSampler.ts` renders them via
`@remotion/renderer`'s programmatic API (`bundle` once and cache it,
`selectComposition` + `renderStill` per frame, returning an in-memory
`Buffer` — no temp files); the `sample_frames` MCP tool returns each as a
text label followed by a real image content block. `qa.yaml` looks at
them directly and checks exactly PLAN.md's two closed questions — text
clipped at an edge, elements overlapping — never an aesthetic one.

**A real bug surfaced building this, worth recording**: the very first
live run corrupted the MCP stdio stream on every `sample_frames` call
(`invalid character 'D' looking for beginning of value` on the AgentForge
side). Root cause: `@remotion/renderer`'s `isEqualOrBelowLogLevel` treats
an *unset* `logLevel` as `indexOf(undefined) === -1`, which compares as
"below" every real level — silently enabling Chromium's `dumpio`, which
re-emits the browser's own stdout/stderr (including its `DevTools
listening on ws://...` startup line) via `console.log`, landing on the
same real stdout an MCP stdio server reserves exclusively for JSON-RPC.
Fixed by passing `logLevel: "error"` explicitly to `selectComposition`
and `renderStill` (not `bundle`, which never launches a browser).
Verified live, end to end: `qa.yaml` on the committed
`bubble-sort-demo.json` now runs `check_render` → `validate_spec` →
`sample_frames` (one clean call, no retries) → `render_preview` in 4
tool calls, ~46s, producing a real mp4 — it reported no clipping or
overlap on this spec, and did *not* flag the caption/safe-area issue
below, which is the expected, honest result: nothing in the frame itself
is clipped or overlapping — YouTube's UI only covers that band once the
video is actually in the app, which an isolated still can't show a vision
model. That gap is real but out of Layer 2's narrow scope as specified.
**Since fixed** — `Caption.tsx` anchored to a bare `bottom: 60`, which a
`position: absolute` element ignores `Frame`'s `paddingBottom` for; moved
to `bottom: SAFE_AREA.bottom` so it clears the reserved band entirely.
Confirmed visually via `sample_frames` itself on the exact spec above.

The QA agent's job is to read the failure list and decide *what to
change* — adjust pacing, shorten narration, reduce array size, re-render.
That's a genuine agentic decision with a verifiable success criterion,
and `qa.yaml` now does it with both layers.

---

## 8. Agent configs

Sketches; refine against real AgentForge YAML once the needed features land.

**script.yaml** — `list_algorithms`, `run_algorithm`, `validate_spec`. Must emit valid StorySpec JSON. Model: needs to write well *and* hold a multi-round self-correction loop — a local model (qwen3:8b) measurably can't do both at once, even with `run_algorithm` added as a scaffolding step (see README's Phase 3 notes). Currently Anthropic's `claude-sonnet-5`, verified 3/3 clean; a free/local-only variant, `script.free.yaml`, holds Google AI Studio's free-tier Gemini (via a native `gemini` provider added to AgentForge) or qwen3 via Ollama, with their drawbacks documented in that file.

**animate.yaml** — `run_algorithm`, `generate_voice`, `render_preview`. Mostly mechanical; a local model can drive this once the tool schemas are tight.

**qa.yaml** — built, both QA layers. `check_render`, `validate_spec`, `sample_frames`, `render_preview` (gated, same as `animate.yaml`). Model: `claude-sonnet-5`, genuinely exercising vision now (§7).

**publish.yaml** — built (upload stubbed). `check_render`, `validate_spec`, `sample_frames`, `render_final`, `youtube.upload`. Model: `claude-sonnet-5`. This is the fully automated pipeline `run.sh` drives — everything but the upload is auto-approved (unlike `qa.yaml`, which also gates `render_preview` since it's meant to be watched interactively); only `youtube.upload` requires a decision, matching PLAN.md §9's "approve one prompt" exit bar exactly.

```yaml
# publish.yaml (as built)
approvals:
  mode: annotated
  auto_approve: ["algoreel.check_render", "algoreel.validate_spec", "algoreel.sample_frames", "algoreel.render_final"]
  require: ["youtube.upload"]
  timeout: 30m
  on_timeout: deny
```

**Keep the upload gate permanently.** Full autonomy is not the more impressive design — a system that does all the work and asks for one signature is. It also means a bad video is never publicly your fault.

---

## 9. Phases

Each phase has an exit criterion. Do not start the next one until it's met.

### Phase 0 — One good video, zero agents
Remotion + `binarySearch` + a hand-written StorySpec → MP4. No MCP, no AgentForge, no LLM.

*Exit:* a 45-second binary search video you'd be willing to show someone.

*Why first:* this is the highest-risk unknown and it has nothing to do with agents. If the animation looks bad, no amount of orchestration saves it.

### Phase 1 — Visual template
Extract the template layer from the Phase 0 video. Add `bubbleSort` and confirm it reuses everything without special-casing.

*Exit:* two videos that are visibly the same product.

### Phase 2 — Wrap as MCP, drive by hand
Build `server.ts`. Register tools. Run `agentforge chat animate.yaml` and type "make a bubble sort video." Every tool call gated so you watch each one.

*Exit:* an agent produced a video end-to-end, even with you approving every step.

*This phase is where you discover your tool schemas are wrong.* Expect to rewrite them.

### Phase 3 — a real model provider for script.yaml
Originally scoped as "Anthropic provider in AgentForge"; first landed as
a native Gemini provider instead (Google AI Studio's free tier, no API
spend), since AgentForge's `openai` provider couldn't reach Gemini's
OpenAI-compat endpoint through a full multi-turn tool loop. Anthropic
came back into play once a second AgentForge bug was found and fixed —
its tool-name translation (`toWireToolName`/`fromWireToolName`) existed
for the `openai` provider but not `anthropic.go`, so any dotted MCP tool
name 400'd immediately — and now `script.yaml` defaults to
`claude-sonnet-5`, verified 3/3 clean. Gemini (plus qwen3 via Ollama)
lives on in `script.free.yaml` as the free/local-only option, with its
drawbacks documented there. See README's Phase 3 notes for the full
history, including a `run_algorithm` scaffolding step tried against
qwen3 that didn't close its reliability gap. Still blocks all vision QA
(Phase 4) either way.

*Exit:* `script.yaml` produces valid StorySpec JSON on 5 consecutive
topics without hand-editing. **Met** — 5/5 clean runs on Anthropic (a mix
of direct and indirect topics), each valid on the first `validate_spec`
call. Phase 3 is done.

### Phase 4 — QA loop
Deterministic checks, then vision. Agent retries on failure.

**Both layers done** (see §7's full writeup). `check_render` — a pure
function of the spec, not a render, since every real check turned out to
need nothing but the spec + the timeline math already in
`buildTimeline.ts` — and `sample_frames` — real Remotion stills via
`@remotion/renderer`'s programmatic API, after fixing both an AgentForge
vision-support gap and a real MCP-stdio-corruption bug found in the
process (`logLevel` defaulting to Chromium's verbose `dumpio` mode) — are
both wired into `qa.yaml` and verified live end to end.

*Exit:* a deliberately broken spec (40-element array, 90 seconds of
narration) gets caught and fixed by the agent without you intervening.
**Met.** Given a 40-element bubbleSort spec with `targetDurationSec: 90`
and only 2 thin narration beats, `qa.yaml` ran `check_render` (caught
`array-too-wide`, `invisible-checkpoints` — 1598 of 1601 checkpoints at
0 frames — and `duration-off-target`, 76s off), rewrote the spec down to
6 elements across 6 narration beats with `targetDurationSec: 32`,
`check_render` clean, `validate_spec` clean, then rendered — all without
any input beyond the one approval on `render_preview` itself, which stays
gated by design (same as `animate.yaml`). Along the way, `check_render`
also caught two *already-committed* specs silently missing their target
duration by 8+ seconds (`specs/binary-search-demo.json`,
`specs/bfs-party-intro-demo.json`) — real bugs `validate_spec` never had
the information to see.

**Publish the first Short here, manually.** Not because it's ready — because you need to find out whether the format works at all before building more on top of it.

### Phase 5 — Publish agent
YouTube MCP tool, upload gated, full `run.sh` chain.

**Done, upload stubbed.** No Google Cloud OAuth project exists yet
(§11), so `youtube-server.ts`'s `upload` validates real YouTube
constraints and returns a clearly-marked fake `videoId`/`url` instead of
calling any real API — swapping in a real upload is a change to that one
file, not to `publish.yaml`'s approval policy or `run.sh`'s flow. Every
video is still silent (caption-only) — real TTS stays the other open §11
decision.

*Exit:* `./run.sh "explain BFS"` → you approve one prompt → video is
live. **Met** (in the stubbed sense — "live" today means a stub
response, not a real upload): verified live end to end, including the
approve, deny, and `AUTO_APPROVE=1` non-interactive paths. Along the way,
found and fixed a real bug in `run.sh` itself — a `while read <
<(process substitution)` loop redirects its *entire body's* stdin, so an
interactive `read -p` inside the loop was reading EOF instead of the
user's answer instead of asking anything, and `set -e` silently killed
the script. Fixed by reading the pending-approval list from fd 3 instead
of stdin, leaving stdin free for the actual prompt.

### Phase 6 — Close the loop
`get_analytics` feeds topic selection. The agent looks at retention on the last ten videos and picks the next topic.

*Exit:* a topic chosen by the agent, based on real data, that you didn't suggest.

---

## 10. Algorithm order

Chosen for visual variety, not difficulty. Three that look different from each other validate the primitive set:

1. **Binary search** — array, pointers, elimination
2. **Bubble sort** — array, comparison, swap
3. **BFS** — graph, nodes, edges, queue

Then the long tail is cheap: linear search, selection sort, insertion sort, DFS, two pointers, sliding window, stack, queue, BST insert, merge sort.

Avoid early: quicksort (recursion + partitioning is two hard things), anything DP (tables are a whole separate primitive), anything with a call stack visualisation.

---

## 11. Open decisions

- **TTS provider.** ElevenLabs (quality, cost) vs OpenAI TTS (cheap, adequate) vs local Piper (free, robotic). Try Piper first — if it sounds acceptable at Shorts pace, the whole pipeline stays local and free.
- **Channel identity.** The repo is AlgoReel; the YouTube channel doesn't have to be. Faceless channel? Consistent intro sound? Decide before video #1, not video #10.
- **Repo split.** `algoreel-mcp` and `algoreel-agents` could be one repo. Probably should be, until they aren't.

---

## 12. What "done" looks like

A README with:

- A 20-second GIF: `./run.sh "explain quicksort"` → approval prompt → published video
- A link to the actual YouTube channel with 15+ videos
- `agentforge runs get <id>` output showing the full trace of one video's creation, including a QA failure and the agent's fix
- A short section on the determinism boundary, because that's the design insight worth explaining

And in AgentForge's README: "AlgoReel — an autonomous content pipeline built on AgentForge," with a link.

# AlgoReel — Plan

**An agent-driven pipeline that turns a topic or a dataset into a published short-form video — DSA explainers and data timelapses today — running on AgentForge.**

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

**The boundary moved up one level, not away.** Hand-writing every
algorithm forever doesn't scale (found live: asked for a topic with no
matching hand-written algorithm, the agent forced the closest one in with
misleading narration — bubble sort's swaps described as linked-list
pointer changes). The fix keeps the same principle: the agent may now
*write* an algorithm implementation, but it never gets to assert what
that code does — the code actually runs, in a sandbox, on real input, and
the operation log is a mechanical record of what really happened. A wrong
implementation shows up as a wrong result or a flagged complexity
mismatch, not as something fixable by writing more convincing narration.
See §5's `run_algorithm` and §10.

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
  #
  # Built: also accepts {name, description, code, input} — a lower-level
  # form that submits raw TypeScript directly to the sandbox/validator
  # pipeline. code is executed for real in a sandboxed child process
  # (Node's --permission flag + a vm.Script timeout, both confirmed
  # live), checked for result correctness, real comparison
  # instrumentation, and complexity-class plausibility, then cached as a
  # real, permanent algorithm file — every later request for that name
  # reuses it directly, no re-sandboxing. script.yaml no longer calls
  # this form itself (see ensure_algorithm below); it stays as the
  # tested low-level API underneath it. See §2 and §10.

algoreel.ensure_algorithm(algorithm, structure)
  -> { name, description, attempts, alreadyExisted }
  # Built: the high-level entry point script.yaml actually calls now for
  # anything not in list_algorithms. Guarantees a working implementation
  # exists — a registry hit returns immediately; a miss hands the job to
  # a dedicated, toolless specialist agent (algoreel-agents/agents/
  # algorithm.yaml, a free local model) and retries up to 3 times,
  # feeding run_algorithm's real validator error back into the prompt on
  # each failure. Does NOT run the algorithm on a real input — callers
  # use the returned name with run_algorithm({algorithm, input}) for
  # that, same as any hand-written algorithm. Only structure: "array" is
  # supported. Retry loop lives in TypeScript (src/algorithms/
  # ensureAlgorithm.ts), not in algorithm.yaml's own AgentForge turn
  # loop — deliberately, so the local model only ever has to do a single
  # "read prompt, emit code" completion per attempt rather than drive
  # multi-round tool-call self-correction, which this project's earlier
  # local-model testing already found unreliable (script.free.yaml's
  # qwen3 trial: 1 success in 5). See §10.

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

### Phase 7 — Local models by default
`script.yaml`/`qa.yaml`/`publish.yaml` all needed `ANTHROPIC_API_KEY` and a
paid model. Phase 3's own finding was that a local model's real ceiling is
*multi-turn tool-calling*, not code or tool discipline in general — the
algorithm agent (§10) already proved a toolless, single-shot, TypeScript-
orchestrated retry loop works reliably on local models where a tool-calling
loop didn't. This phase generalizes that pattern to the rest of the pipeline
instead of chasing a bigger local model.

**Done.** `algoreel-mcp/src/spec/ensureSpec.ts` replaces `script.yaml`
entirely: topic selection (`select-algorithm.yaml`, mostly a deterministic
keyword match against the live registry, falling back to a toolless
constrained-decoding call only for indirect topics) and narration authoring
(`narrate.yaml`, toolless, single-shot, given an exact beat budget computed
up front by `src/spec/beatBudget.ts` rather than repaired after the fact) are
both local by default, with every invariant a local model reliably breaks —
`op:N` beat numbering, emphasis-as-substring, array width, target duration —
enforced mechanically in TypeScript instead of asked for in a prompt. A
model ladder (`src/agents/ladder.ts`) escalates to `claude-sonnet-5` only if
`ANTHROPIC_API_KEY` is set in the environment *and* the local rung exhausts
its retries — never the other way around, and never silently.

`qa.yaml`/`publish.yaml` stayed tool-calling (their job — running
`check_render`, fixing what it flags, rendering — is exactly the mechanical,
structured-error-driven loop the algorithm agent's own retry loop already
showed local models handle fine; the failure mode Phase 3 measured was
open-ended *authoring* under a tool loop, not this). Their old Anthropic-only
versions moved to `qa.anthropic.yaml`/`publish.anthropic.yaml` as escalation
rungs (unused today — nothing calls them yet; wiring `run.sh`/`preview.sh`'s
ladder through to them is future work, not done in this phase).

**A second, real reliability bug found and fixed along the way, not assumed
away:** even with the tool-calling shape unchanged, `qa.yaml`/`publish.yaml`
against `qwen3:8b` had a measured ~50% rate of returning a completely empty
completion — no tool call, no text — on a fresh run. Root-caused live via a
raw `/api/chat` capture: Ollama's `done_reason` was a clean `"stop"`, and
`eval_count` was far under `max_tokens`, so it was never a truncation.
`qwen3:8b` was narrating its entire plan into Ollama's separate `thinking`
channel ("call check_render, then validate_spec, then...") and then simply
stopping without ever emitting the tool call it had just described. Raising
`max_tokens` cannot fix this — the model wasn't running out of budget, it
was ending the turn on its own. The fix was AgentForge-level: a new
`model.think: false` config field (`internal/config/schema.go`, threaded
through the same path `num_ctx` uses) that sends Ollama's top-level `think`
request field, turning the channel off entirely. Measured before/after
against the same agent and prompt: roughly 1 failure in 2 runs with thinking
on, 0 failures in 18 consecutive runs (10 `publish.yaml`, 8 `qa.yaml`) with
`think: false`. `run.sh`/`preview.sh`'s bash-level `run_agent_retrying_empty`
retry is kept as a second line of defense, not the fix itself.

Also done in this phase: AgentForge gained a real `model.num_ctx` config
field (same file/pattern as `think`), retiring the two derived Ollama
Modelfiles this repo used to need purely to raise the context window; a
deterministic `caption-overlaps-structure` check
(`remotion/primitives/textBox.ts`) closed the one real gap in `checkRender`'s
coverage (a long caption wraps upward and can crowd a tall structure — the
template wraps text, it doesn't clip it, so "is text cut off" was mostly the
wrong question); and `script.yaml`/`script.free.yaml` were marked deprecated
in place (kept one release as the historical record of the "1 success in 5"
qwen3 result that motivated this whole phase) rather than deleted, since
nothing still runs them.

*Exit:* `./run.sh`/`./preview.sh` with no `.env` at all → a real rendered
video, no API key required by default. **Met** — verified live with `.env`
moved aside and every relevant env var unset: `preview.sh "explain selection
sort"` and `run.sh "explain bubble sort"` both completed cleanly end to end
(topic → generated+cached algorithm → validated spec → rendered/published
video), zero model calls made to any paid provider.

**Honest gap:** this proves the local pipeline is *reliable*, not that its
narration is as good as `claude-sonnet-5`'s. That bar (valid vs. worth
watching) was flagged as open when this phase started and remains open — the
ladder exists so escalating on quality, not just on failure, is a future
config change, not an architecture change.

### Phase 8 — Multi-video-type architecture

Every phase so far assumed the output is a DSA explainer. The goal now is to
generalize AlgoReel from an algorithm-video generator into a general
data/content → video generator: a planner decides *what kind* of video to
make (`dsa`, `time_series`, ...), deterministic code decides how to
validate, animate, and render it. Full design and phased implementation
order live in a separate note; this section tracks what's actually landed.

**Step 1 (done) — `VideoType`/`VideoPlan`, `Video.tsx` as a router.**
`remotion/Video.tsx` used to *be* the DSA renderer — it read `spec.input`'s
shape directly to pick `ArrayView` vs. `StructureView`. That logic moved,
unchanged, into a new `remotion/AlgorithmVideo.tsx`; `Video.tsx` is now a
plain `switch (plan.videoType)` dispatcher with one case, `dsa`, matching
the target architecture's "the router never contains video-type-specific
logic" rule. New `src/plan/types.ts` defines `VideoType = "dsa"` (only
values with a real implementation — no speculative future types) and
`VideoPlan`/`DsaVideoPlan`, which wraps a `StorySpec` under `{ videoType:
"dsa", payload: <StorySpec> }` rather than replacing it — the existing DSA
pipeline (`buildTimeline`, `checkRender`, every algorithm, every agent
config) still speaks `StorySpec` untouched, exactly as the design note's
"preserve the existing contract" principle calls for.

The one real ripple: every current entry point that hands a prop into the
`Video` Remotion composition (`Root.tsx`'s demo compositions, `renderVideo.ts`,
`frameSampler.ts`) used to pass `{ spec }` — since `Video.tsx`'s prop
contract changed, all three now wrap the `StorySpec` into a `DsaVideoPlan`
first (`src/plan/fromStorySpec.ts`'s `toDsaVideoPlan`) before it reaches the
composition. This is purely internal plumbing — every MCP tool in
`server.ts` (`validate_spec`, `check_render`, `render_preview`, ...) still
takes a bare `{ spec }` exactly as before; no agent config or tool schema
changed. Verified live: full test suite (124/124) and `tsc --noEmit` both
clean, plus two real Remotion renders confirming the actual prop-passing
paths — `remotion render ... BinarySearch` (a demo composition, via
`Root.tsx`) and `remotion render ... Video --props=<plan-shaped JSON>` (the
generic MCP-render composition, exercising the exact shape `renderVideo.ts`/
`frameSampler.ts` now write).

Not yet done: the `time_series` video type itself, its validator/renderer,
the `VIDEO_TYPES` registry (deliberately deferred — a registry with one
member is premature), and the planner agent that would actually produce a
`VideoPlan` instead of every call site wrapping a `StorySpec` by hand.

**Step 2 (done) — the `time_series` video type: spec, validator, renderer,
progressive animation.** New `src/spec/timeSeries/{types,schema,validate}.ts`
define `TimeSeriesSpec` (title, xAxis, yAxis, series, optional animation
mode) as a genuinely separate contract, not a StorySpec variant — no
hook/narration/complexity, since a timelapse isn't a hook-steps-outro story.
`validateTimeSeriesSpec` mirrors `validateSpec`'s shape-then-semantics split
(zod for structure, a second pass for every series matching the x-axis's
length, every value finite, no duplicate series names).

New `remotion/primitives/timeSeriesLayout.ts` is pure geometry — no React,
same discipline as `layout.ts` — computing a fixed-size chart's y-domain
(10%-padded, spanning every series), x/y pixel positions, and how many
x-axis points are "revealed" at a given `[0,1]` progress. `TimeSeriesView.tsx`
draws that as SVG (axis lines/ticks, a highlighted "current" x-tick, one line
+ point-per-index per series, a legend for 2+ series, a value-at-the-end
label for exactly 1 series to sidestep multi-series label collision), using
the dataviz skill's validated dark-mode categorical order (checked live
against this template's actual `COLORS.background`, not assumed) rather than
picked-by-eye hues. `TimeSeriesVideo.tsx` is the Remotion composition:
`useCurrentFrame()` + `interpolate()` → progress, handed to `TimeSeriesView`
— it does nothing else, matching §7's "should not" list.

`Video.tsx` gained a second router case; `Root.tsx` generalized from
`{id, spec}` to `{id, plan}` (needed regardless of video type, since every
composition shares one `Video` component now) and added a `TimeSeriesDemo`
composition off a real India-GDP demo spec
(`specs/time-series/time-series-demo.json` — kept in its own subdirectory
specifically so `beatBudget.test.ts`'s non-recursive `specs/*.json` scan,
which assumes every top-level file is a StorySpec, never picks it up). New
`remotion/videoPlanDuration.ts` computes a `VideoPlan`'s rendered duration by
`videoType` (defers to `buildTimeline` for `dsa`; `time_series` has no
per-beat timeline, just `targetDurationSec` converted straight to frames) —
`Root.tsx`'s `calculateMetadata` calls this instead of assuming `dsa`.

Verified live, not just unit-tested: rendered the real `TimeSeriesDemo`
composition end to end (`npm run render:time-series-demo`, a real 20s mp4),
then pulled individual frames with `remotion still` and looked at them
directly. That caught a real bug static analysis wouldn't have: the
single-series end-value label sat a few pixels from the frame's right edge
on the final frame ("3.9k" at progress=1) — not technically clipped, but
close enough to be a real risk. Fixed by narrowing `CHART.width` (860→760)
to leave deliberate margin for that label, confirmed by re-rendering the
same frame. Also rendered a hand-built two-series plan through the generic
`Video` composition (the exact `{plan: {...}}` shape a future MCP tool would
send) to confirm the legend path and categorical color order.

Still not done: MCP tool wiring for `time_series` (`render_preview` et al.
remain dsa-only — no tool lets an agent request a time-series render yet),
generic JSON/CSV input normalization, deterministic chart QA (an
axes/labels/points-inside-frame check, `checkRender.ts`'s equivalent for
this video type), and the planner agent itself.

**Step 3 (done) — generic data input, deterministic chart QA, and a real
`algoreel render <path>` entry point.** New `src/cli/renderTimeSeries.ts`
takes a bare TimeSeriesSpec (JSON) or a plain CSV and turns it into a real
mp4 next to the input file — the first way to render a time-series video
that isn't hand-editing `Root.tsx`. It runs the exact same
validate-then-check-then-render discipline the MCP tools already enforce
for `dsa` (`validate_spec` -> `check_render` -> `render_preview`): schema +
semantic validation, then a new deterministic geometry check, and only then
a real render — refusing to render (and printing why) if either fails.

New `src/spec/timeSeries/checkRender.ts` (`checkTimeSeriesRender`) is
`checkRender.ts`'s time-series equivalent: pure function of the spec (+ a
duration, since `TimeSeriesSpec` doesn't carry one), using the exact
geometry `TimeSeriesView.tsx` renders with. Catches x-axis labels crowded
past overlap on the fixed chart width, a y-axis or single-series end-value
label too wide for its reserved margin (the general form of the "3.9k near
the edge" bug found in step 2 — that fix patched one specific case;
this makes it a checked invariant for any spec, since a value's magnitude,
not just point count, determines label width), too-short a duration to be
watchable, and more x-axis points than there are frames to reveal them in
one-by-one. Deliberately doesn't check "points inside chart" or "invalid
coordinates" — guaranteed by construction once validation passes (the
y-domain always spans every plotted value), so there's no code path left
that could produce one. `formatValue` (the renderer's value->label text)
and the chart's margin constants moved into the already-pure
`timeSeriesLayout.ts` specifically so the checker and the renderer can't
disagree about label width — the same reason `checkRender.ts` already
shares `layout.ts` with `StructureView`.

New `src/spec/timeSeries/fromCsv.ts` (`parseCsvToTimeSeriesSpec`) is the
raw-data normalizer PLAN.md §16 describes: first column is the x-axis,
every other column a series named by its header. Deliberately minimal (no
quoted-field escaping) — the shape covered is "a spreadsheet export of
numbers," not arbitrary CSV.

`renderVideo.ts` (previously dsa-only, taking a `StorySpec`) generalized to
take a `VideoPlan` directly, so the CLI and `server.ts`'s
`render_preview`/`render_final` share one implementation instead of the CLI
needing its own copy of the shell-out-to-remotion logic; the two MCP call
sites now wrap with `toDsaVideoPlan` explicitly instead of that happening
inside `renderVideo` itself.

**A real, separate bug found and fixed while adding this phase's tests, not
assumed away:** `package.json`'s `test` script relied on shell `**`
globbing (`src/**/*.test.ts`) to find test files recursively. `npm test`
runs scripts via `/bin/sh` (dash on this machine), which does *not* support
recursive globstar — `src/**/*.test.ts` under dash matches only one
intermediate directory level, silently skipping anything nested two levels
deep. `src/spec/timeSeries/` (added in step 2) sits at exactly that depth,
so `validate.test.ts`'s 9 tests had been silently never executed by
`npm test` since step 2 landed — confirmed live: typed the same glob into
an interactive zsh shell and it correctly found all 18 files, then
confirmed `sh -c` finds only 15, missing every `timeSeries/` test file.
Fixed by switching the script to `find src remotion -name '*.test.ts'`,
which is depth-agnostic and portable across shells. Running the corrected
suite immediately surfaced a second real, previously-invisible failure:
`validate.test.ts`'s "rejects a non-finite value" test asserted a custom
error message that a semantic check was supposed to produce, but zod v4's
`z.number()` already rejects `NaN`/`Infinity` at the schema layer in this
zod version (confirmed directly against `z.number().safeParse(Infinity)`)
— making that semantic check dead code, unreachable in every real call
path. Removed the redundant check from `validate.ts` and corrected the
test to assert against the actual (schema-level) rejection.

Verified live end to end, not just unit-tested: rendered the committed GDP
demo through the new CLI (`npm run render:time-series-cli`) to a real mp4;
built a small CSV by hand and rendered it through the CSV path
(`--title`/`--x-label`/`--y-label`/`--y-unit`) to a separate real mp4; and
constructed a deliberately bad spec (30 x-axis points, guaranteed label
overlap) to confirm the CLI refuses to render and prints the exact
`check_render` failure — no mp4 was produced for the bad case.

Still not done: MCP tool wiring for `time_series` (the CLI is a real entry
point, but no `algoreel` MCP tool lets an agent request one) and the
planner agent itself (Phase 4).

**Step 4 (done) — the planner agent: classify, then produce a `VideoPlan`
directly.** New `src/plan/selectVideoType.ts` is the actual planner (§13):
given a request, decides `dsa` or `time_series` and nothing else — it never
generates Remotion code or touches data itself. Mirrors
`ensureSpec.ts`'s `resolveAlgorithm` pattern exactly rather than inventing
a new one: deterministic first, a toolless model call only for what's
genuinely ambiguous. Three deterministic paths, each skipping the model
entirely: `csv` input, or `data` already shaped like a `TimeSeriesSpec`
(has `xAxis`/`series`) is unambiguously `time_series`; a prompt matching a
known algorithm by keyword (`keywordMatchAlgorithm`, exported from
`ensureSpec.ts` so both selectors share one signal instead of two that
could drift) is `dsa` *unless* the same prompt also matches time-series
vocabulary or a year-range pattern (`"1990 to 2025"`), in which case it's
genuinely ambiguous and falls through. Only then does it call a new local
agent, **`select-video-type.yaml`** (`qwen3:8b`, toolless, schema-
constrained JSON output — the exact shape `select-algorithm.yaml` already
uses), with **`select-video-type.anthropic.yaml`** as a paid escalation
rung gated on `ANTHROPIC_API_KEY`, via the same `runLadder` machinery
`ensureSpec.ts` already uses. New `src/plan/planVideo.ts` connects the
classification to an actual `VideoPlan` (§14, §24): `dsa` calls
`ensureSpec({topic: prompt})` and wraps the result; `time_series` requires
`data` or `csv` to already be supplied — a request with neither is a clean
`PlanVideoError`, never a hallucinated dataset, which is exactly §15's
"the planner doesn't fetch external data" boundary made into an enforced
invariant rather than a design note. A CSV path runs through
`parseCsvToTimeSeriesSpec`, then every result — either path — is checked
with `validateTimeSeriesSpec` and `checkTimeSeriesRender` before ever
becoming a plan, so a render is never attempted on data that would fail
either check. New `src/cli/planVideo.ts` (mirrors `makeSpec.ts`'s shape)
is the first entry point that goes straight from a bare request to a
`VideoPlan` without the caller already knowing which video type it wants.

This phase happened to land in an environment with `agentforge` and a
running Ollama (`qwen3:8b` pulled) actually available, so — unlike step 3,
whose CLI could only be exercised on supplied data — this was verified
genuinely live end to end, not just unit-tested against injected deps:

- `explain bubble sort` -> `planVideo` -> a real narration call to local
  Ollama (no algorithm-selection call needed, keyword-matched) -> a
  `DsaVideoPlan` -> `renderVideo` -> a real mp4.
- A hand-built `india-gdp.csv` -> `planVideo` (`time_series`, no model call
  — CSV input decides it deterministically) -> `checkTimeSeriesRender`
  passes -> a `TimeSeriesVideoPlan` -> `renderVideo` -> a real mp4.
- Three genuinely ambiguous prompts (no keyword or vocabulary match on
  either side) sent to the real `select-video-type.yaml` agent: "make a
  video about how frogs sing at night" (arguably not really either type —
  the model picked `time_series`, an honest ceiling on an out-of-scope
  request, same category as this project's other documented "the mechanism
  works, per-request quality isn't guaranteed" findings), "find something
  in an already-alphabetized phone book" (`dsa`, correct — the exact
  phrasing `select-algorithm.yaml` was itself validated against),
  "how has the population of Tokyo changed since 1950" (`time_series`,
  correct).

**A real bug found and fixed via that live testing, not assumed away:**
`select-video-type.yaml`'s first version failed every attempt with
`max turns (1) exceeded` against real `qwen3:8b` — traced to `max_tokens:
128` being too small once qwen3's thinking channel engages: it spends its
whole budget on `<think>` reasoning before ever reaching the final JSON
answer, gets truncated, and AgentForge needs a second turn to let it
finish, exceeding `max_turns: 1`. This is the same failure *class* the
tool-using agents' `think: false` comments already document (`qa.yaml`,
`publish.yaml`, `animate.yaml`), just manifesting as a turn-limit error
here instead of a silent empty completion, since this agent is toolless.
Fixed by setting `think: false` explicitly (a two-way classification has
no real need for chain-of-thought) and bumping `max_tokens` to 512 to
match `select-algorithm.yaml`'s own value as defense-in-depth. Confirmed
live: the exact same failing prompt completed cleanly afterward.

Still not done: MCP tool wiring for `time_series` (the CLI paths — both
`renderTimeSeries.ts` and `planVideo.ts` — are real entry points, but no
`algoreel` MCP tool lets an agent request either), the `VIDEO_TYPES`
registry (Phase 5), and real data acquisition (deliberately out of scope
per §15 — supplied data only).

**Step 5 (done) — the `VIDEO_TYPES` registry, and proving it on the two
types that already exist rather than adding a third.** Before this step,
"which video type" was answered by two independent switches that had to
agree by construction, not by the type system: `Video.tsx`'s render
dispatch and (the now-deleted) `videoPlanDuration.ts`'s duration dispatch.
New `remotion/videoTypes.ts` collapses both into one lookup table
(`VIDEO_TYPES: { [K in VideoType]: VideoTypeDefinition<...> }`, per §11's
original sketch) with a third field neither switch had: `validate`. Adding
a video type now means adding one entry here — nothing in `Video.tsx` or
`Root.tsx` changes, which is the concrete meaning of "prove the mechanism
before adding a third type" (§28): the registry only earns that claim once
`Video.tsx` and `Root.tsx`'s duration calculation are both pure lookups
against it, not switches that happen to produce the same answer as it.
`AlgorithmVideo`/`TimeSeriesVideo` both changed to take the whole plan
(`{plan}`) rather than their payload unpacked by the caller
(`{spec}`/`{spec, targetDurationSec}`), so each slots into the registry's
one shared `render` signature directly — no adapter wrapper components
needed. `validateTimeSeriesPlan` combines `validateTimeSeriesSpec` (shape)
and `checkTimeSeriesRender` (geometry, needs the plan's
`targetDurationSec`) into the one `{valid, errors}` result the registry's
contract expects — the same two checks `renderTimeSeries.ts`'s CLI already
runs in sequence, now also available as a single call for a future
videoType-agnostic caller (a generic MCP tool, say) that doesn't need the
warning/error distinction the CLI's own UX still preserves by calling the
two functions directly itself.

One real, known TypeScript limitation, documented rather than routed
around: `VIDEO_TYPES[plan.videoType]` can't be called back with `plan`
directly — a lookup table of per-variant functions doesn't distribute a
union call the way a switch's own case-narrowing does, so
`definitionFor()` widens the result to `VideoTypeDefinition<VideoPlan>`
with one explicit, commented cast. Safe by construction (`plan` only ever
reaches the definition its own `videoType` selected), and deliberately the
*only* unsafe cast in this file — not a way to skip real type-checking
anywhere else in the multi-video-type code.

Verified live: `remotion/videoTypes.test.ts` (8 new tests) checks the
registry actually reaches the right implementation per video type, not
just that each implementation works alone — `calculateDurationInFrames`
matches `buildTimeline`'s real duration for `dsa` vs. a bare
duration-to-frames conversion for `time_series`, `validateVideoPlan`
fails a `dsa` plan on an unknown algorithm and a `time_series` plan on
both a schema error and a geometry error, `renderComponentFor` returns the
right component by reference. Then re-ran three real Remotion renders
after the `Video.tsx`/`Root.tsx` refactor to confirm the actual rendering
behavior didn't just type-check but still produces real video: a `dsa`
demo composition, the `TimeSeriesDemo` composition, and the generic
`Video` composition with a hand-built plan-shaped props file (the exact
path `renderVideo.ts` uses) — all three unchanged from before the
refactor. 188/188 tests pass, `tsc --noEmit` clean.

### How to add a new video type

The concrete recipe, generalized from what `dsa` and `time_series` each
actually needed — every file below is a template to copy, not prose to
improvise from:

1. **A spec contract.** `src/spec/<type>/types.ts` — a plain TypeScript
   interface, no fields borrowed from `StorySpec` or `TimeSeriesSpec` "just
   in case" (§22's "avoid a universal VisualState" — keep this type's state
   genuinely its own).
2. **A schema + validator.** `src/spec/<type>/schema.ts` (zod, mirrors the
   interface) and `src/spec/<type>/validate.ts` (`validate<Type>Spec`):
   shape first via zod, then a `semanticErrors` pass for whatever zod can't
   express (cross-field agreement, uniqueness). Cheap, no render, no
   Remotion import.
3. **A deterministic render-geometry check**, if the type has any layout
   that could overflow/overlap — `src/spec/<type>/checkRender.ts`
   (`check<Type>Render`), a pure function of the spec (+ duration, if the
   spec doesn't carry one) using the *exact* geometry constants the
   renderer draws with. Not every type needs this on day one — `time_series`
   didn't get one until its own step 3 — but it belongs in `src/spec/<type>/`
   when it exists, not folded into the DSA `checkRender.ts`.
4. **A pure layout module**, if the type renders anything data-driven.
   `remotion/primitives/<type>Layout.ts` — no React/Remotion imports, so
   step 3's checker and the renderer can share the exact same math instead
   of two definitions that could drift.
5. **The view + composition.** `remotion/primitives/<Type>View.tsx` (the
   actual visual, taking spec + whatever varies per frame) and
   `remotion/<Type>Video.tsx` (the Remotion composition — `useCurrentFrame`/
   `useVideoConfig` live here and nowhere else in the type's own code —
   taking `{ plan: <Type>VideoPlan }`, the one shared signature every
   `render` entry in the registry uses).
6. **Extend the type-level union.** Add the new literal to `VideoType` and
   a `<Type>VideoPlan` interface to `src/plan/types.ts` — wrapping the new
   spec under `payload`, same as `DsaVideoPlan`/`TimeSeriesVideoPlan` do.
7. **Register it.** One new entry in `VIDEO_TYPES`
   (`remotion/videoTypes.ts`): `validate`, `calculateDurationInFrames`,
   `render`. This is the only place `Video.tsx` or `Root.tsx` would ever
   need to change for a type that didn't register here — and per this
   step's own registry, they don't.
8. **A demo spec + a real render.** A demo file under
   `specs/<type>/` (its own subdirectory — `beatBudget.test.ts`'s
   non-recursive scan assumes every top-level `specs/*.json` is a
   `StorySpec`) and a `render:<type>-demo` npm script. Prove it the way
   every step in this phase was proven: render it for real and look at the
   actual frames, don't trust the types alone.
9. **Teach the planner**, last. `selectVideoType.ts` needs a new
   deterministic signal (structural, vocabulary, or both) for the new
   type, and `select-video-type.yaml`'s instructions need the new type
   named in its prompt — otherwise every request for it silently falls
   through to whichever of the existing types the model guesses is
   closest.

What deliberately isn't on this list: touching `Video.tsx`, `Root.tsx`, or
any other video type's own files. If any of those need to change to add a
type, the registry hasn't actually generalized — that's the bar step 5 set.

### Phase 9 — Beyond two video types

Prompted by an external review of the repo at the end of Phase 8: the
architecture (determinism boundary, registry, deterministic QA) is sound,
but the project is still "an AI DSA video generator that also does charts"
rather than the more general thing PLAN.md §1 already describes. This
phase is about *using* the extension points Phase 8 built, not building
new ones — every step below either follows §27's existing recipe exactly,
or is a deliberate, scoped exception to the determinism boundary's data
rule, called out as such rather than smuggled in as a side effect of
something else.

**The one rule every step below has to hold to, restated because it's the
part most likely to erode under feature pressure:** an agent may decide
*labels* — which video type, what a chart's title says, which point is
worth calling out, what the narration says about it. An agent never
decides *values* — a data point, a coordinate, a duration in frames, which
frame an event lands on. Event detection (step 3) is the sharpest test of
this: the *finding* ("2008 was a 12% drop, the sharpest in the series")
must come from arithmetic on the real data, the same way `checkRender.ts`'s
geometry checks do; only the *sentence describing it* is ever an agent's
job.

Planned, in priority order:

1. **Make `time_series`'s own QA loop symmetric with `dsa`'s (done).**
   `qa.yaml` gives `dsa` a real check-fix-recheck-render loop;
   `time_series` only had `checkTimeSeriesRender` refusing a bad render
   with a message — nothing retried. Split into two pieces, since not all
   of `checkTimeSeriesRender`'s failures are the same kind of problem:
   - **Deterministic, no agent needed.** The old `x-axis-labels-overlap`/
     `-tight` checks existed because every x-axis point got its own tick
     label; a dataset with many real, valid points was rejected outright
     rather than just drawing fewer labels. `timeSeriesLayout.ts` gained
     `labelStride`/`tickIndicesToLabel`; `TimeSeriesView.tsx` now labels a
     thinned, evenly-spaced subset of ticks (every point still gets its
     tick mark and its place on the line) instead of rejecting the
     dataset. `checkTimeSeriesRender` replaced the old error/warning pair
     with `x-axis-label-too-wide` (a genuinely unfixable single label —
     still a hard error) and `x-axis-labels-thinned` (informational,
     never blocking).
   - **Narrow repair, `planVideo.ts`'s flow only — turned out to need no
     agent at all.** When the only remaining problem is duration-shaped
     (`duration-too-short`, or the `reveal-faster-than-frames` warning),
     `planVideo.ts` now widens `targetDurationSec` to
     `minimumSufficientDurationSec(spec)` (new in `checkRender.ts`, pure
     arithmetic — the smallest duration that clears both duration checks)
     and re-checks once. If a failure isn't duration-shaped, or the
     repair doesn't clear it, it stays a hard `PlanVideoError` — never
     "fixed" by altering the caller's actual data. Writing this out made
     the "agent repair" framing from this phase's own opening obsolete
     for this specific step: computing the minimum sufficient duration is
     a pure function of the spec, so there was never anything for an LLM
     call to add.

   **A real bug found live, not caught by any unit test first:** the
   first version of the label-thinning fix computed "how many labels fit"
   as a standalone count (`floor(chartWidth / labelWidth)`), then
   proportionally remapped that count onto the real indices with
   `Math.round`. Type-checked, unit-tested, all green — and still wrong.
   Rendering a real 25-point dataset and looking at the actual frame
   showed several originally-adjacent years (2006/2007/2008,
   2016/2017/2018, ...) all still labeled and overlapping, because
   proportional rounding on a non-integer step doesn't guarantee even
   *index* gaps, only a correct *average* — it can (and did) keep two
   already-adjacent points both labeled while skipping one three slots
   away. The count-based estimate wasn't a good enough proxy for the real
   constraint. Fixed by working in index space directly: a fixed
   `stride` between shown indices, chosen so `stride` real per-point
   spacings are provably `>=` the widest label's width — which is the
   only thing that actually guarantees no overlap, by construction
   rather than by a proportional approximation. Confirmed by re-rendering
   the exact same dataset and looking at the frame again: clean,
   every-other-year labels, no overlap. This is the second time in this
   project a proportionally-plausible-looking layout estimate turned out
   wrong only once a real frame was actually looked at (the first was the
   "3.9k near the edge" bug in Phase 8 step 2) — reinforcing why every
   step in this project's history renders and looks, rather than trusting
   the math alone.

   *Exit, met:* the demo GDP dataset extended to 25 points (previously a
   hard `x-axis-labels-overlap` rejection) renders cleanly with thinned,
   non-overlapping labels — verified by rendering and inspecting the
   actual frame twice (once catching the bug, once confirming the fix).
   A deliberately tiny `targetDurationSec` (0.1s on a 7-point spec, and
   1s on a 90-point spec) gets corrected to the real minimum and rendered
   successfully both times, confirmed live through `planVideo` +
   `renderVideo` end to end. 201/201 tests pass.

2. **`bar_race` as the third video type**, via §27's recipe exactly:
   `src/spec/barRace/{types,schema,validate,checkRender}.ts`,
   `remotion/primitives/{barRaceLayout.ts,BarRaceView.tsx}`,
   `remotion/BarRaceVideo.tsx`, one new `VIDEO_TYPES` entry, a demo spec
   (e.g. top-5 country GDP by year, reordering as ranks change) and
   `render:bar-race-demo` script, plus a `selectVideoType.ts` signal
   ("ranking", "who's biggest", "moving up and down") and a
   `select-video-type.yaml` prompt update. The real test this type
   provides that `time_series` didn't: entities *change rank* and
   therefore *change vertical position* frame to frame, not just value —
   a genuinely different layout problem (interpolating a bar's position,
   not just its length) than anything the registry has handled yet.
   *Exit:* a real render, inspected frame-by-frame the way every prior
   video type was, showing bars visibly reordering as ranks change.

3. **Deterministic event annotation**, for `time_series` first
   (extends to `bar_race` once it exists). A pure function of the
   already-computed series data — largest single-step `|Δvalue|` or
   `|Δvalue / value|`, same "pure function, no render" discipline as every
   `checkRender.ts` — flags *which* x-axis index is the standout point.
   `TimeSeriesSpec` grows an optional `annotations` field (`{index, label}`)
   that a planner (or a human) can fill in with the *sentence*; if absent,
   the deterministic detector proposes the index and a caller (a future
   narration step) supplies the label. The renderer draws a marker + label
   at that point — never picks the point itself from prose. This is the
   concrete mechanism for the "LLM explains, code detects" split the
   review itself proposed.

4. **Real data acquisition — one source, one indicator family, on
   purpose.** Explicitly *not* "wire up World Bank + FRED + OWID + IMF" —
   that repeats Phase A's own early mistake of generalizing before one
   case is proven. Confirmed live before committing to this at all: this
   environment has real outbound network access, and the World Bank API
   needs no auth or key —
   `https://api.worldbank.org/v2/country/IN/indicator/NY.GDP.MKTP.CD?format=json&date=1990:2025`
   returns `[metadata, [{date, value, country: {value}, indicator: {value}}, ...]]`,
   confirmed against real India GDP figures. Scope: a `src/spec/timeSeries/fromWorldBank.ts`
   (mirrors `fromCsv.ts`'s shape — deterministic TypeScript, no LLM
   involved in the fetch or the parsing) that takes a country code +
   indicator code + year range and returns a `TimeSeriesSpec`, called by
   `planVideo.ts` only when the caller names a country/indicator
   explicitly (an agent may pick *which* indicator/country the request
   implies — a label decision — but the fetch and every number in the
   result is the real HTTP response, unmodified). The source URL and
   retrieval time get stamped into the `VideoPlan`'s `description` field
   as provenance, so a viewer can trace every number back to where it
   came from. *Exit:* `"GDP timelapse for Brazil"` with no CSV/JSON
   attached produces a real render sourced from a live API call, and the
   plan JSON shows exactly which URL supplied the numbers. Other sources
   (FRED, OWID, UN) are explicitly future work, added one at a time, only
   after this one is proven — same discipline as `structure: "graph"`
   codegen only landing after `structure: "array"` was proven.

5. **`timeline` (historical events) as a fourth video type** — lower
   priority than the above since it's mostly validating the registry
   against a non-chart shape (nodes with dates/labels, no numeric axis)
   rather than adding real capability; do this once 2-4 are settled and
   the recipe in §27 could use a second confirmation beyond `bar_race`.

**Explicitly not planned now, and why:**
- **A general "Video IR"** (shared `scenes`/`metadata` structure across
  every video type) — the review's own caveat is the right one: two (soon
  three or four) video types isn't enough evidence for what a real common
  layer would need, the same reason `StructureView` didn't generalize
  until a *third* structure needed the same thing (§9's "Codegen
  generalized..." entry). Revisit after step 5, not before.
- **Narration/voice (TTS)** — a real, cross-cutting gap (every AlgoReel
  video is silent, dsa included — this predates Phase 8 and isn't
  time-series-specific), but blocked on a provider decision (which TTS
  API, whether a key is available) that hasn't been made. Stays an open
  decision (§11), not a committed step, until it has.
- **Expanding the generated-algorithm system further** (more structures,
  more families) — it works and is mature; the review's own advice here
  is correct: the leverage now is in the video engine, not in teaching a
  local model more sorts.
- **Web UI, real YouTube publishing** — real product work, orthogonal to
  the architecture story this phase is about; `youtube-server.ts`'s stub
  and `run.sh`'s pipeline already prove the mechanism up to the point a
  real OAuth project exists.

---

## 10. Algorithm order

Chosen for visual variety, not difficulty. Three that look different from each other validate the primitive set:

1. **Binary search** — array, pointers, elimination
2. **Bubble sort** — array, comparison, swap
3. **BFS** — graph, nodes, edges, queue

**Built (Phase A): the long tail is now mostly codegen, not hand-writing.**
Found live that hand-writing every algorithm doesn't scale — a topic with
no matching entry (e.g. "reversing a linked list") made the agent force
the closest existing algorithm into the slot with misleading narration
(bubble sort's swaps described as pointer changes). The fix moves the
determinism boundary up one level rather than abandoning it: for any
array-shaped algorithm (sorting/searching — linear search, selection
sort, insertion sort, two pointers, sliding window, merge sort, quicksort,
...), a real implementation gets written against a `TracedArray` contract
instead of requiring a hand-written entry first. It's executed for real
in a sandboxed child process (Node's `--permission` flag plus a
`vm.Script` timeout — both confirmed live to actually hold, including
blocking `require()` and `process.env`), checked for result correctness
(against a native reference sort), real comparison instrumentation (a
correct sort that never calls `trace.compare()` is rejected too — a
silent gap Phase A originally left open, found live once a weaker model
made skipping it common), and complexity-class plausibility
(compare-count growth rate at two input sizes, not a single-point
threshold — confirmed live this is what it takes to catch a disguised
O(n²) sort submitted under an O(n log n) name; originally a warning that
still cached the bad file, now fatal — a warning-that-still-caches
defeats a retry loop, since the next attempt just hits the cache and
gets the same bad code back). Only then cached as a real, permanent file
in `algorithms/generated/`, indistinguishable from a hand-written one on
every later request for that name. See §5's `run_algorithm` and
`algoreel-mcp/src/algorithms/sandbox.ts`.

**Built (the algorithm agent): who writes the code moved out of
script.yaml.** Phase A put the writing job inline in `script.yaml`,
which worked but cost it ~40 lines of `TracedArray` contract
documentation with nothing to do with storytelling. `script.yaml` now
just calls `ensure_algorithm(algorithm, structure)` (§5) and gets a name
back; the actual writing happens in a separate, **toolless** specialist
agent, `algoreel-agents/agents/algorithm.yaml`, on a free local model
(Ollama). The retry loop (≤3 attempts, real validator errors fed back
into the prompt each time) lives in TypeScript
(`algoreel-mcp/src/algorithms/ensureAlgorithm.ts`), not inside
`algorithm.yaml`'s own AgentForge turn loop — deliberately: a toolless
agent only ever has to do one "read prompt, emit code" completion per
attempt, which is a far more reliable ask of a small local model than
multi-round tool-call self-correction (this project's own local-model
testing already found that unreliable — script.free.yaml's qwen3 trial:
1 success in 5). It also sidesteps a real hazard: a tooled sub-agent
would spawn a second `algoreel-mcp` server process writing into
`generated/` behind the first one's back, and AgentForge has no locking
anywhere in its tree to make that safe.

Model choice, with honest results: `qwen2.5-coder:14b` (the same local
model this project's `Modelfile` rejected for *unrelated* reasons — it
doesn't reliably wrap tool calls in the tags AgentForge/Ollama's
template requires, which doesn't matter for a toolless agent). Verified
live end to end: selection sort succeeded on attempt 1 through the real
pipeline (agent → sandbox → validators → cache). Insertion sort failed
all 3 attempts with the *same* incorrect index-tracking bug each time —
real evidence that a 14B local model's ceiling is topic-dependent, not a
hypothetical risk. The mechanism (agent, retry loop, feedback,
validators) is proven; per-algorithm code quality from a free local
model is not guaranteed, and isn't currently retried with a stronger
model as a fallback.

**Found live, a second and more fundamental gap: `ensure_algorithm` is
sorting-only, and nothing said so.** Asking for `"linear search"` burned
every one of 3 retry attempts, repeatedly, because `sandbox.ts`'s
correctness check (§5) works by comparing the sandboxed result against
the input array sorted ascending — which has no meaning for a search. A
*correct* linear search implementation fails this check exactly as hard
as a wrong one; the retry loop had no way to ever succeed, no matter how
good the code was. This bug predates the algorithm agent — `script.yaml`'s
instructions have said "sorting or searching" since Phase A, but the
sandbox was never anything but sort-only, and no earlier live test
happened to try a search. Fixed by narrowing `script.yaml`,
`script.free.yaml`, and `ensure_algorithm`'s own tool description to say
"sorting only" plainly, with `binarySearch` named as the one search
that's actually available (from `list_algorithms`, hand-written). Not
fixed mechanically — there's no cheap way to detect "this is a search"
from a name string alone, so this is prose guidance, not an enforced
guard, same category of thing as the honesty instruction two paragraphs
up.

**Found live, a third and much more severe bug: a real caching-corruption
crash, triggered by asking for quicksort.** A user's `./preview.sh
"quick sort algorithm"` hung — Ollama running continuously for 4+ minutes,
60+ back-to-back completions, no visible outer process, until manually
killed. Root cause, confirmed by direct reproduction: `ensure_algorithm`'s
`description` field is agent-supplied, not developer-controlled, and
Claude Sonnet (trying to help the local model with a hard algorithm) had
passed a full multi-line pseudocode spec as the description.
`cacheGeneratedAlgorithm` spliced it straight into a single `// ` line
comment — every line after the first leaked as raw, uncommented top-level
text, producing a file that passed every validator (they only ever check
`req.code`, sandboxed separately, never the cached file's own text) but
was syntactically broken TypeScript on disk. That file then crashed the
very next dynamic `import()` — uncaught, and (before this fix) *after*
`rebuildManifest()` had already added a static import of it, meaning the
corrupted file would have broken the entire server's static import chain
on next startup, not just this one algorithm. Worse: the crash produced a
confusing, unhelpful error (an esbuild transform error, not a validator
message about the actual code) that got fed back into the next retry
attempt, and the broken file's "don't clobber a trusted file" guard meant
no attempt could ever succeed afterward — every subsequent try hit the
same corrupted import, regardless of what new code it generated.

Fixed three ways in `sandbox.ts`: (1) the header comment now gets only a
short excerpt of the description, never the full text — the complete
text is always safely recoverable from the `DESCRIPTION` string export
instead, which handles newlines correctly by construction; (2) the
post-cache dynamic `import()` now happens *before* `rebuildManifest()`,
wrapped in a try/catch that deletes the file on failure — a broken file
is caught and removed before the manifest ever learns it exists, so the
next attempt starts clean instead of being permanently blocked; (3) since
`existing` is already confirmed falsy by the time caching runs, any file
already on disk under that name is by definition untrusted debris from an
interrupted prior attempt, not a trusted cache — the "don't clobber"
guard was removed entirely rather than papered over.

Direct reproduction after the fix: the exact same request (quicksort)
now fails cleanly in ~20s across 3 real attempts, with an accurate
validator error, instead of hanging for 4+ minutes. The remaining
failure is real and separate: this local model repeatedly produces a
fixed-pivot quicksort, genuinely O(n²) on the sandbox's adversarial
(reverse-sorted) scaling check — a classic, well-known naive-quicksort
mistake. `algorithm.yaml`'s instructions were extended with explicit
pivot-strategy guidance; a retest then failed differently (a genuine
off-by-one bug in a randomized-pivot attempt) rather than fully
succeeding. Two clean, fast, correctly-diagnosed failures — not a hang,
not a crash — is accepted as real evidence of a capability ceiling for a
14B local model on this specific algorithm, same category as the
insertion-sort finding, and isn't being iterated on further.

Also added, independent of root-causing this incident: `algorithm.yaml`
now runs on `algoreel-coder` (`algoreel-agents/Modelfile.coder`), a
derived model with `num_ctx` raised past Ollama's 4096 default —
mirroring `algoreel-llama`'s existing Modelfile, for the same category of
reason (retry prompts embed prior code and errors, and a caller-supplied
description can be long, as this incident itself demonstrated). Not
confirmed as the fix for anything specific — observed prompts never
actually exceeded ~1100 tokens even during the incident — but cheap,
safe, and removes a variable before it becomes one.

Graph algorithms beyond `bfs` (Dijkstra, BST insert, stack/queue) were
**not** covered by any of this at the time — Phase A and the algorithm
agent were both array-only. A `TracedGraph` equivalent was a natural
follow-up; later in this section covers what was actually built, and why
graph *traversal* specifically (not graphs in general) is where it
became tractable.

**Linked lists got a real primitive of their own first** — `LinkedListView`
(nodes in a row, directed pointer arrows) plus four new `Operation`
variants and a hand-written `reverseLinkedList` proving them, the same
phasing arrays used before Phase A's codegen generalized them (hand-write
one example first). That primitive was then **generalized once a second
structure (`bfs`'s graph) needed the same kind of thing**: every node/link
structure — a linked list's row, a graph's circle, a tree's levels, a
stack's column — turned out to be one renderer (`StructureView.tsx`)
parameterized by a declared `layout: "row" | "column" | "levels" |
"circle"` (`remotion/primitives/layout.ts`, pure layout functions with no
React/Remotion imports so `checkRender.ts` can call the exact geometry the
renderer will actually use, pre-render). `LinkedListView` and `GraphView`
were deleted once `StructureView` reproduced both exactly. The operation
vocabulary collapsed to six structure-neutral ops (`struct`, `link`,
`nodeState`, `linkState`, `nodePointer`, plus array's existing ones) —
`nodeState`'s "focus" value folds in what was briefly a separate
"nodeFocus" set, after a real correctness bug surfaced during that split
(a stale focus could mask a later "done" on the same node, since nothing
cleared the old focus set on an unrelated state change — the same failure
class `highlight`'s existing stale-focus-clearing already exists to
prevent for arrays). `Video.tsx` and `checkRender.ts` both dispatch off
one shared `inputShape()` helper (`src/spec/inputShape.ts`, now
`"array" | "struct"`) rather than the name-based/shape-based split that
used to exist between them.

Proven with **zero changes to `StructureView.tsx` or `layout.ts`**: a
binary tree in-order traversal (`inorderTraversal`, `"levels"` layout,
left-then-node-then-right, no comparisons) and a stack-based balanced-
parentheses check (`checkBalancedParens`, `"column"` layout — the one
structure whose *node set itself* changes over time, handled by
re-declaring `struct` with the current contents on every push/pop rather
than adding a new operation for it). Adding either cost exactly one
algorithm file, one registry entry, and one demo spec — the generalization
this phase set out to prove.

**`ensure_algorithm` then generalized past array-only, to graph
traversal specifically** — the same "hand-write canonical examples,
generalize once enough exist" phasing, applied one level up: array
codegen's whole safety net is one cheap, universal oracle ("does the
result equal the array sorted ascending?"); no such single check exists
for structures in general, which is exactly why `bfs`/`reverseLinkedList`
/`inorderTraversal`/`checkBalancedParens` all stayed hand-written. But
BFS and DFS are each **fully deterministic** given a fixed neighbor
tie-break (sorted ascending — `bfs.ts` already did this, for exactly this
reason), so a reference implementation computed independently by the
harness (`sandbox.ts`'s `referenceBFSOrder`/`referenceDFSOrder`) is a
valid oracle, the same shape as arrays' sort reference. `TracedGraph`
(`graphTrace.ts`) mirrors `TracedArray` exactly — `neighbors`/`isVisited`/
`visit`/`traverseEdge`, deliberately as minimal — and
`ensure_algorithm({algorithm, structure: "graph"})` hands the writing job
to a new specialist (`algoreel-agents/agents/algorithm-graph.yaml`, same
`algoreel-coder` model), validated by an exact visit-order match against
the reference plus a "must call `traverseEdge()`" check — no
complexity-class validator needed here, unlike arrays, since an exact
order match already implies correct traversal mechanics. Cached to a
separate `generated-graph/` directory (own manifest, same static-import
constraint as `generated/manifest.ts`) so its registration never mixes
with array-generated entries. Verified live: a "dfs" request succeeded
on the **first attempt**, twice independently, and
`./preview.sh "depth-first search"` rendered correctly end to end.

General graphs beyond bfs/dfs traversal (Dijkstra, MST, anything needing
edge weights), general trees beyond in-order traversal (insertion,
deletion, other traversal orders), hash tables, DB/table structures, and
codegen for linked lists/trees/stacks all **remain** fully out of scope —
`ensure_algorithm` mechanically rejects any `structure` other than
`"array"`/`"graph"`, and any graph name outside the bfs/dfs family,
before ever running a sandbox. `script.yaml` is instructed to say so
honestly for whatever's still missing rather than force a mismatched
algorithm into that slot, the same failure mode this phase already fixed
once, one level more subtle (an honestly-coded algorithm can still get a
dishonest narration wrapped around it — also found live and fixed, see
`script.yaml`'s STATUS comment).

Avoid early: quicksort (recursion + partitioning is two hard things), anything DP (tables are a whole separate primitive), anything with a call stack visualisation. (These were "avoid early" for *hand-writing*; codegen makes quicksort specifically no harder than merge sort to add now, since the agent — not a human — writes the partitioning logic.)

---

## 11. Open decisions

- **TTS provider.** ElevenLabs (quality, cost) vs OpenAI TTS (cheap, adequate) vs local Piper (free, robotic). Try Piper first — if it sounds acceptable at Shorts pace, the whole pipeline stays local and free.
- **Channel identity.** The repo is AlgoReel; the YouTube channel doesn't have to be. Faceless channel? Consistent intro sound? Decide before video #1, not video #10.
- **Repo split.** `algoreel-mcp` and `algoreel-agents` could be one repo. Probably should be, until they aren't.
- **A roster of further specialist agents.** The algorithm agent (§10) was the first split-out specialist; Phase 7 added narration/selection (`narrate.yaml`/`select-algorithm.yaml`) as two more, on the same toolless-single-shot pattern. `qa.yaml`/`publish.yaml` stayed tool-calling by design (§9 Phase 7) rather than being split further, since that shape was never what failed.
- **A stronger fallback when the algorithm agent's local model can't do it.** Still open, and now inconsistent with the rest of the pipeline: `ensureSpec.ts`'s selection/narration steps escalate to `claude-sonnet-5` via `src/agents/ladder.ts` when `ANTHROPIC_API_KEY` is set and the local rung exhausts its retries, but `ensureAlgorithm.ts`'s codegen retry loop still has no such escalation — 3 failed attempts is a hard stop regardless of whether a key is present. `ladder.ts` was written generically enough to cover this (it isn't `ensureAlgorithm`-specific), so wiring it in is a small, scoped follow-up, not a redesign.
- **`qa.anthropic.yaml`/`publish.anthropic.yaml` are unwired.** They exist as escalation-capable variants of the local `qa.yaml`/`publish.yaml` (Phase 7) but nothing calls them yet — `run.sh`/`preview.sh` only ever run the local versions. Wiring them behind the same present-key-and-local-exhausted ladder condition `ensureSpec.ts` uses is the natural next step, not yet done.

---

## 12. What "done" looks like

A README with:

- A 20-second GIF: `./run.sh "explain quicksort"` → approval prompt → published video
- A link to the actual YouTube channel with 15+ videos
- `agentforge runs get <id>` output showing the full trace of one video's creation, including a QA failure and the agent's fix
- A short section on the determinism boundary, because that's the design insight worth explaining

And in AgentForge's README: "AlgoReel — an autonomous content pipeline built on AgentForge," with a link.

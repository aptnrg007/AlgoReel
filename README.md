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
log (`init`, `highlight`, `compare`, `swap`, `write`, `discard`, `done`,
...). An agent's job is entirely upstream and downstream of that: pick a
topic, write the hook and narration, choose emphasis words and pacing,
decide whether a render passed QA and what to retry. It never invents a
frame number, a comparison result, or a sorted position. See `PLAN.md`
§1-2 for the full reasoning.

The boundary moved up one level for algorithms outside the hand-written
set (see Phase A below): an agent can now *write* an algorithm
implementation, but it never asserts what that code does — the code
actually runs, sandboxed, on real input, and the operation log is a
mechanical record of what really happened, not something the agent
narrates into existence.

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
- **Phase 4 — both QA layers done.** A spec that passes `validate_spec`
  can still render into something unwatchable — proven live: a
  40-element `bubbleSort` spec with two short narration beats validates
  cleanly, then produces 1601 animation checkpoints of which **1598 get
  zero frames**, because `buildTimeline`'s frame budget divides evenly
  across far more checkpoints than a short beat has frames for. New
  `check_render` MCP tool (`algoreel-mcp/src/spec/checkRender.ts`)
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

  **Vision QA (Layer 2) is built too**, after fixing what was blocking it
  in AgentForge (see that repo's history): MCP image results used to
  reach the model as unreadable base64 text; now a real image content
  type round-trips end to end, verified live. New `sample_frames` MCP
  tool renders 4-6 stills straight from the spec via `@remotion/renderer`'s
  programmatic API (`remotion/sampleFrames.ts` picks the frame numbers,
  pure and unit tested; `src/render/frameSampler.ts` does the actual
  rendering, no temp files) and hands them to `qa.yaml`, which looks at
  them directly and checks exactly two things per PLAN.md §7 — clipped
  text, overlapping elements — never an aesthetic judgement.

  **A real, separate bug turned up building this**: every `sample_frames`
  call corrupted the MCP connection (`invalid character 'D'...` on the
  AgentForge side) until traced to `@remotion/renderer` silently treating
  an unset `logLevel` as more verbose than `"trace"` itself, enabling
  Chromium's `dumpio` and re-emitting the browser's own `DevTools
  listening on ws://...` startup line onto the same stdout an MCP server
  needs exclusively for JSON-RPC. Fixed by passing `logLevel: "error"`
  explicitly. Confirmed the fix live: `qa.yaml` on the committed
  `bubble-sort-demo.json` now runs `check_render` → `validate_spec` →
  `sample_frames` (one clean call) → `render_preview` in 4 tool calls,
  producing a real mp4.

  New **`qa.yaml`** agent drives `check_render` → fix → `check_render` →
  `validate_spec` → `sample_frames` → fix if needed → `render_preview`
  (gated, same principle as `animate.yaml`); verified live end-to-end on
  Phase 4's own exit case: a deliberately broken 40-element/90-second-target
  spec was rewritten down to 6 elements across 6 beats with a matching
  `targetDurationSec: 32`, unaided, and rendered to a real mp4. Also found
  but deliberately **not fixed in that phase**: `Caption.tsx` rendered
  captions at `bottom: 60px`, inside the bottom 280px `SAFE_AREA`
  reserved because YouTube's UI overlays it — every video rendered so
  far had its caption in that covered band. Left alone at the time since
  it's constant across every spec (a template bug, not a per-spec one)
  and deserved its own look against a real render rather than a fix
  bundled into a QA-focused phase. Layer 2 correctly didn't flag it
  either, on an honest technicality worth understanding: nothing in an
  isolated still is actually clipped or overlapping — the problem only
  exists once YouTube's real app UI covers that band, which a bare frame
  can't show a vision model. **Fixed afterward**: anchored to
  `bottom: SAFE_AREA.bottom` instead of a bare `60`, since a
  `position: absolute` element ignores `Frame`'s `paddingBottom`.
  Confirmed visually — rendered a real frame with `sample_frames` and
  looked at it directly, the same tool this phase built.
- **Phase 5 — publish agent, upload stubbed.** No Google Cloud OAuth
  project exists yet (a real one needs manual setup only the repo owner
  can do), so `algoreel-mcp/src/youtube-server.ts`'s `upload` tool
  validates real YouTube constraints — title length, non-empty
  description, at least one tag, that the video file actually exists —
  and returns a clearly-marked fake `videoId`/`url` instead of calling
  any real API. It's a deliberately separate MCP server from the main
  `algoreel` one (matching PLAN.md §5's own `youtube.upload` namespace),
  so swapping in a real upload later touches that one file only. New
  **`render_final`** renders the actual full-resolution video (no
  `--scale=0.5`, unlike `render_preview`) into `out/final/`. New
  **`publish.yaml`** chains `check_render` → fix → `validate_spec` →
  `sample_frames` → `render_final` → `youtube.upload` — everything but
  the upload auto-approved, since this agent (unlike the interactively
  watched `qa.yaml`) is meant to run unattended end to end with exactly
  one decision, matching PLAN.md §9's "approve one prompt" bar. New
  **`run.sh`** at the repo root chains `script.yaml` → `publish.yaml` for
  the full `./run.sh "a topic"` flow, verified live on the approve, deny,
  and non-interactive (`AUTO_APPROVE=1`) paths. Every video is still
  silent — real narration stays PLAN.md §11's other open decision.

  **A real bug in `run.sh` itself, found and fixed while verifying the
  deny path**: a `while read ... < <(process substitution)` loop
  redirects its *entire body's* stdin to that substitution, so the
  interactive `read -p` confirmation prompt *inside* the loop was
  silently reading EOF instead of the user's typed answer — `read`
  returned non-zero, and `set -e` killed the script before it ever
  printed the prompt. Fixed by reading the pending-approval list from a
  separate file descriptor (`3<<<`) instead of stdin, leaving stdin free
  for the actual interactive question.

- **Phase A — generated algorithms, sandboxed and verified.** Found live
  that the 3 hand-written algorithms don't scale: a topic with no match
  (`"reversing a linked list"`) made the agent force `bubbleSort` into
  the slot with misleading narration ("just like flipping a pointer").
  Hand-writing every algorithm forever isn't feasible, but the
  determinism boundary still has to hold — so instead of hand-coding the
  long tail, `script.yaml`'s agent can now write a real TypeScript
  implementation against a `TracedArray` contract
  (`get`/`set`/`compare`/`swap`/`toArray`, each logging a real operation
  as a side effect) for any array-shaped algorithm `list_algorithms`
  doesn't already have. `run_algorithm`'s extended `{name, description,
  code, input}` form runs that code for real in a sandboxed child
  process — Node's `--permission` flag plus a `vm.Script` timeout,
  both confirmed live to actually hold (a real infinite loop is killed
  at 5s; `require()` and `process.env` are both undefined) — then checks
  it two ways before trusting it: result correctness against a native
  reference sort, and a complexity-class sanity check that runs the
  submission twice (at the real size and a synthetic 4x-larger one) and
  compares the *growth rate* of its compare-count against what O(n log n)
  vs O(n²) predict, rather than a single-point threshold (confirmed live
  that a single-point check misses a real bubble sort at n=10 entirely —
  growth-rate comparison catches it). Once validated, the code is cached
  as a real, permanent file in `algorithms/generated/`, indistinguishable
  from a hand-written algorithm on every later request for that name — no
  re-sandboxing, no LLM involved at all after the first successful run.

  The registry that made this possible (`algorithms/index.ts`) is now a
  dynamic map seeded from a statically-imported manifest rather than an
  exhaustive switch closed over 3 names — required because
  `algorithms/index.ts` is transitively bundled by Remotion's webpack
  render path, which can't resolve `node:fs`/`node:path` or a
  runtime-computed dynamic `import()` (found live via a real
  `UnhandledSchemeError`, fixed by generating a plain-static-import
  manifest file instead of scanning the directory at render time).

  Verified live end to end: `./preview.sh "merge sort"` produces a real
  generated, validated `mergesort.ts` and a real rendered mp4. Re-testing
  the original bug (`./preview.sh "reversing a linked list"`) at the time
  produced an honestly-named fallback — "reversing an array with the
  two-pointer technique" — rather than a mismatched algorithm dressed up
  as the original request; `script.yaml` explicitly required this
  honesty (topic and narration must describe what was actually
  implemented) after a first fix caught the *code* but not the
  narration still claiming to be "how linked list reversal works." A
  later phase closed this properly with a real `reverseLinkedList` — see
  below.

  **Deliberately out of scope for this phase** (see `PLAN.md` §10): graph
  algorithms (no `TracedGraph` yet), linked lists/trees (need a new
  visual primitive, not just new operations), and generalizing beyond
  DSA entirely — all raised in discussion, all premature before this
  narrower array-algorithm mechanism had real evidence behind it.

- **The algorithm agent — code-writing moved out of `script.yaml`.**
  Phase A worked, but it made `script.yaml` write algorithm code inline,
  which meant ~40 lines of `TracedArray` contract documentation living
  in an agent whose actual job is storytelling. `script.yaml` now just
  calls a new tool, **`ensure_algorithm(algorithm, structure)`** — a
  registry hit returns instantly; a miss hands the writing job to a
  brand new, **toolless** specialist agent,
  `algoreel-agents/agents/algorithm.yaml`, on a free local model
  (`qwen2.5-coder:14b` via Ollama — zero API key, zero marginal cost per
  retry). The retry loop (up to 3 attempts, `sandbox.ts`'s real
  validator error fed back into the prompt each time) lives in
  TypeScript (`algoreel-mcp/src/algorithms/ensureAlgorithm.ts`), not
  inside `algorithm.yaml`'s own AgentForge turn loop — on purpose: a
  toolless agent only ever does one "read prompt, emit code" completion
  per attempt, which is a far more reliable ask of a small local model
  than multi-round tool-call self-correction (this project's own
  earlier testing already found that unreliable for `script.free.yaml`'s
  qwen3: 1 success in 5 trials). It also avoids a second `algoreel-mcp`
  server process quietly writing into `generated/` behind the first
  one's back — AgentForge has no locking anywhere in its codebase to
  make that safe.

  Two real sandbox gaps surfaced while building this, both fixed:
  a complexity-mismatch **warning still cached the bad file**, which
  would have broken the retry loop outright (attempt 2 would just hit
  the cache and get the same bad code back) — now a hard rejection. And
  **nothing checked for zero `trace.compare()` calls** — a sort that
  skips instrumentation passed clean and would render with no comparison
  highlights; now a validator catches it before caching.

  Verified live end to end: selection sort succeeded on the *first*
  attempt through the real pipeline (agent → sandbox → validators →
  cache). Insertion sort failed all 3 attempts with the same incorrect
  index-tracking bug every time — real, reported evidence that a 14B
  local model's reliability is genuinely topic-dependent, not just a
  theoretical risk of going local. The mechanism is proven; per-topic
  code quality from a free model isn't guaranteed, and there's currently
  no escalation to a paid model when it fails. See `PLAN.md` §10 and
  §11.

- **A generic structure engine — one renderer for every node/link shape,
  not one per structure.** Linked lists first got their own primitive
  (`LinkedListView`, closing the original bug: `ArrayView`'s blocks and
  `GraphView`'s undirected edges couldn't honestly represent a reversal's
  *directed, mutable* pointers). Then the pattern generalized: a linked
  list's row, a graph's circle, a tree's levels, a stack's column are all
  the same thing — nodes placed by a declared layout, connected by links
  or not. One component now handles all of them, **`StructureView.tsx`**,
  driven by pure layout functions (`remotion/primitives/layout.ts`:
  `row`/`column`/`levels`/`circle`, no force-directed layouts — those
  can't be checked before a render) that `checkRender.ts` calls with the
  exact same geometry the renderer will actually use. `LinkedListView` and
  `GraphView` were deleted once `StructureView` reproduced both exactly.
  The operation vocabulary collapsed to six structure-neutral types
  (`struct`, `link`, `nodeState`, `linkState`, `nodePointer`, plus
  array's own) — down from the linked-list-specific and graph-specific
  sets that came before. `Video.tsx` and `checkRender.ts` both dispatch
  off one shared `inputShape()` helper (`"array" | "struct"`) instead of
  the name-based/shape-based split that used to exist between them.

  Proven with a real exit criterion, not just an inline claim: a binary
  tree in-order traversal (`inorderTraversal`, `"levels"` layout) and a
  stack-based balanced-parentheses check (`checkBalancedParens`,
  `"column"` layout) were both added with **zero changes** to
  `StructureView.tsx` or `layout.ts` — each cost exactly one algorithm
  file, one registry entry, one demo spec, the same shape adding
  `reverseLinkedList` itself took. General trees beyond in-order
  traversal, hash tables, and DB tables remain out of scope.
  `./preview.sh "reversing a linked list"` (or a tree/stack topic) now
  produces the real thing, rendered as connected nodes with pointers
  actually moving, not a fallback array algorithm.

  **A second, more fundamental gap, also found live:** asking for
  `"linear search"` burned all 3 retry attempts every single time,
  because `sandbox.ts`'s correctness check compares the result against
  the array sorted ascending — which no search can ever produce, correct
  or not. `ensure_algorithm` was never anything but sorting-only; the
  instructions just hadn't said so plainly, a gap dating back to Phase A
  that no earlier live test happened to expose. Fixed in the prose
  (`script.yaml`, `script.free.yaml`, `ensure_algorithm`'s own
  description) — there's no cheap way to mechanically detect "this is a
  search" from a name alone, so `binarySearch` (hand-written, from
  `list_algorithms`) stays the only search available.

  **A third, much more severe bug, also found live:** a real user's
  `./preview.sh "quick sort algorithm"` hung — Ollama running
  continuously for 4+ minutes with no visible outer process, until
  manually killed. Root cause: `ensure_algorithm`'s `description` is
  agent-supplied (Claude Sonnet had passed a full multi-line pseudocode
  spec, trying to help the local model with quicksort specifically), and
  the caching code spliced it into a single-line comment — every line
  after the first leaked as raw, uncommented top-level text, producing a
  file that passed every validator (they only check the sandboxed code,
  never the cached file's own text) but was syntactically broken
  TypeScript. That file then crashed the next dynamic import, fed back a
  confusing non-answer as "feedback," and — because a "don't clobber a
  trusted file" guard treated it as already trusted — permanently blocked
  every further attempt at that name. Fixed three ways in `sandbox.ts`:
  the header comment now takes only a short excerpt (the full text is
  always safe in the `DESCRIPTION` string export); the post-cache import
  happens *before* the manifest gets updated, with a try/catch that
  deletes a broken file so the next attempt starts clean instead of
  corrupting the server's static import chain; and the "don't clobber"
  guard was removed entirely, since by the time caching runs, any file
  already on disk under that name is provably untrusted debris, not a
  trusted cache.

  Reproduced after the fix: the same request now fails cleanly in ~20s
  across 3 real attempts with an accurate error, instead of hanging.
  Quicksort's remaining failure is real and separate — this model keeps
  writing a fixed-pivot implementation, genuinely O(n²) on the sandbox's
  adversarial scaling check, a classic naive-quicksort mistake.
  `algorithm.yaml` gained explicit pivot-strategy guidance; a retest then
  hit a different bug (an off-by-one in a randomized-pivot attempt)
  rather than succeeding. Two clean, fast, correctly-diagnosed failures —
  not a hang — is accepted as a real capability ceiling for this local
  model on this specific algorithm, same category as insertion sort, and
  isn't being iterated on further. Also added regardless: `algorithm.yaml`
  now runs on `algoreel-coder` (`algoreel-agents/Modelfile.coder`), the
  same context-headroom treatment `algoreel-llama` already gets, though
  it wasn't confirmed as the actual fix for this incident.

- **Codegen generalized past array-only, to graph traversal.** Rendering
  already generalized (above); the remaining manual work was always the
  algorithm *logic* itself — every structure algorithm so far was
  hand-written, one file at a time. `ensure_algorithm` already solved
  exactly this for arrays; extending it to a structure needed a real
  correctness oracle as cheap as "is it sorted," which doesn't exist for
  structures in general — but BFS and DFS are each fully deterministic
  given a fixed sorted-neighbor tie-break (`bfs.ts` already does this),
  so a reference implementation computed independently by the harness
  (`sandbox.ts`'s `referenceBFSOrder`/`referenceDFSOrder`) is a valid
  oracle, same shape as arrays' sort reference, just for this family.
  New: `graphTrace.ts`'s `TracedGraph` (mirrors `trace.ts`'s
  `TracedArray` exactly: `neighbors`/`isVisited`/`visit`/`traverseEdge`),
  a new specialist agent (`algoreel-agents/agents/algorithm-graph.yaml`,
  same `algoreel-coder` model and toolless single-shot pattern), and
  `ensure_algorithm({structure: "graph"})` validated by an exact
  visit-order match plus a "must call `traverseEdge()`" check — no
  complexity-class validator needed here, unlike arrays, since an exact
  order match already implies correct mechanics. Results cache to a
  separate `generated-graph/` directory (own manifest, same
  static-import constraint as the array one) so the two shapes'
  registrations never mix. Scoped deliberately to bfs/dfs by name —
  Dijkstra, MST, and anything needing edge weights have no such cheap
  oracle and aren't covered, mechanically enforced before any sandbox
  run. Verified live: a "dfs" request succeeded on the **first attempt**,
  twice independently, and `./preview.sh "depth-first search"` picked
  the generated `dfs` and rendered correctly end to end.

- **Phase 7 — local models by default, no API key required.** Every stage
  of the pipeline used to need `ANTHROPIC_API_KEY`: `script.yaml` for
  authoring, `qa.yaml`/`publish.yaml` for QA and publish. Phase 3's own
  finding was that a local model's real ceiling is *multi-turn
  tool-calling*, not code or tool discipline generally — the algorithm
  agent (Phase A) already proved a toolless, single-shot,
  TypeScript-orchestrated retry loop works reliably where a tool-calling
  loop didn't. This phase generalizes that pattern instead of chasing a
  bigger local model.

  New `algoreel-mcp/src/spec/ensureSpec.ts` replaces `script.yaml`
  entirely: topic selection (`select-algorithm.yaml` — mostly a
  deterministic keyword match against the live registry, falling back to
  a toolless constrained-decoding call only for genuinely indirect
  topics) and narration authoring (`narrate.yaml` — toolless, single-shot,
  given an exact beat budget computed up front by the new
  `src/spec/beatBudget.ts` rather than repaired after the fact) both run
  on local Ollama models by default. Every invariant a local model
  reliably breaks — `op:N` beat numbering, emphasis words that aren't
  literal substrings, array width, target duration — is enforced
  mechanically in TypeScript instead of asked for in a prompt. A new
  model ladder (`src/agents/ladder.ts`) escalates to `claude-sonnet-5`
  only if `ANTHROPIC_API_KEY` is actually set *and* the local rung
  exhausts its retries — never the reverse, never silently.

  `qa.yaml`/`publish.yaml` deliberately kept their tool-calling shape:
  running `check_render`, fixing what it flags, and rendering is the same
  mechanical, structured-error-driven loop the algorithm agent's retry
  loop already showed local models handle fine. Their old Anthropic-only
  versions moved to `qa.anthropic.yaml`/`publish.anthropic.yaml` as
  escalation rungs (not yet wired into `run.sh`/`preview.sh` — future
  work).

  **A second, real reliability bug found and fixed, not assumed away:**
  even with the tool-calling shape unchanged, `qa.yaml`/`publish.yaml`
  against `qwen3:8b` measured roughly a 50% rate of returning a
  completely empty completion on a fresh run — no tool call, no text.
  Root-caused with a raw `/api/chat` capture: Ollama's `done_reason` was a
  clean `"stop"` and token usage was far under the budget, so it was never
  a truncation. `qwen3:8b` was narrating its entire plan into Ollama's
  separate `thinking` channel and then simply stopping without ever
  emitting the tool call it had just described — raising `max_tokens`
  cannot fix a model that isn't running out of budget. Fixed at the
  AgentForge level: a new `model.think: false` config field
  (`internal/config/schema.go`) sends Ollama's top-level `think` request
  field, turning the channel off entirely. Measured before/after against
  the same agent and prompt: roughly 1 failure in 2 runs with thinking
  on, **0 failures in 18 consecutive runs** with `think: false`.

  Also done: AgentForge gained a real `model.num_ctx` field (same
  pattern), retiring the two derived Ollama Modelfiles this repo used to
  need purely to raise the context window; a deterministic
  `caption-overlaps-structure` check (`remotion/primitives/textBox.ts`)
  closed the one real gap in `check_render`'s coverage; and
  `script.yaml`/`script.free.yaml` were marked deprecated in place rather
  than deleted, since nothing still runs them.

  Verified live with `.env` moved aside and every relevant key unset:
  `./preview.sh "explain selection sort"` and
  `./run.sh "explain bubble sort"` both completed cleanly end to end —
  topic → generated+cached algorithm → validated spec → rendered/
  published video — with zero calls to any paid provider. **Honest gap:**
  this proves the local pipeline is *reliable*, not that its narration
  matches `claude-sonnet-5`'s quality — that bar stays open, and the
  ladder exists so escalating on quality (not just on failure) is a
  future config change, not an architecture change.

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
running locally (plain `qwen3:8b`, no derived model needed — `num_ctx`
and `think` are set directly in `animate.yaml`'s `model:` block; see its
comments to switch to Anthropic instead):

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
./agentforge chat /path/to/AlgoReel/algoreel-agents/agents/animate.yaml
```

**As of Phase 7, none of this needs an API key by default.** Turning a
bare topic into a validated StorySpec is a TypeScript call
(`src/spec/ensureSpec.ts`, via the `makeSpec.ts` CLI), not an agent
you invoke directly — it drives local, toolless model calls itself
(`select-algorithm.yaml`, `narrate.yaml`) and only escalates to
Anthropic's `claude-sonnet-5` if `ANTHROPIC_API_KEY` is set in the
environment and the local rung exhausts its retries:

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
npx tsx algoreel-mcp/src/cli/makeSpec.ts "explain breadth-first search" > spec.json
```

Check a StorySpec for layout/pacing problems and render it once it's
clean — **`qa.yaml`** takes a StorySpec directly (a bare JSON blob alone
confuses the local model into an empty completion — prefix a one-line
instruction, same as `preview.sh` does below) and, on local `qwen3:8b` by
default, fixes anything `check_render` flags, then renders.
`render_preview` needs a separate approval, same principle as
`animate.yaml`. Use **`qa.anthropic.yaml`** instead for an added
`sample_frames` vision pass over real pixels (costs an Anthropic API call
per QA round — see that file's STATUS comment):

```
export ALGOREEL_MCP_DIR=/path/to/AlgoReel/algoreel-mcp
{ echo "Here is the StorySpec JSON to check and render:"; echo; cat spec.json; } > msg.txt
./agentforge run /path/to/AlgoReel/algoreel-agents/agents/qa.yaml \
  -m "@msg.txt" --output-format json
# then, once it reports state: awaiting_approval:
./agentforge runs approve <run-id> <call-id>
```

Just want to see a topic turn into a video, no YouTube step anywhere in
the flow — **`preview.sh`** chains `makeSpec.ts` into `qa.yaml`, pausing
for exactly one approval (`render_preview`). It never even starts
`youtube-server.ts`, and needs no API key by default:

```
export AGENTFORGE_BIN=/path/to/AgentForge/agentforge   # if not on PATH
./preview.sh "explain linked lists"
# prints the pending render_preview call, then: Approve this? [y/N]
```

Go all the way from a bare topic to a "published" video in one command —
**`run.sh`** chains `makeSpec.ts` into `publish.yaml`, pausing for
exactly one approval (the upload). `agentforge` needs to be findable —
either on `PATH`, or point `AGENTFORGE_BIN` at the binary. No API key
needed by default. The upload itself is currently a stub (no YouTube
OAuth credentials configured — see the Phase 5 status above), so this
produces a real rendered mp4 and a clearly-fake `videoId`/`url`, not an
actual live video yet:

```
export AGENTFORGE_BIN=/path/to/AgentForge/agentforge   # if not on PATH
./run.sh "explain breadth-first search"
# prints the pending youtube.upload call, then: Approve this? [y/N]
```

Both scripts accept `AUTO_APPROVE=1` to skip the interactive prompt, for
an unattended run. Both also source a `.env` at the repo root if one
exists — set `ANTHROPIC_API_KEY` there to enable escalation on a topic
the local path can't handle; leave it unset (or don't create `.env` at
all) to stay fully local.

## Algorithms

Six hand-written algorithms: `binarySearch`, `bubbleSort` (array-shaped),
and `bfs`, `reverseLinkedList`, `inorderTraversal`, `checkBalancedParens`
(node/link-shaped). The array algorithms render via `ArrayView`; every
node/link algorithm — regardless of whether it's a list, a graph, a tree,
or a stack — renders via one shared `StructureView`, driven by a `layout`
(`"row" | "column" | "levels" | "circle"`) the algorithm declares in its
first operation. Adding `bfs`'s graph and `reverseLinkedList`'s list each
started as their own hand-rolled vocabulary and view; once a *third*
structure needed the same kind of thing, they generalized into one:
`struct` (declares nodes + a layout, the node/link analog of `init`),
`link` (one directed link, addressed by `(from, slot)` so a tree can have
both `left` and `right`), `nodeState` (a node's visual state, including
"focus" — the step boundary), `linkState` (an edge/link's active/used
status), `nodePointer` (a named pointer, e.g. `head`/`prev`/`curr`).
Six operation types now cover every structure, replacing what used to be
two separate, structure-specific sets.

Rendering picks `ArrayView` or `StructureView` based on the spec's input
*shape* (`src/spec/inputShape.ts`: `"array" | "struct"`, also used by
`checkRender.ts`'s layout checks, so the two can't disagree about what
kind of structure a spec is). `StructureView`'s geometry comes from pure
layout functions (`remotion/primitives/layout.ts`) with no React/Remotion
imports, specifically so `checkRender.ts` can call the exact same code
the renderer will use to catch overlap/overflow *before* the render —
deliberately no force-directed layout, since that can't be predicted
ahead of time. `row`/`column` place nodes by index; `circle` (a graph)
places them evenly around a fixed radius; `levels` (a tree) derives depth
by walking `left`/`right` links from the root and x-position from an
in-order walk, so a left child always renders left of its parent.

This was proven, not just claimed: `inorderTraversal` (a `"levels"` tree)
and `checkBalancedParens` (a `"column"` stack, the one structure whose
node set itself changes over time — handled by re-declaring `struct` with
the current contents on every push/pop, not a new operation) were both
added with **zero changes** to `StructureView.tsx` or `layout.ts`. Each
cost exactly one algorithm file, one registry entry, one demo spec.

General trees beyond in-order traversal (insertion, deletion, other
traversal orders), hash tables, and DB/table structures remain out of
scope.

Beyond those six, `ensure_algorithm` covers two more, generalized
families without touching this repo by hand:

- `structure: "array"` — any sorting algorithm (searching isn't
  covered; `binarySearch` is the only search available).
- `structure: "graph"` — BFS or DFS by name, unweighted (Dijkstra, MST,
  and anything needing edge weights aren't covered).

Both hand a local model the job of writing the implementation, validated
against a real oracle before being trusted: arrays check the result
against `Array.prototype.sort()`; graphs check the exact visit order
against a real reference BFS/DFS traversal (both are fully deterministic
given a fixed sorted-neighbor tie-break, the same reason `bfs.ts` already
sorts its adjacency lists) — no single universal check like "is it
sorted" exists for structures in general, which is why this stops at
graph *traversal* rather than covering every structure. `graphTrace.ts`'s
`TracedGraph` (`neighbors`/`isVisited`/`visit`/`traverseEdge`) mirrors
`trace.ts`'s `TracedArray` exactly, and a new specialist agent
(`algoreel-agents/agents/algorithm-graph.yaml`) writes against it, same
retry-with-real-feedback loop as the array path. Verified live: a "dfs"
request succeeded on the first attempt, and
`./preview.sh "depth-first search"` rendered correctly end to end.
Cached results live in `algorithms/generated/` (array) and
`algorithms/generated-graph/` (graph) — kept separate so registering one
shape's cache never has to reason about the other; `list_algorithms`'
`generated: true` field tells the agent (and you) which entries came from
either path versus were hand-written. Linked lists, trees, and stacks
still aren't codegen-covered — those stay hand-written.

- **Phase 8, step 1 — `Video.tsx` is a videoType router.** Everything above
  is DSA-only; the goal now is generalizing AlgoReel into a general
  data/content → video generator (a planner picks the video type, code
  handles validation/animation/rendering for it — see `PLAN.md` §9 Phase 8).
  First step: `remotion/Video.tsx`'s DSA-specific rendering (pick
  `ArrayView` vs. `StructureView` off the spec's input shape) moved
  unchanged into new `remotion/AlgorithmVideo.tsx`; `Video.tsx` is now a
  one-case `switch (plan.videoType)` dispatcher. New `src/plan/types.ts`
  adds `VideoType`/`VideoPlan`, wrapping the existing `StorySpec` under
  `{ videoType: "dsa", payload }` rather than replacing it — every
  algorithm, MCP tool, and agent config still speaks `StorySpec` exactly as
  before; only the three call sites that hand props to the `Video` Remotion
  composition (`Root.tsx`, `renderVideo.ts`, `frameSampler.ts`) changed, to
  wrap the spec into a plan first. Verified live: 124/124 tests and
  `tsc --noEmit` clean, plus two real renders exercising both paths — a
  demo composition (`BinarySearch`) and the generic MCP-render composition
  with a hand-built plan-shaped props file, matching what `render_preview`
  now actually writes. `time_series` (the second video type), the
  `VIDEO_TYPES` registry, and the planner agent itself are still open.

- **Phase 8, step 2 — the `time_series` video type.** New
  `src/spec/timeSeries/{types,schema,validate}.ts` define `TimeSeriesSpec`
  (title, x/y axis, one or more named series) as its own contract — no
  hook/narration, since a timelapse isn't a hook-steps-outro story — with a
  validator mirroring `validateSpec`'s shape-then-semantics split (every
  series matches the x-axis length, every value finite, no duplicate
  names). New `remotion/primitives/timeSeriesLayout.ts` (pure geometry, no
  React) computes the chart's y-domain, point positions, and how many
  x-axis points are "revealed" at a given progress; `TimeSeriesView.tsx`
  draws that as SVG, using the dataviz skill's validated dark-mode
  categorical palette (checked live against this template's real
  background color) for multi-series color, with a legend for 2+ series and
  a highlighted "current" x-axis tick. `TimeSeriesVideo.tsx` is the
  Remotion composition — `useCurrentFrame()` + `interpolate()` → progress,
  nothing else. `Video.tsx` gained a second router case; `Root.tsx` added a
  `TimeSeriesDemo` composition off a real India-GDP demo spec
  (`specs/time-series/`, its own subdirectory so the existing
  `beatBudget.test.ts` spec-directory scan — which assumes every top-level
  file is a StorySpec — never trips over it).

  Verified live: rendered the real composition to an actual mp4
  (`npm run render:time-series-demo`), then pulled individual frames with
  `remotion still` and looked at them directly rather than trusting the
  code — which caught a real bug: the single-series end-value label sat a
  few pixels from the frame's right edge on the final frame, close enough
  to be a real risk though not yet clipped. Fixed by narrowing the chart's
  width to leave deliberate margin, confirmed by re-rendering the same
  frame. Also rendered a hand-built two-series plan through the generic
  `Video` composition to confirm the legend and categorical-color path.
  Still open: MCP tool wiring for `time_series` (no tool can request one
  yet), CSV/generic input normalization, deterministic chart QA (the
  `checkRender.ts` equivalent for this video type), and the planner agent.

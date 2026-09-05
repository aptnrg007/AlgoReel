# AlgoReel — Status

Phase-by-phase build history: what's done, what was verified live, and every
real bug found along the way. Moved out of `README.md` to keep that file a
quick reference rather than a running log — see `PLAN.md` for the design
rationale and phased roadmap this history follows.

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
  `StructureView.tsx` or `layout.ts`. Each cost exactly one algorithm
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

- **Phase 8, step 3 — generic data input, deterministic chart QA, and a
  real CLI entry point.** New `src/cli/renderTimeSeries.ts` takes a bare
  TimeSeriesSpec JSON or a plain CSV and renders it to a real mp4 next to
  the input — the first way to render a time-series video without
  hand-editing `Root.tsx`. It runs the same validate-then-check-then-render
  discipline the MCP tools already enforce for `dsa`, refusing to render
  (and printing why) if either step fails. New
  `src/spec/timeSeries/checkRender.ts` is `checkRender.ts`'s time-series
  equivalent — pure geometry checks (x-axis labels crowded past overlap,
  a y-axis or end-value label too wide for its margin — the general form
  of step 2's "3.9k near the edge" bug, now a checked invariant instead of
  a one-off fix, since label width depends on a value's magnitude, not
  just point count — too-short a duration, more points than frames to
  reveal them in). New `src/spec/timeSeries/fromCsv.ts` normalizes a plain
  CSV (first column x-axis, every other column a named series) into a
  `TimeSeriesSpec`. `renderVideo.ts` generalized from `StorySpec`-only to
  take a `VideoPlan` directly, so the CLI and the existing MCP render tools
  share one implementation.

  **A real, separate bug found while adding this phase's tests:**
  `package.json`'s test script relied on shell `**` globbing to find test
  files recursively, but `npm test` runs via `/bin/sh` (dash on this
  machine), which doesn't support recursive globstar — it silently missed
  anything nested two directory levels deep, which meant `validate.test.ts`
  (added in step 2, at exactly that depth) had **never actually run** under
  `npm test` since it was added. Confirmed live (an interactive zsh shell
  found all 18 test files with the same glob; `sh -c` found only 15) and
  fixed by switching to `find src remotion -name '*.test.ts'`. Running the
  now-complete suite immediately surfaced a second real bug hiding behind
  the first: a test asserted a custom error message from a semantic check
  that can never actually run, because zod v4's `z.number()` already
  rejects `NaN`/`Infinity` at the schema layer (confirmed directly against
  zod) — the check was dead code. Removed it and fixed the test.

  Verified live: rendered the committed GDP demo through the new CLI to a
  real mp4, built a CSV by hand and rendered it through the CSV path to a
  separate mp4, and confirmed a deliberately bad spec (guaranteed label
  overlap) is refused with no mp4 produced. Still open: MCP tool wiring for
  `time_series` and the planner agent (Phase 4).

- **Phase 8, step 4 — the planner agent.** New `src/plan/selectVideoType.ts`
  decides `dsa` vs `time_series` for a request, mirroring `ensureSpec.ts`'s
  own algorithm-selection pattern: deterministic first (CSV/data already
  shaped like a `TimeSeriesSpec` is unambiguously `time_series`; a prompt
  matching a known algorithm by keyword is `dsa` unless it also matches
  time-series vocabulary or a year range, in which case it's ambiguous),
  falling back to a new local agent, `select-video-type.yaml`
  (`qwen3:8b`, toolless, schema-constrained output), with a paid escalation
  rung gated on `ANTHROPIC_API_KEY` — the same `runLadder` machinery
  `ensureSpec.ts` already uses. New `src/plan/planVideo.ts` connects that
  classification to an actual `VideoPlan`: `dsa` calls `ensureSpec`
  directly; `time_series` requires the caller to already supply `data` or
  `csv` — a request with neither is a clean error, never a hallucinated
  dataset, making "the planner doesn't fetch external data" an enforced
  invariant. New `src/cli/planVideo.ts` is the first entry point that goes
  from a bare request straight to a `VideoPlan`.

  This phase happened to land where `agentforge` and a running Ollama
  (`qwen3:8b`) were actually available, so it was verified genuinely live,
  not just against injected test deps: `"explain bubble sort"` through a
  real narration call to a real `DsaVideoPlan` to a real rendered mp4; a
  hand-built GDP CSV through the deterministic `time_series` path to
  another real mp4; and three genuinely ambiguous prompts sent to the real
  agent, two classified correctly (`"find something in an
  already-alphabetized phone book"` → `dsa`; `"how has the population of
  Tokyo changed since 1950"` → `time_series`) and one on a request outside
  either category's real scope, which the model still had to pick between.

  **A real bug found and fixed via that live testing:** the agent first
  failed every attempt with `max turns (1) exceeded` against real
  `qwen3:8b` — `max_tokens: 128` was too small once qwen3's thinking
  channel engaged, burning the whole budget on `<think>` reasoning before
  ever reaching the JSON answer, then needing a second turn to finish and
  exceeding the 1-turn limit. Same failure class this repo's tool-using
  agents already document under `think: false`, just surfacing as a
  turn-limit error instead of a silent empty completion since this agent
  is toolless. Fixed by setting `think: false` and matching
  `select-algorithm.yaml`'s `max_tokens: 512`; confirmed live afterward.
  Still open: MCP tool wiring for `time_series` and the `VIDEO_TYPES`
  registry (Phase 5).

- **Phase 8, step 5 — the `VIDEO_TYPES` registry, proven on the two types
  that already exist.** Before this step, "which video type" was answered
  by two independent switches (`Video.tsx`'s render dispatch, and a
  duration-dispatch file) that had to agree by construction, not by the
  type system. New `remotion/videoTypes.ts` collapses both into one lookup
  table with a third field neither switch had — `validate`. Adding a video
  type now means adding one entry here; `Video.tsx` and `Root.tsx` are
  both pure lookups against it. `AlgorithmVideo`/`TimeSeriesVideo` both
  changed to take the whole plan (`{plan}`) instead of an unpacked payload,
  so each slots into the registry's one shared `render` signature with no
  adapter needed. Verified live: 8 new tests confirm the registry reaches
  the right implementation per type (not just that each implementation
  works alone), then three real Remotion renders (a `dsa` demo, the
  `time_series` demo, and the generic `Video` composition) confirmed the
  actual rendering behavior survived the refactor unchanged. `PLAN.md` §9
  Phase 8 step 5 has the full "how to add a new video type" recipe,
  generalized from what `dsa`/`time_series` each actually needed.
  188/188 tests pass. Still open: MCP tool wiring for `time_series` and
  real data acquisition (deliberately out of scope — supplied data only).

- **Phase 9, step 1 — `time_series`'s QA loop made symmetric with
  `dsa`'s.** Prompted by an external review of the repo at the end of
  Phase 8 (see `PLAN.md` §9 Phase 9 for the full roadmap this kicked off).
  `checkTimeSeriesRender` used to reject a wide-but-valid dataset outright
  (too many x-axis points to label); it now thins labels instead —
  `timeSeriesLayout.ts` gained `labelStride`/`tickIndicesToLabel`,
  `TimeSeriesView.tsx` labels an evenly-spaced subset of ticks while every
  point still gets its place on the line, and the old
  `x-axis-labels-overlap`/`-tight` checks became `x-axis-label-too-wide`
  (a single label that genuinely can't fit — still an error) and
  `x-axis-labels-thinned` (informational, non-blocking). Separately,
  `planVideo.ts` now repairs a too-short `targetDurationSec`
  automatically via a new pure function, `minimumSufficientDurationSec` —
  no agent call turned out to be needed, since the "right" duration is
  just arithmetic on the spec.

  **A real bug found live, past what unit tests and type-checking already
  caught clean:** the first version of the thinning fix computed "how
  many labels fit" as a standalone count, then proportionally remapped it
  onto the real indices with `Math.round`. Rendering an actual 25-point
  dataset and looking at the frame showed several originally-adjacent
  years still both labeled and overlapping — the count was right on
  average but `Math.round` on a non-integer step doesn't guarantee even
  index gaps. Fixed by switching to a fixed index `stride` (chosen so
  `stride` real per-point pixel-spacings are provably `>=` the label
  width), which rules out overlap by construction instead of by a
  proportional approximation. Confirmed by re-rendering the identical
  dataset and looking again: clean, non-overlapping, every-other-year
  labels. The second time in this project a plausible-looking layout
  estimate was only caught wrong by actually rendering and looking, not
  by the math or the tests (the first was Phase 8 step 2's "3.9k near the
  edge").

  Verified live end to end: the duration repair confirmed on both a
  small (7-point, hits the flat 1s floor) and a large (90-point, hits the
  reveal-pacing minimum) dataset, both through real `planVideo` +
  `renderVideo` calls producing real mp4s. 201/201 tests pass.

- **Phase 9, step 2 — `bar_race` as the third video type.** Built via
  `PLAN.md` §27's recipe exactly: its own spec/validator/checkRender,
  a pure layout module (continuous step interpolation and ranking, since
  entities re-rank and change vertical position frame to frame — a
  genuinely different problem than `time_series`'s point-reveal), a
  view/composition, a `VIDEO_TYPES` entry, a demo spec, CSV support, and
  a CLI mirroring `renderTimeSeries.ts`. `selectVideoType.ts` became a
  real three-way classifier (`dsa`/`time_series`/`bar_race`).
  `Video.tsx` needed zero changes to add this type — confirmed by
  `tsc --noEmit` passing untouched, the actual proof the registry
  generalized rather than just looking like it did.

  Colors are keyed to each entry's fixed position in the spec, never its
  current rank — confirmed live: China's bar stays the same color across
  every year even as it climbs from 4th to 2nd place.

  **Two real bugs found live, past clean type-checks and unit tests:**
  the first render was genuinely correct on the first attempt (entities
  re-ranking, colors staying put) — but a closer look at a
  mid-transition frame found a frame labeled "2015" while showing a
  value that was actually still a blend of 2010's and 2015's real
  numbers, because the displayed step rounded to the *nearest* whole
  step while the value was still interpolating from the previous one. A
  rendered frame asserting a specific year's real number before it's
  actually reached that number is a correctness bug, not a cosmetic one
  — exactly what this project's determinism principle exists to prevent.
  Fixed by keeping the displayed step on the last one whose real values
  have actually been reached, advancing only once the interpolation
  arrives exactly. Confirmed live: re-rendering showed the label and the
  displayed numbers landing on the real 2015 data (18.2k/11.1k) at the
  exact instant the animation reaches that step, not before.

  Verified live end to end: multiple frames inspected directly (start,
  two mid-transitions, end), the CSV and JSON CLI paths, and a real
  three-way classification against actual `qwen3:8b` (not injected
  deps) all closing the loop to a real rendered mp4. 244/244 tests pass.

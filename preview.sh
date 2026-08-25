#!/usr/bin/env bash
# One command, no YouTube involved, no API key required:
# `./preview.sh "explain linked lists"` writes a StorySpec (ensureSpec.ts,
# via makeSpec.ts — local Ollama models by default, escalating to
# claude-sonnet-5 only if ANTHROPIC_API_KEY is set and the local rung
# exhausts its attempts), QAs it with both check_render and sample_frames
# (qa.yaml), and renders a local preview mp4 once you approve that one
# render step. Never starts youtube-server.ts — there is nothing in this
# script that could upload anywhere. Use run.sh instead once you actually
# want to run the (currently stubbed) publish pipeline.
#
# Mirrors run.sh's structure (same env setup, same list_pending helper,
# same fd-3 fix for the approval loop — see run.sh's comments for why fd 3
# matters) but chains makeSpec.ts into qa.yaml instead of publish.yaml, so
# the one approval is render_preview, not youtube.upload.
#
# Set AUTO_APPROVE=1 to skip the interactive prompt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

export ALGOREEL_MCP_DIR="$SCRIPT_DIR/algoreel-mcp"
AGENTFORGE_BIN="${AGENTFORGE_BIN:-agentforge}"

if ! command -v "$AGENTFORGE_BIN" >/dev/null 2>&1; then
  echo "error: '$AGENTFORGE_BIN' not found. Build/install AgentForge, or set AGENTFORGE_BIN=/path/to/agentforge" >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "usage: $0 \"a topic, e.g. explain breadth-first search\"" >&2
  exit 1
fi
TOPIC="$1"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- helpers (Node, not jq — jq isn't assumed installed, and Node is
# already a hard dependency of this whole project) ---

# Prints a short human-readable summary of every pending tool call in a
# run result (there should only ever be one: render_preview), one per
# line as "index\tcall_id\ttool\tjson-args".
list_pending() {
  node -e '
    const fs = require("fs");
    const run = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const [i, p] of (run.pending || []).entries()) {
      console.log(`${i}\t${p.call_id}\t${p.tool}\t${JSON.stringify(p.args)}`);
    }
  ' "$1"
}

# Retries a local-model tool-calling agent up to 3 times when it returns an
# empty completion: state "completed", zero tool calls, no final text —
# never "failed" (a real error) or "awaiting_approval" (real progress),
# both left alone. Measured live: qwen3:8b does this on qa.yaml/
# publish.yaml roughly 1 run in 4, always on the very first model turn,
# never mid-workflow — a bare re-roll of the same prompt succeeded every
# time it was tried, so this retries locally rather than escalating to a
# paid model, same "cheap thing first" discipline as ensureSpec.ts's own
# ladder.
run_agent_retrying_empty() {
  local agent_path="$1" message_file="$2" output_path="$3"
  local attempt state tool_calls has_output
  for attempt in 1 2 3; do
    "$AGENTFORGE_BIN" run "$agent_path" -m "@$message_file" --output-format json --output "$output_path"
    state="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).state)' "$output_path")"
    tool_calls="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tool_calls_count ?? 0)' "$output_path")"
    has_output="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(r.output !== undefined && r.output !== null && r.output !== "" ? "1" : "0")' "$output_path")"
    if [ "$state" = "completed" ] && [ "$tool_calls" = "0" ] && [ "$has_output" = "0" ]; then
      echo "    (attempt $attempt: local model returned an empty completion — retrying)" >&2
      continue
    fi
    return 0
  done
  echo "    (all 3 attempts returned an empty completion — giving up, see the raw result below)" >&2
}

echo "==> Writing a script for: $TOPIC"
npx tsx "$SCRIPT_DIR/algoreel-mcp/src/cli/makeSpec.ts" "$TOPIC" > "$WORK/spec.json"
echo "    spec ready: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).topic)' "$WORK/spec.json")"

# A bare JSON blob as the entire user message, with no instruction
# sentence attached, measured live to make qa.yaml's local model (qwen3:8b)
# return an empty completion instead of calling check_render — no tool
# calls, no text, run state "completed" with nothing in it. One line of
# instruction ahead of the JSON fixed it immediately (confirmed: 5 real
# tool calls, reaching render_preview). Costs nothing for the Anthropic
# variant, so this wrapping applies regardless of which qa.yaml variant is
# configured.
{
  echo "Here is the StorySpec JSON to check and render:"
  echo
  cat "$WORK/spec.json"
} > "$WORK/spec-message.txt"

echo "==> Running QA and rendering a preview"
run_agent_retrying_empty "$SCRIPT_DIR/algoreel-agents/agents/qa.yaml" "$WORK/spec-message.txt" "$WORK/qa.json"

STATE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).state)' "$WORK/qa.json")"

if [ "$STATE" = "failed" ]; then
  echo "error: qa run failed:" >&2
  node -e 'console.error(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).error || "(no error message)")' "$WORK/qa.json" >&2
  exit 1
fi

RUN_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).run_id)' "$WORK/qa.json")"

if [ "$STATE" = "awaiting_approval" ]; then
  echo "==> Approval needed:"
  # Captured into a variable first, not streamed via `while read < <(...)` —
  # that pattern redirects the whole loop body's stdin to the process
  # substitution, so an interactive `read -p` *inside* the loop would read
  # EOF from it instead of the user's actual answer (found live building
  # run.sh: it read nothing, `read` returned non-zero, and `set -e` killed
  # the script before ever asking).
  PENDING="$(list_pending "$WORK/qa.json")"
  # Read the pending list from fd 3, not stdin (fd 0) — leaves stdin free
  # for the interactive `read -p` inside the loop body. `<<< "$PENDING"`
  # on the loop itself would have the same bug a plain `< <(...)` does:
  # it redirects the *whole loop's* stdin, so the inner prompt would read
  # EOF from that same string instead of the user's answer.
  while IFS=$'\t' read -r idx call_id tool args <&3; do
    echo "    [$tool]"
    echo "    $args"
    if [ "${AUTO_APPROVE:-0}" = "1" ]; then
      echo "    AUTO_APPROVE=1 set — approving without asking."
      decision="y"
    else
      read -r -p "    Approve this? [y/N] " decision
    fi
    if [ "$decision" = "y" ] || [ "$decision" = "Y" ]; then
      "$AGENTFORGE_BIN" runs approve "$RUN_ID" "$call_id" \
        --output-format json --output "$WORK/final.json"
    else
      "$AGENTFORGE_BIN" runs deny "$RUN_ID" "$call_id" --reason "declined via preview.sh" \
        --output-format json --output "$WORK/final.json"
    fi
  done 3<<< "$PENDING"
  cp "$WORK/final.json" "$WORK/qa.json"
fi

echo "==> Result:"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(r.output || JSON.stringify(r, null, 2));' "$WORK/qa.json"

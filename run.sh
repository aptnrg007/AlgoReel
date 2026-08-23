#!/usr/bin/env bash
# PLAN.md §9 Phase 5's exit criterion: `./run.sh "explain BFS"` -> you
# approve one prompt -> video is live. (Currently "live" means a stub
# YouTube response — see algoreel-mcp/src/youtube-server.ts and
# PLAN.md §11; nothing here changes once real credentials land.)
#
# Chains script.yaml (topic -> StorySpec) into publish.yaml (StorySpec ->
# QA'd, rendered, uploaded video). publish.yaml auto-approves every step
# except youtube.upload, so this script only ever has to handle one
# approval decision, no matter how many check_render/sample_frames
# rounds the agent needed internally.
#
# Set AUTO_APPROVE=1 to skip the interactive prompt (unattended runs, or
# scripted verification) — it still goes through the same approve/deny
# call agentforge would otherwise need a human to make interactively.
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

# --- extractor helpers (Node, not jq — jq isn't assumed installed, and
# Node is already a hard dependency of this whole project) ---

# Reads an `agentforge run --output-format json` result file and prints
# its .output field, stripping an optional ```json ... ``` fence (Claude
# wraps script.yaml's answer in one about half the time — see
# script.yaml's comments). Exits non-zero with a clear message if the
# run didn't complete or the output isn't valid JSON.
extract_spec() {
  node -e '
    const fs = require("fs");
    const run = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (run.state !== "completed") {
      console.error(`script.yaml run did not complete (state: ${run.state}): ${run.error || "no error message"}`);
      process.exit(1);
    }
    let out = (run.output || "").trim();
    out = out.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
    try {
      JSON.parse(out); // validate before handing it to the next agent
    } catch (e) {
      console.error("script.yaml did not return valid JSON:", e.message);
      console.error(out.slice(0, 500));
      process.exit(1);
    }
    process.stdout.write(out);
  ' "$1"
}

# Prints a short human-readable summary of every pending tool call in a
# run result (there should only ever be one: youtube.upload), one per
# line as "index\ttool\tjson-args".
list_pending() {
  node -e '
    const fs = require("fs");
    const run = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const [i, p] of (run.pending || []).entries()) {
      console.log(`${i}\t${p.call_id}\t${p.tool}\t${JSON.stringify(p.args)}`);
    }
  ' "$1"
}

echo "==> Writing a script for: $TOPIC"
"$AGENTFORGE_BIN" run "$SCRIPT_DIR/algoreel-agents/agents/script.yaml" \
  -m "$TOPIC" --output-format json --output "$WORK/script.json"
extract_spec "$WORK/script.json" > "$WORK/spec.json"
echo "    spec ready: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).topic)' "$WORK/spec.json")"

echo "==> Running QA and publishing"
"$AGENTFORGE_BIN" run "$SCRIPT_DIR/algoreel-agents/agents/publish.yaml" \
  -m "@$WORK/spec.json" --output-format json --output "$WORK/publish.json"

STATE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).state)' "$WORK/publish.json")"

if [ "$STATE" = "failed" ]; then
  echo "error: publish run failed:" >&2
  node -e 'console.error(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).error || "(no error message)")' "$WORK/publish.json" >&2
  exit 1
fi

RUN_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).run_id)' "$WORK/publish.json")"

if [ "$STATE" = "awaiting_approval" ]; then
  echo "==> Approval needed:"
  # Captured into a variable first, not streamed via `while read < <(...)` —
  # that pattern redirects the whole loop body's stdin to the process
  # substitution, so an interactive `read -p` *inside* the loop would read
  # EOF from it instead of the user's actual answer (found live: it read
  # nothing, `read` returned non-zero, and `set -e` killed the script
  # before ever asking).
  PENDING="$(list_pending "$WORK/publish.json")"
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
      "$AGENTFORGE_BIN" runs deny "$RUN_ID" "$call_id" --reason "declined via run.sh" \
        --output-format json --output "$WORK/final.json"
    fi
  done 3<<< "$PENDING"
  cp "$WORK/final.json" "$WORK/publish.json"
fi

echo "==> Result:"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(r.output || JSON.stringify(r, null, 2));' "$WORK/publish.json"

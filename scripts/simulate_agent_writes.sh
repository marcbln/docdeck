#!/usr/bin/env bash
#
# End-to-end smoke test for docdeck's live-update path.
#
# Opens two throwaway documents in docdeck, then simulates a background agent
# appending to one of them in bursts — exactly the write pattern the debounced
# inotify watcher exists to absorb.
#
# Usage:
#   ./scripts/simulate_agent_writes.sh [path-to-docdeck-binary]
#
# With no argument the script prefers a release build, then a debug build, and
# finally falls back to `npm run tauri dev`.

set -euo pipefail

DOC_ALPHA="/tmp/agent_plan_alpha.md"
DOC_BETA="/tmp/agent_report_beta.md"
STEPS="${STEPS:-5}"
STEP_DELAY="${STEP_DELAY:-1}"

cd "$(dirname "$0")/.."

resolve_binary() {
  if [[ $# -ge 1 && -x "$1" ]]; then
    printf '%s' "$1"
    return
  fi
  for candidate in \
    src-tauri/target/release/docdeck \
    src-tauri/target/debug/docdeck; do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  printf ''
}

BINARY="$(resolve_binary "${1:-}")"

printf -- '---\ntitle: "Agent Alpha"\nstatus: in-progress\ntags: [agent, alpha]\n---\n\n# Agent Alpha — Initial Plan\n\n- [ ] Step pending\n' > "$DOC_ALPHA"
printf -- '---\ntitle: "Agent Beta"\nstatus: in-progress\ntags: [agent, beta]\n---\n\n# Agent Beta — Initial Report\n\n- [ ] Step pending\n' > "$DOC_BETA"

APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$DOC_ALPHA" "$DOC_BETA"
}
trap cleanup EXIT

if [[ -n "$BINARY" ]]; then
  printf 'Launching docdeck (%s) with two documents...\n' "$BINARY"
  "$BINARY" "$DOC_ALPHA" "$DOC_BETA" &
  APP_PID=$!
else
  printf 'No prebuilt binary found — falling back to `npm run tauri dev`.\n'
  npm run tauri dev -- "$DOC_ALPHA" "$DOC_BETA" &
  APP_PID=$!
fi

sleep 5
printf 'Simulating background agent writes to %s (%s steps)...\n' "$DOC_BETA" "$STEPS"

for i in $(seq 1 "$STEPS"); do
  sleep "$STEP_DELAY"
  printf -- '- [x] Step %s executed at %s\n' "$i" "$(date +%T)" >> "$DOC_BETA"
  printf '  wrote step %s/%s\n' "$i" "$STEPS"
done

cat <<'EOF'

Verification checklist:
  1. The Agent Beta tab shows an amber pulsing dot while Agent Alpha is active.
  2. Switching to the Agent Beta tab clears the dot and paints the new steps.
  3. With "Auto-Sort" enabled, the Beta tab bubbles to the top of the list.
  4. In a second terminal, `docdeck README.md` opens a third tab in THIS window
     rather than starting a second process.
  5. Both simulated documents open with a frontmatter table above the body.
  6. The Outline button lists the documents' headings and jumps to one.
  7. Folding the metadata table survives the agent's background appends.
  8. The Theme button flips chrome, code blocks and Mermaid colors.
EOF

printf 'Press Ctrl+C to stop docdeck.\n'
wait "$APP_PID"
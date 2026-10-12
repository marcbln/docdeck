#!/usr/bin/env bash
#
# End-to-end smoke test for docdeck's folder-watch mode.
#
# Creates a throwaway _ai-style workspace, launches docdeck on the folder, then
# simulates an agent creating and editing Markdown files inside it.
#
# Usage:
#   ./scripts/simulate_folder_watch.sh [path-to-docdeck-binary]
#
# With no argument the script prefers a release build, then a debug build, and
# finally falls back to `npm run tauri dev`.

set -euo pipefail

WORKSPACE="/tmp/docdeck_folder_sim"
STEPS="${STEPS:-4}"
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

rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE/backlog/active" "$WORKSPACE/backlog/reports"
printf '# Active plan\n\n- [ ] Step pending\n' > "$WORKSPACE/backlog/active/plan.md"

APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE"
}
trap cleanup EXIT

if [[ -n "$BINARY" ]]; then
  printf 'Launching docdeck (%s) on %s...\n' "$BINARY" "$WORKSPACE"
  "$BINARY" "$WORKSPACE" &
  APP_PID=$!
else
  printf 'No prebuilt binary found — falling back to `npm run tauri dev`.\n'
  npm run tauri dev -- "$WORKSPACE" &
  APP_PID=$!
fi

sleep 5
printf 'Simulating an agent writing under %s (%s steps)...\n' "$WORKSPACE" "$STEPS"

for i in $(seq 1 "$STEPS"); do
  sleep "$STEP_DELAY"
  printf -- '- [x] Step %s executed at %s\n' "$i" "$(date +%T)" \
    >> "$WORKSPACE/backlog/active/plan.md"
  printf '# Report %s\n\nGenerated at %s\n' "$i" "$(date +%T)" \
    > "$WORKSPACE/backlog/reports/report_$i.md"
  printf '  step %s/%s: edited plan.md, created report_%s.md\n' \
    "$i" "$STEPS" "$i"
done

cat <<'EOF'

Verification checklist:
  1. At launch, the folder picker lists backlog/active/plan.md and no reports.
  2. Confirming opens plan.md and the picker closes; the folder stays watched.
  3. Every new report_<n>.md opens as a background tab with an amber dot,
     without stealing focus from plan.md.
  4. Switching to a report tab clears its dot; edits keep reloading plan.md.
  5. In a second terminal, `docdeck <workspace>` reopens the picker in THIS
     window with plan.md and the reports pre-checked.
  6. Cancel leaves all folder files open/unopened exactly as they were.
  7. Delete a report file: its tab stays with a strikethrough and the deleted
     banner; recreating the file clears both.
  8. `mv <workspace>/backlog/reports/report_1.md /tmp/` keeps working: the tab
     is marked deleted rather than losing the watch outright.
EOF

printf 'Press Ctrl+C to stop docdeck.\n'
wait "$APP_PID"
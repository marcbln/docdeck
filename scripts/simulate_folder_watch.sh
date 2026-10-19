#!/usr/bin/env bash
#
# End-to-end smoke test for docdeck's config-driven watches and inbox.
#
# Creates a throwaway workspace and config, launches docdeck with
# DOCDECK_CONFIG pointing at it, then simulates an agent writing, deleting and
# recreating documents.
#
# Usage:
#   ./scripts/simulate_folder_watch.sh [path-to-docdeck-binary]
#
# With no argument the script prefers a release build, then a debug build, and
# finally falls back to `npm run tauri dev`.

set -euo pipefail

WORKSPACE="/tmp/docdeck_watch_sim"
CONFIG_DIR="/tmp/docdeck_watch_sim_config"
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

rm -rf "$WORKSPACE" "$CONFIG_DIR"
mkdir -p \
  "$WORKSPACE/projects/alpha/_ai/backlog" \
  "$WORKSPACE/projects/alpha/_ai/archive" \
  "$WORKSPACE/projects/alpha/node_modules" \
  "$WORKSPACE/projects/beta/_ai/backlog" \
  "$CONFIG_DIR/docdeck"
printf '# Alpha plan\n\n- [ ] Step pending\n' \
  > "$WORKSPACE/projects/alpha/_ai/backlog/plan.md"
printf '# Beta notes\n' \
  > "$WORKSPACE/projects/beta/_ai/backlog/notes.md"
printf 'must never appear\n' \
  > "$WORKSPACE/projects/alpha/node_modules/skip.md"
printf 'must never appear\n' \
  > "$WORKSPACE/projects/alpha/_ai/archive/old.md"

cat > "$CONFIG_DIR/docdeck/config.toml" <<'TOML'
watch = ["/tmp/docdeck_watch_sim/projects/*/_ai"]
exclude = ["**/archive/**"]
TOML

APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$CONFIG_DIR"
}
trap cleanup EXIT

if [[ -n "$BINARY" ]]; then
  printf 'Launching docdeck (%s) with %s...\n' "$BINARY" "$CONFIG_DIR/docdeck/config.toml"
  DOCDECK_CONFIG="$CONFIG_DIR/docdeck/config.toml" "$BINARY" &
  APP_PID=$!
else
  printf 'No prebuilt binary found — falling back to `npm run tauri dev`.\n'
  DOCDECK_CONFIG="$CONFIG_DIR/docdeck/config.toml" npm run tauri dev &
  APP_PID=$!
fi

sleep 5
printf 'Simulating an agent writing under %s (%s steps)...\n' "$WORKSPACE" "$STEPS"

for i in $(seq 1 "$STEPS"); do
  sleep "$STEP_DELAY"
  printf -- '- [x] Step %s executed at %s\n' "$i" "$(date +%T)" \
    >> "$WORKSPACE/projects/alpha/_ai/backlog/plan.md"
  printf '# Report %s\n\nGenerated at %s\n' "$i" "$(date +%T)" \
    > "$WORKSPACE/projects/beta/_ai/backlog/report_$i.md"
  printf '  step %s/%s: edited alpha plan.md, created beta report_%s.md\n' \
    "$i" "$STEPS" "$i"
done

# Deleted row, then recreate: both transitions must be visible in the inbox.
rm "$WORKSPACE/projects/beta/_ai/backlog/report_1.md"
sleep "$STEP_DELAY"
printf '# Report 1\n\nRecreated at %s\n' "$(date +%T)" \
  > "$WORKSPACE/projects/beta/_ai/backlog/report_1.md"

# Excluded and noise paths: write them and confirm they never show up.
printf 'ignored\n' > "$WORKSPACE/projects/alpha/_ai/archive/old.md"
printf 'ignored\n' > "$WORKSPACE/projects/alpha/node_modules/skip.md"

cat <<'EOF'

Verification checklist:
  1. At launch the inbox lists beta notes.md and alpha plan.md, newest first,
     with the project chips `alpha` and `beta`; nothing is bold.
  2. Editing plan.md moves its row to the top and the active tab pulses its
     dot briefly; the row never goes bold.
  3. Each new report_<n>.md appears bold at the top WITHOUT opening a tab.
  4. Clicking a bold row opens that document and clears its bold.
  5. Editing a document that is open but not active makes its row and tab bold.
  6. Closing an unread tab leaves the row bold.
  7. Deleting report_1.md strikes its row through; recreating it clears the
     strike and makes it bold again without opening a tab.
  8. `archive/old.md` and `node_modules/skip.md` never appear, at launch or
     after being written.
  9. In a second terminal,
     `DOCDECK_CONFIG=/tmp/docdeck_watch_sim_config/docdeck/config.toml \
      docdeck /tmp/docdeck_watch_sim/projects/alpha`
     adds the session root and lists its files in the same inbox.
 10. Toggling Inbox off hides the panel; restarting docdeck restores the
     toggle state and clears every bold mark.
 11. Renaming the config away and restarting shows the setup hint with the
     exact path; putting a broken TOML there shows the parse error instead.
EOF

printf 'Press Ctrl+C to stop docdeck.\n'
wait "$APP_PID"

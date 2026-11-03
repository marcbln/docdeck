#!/usr/bin/env bash
#
# Tests for scripts/lib/restart.sh and the installer's restart decision flow.
# No Tauri build is required and no real docdeck instance is signalled.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/restart.sh
source "$SCRIPT_DIR/lib/restart.sh"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/docdeck-install-test.XXXXXX")"
PASS=0
FAIL=0

cleanup() {
  restart_release_lock
  if [[ -n "${SLEEP_PID:-}" ]]; then
    pkill -TERM -P "$SLEEP_PID" 2>/dev/null || true
    kill -9 "$SLEEP_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

ok() {
  PASS=$((PASS + 1))
  printf 'ok - %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf 'not ok - %s\n' "$1"
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$expected" == "$actual" ]]; then
    ok "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    ok "$label"
  else
    fail "$label (missing '$needle' in '$haystack')"
  fi
}

record_json() {
  local file="$1" pid="$2" exe="$3" cwd="$4" argv="$5"
  printf '{"version":1,"pid":%s,"exe":"%s","argv":%s,"cwd":"%s","startedAt":1793700000000}\n' \
    "$pid" "$exe" "$argv" "$cwd" >"$file"
}

record_path_with_env() {
  env -i PATH="$PATH" "$@" bash -c 'source "$1"; docdeck_record_path' _ "$SCRIPT_DIR/lib/restart.sh"
}

# --- Record path resolution -------------------------------------------------

assert_eq "/run/user/1000/docdeck/instance.json" \
  "$(record_path_with_env XDG_RUNTIME_DIR=/run/user/1000 HOME=/home/user)" \
  "record path prefers XDG_RUNTIME_DIR"

assert_eq "/home/user/.local/state/docdeck/instance.json" \
  "$(record_path_with_env HOME=/home/user)" \
  "record path falls back to HOME"

assert_eq "/appdata/docdeck/instance.json" \
  "$(record_path_with_env LOCALAPPDATA=/appdata)" \
  "record path falls back to LOCALAPPDATA"

if record_path_with_env >/dev/null 2>&1; then
  fail "record path requires at least one runtime directory"
else
  ok "record path requires at least one runtime directory"
fi

# --- Record parsing ---------------------------------------------------------

parser_dir="$TEST_ROOT/parser"
mkdir -p "$parser_dir" "$parser_dir/project"
parser_file="$parser_dir/instance.json"

record_json "$parser_file" "$$" "/usr/bin/docdeck" "$parser_dir/project" \
  '["/usr/bin/docdeck","one.md","./_ai"]'

if restart_load_record "$parser_file"; then
  ok "valid record is parsed"
else
  fail "valid record is parsed"
fi
assert_eq "1" "$RESTART_RECORD_VERSION" "record version is read"
assert_eq "$$" "$RESTART_RECORD_PID" "record pid is read"
assert_eq "/usr/bin/docdeck" "$RESTART_RECORD_EXE" "record executable is read"
assert_eq "$parser_dir/project" "$RESTART_RECORD_CWD" "record cwd is read"
assert_eq "3" "${#RESTART_RECORD_ARGV[@]}" "record argv is read"
assert_eq "one.md" "${RESTART_RECORD_ARGV[1]}" "record argv order is preserved"

record_json "$parser_file" "$$" "/usr/bin/docdeck" "$parser_dir/project" \
  '["/usr/bin/docdeck"]'
if restart_load_record "$parser_file"; then
  ok "single-entry argv is accepted"
else
  fail "single-entry argv is accepted"
fi

record_json "$parser_file" "$$" "/usr/bin/docdeck" "$parser_dir/project" \
  '["/usr/bin/docdeck"]'
printf '%s' '{"version":2,"pid":1,"exe":"/usr/bin/docdeck","argv":["docdeck"],"cwd":"/tmp","startedAt":1}' >"$parser_file"
if restart_load_record "$parser_file"; then
  fail "unknown record version is rejected"
else
  ok "unknown record version is rejected"
fi

record_json "$parser_file" "$$" "/usr/bin/docdeck" "$parser_dir/project" \
  '["/usr/bin/docdeck"]'
printf '%s' '{"version":1,"pid":"nope","exe":"/usr/bin/docdeck","argv":["docdeck"],"cwd":"/tmp","startedAt":1}' >"$parser_file"
if restart_load_record "$parser_file"; then
  fail "wrongly typed record is rejected"
else
  ok "wrongly typed record is rejected"
fi

dd if=/dev/zero bs=1024 count=65 2>/dev/null | tr '\0' 'x' >"$parser_file"
if restart_load_record "$parser_file"; then
  fail "oversized record is rejected"
else
  ok "oversized record is rejected"
fi

if restart_load_record "$TEST_ROOT/missing.json"; then
  fail "missing record is rejected"
else
  ok "missing record is rejected"
fi

# --- Process identity validation -------------------------------------------

sleep 30 &
SLEEP_PID=$!
sleep_exe="$(readlink "/proc/$SLEEP_PID/exe" 2>/dev/null || true)"
sleep_exe="${sleep_exe% (deleted)}"
if [[ -z "$sleep_exe" ]]; then
  sleep_exe="$(ps -p "$SLEEP_PID" -o comm= 2>/dev/null | tr -d '[:space:]')"
fi

sleep_record="$TEST_ROOT/sleep-record.json"
record_json "$sleep_record" "$SLEEP_PID" "$sleep_exe" "$TEST_ROOT" '["docdeck"]'
if restart_load_record "$sleep_record" && restart_validate_target "$sleep_record"; then
  ok "live current-user process with a matching executable is trusted"
else
  fail "live current-user process with a matching executable is trusted"
fi

record_json "$sleep_record" "$SLEEP_PID" "/definitely/not/the/live/exe" "$TEST_ROOT" '["docdeck"]'
if restart_load_record "$sleep_record" && restart_validate_target "$sleep_record"; then
  fail "mismatched executable is rejected"
else
  ok "mismatched executable is rejected"
fi
if [[ -e "$sleep_record" ]]; then
  fail "mismatched record is removed"
else
  ok "mismatched record is removed"
fi

kill "$SLEEP_PID" 2>/dev/null || true
wait "$SLEEP_PID" 2>/dev/null || true
SLEEP_PID=""

dead_record="$TEST_ROOT/dead-record.json"
record_json "$dead_record" "999999" "/usr/bin/docdeck" "$TEST_ROOT" '["docdeck"]'
if restart_load_record "$dead_record" && restart_validate_target "$dead_record"; then
  fail "dead record is rejected"
else
  ok "dead record is rejected"
fi
if [[ -e "$dead_record" ]]; then
  fail "dead record is removed"
else
  ok "dead record is removed"
fi

foreign_record="$TEST_ROOT/foreign-record.json"
record_json "$foreign_record" "$$" "/usr/bin/docdeck" "$TEST_ROOT" '["docdeck"]'
if (
  restart_pid_alive() { return 0; }
  restart_pid_owner_ok() { return 1; }
  restart_live_exe() { printf '/usr/bin/docdeck'; }
  restart_load_record "$foreign_record" || exit 1
  restart_validate_target "$foreign_record"
); then
  fail "other user's process is rejected"
else
  ok "other user's process is rejected"
fi

# --- Classification ---------------------------------------------------------

target="$TEST_ROOT/installed-docdeck"
printf '#!/usr/bin/env bash\nexit 0\n' >"$target"
chmod +x "$target"

assert_eq "installed" "$(restart_classify "$target" "$target")" \
  "same executable is an installed instance"
assert_eq "development" "$(restart_classify "/bin/sh" "$target")" \
  "different executable is a development instance"

# --- Decision table and prompts --------------------------------------------

if printf '\n' | restart_prompt "? " y 2>/dev/null; then
  ok "default yes accepts an empty answer"
else
  fail "default yes accepts an empty answer"
fi
if printf 'n\n' | restart_prompt "? " y 2>/dev/null; then
  fail "explicit no overrides default yes"
else
  ok "explicit no overrides default yes"
fi
if printf '\n' | restart_prompt "? " n 2>/dev/null; then
  fail "default no rejects an empty answer"
else
  ok "default no rejects an empty answer"
fi

flow_output="$(
  (
    RESTART_CHOICE="auto"
    RESTART_NO_INTERACTION=0
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD="$TEST_ROOT"
      RESTART_INSTANCE_ARGS=("$target")
      return 0
    }
    restart_classify() { printf 'installed'; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "No interactive terminal attached" \
  "non-interactive install prints manual-restart guidance"

flow_output="$(
  (
    RESTART_CHOICE="auto"
    RESTART_NO_INTERACTION=1
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD="$TEST_ROOT"
      RESTART_INSTANCE_ARGS=("$target")
      return 0
    }
    restart_classify() { printf 'installed'; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "No interactive terminal attached" \
  "--no-interaction never prompts"

flow_output="$(
  (
    RESTART_CHOICE="decline"
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "Left the running docdeck instance untouched" \
  "--no-restart declines before detection"

flow_output="$(
  (
    RESTART_CHOICE="restart"
    RESTART_NO_INTERACTION=0
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD="$TEST_ROOT"
      RESTART_INSTANCE_ARGS=("$target" "one.md")
      return 0
    }
    restart_classify() { printf 'development'; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "installed build is" \
  "development instance without a terminal is not replaced"

flow_output="$(
  (
    RESTART_CHOICE="restart"
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="pgrep"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD=""
      RESTART_INSTANCE_ARGS=()
      return 0
    }
    restart_classify() { printf 'installed'; }
    restart_acquire_lock() { return 1; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "Another install is already restarting" \
  "concurrent install skips the restart"

flow_output="$(
  (
    RESTART_CHOICE="restart"
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD="$TEST_ROOT"
      RESTART_INSTANCE_ARGS=("$target" "one.md")
      return 0
    }
    restart_classify() { printf 'installed'; }
    restart_acquire_lock() { RESTART_LOCK_PATH=""; return 0; }
    restart_stop_instance() { return 1; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)" || flow_status=$?
flow_status="${flow_status:-0}"
assert_contains "$flow_output" "did not exit after a graceful request and SIGTERM" \
  "unresponsive instance reports the abort"
assert_eq "1" "$flow_status" "unresponsive instance exits non-zero"

flow_output="$(
  (
    RESTART_CHOICE="restart"
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD="$TEST_ROOT"
      RESTART_INSTANCE_ARGS=("$target" "one.md")
      return 0
    }
    restart_classify() { printf 'installed'; }
    restart_acquire_lock() { RESTART_LOCK_PATH=""; return 0; }
    restart_stop_instance() { return 0; }
    restart_launch() { return 0; }
    restart_wait_for_new_record() { printf '4321'; return 0; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "Restarted docdeck (pid 4321)" \
  "successful restart reports the new pid"

flow_output="$(
  (
    RESTART_CHOICE="restart"
    restart_find_instance() {
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$$"
      RESTART_INSTANCE_EXE="$target"
      RESTART_INSTANCE_CWD="$TEST_ROOT"
      RESTART_INSTANCE_ARGS=("$target" "one.md")
      return 0
    }
    restart_classify() { printf 'installed'; }
    restart_acquire_lock() { RESTART_LOCK_PATH=""; return 0; }
    restart_stop_instance() { return 0; }
    restart_launch() { return 0; }
    restart_wait_for_new_record() { return 1; }
    restart_after_install "$target" copy </dev/null
  ) 2>&1
)"
assert_contains "$flow_output" "did not report within 5 seconds" \
  "unconfirmed start reports a warning"

# --- Lock ownership ---------------------------------------------------------

export XDG_RUNTIME_DIR="$TEST_ROOT/lock-run"
mkdir -p "$XDG_RUNTIME_DIR"

if restart_acquire_lock; then
  ok "restart lock is acquired"
else
  fail "restart lock is acquired"
fi
if (restart_acquire_lock); then
  fail "live lock owner blocks a second installer"
else
  ok "live lock owner blocks a second installer"
fi
restart_release_lock
if [[ -e "$XDG_RUNTIME_DIR/docdeck/install-restart.lock" ]]; then
  fail "restart lock is released"
else
  ok "restart lock is released"
fi

mkdir -p "$XDG_RUNTIME_DIR/docdeck/install-restart.lock"
printf '999999\n' >"$XDG_RUNTIME_DIR/docdeck/install-restart.lock/pid"
if (restart_pid_alive() { return 1; }; restart_acquire_lock); then
  ok "stale lock is recovered"
else
  fail "stale lock is recovered"
fi
restart_release_lock

# --- Stop escalation --------------------------------------------------------

fake_bin="$TEST_ROOT/fake-docdeck"
printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_bin"
chmod +x "$fake_bin"

sleep 30 &
SLEEP_PID=$!
if RESTART_GRACE_SECONDS=0 RESTART_ESCALATION_SECONDS=1 \
  restart_stop_instance "$SLEEP_PID" "$fake_bin"; then
  ok "SIGTERM escalation stops a responsive process"
else
  fail "SIGTERM escalation stops a responsive process"
fi
wait "$SLEEP_PID" 2>/dev/null || true
SLEEP_PID=""

bash -c 'trap "" TERM; sleep 30' &
SLEEP_PID=$!
if RESTART_GRACE_SECONDS=0 RESTART_ESCALATION_SECONDS=0 \
  restart_stop_instance "$SLEEP_PID" "$fake_bin"; then
  fail "process that ignores SIGTERM aborts the restart"
else
  ok "process that ignores SIGTERM aborts the restart"
fi
pkill -TERM -P "$SLEEP_PID" 2>/dev/null || true
kill -9 "$SLEEP_PID" 2>/dev/null || true
wait "$SLEEP_PID" 2>/dev/null || true
SLEEP_PID=""

# --- Launch argument construction ------------------------------------------

project="$TEST_ROOT/project"
mkdir -p "$project"
launch_log="$TEST_ROOT/launch.log"
launch_bin="$TEST_ROOT/launch-bin"
cat >"$launch_bin" <<EOF
#!/usr/bin/env bash
{
  printf '%s\n' "\$PWD"
  if ((\$# > 0)); then
    printf '%s\n' "\$@"
  fi
} > "$launch_log"
EOF
chmod +x "$launch_bin"

RESTART_INSTANCE_ARGS=("$launch_bin" "one.md" "./_ai")
restart_launch "$launch_bin" "$project" 0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$launch_log" ]] && break
  sleep 0.1
done
assert_eq "$project" "$(sed -n '1p' "$launch_log")" "relaunch uses the recorded cwd"
assert_eq "one.md" "$(sed -n '2p' "$launch_log")" "relaunch preserves the first argument"
assert_eq "./_ai" "$(sed -n '3p' "$launch_log")" "relaunch preserves the second argument"

rm -f "$launch_log"
RESTART_INSTANCE_ARGS=("$launch_bin" "one.md")
restart_launch "$launch_bin" "$project" 1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$launch_log" ]] && break
  sleep 0.1
done
assert_eq "$project" "$(sed -n '1p' "$launch_log")" "bare relaunch uses the recorded cwd"
if [[ "$(wc -l <"$launch_log" | tr -d '[:space:]')" == "1" ]]; then
  ok "bare relaunch drops the original arguments"
else
  fail "bare relaunch drops the original arguments"
fi

# --- Summary ----------------------------------------------------------------

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]

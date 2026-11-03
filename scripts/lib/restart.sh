#!/usr/bin/env bash
#
# Sourceable restart helpers for scripts/install.sh.
#
# The record format and validation rules mirror src-tauri/src/instance.rs:
#   $XDG_RUNTIME_DIR/docdeck/instance.json
#   $HOME/.local/state/docdeck/instance.json
#   %LOCALAPPDATA%\docdeck\instance.json
#
# Nothing here runs at source time except reading the embedded Node parser.

RESTART_RECORD_MAX_BYTES=65536
RESTART_MSG_NONE="No running docdeck instance. The new build will be used on the next launch."
RESTART_MSG_AMBIGUOUS="More than one docdeck instance is running; skipping the restart. The new build will be used on the next launch."
RESTART_MSG_RESTARTED="Restarted docdeck (pid %s) from %s with its original launch arguments."
RESTART_MSG_RESTARTED_BARE="Restarted docdeck (pid %s) from %s without its original launch arguments."
RESTART_MSG_NOT_CONFIRMED="Started docdeck from %s, but the new instance did not report within 5 seconds."
RESTART_MSG_DECLINED="Left the running docdeck instance untouched. Quit and relaunch it to use the new build."
RESTART_MSG_NONINTERACTIVE="No interactive terminal attached. Quit and relaunch docdeck to use the new build."
RESTART_MSG_DEV="The running docdeck is %s; the installed build is %s. Left it running; quit and relaunch it to use the new build."
RESTART_MSG_LOCKED="Another install is already restarting docdeck; skipping the restart."
RESTART_MSG_STOP_FAILED="The running docdeck instance (pid %s) did not exit after a graceful request and SIGTERM. Left it running and started nothing."
RESTART_MSG_LAUNCH_FAILED="Stopped the old docdeck instance but could not start %s. Start it manually."

RESTART_CHOICE="${RESTART_CHOICE:-auto}"
RESTART_NO_INTERACTION="${RESTART_NO_INTERACTION:-0}"
RESTART_GRACE_SECONDS="${RESTART_GRACE_SECONDS:-5}"
RESTART_ESCALATION_SECONDS="${RESTART_ESCALATION_SECONDS:-5}"
RESTART_LOCK_PATH=""

RESTART_RECORD_VERSION=""
RESTART_RECORD_PID=""
RESTART_RECORD_EXE=""
RESTART_RECORD_CWD=""
RESTART_RECORD_STARTED_AT=""
RESTART_RECORD_ARGV=()

RESTART_INSTANCE_SOURCE=""
RESTART_INSTANCE_PID=""
RESTART_INSTANCE_EXE=""
RESTART_INSTANCE_CWD=""
RESTART_INSTANCE_ARGS=()

IFS= read -r -d '' RESTART_NODE_PARSER <<'NODE' || true
const fs = require('fs');
const path = require('path');

const file = process.env.DOCDECK_RECORD;

let raw;
try {
  const stat = fs.statSync(file);
  if (stat.size > 65536) process.exit(3);
  raw = fs.readFileSync(file, 'utf8');
} catch (error) {
  process.exit(3);
}

let record;
try {
  record = JSON.parse(raw);
} catch (error) {
  process.exit(3);
}

const absolute = (value) =>
  typeof value === 'string' && value.length > 0 && path.isAbsolute(value);

if (
  !record ||
  record.version !== 1 ||
  !Number.isInteger(record.pid) ||
  record.pid <= 0 ||
  !absolute(record.exe) ||
  !absolute(record.cwd) ||
  !Array.isArray(record.argv) ||
  record.argv.length === 0 ||
  !record.argv.every((value) => typeof value === 'string') ||
  !Number.isFinite(record.startedAt)
) {
  process.exit(3);
}

const fields = [
  String(record.version),
  String(record.pid),
  record.exe,
  record.cwd,
  String(record.startedAt),
  ...record.argv,
];

if (fields.some((field) => field.includes('\u0000'))) {
  process.exit(3);
}

process.stdout.write(fields.map((field) => field + '\u0000').join(''));
NODE

restart_msg() {
  printf '%s\n' "$1" >&2
}

docdeck_record_dir() {
  if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    printf '%s/docdeck' "$XDG_RUNTIME_DIR"
  elif [[ -n "${HOME:-}" ]]; then
    printf '%s/.local/state/docdeck' "$HOME"
  elif [[ -n "${LOCALAPPDATA:-}" ]]; then
    printf '%s/docdeck' "$LOCALAPPDATA"
  else
    return 1
  fi
}

docdeck_record_path() {
  local directory
  directory="$(docdeck_record_dir)" || return 1
  printf '%s/instance.json' "$directory"
}

restart_load_record() {
  local file="$1"
  local temporary field

  [[ -f "$file" ]] || return 1

  temporary="$(mktemp "${TMPDIR:-/tmp}/docdeck-record.XXXXXX")" || return 1
  if ! DOCDECK_RECORD="$file" node -e "$RESTART_NODE_PARSER" >"$temporary" 2>/dev/null; then
    rm -f "$temporary"
    return 1
  fi

  local -a fields=()
  while IFS= read -r -d '' field; do
    fields+=("$field")
  done <"$temporary"
  rm -f "$temporary"

  ((${#fields[@]} >= 6)) || return 1

  RESTART_RECORD_VERSION="${fields[0]}"
  RESTART_RECORD_PID="${fields[1]}"
  RESTART_RECORD_EXE="${fields[2]}"
  RESTART_RECORD_CWD="${fields[3]}"
  RESTART_RECORD_STARTED_AT="${fields[4]}"
  RESTART_RECORD_ARGV=("${fields[@]:5}")
  return 0
}

restart_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

restart_pid_owner_ok() {
  local pid="$1" uid
  uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]')" || return 1
  [[ -n "$uid" && "$uid" == "$(id -u)" ]]
}

restart_live_exe() {
  local pid="$1" exe
  case "$(uname -s)" in
    Linux)
      if [[ -e "/proc/$pid/exe" ]]; then
        exe="$(readlink "/proc/$pid/exe" 2>/dev/null)" || return 1
        printf '%s' "${exe% (deleted)}"
      else
        ps -p "$pid" -o comm= 2>/dev/null | tr -d '[:space:]'
      fi
      ;;
    *)
      ps -p "$pid" -o comm= 2>/dev/null | tr -d '[:space:]'
      ;;
  esac
}

restart_canonicalize() {
  local value="$1" resolved
  resolved="$(DOCDECK_PATH="$value" node -e 'const fs=require("fs");try{process.stdout.write(fs.realpathSync(process.env.DOCDECK_PATH))}catch{process.stdout.write(process.env.DOCDECK_PATH)}' 2>/dev/null)" || resolved=""
  printf '%s' "${resolved:-$value}"
}

restart_classify() {
  local exe="$1" target="$2" left right
  [[ -n "$exe" && -n "$target" ]] || {
    printf 'unknown'
    return 0
  }
  left="$(restart_canonicalize "$exe")"
  right="$(restart_canonicalize "$target")"
  if [[ "$left" == "$right" ]]; then
    printf 'installed'
  else
    printf 'development'
  fi
}

restart_validate_target() {
  local record="$1" pid="$RESTART_RECORD_PID" live

  restart_pid_alive "$pid" || {
    rm -f "$record"
    return 1
  }
  restart_pid_owner_ok "$pid" || {
    rm -f "$record"
    return 1
  }
  live="$(restart_live_exe "$pid")" || {
    rm -f "$record"
    return 1
  }
  [[ -n "$live" ]] || {
    rm -f "$record"
    return 1
  }
  if [[ "$(restart_canonicalize "$live")" != "$(restart_canonicalize "$RESTART_RECORD_EXE")" ]]; then
    rm -f "$record"
    return 1
  fi
  return 0
}

restart_find_instance() {
  local record pids count

  RESTART_INSTANCE_SOURCE=""
  RESTART_INSTANCE_PID=""
  RESTART_INSTANCE_EXE=""
  RESTART_INSTANCE_CWD=""
  RESTART_INSTANCE_ARGS=()

  if record="$(docdeck_record_path)" && [[ -f "$record" ]]; then
    if restart_load_record "$record" && restart_validate_target "$record"; then
      RESTART_INSTANCE_SOURCE="record"
      RESTART_INSTANCE_PID="$RESTART_RECORD_PID"
      RESTART_INSTANCE_EXE="$RESTART_RECORD_EXE"
      RESTART_INSTANCE_CWD="$RESTART_RECORD_CWD"
      RESTART_INSTANCE_ARGS=("${RESTART_RECORD_ARGV[@]}")
      return 0
    fi
    rm -f "$record"
    return 1
  fi

  pids="$(pgrep -u "$(id -u)" -x docdeck 2>/dev/null)" || pids=""
  [[ -n "$pids" ]] || return 1

  count="$(printf '%s\n' "$pids" | wc -l | tr -d '[:space:]')"
  if [[ "$count" -gt 1 ]]; then
    RESTART_INSTANCE_SOURCE="ambiguous"
    return 2
  fi

  RESTART_INSTANCE_SOURCE="pgrep"
  RESTART_INSTANCE_PID="$pids"
  RESTART_INSTANCE_EXE="$(restart_live_exe "$pids")" || return 1
  RESTART_INSTANCE_CWD=""
  RESTART_INSTANCE_ARGS=()
  return 0
}

restart_prompt() {
  local question="$1" default="$2" answer
  printf '%s' "$question" >&2
  if ! IFS= read -r answer; then
    answer=""
  fi
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*) return 0 ;;
    [Nn]*) return 1 ;;
    *) [[ "$default" == "y" ]] ;;
  esac
}

restart_acquire_lock() {
  local directory lock owner

  directory="$(docdeck_record_dir)" || return 1
  if [[ ! -d "$directory" ]]; then
    mkdir -p "$directory" 2>/dev/null || return 1
    chmod 700 "$directory" 2>/dev/null || true
  fi

  lock="$directory/install-restart.lock"
  if mkdir "$lock" 2>/dev/null; then
    RESTART_LOCK_PATH="$lock"
    printf '%s\n' "$$" >"$lock/pid"
    return 0
  fi

  owner="$(tr -d '[:space:]' <"$lock/pid" 2>/dev/null)" || owner=""
  if [[ -n "$owner" ]] && restart_pid_alive "$owner"; then
    return 1
  fi

  rm -rf "$lock" 2>/dev/null || true
  if mkdir "$lock" 2>/dev/null; then
    RESTART_LOCK_PATH="$lock"
    printf '%s\n' "$$" >"$lock/pid"
    return 0
  fi
  return 1
}

restart_release_lock() {
  if [[ -n "${RESTART_LOCK_PATH:-}" ]]; then
    rm -rf "$RESTART_LOCK_PATH" 2>/dev/null || true
    RESTART_LOCK_PATH=""
  fi
}

restart_pid_exited() {
  local pid="$1" state
  if ! restart_pid_alive "$pid"; then
    return 0
  fi
  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  [[ "$state" == Z* ]]
}

restart_wait_for_exit() {
  local pid="$1" seconds="$2" elapsed=0
  while (( elapsed < seconds )); do
    restart_pid_exited "$pid" && return 0
    sleep 1
    elapsed=$((elapsed + 1))
  done
  restart_pid_exited "$pid"
}

restart_stop_instance() {
  local pid="$1" bin="$2"

  "$bin" --quit >/dev/null 2>&1 || true
  restart_wait_for_exit "$pid" "$RESTART_GRACE_SECONDS" && return 0

  kill -TERM "$pid" 2>/dev/null || true
  restart_wait_for_exit "$pid" "$RESTART_ESCALATION_SECONDS" && return 0
  return 1
}

restart_launch() {
  local bin="$1" cwd="$2" bare="${3:-1}"
  local -a command_line=("$bin")

  [[ -x "$bin" ]] || return 1
  [[ -d "$cwd" ]] || return 1

  if [[ "$bare" != "1" ]] && ((${#RESTART_INSTANCE_ARGS[@]} > 1)); then
    command_line+=("${RESTART_INSTANCE_ARGS[@]:1}")
  fi

  (
    cd "$cwd" || exit 1
    if command -v setsid >/dev/null 2>&1; then
      setsid "${command_line[@]}" >/dev/null 2>&1 </dev/null &
    else
      nohup "${command_line[@]}" >/dev/null 2>&1 </dev/null &
    fi
  ) || return 1
  return 0
}

restart_wait_for_new_record() {
  local old_pid="$1" seconds="$2" elapsed=0 record
  while (( elapsed < seconds )); do
    if record="$(docdeck_record_path)" && [[ -f "$record" ]] &&
      restart_load_record "$record" &&
      [[ "$RESTART_RECORD_PID" != "$old_pid" ]] &&
      restart_pid_alive "$RESTART_RECORD_PID"; then
      printf '%s' "$RESTART_RECORD_PID"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

restart_after_install() {
  local bin="${1:-}" found class consent=0 source="" bare=1 recoverable=0
  local pid record cwd new_pid

  [[ -n "$bin" ]] || return 1

  if [[ "$RESTART_CHOICE" == "decline" ]]; then
    restart_msg "$RESTART_MSG_DECLINED"
    return 0
  fi

  restart_find_instance
  found=$?
  if ((found == 2)); then
    restart_msg "$RESTART_MSG_AMBIGUOUS"
    return 0
  elif ((found != 0)); then
    restart_msg "$RESTART_MSG_NONE"
    return 0
  fi

  class="$(restart_classify "$RESTART_INSTANCE_EXE" "$bin")"

  if [[ "$class" != "installed" ]]; then
    if [[ ! -t 0 ]]; then
      restart_msg "$(printf "$RESTART_MSG_DEV" "$RESTART_INSTANCE_EXE" "$bin")"
      return 0
    fi
    if restart_prompt "The running docdeck is $RESTART_INSTANCE_EXE, not the installed $bin. Replace it with the installed build? [y/N] " n; then
      consent=1
      source="prompt"
    else
      restart_msg "$(printf "$RESTART_MSG_DEV" "$RESTART_INSTANCE_EXE" "$bin")"
      return 0
    fi
  else
    case "$RESTART_CHOICE" in
      restart)
        consent=1
        source="explicit-restart"
        ;;
      *)
        if [[ "$RESTART_NO_INTERACTION" == "1" || ! -t 0 ]]; then
          restart_msg "$RESTART_MSG_NONINTERACTIVE"
          return 0
        fi
        if restart_prompt "Restart the running docdeck instance (pid $RESTART_INSTANCE_PID) now? [Y/n] " y; then
          consent=1
          source="prompt"
        else
          restart_msg "$RESTART_MSG_DECLINED"
          return 0
        fi
        ;;
    esac
  fi

  ((consent == 1)) || return 0

  if [[ "$RESTART_INSTANCE_SOURCE" == "record" && -d "$RESTART_INSTANCE_CWD" && ${#RESTART_INSTANCE_ARGS[@]} -gt 0 ]]; then
    recoverable=1
  fi

  if ((recoverable == 0)); then
    if [[ -t 0 ]]; then
      if ! restart_prompt "The original launch arguments could not be recovered. Start docdeck without them? [y/N] " n; then
        restart_msg "$RESTART_MSG_DECLINED"
        return 0
      fi
      bare=1
    elif [[ "$source" == "explicit-restart" ]]; then
      bare=1
    else
      restart_msg "$RESTART_MSG_DECLINED"
      return 0
    fi
  else
    bare=0
  fi

  if ! restart_acquire_lock; then
    restart_msg "$RESTART_MSG_LOCKED"
    return 0
  fi
  trap 'restart_release_lock' EXIT INT TERM

  pid="$RESTART_INSTANCE_PID"
  if ! restart_stop_instance "$pid" "$bin"; then
    restart_msg "$(printf "$RESTART_MSG_STOP_FAILED" "$pid")"
    restart_release_lock
    trap - EXIT INT TERM
    return 1
  fi

  if record="$(docdeck_record_path)" && [[ -f "$record" ]]; then
    if restart_load_record "$record" && [[ "$RESTART_RECORD_PID" == "$pid" ]]; then
      rm -f "$record"
    fi
  fi

  if ((recoverable == 1)); then
    cwd="$RESTART_INSTANCE_CWD"
  else
    cwd="${HOME:-/}"
  fi

  if ! restart_launch "$bin" "$cwd" "$bare"; then
    restart_msg "$(printf "$RESTART_MSG_LAUNCH_FAILED" "$bin")"
    restart_release_lock
    trap - EXIT INT TERM
    return 1
  fi

  new_pid="$(restart_wait_for_new_record "$pid" "$RESTART_GRACE_SECONDS")" || new_pid=""
  if [[ -n "$new_pid" ]]; then
    if ((bare == 1)); then
      restart_msg "$(printf "$RESTART_MSG_RESTARTED_BARE" "$new_pid" "$bin")"
    else
      restart_msg "$(printf "$RESTART_MSG_RESTARTED" "$new_pid" "$bin")"
    fi
  else
    restart_msg "$(printf "$RESTART_MSG_NOT_CONFIRMED" "$bin")"
  fi

  restart_release_lock
  trap - EXIT INT TERM
  return 0
}

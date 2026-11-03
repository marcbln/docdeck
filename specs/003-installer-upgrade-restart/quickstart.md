# Quickstart: Installer Upgrade Restart

**Feature**: `003-installer-upgrade-restart` | **Date**: 2026-11-03

Validation guide for the feature. Run after `/speckit.implement`, or phase by
phase. The record contract is in
[`contracts/instance-record.md`](./contracts/instance-record.md), the interface
in [`contracts/cli.md`](./contracts/cli.md), and the state machine in
[`contracts/restart-flow.md`](./contracts/restart-flow.md).

## Prerequisites

```bash
cd /home/marc/devel/docdeck
npm install
```

Linux needs the Tauri/WebKitGTK packages listed in `README.md`; macOS needs the
standard Tauri prerequisites. The shell installer is Unix-only by design.

Use a scratch prefix and a scratch runtime directory so the real install is not
touched:

```bash
export PREFIX=/tmp/docdeck-restart/bin
export XDG_RUNTIME_DIR=/tmp/docdeck-restart/run
mkdir -p "$PREFIX" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
```

## Automated checks

```bash
npm run typecheck
npm run test:web          # Vitest: no webview regression
npm test                  # cargo test + Vitest
npm run lint:rs           # cargo clippy --all-targets -- -D warnings
npm run test:install      # Bash restart decision/record/stop suite (Unix)
```

Expected:

- Rust tests cover record path resolution, JSON round-trip and rejection,
  atomic write, `0700`/`0600` modes, matching-pid cleanup, and control-flag
  classification; `--quit` never appears in `classify_args`.
- The Bash suite covers record parsing, stale/foreign/mismatched pid rejection,
  the full decision table, prompt defaults, stop escalation against a real
  `sleep` child, and launch argument construction.
- Typecheck, Vitest, and clippy remain clean.

Governance check before acceptance:

```bash
grep -n "runtime instance record\|instance.json" .specify/memory/constitution.md
```

The Persistence bullet must mention the record, its path, its `0600`/`0700`
modes, its metadata-only content, and clean-exit removal (G8).

## Manual verification

Run these against an installed build, not `tauri dev`, unless a scenario says
otherwise.

Build and install once, then start an instance with explicit targets:

```bash
mkdir -p /tmp/docdeck-restart/project/_ai
printf '# One\n' > /tmp/docdeck-restart/project/one.md
printf '# Two\n' > /tmp/docdeck-restart/project/two.md

(cd /tmp/docdeck-restart/project && \
  "$PREFIX/docdeck" one.md ./_ai >/dev/null 2>&1 &)
sleep 2
cat "${XDG_RUNTIME_DIR:-$HOME/.local/state}/docdeck/instance.json"
```

Confirm the record has `pid`, `exe`, `argv` (`one.md`, `./_ai`), `cwd`
(`/tmp/docdeck-restart/project`), `startedAt`, and mode `0600` (`stat -c %a` on
Linux, `stat -f %Lp` on macOS). Directory mode must be `0700`.

### 1. Upgrade with restart (P1, SC-001, SC-002)

1. Leave the instance from the setup running.
2. Change something visible in the build (or just rebuild) and run
   `./scripts/install.sh --prefix "$PREFIX"`.
3. Accept the restart prompt (or run `--restart`).
4. Confirm:
   - the installer prints `Restarted docdeck (pid N) ...`;
   - the old pid is gone and exactly one `docdeck` process is running the
     installed entry point;
   - the new window shows `one.md` and the `_ai` folder watch;
   - `docdeck two.md` from another shell reaches the new window, not a stale one;
   - the whole restart completed in under 10 seconds after consent.
5. Confirm watched documents, `config.toml`, and preferences were not modified.

### 2. Decline and non-interactive (P2)

1. Run the installer while the instance is running; answer `n`.
   Confirm the pid is unchanged and the message tells the user to quit and
   relaunch.
2. Run `./scripts/install.sh --prefix "$PREFIX" < /dev/null`.
   Confirm no prompt, the pid is unchanged, and the manual-restart message is
   printed.
3. Run `./scripts/install.sh --prefix "$PREFIX" --restart < /dev/null`.
   Confirm it restarts without a prompt.
4. Run `./scripts/install.sh --prefix "$PREFIX" --no-restart` while running.
   Confirm no signal is sent and the running instance survives.
5. Run `./scripts/install.sh --prefix "$PREFIX" -n` while running.
   Confirm no prompt and the manual-restart message.

### 3. `--quit` control channel (FR-011, FR-018)

1. With an instance running, run `"$PREFIX/docdeck" --quit` and confirm it exits
   without opening a window; the old record is removed.
2. With no instance running, run it again. Confirm exit 0, no window, and
   `docdeck is not running` on stderr.
3. With an instance running, run `"$PREFIX/docdeck" --quit one.md`. Confirm it
   quits and does not open `one.md` in a new tab first.
4. Delete the record while the app is running, then run `--quit`. Confirm the
   documented limitation: it reports "not running"; the installer's `pgrep`
   fallback is the recovery path.

### 4. Safety cases (P3)

**Stale record** — copy the record, stop the app, put the record back with the
dead pid, then install. Confirm the installer treats it as no instance, removes
the record, signals nothing, and says the new build applies on next launch.

**Unrelated pid** — write a record whose pid belongs to a long-running process
you own (e.g. a `sleep`), with a different recorded `exe`, then install. Confirm
the installer removes the stale record, does not signal that pid, and reports no
instance.

**Other user's process** — if a second user account is available, record that
user's pid. Confirm the installer ignores it (owner check) and signals nothing.

**Development instance** — start `npm run tauri dev`, then run the installer.
Confirm it names the dev executable and the installed entry point and requires an
interactive confirmation; `--restart` without a TTY must skip with the warning,
not kill the dev process.

**Unresponsive instance** — start the app, `kill -STOP "$pid"`, then install and
accept. Confirm the installer waits 5 s, sends `SIGTERM`, waits 5 s, prints the
failure, leaves the old process running (resume it with `kill -CONT`), starts no
new instance, and exits non-zero.

**Relative paths** — start the app from `/tmp/docdeck-restart/project` with
`one.md` and `./_ai`, restart via the installer, and confirm both still resolve
relative to that directory (not the repository or installer directory).

**Symlink install** — `./scripts/install.sh --symlink --prefix "$PREFIX"`, start
the app, rebuild/install again, accept, and confirm the restarted process uses
the installed symlink (a later rebuild is picked up on the next restart).

**Unrecoverable arguments** — remove `argv`/`cwd` from a copy of the record (or
use the `pgrep` fallback) while the app runs:
- interactive + consent: confirm the second "start without arguments?" prompt;
- `--restart` non-interactive: confirm it starts bare and says so;
- no explicit flag: confirm it does not stop the old instance.

**Concurrent installs** — start two installer runs at nearly the same time.
Confirm at most one owns the restart; the other prints the lock message, installs
its binary, and does not signal the instance.

### 5. Failed build / install (FR-002)

Make the build fail (`PATH` without `cargo`, or introduce a temporary compile
error) while the app is running. Confirm the installer exits before detection,
the instance keeps running untouched, and no restart prompt appears.

## Pass criteria

- All automated checks are green.
- Every P1/P2/P3 scenario above produces the documented message.
- No scenario leaves two `docdeck` processes or stops the old instance before the
  build and install both succeed.
- Watched documents, `config.toml`, and preferences are byte-identical before and
  after a restart (SC-005).

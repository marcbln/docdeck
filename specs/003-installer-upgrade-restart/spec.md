# Feature Specification: Installer Upgrade Restart

**Feature Branch**: `003-installer-upgrade-restart`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "The installer should detect running instances and restart (after confirmation). A successful install must never leave the user running the previous build, and open documents should come back the way the app was launched."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upgrade a running app without a manual relaunch (Priority: P1)

A user runs the installer while docdeck is open in the background. The build and
install complete, then the installer notices the running instance and asks
whether to restart it. The user accepts. The old instance shuts down cleanly and
the newly installed build starts, reopened on the same documents or folder it
was launched with. The user never has to quit and relaunch by hand, and never
ends up talking to the previous build by accident.

**Why this priority**: The current behavior is actively wrong, not merely
inconvenient. After an install, launching `docdeck some-file.md` is forwarded
into the still-running old process, so the new build is never used and the
request silently lands in stale code. This story removes that trap.

**Independent Test**: Start an instance with an explicit document and folder,
run the installer, accept the restart prompt, and confirm the window returns
showing the same launch targets while running the new build.

**Acceptance Scenarios**:

1. **Given** a docdeck instance is running and the build succeeds, **When** the
   install finishes and the user accepts the restart, **Then** the old instance
   exits and a new instance of the installed build starts with the original
   launch arguments and working directory.
2. **Given** the same situation, **When** the restart completes, **Then** no
   second instance is left running alongside the old one at any point.
3. **Given** the app was launched with no arguments, **When** it is restarted,
   **Then** the new instance opens in the same default state a manual relaunch
   would produce.

---

### User Story 2 - Decline, or install non-interactively (Priority: P2)

A user does not want their open window closed, or runs the installer from a
script with no terminal attached. The installer respects that: it never stops
the app without consent, and it always leaves a clear statement that the new
build only takes effect after a manual restart.

**Why this priority**: Restarting closes documents the user opened from inside
the app, because open tabs are session-scoped. Consent and a truthful message
are required for the installer to remain predictable.

**Independent Test**: Run the installer with a running instance and (a) decline
the prompt, and (b) pipe input so no terminal is attached. In both cases the
instance keeps running and the message names the manual restart as the remaining
step.

**Acceptance Scenarios**:

1. **Given** an instance is running, **When** the user declines the restart,
   **Then** the instance keeps running untouched and the installer reports that
   a restart is required to use the new build.
2. **Given** no interactive terminal is attached, **When** the install finishes,
   **Then** the installer does not block on a prompt and prints the same manual
   restart guidance.
3. **Given** the user explicitly requests a restart, **When** no interactive
   terminal is attached, **Then** the restart proceeds without prompting.
4. **Given** the user explicitly requests no restart, **When** the install
   finishes, **Then** the running instance is never signalled.

---

### User Story 3 - Refuse to restart the wrong or an unresponsive process (Priority: P3)

The running process is a development build, is identified by a stale record from
a crash, or ignores the request to quit. The installer does not guess: it names
what it found, asks before converting a development instance into an installed
one, and aborts the relaunch rather than risking two competing instances.

**Why this priority**: Automatic process control is only acceptable if it fails
safely. These cases are rare but they are exactly where a naive
find-and-kill implementation destroys trust.

**Independent Test**: Simulate a development instance, a stale instance record
with no live process, and an instance that does not exit within the grace
period. Verify the installer's message and that no relaunch happens in the last
case.

**Acceptance Scenarios**:

1. **Given** the detected instance is a development build rather than the
   installed one, **When** the install finishes, **Then** the installer names
   both executables and asks before replacing the development instance.
2. **Given** a recorded instance no longer exists, **When** the installer looks
   for a running instance, **Then** it treats this as "nothing running", clears
   the record, and does not signal any process.
3. **Given** the running instance does not exit within the grace period,
   **When** the installer has escalated once, **Then** it reports the failure,
   leaves the old instance running, and starts no new instance.
4. **Given** the process belongs to another user, **When** the installer looks
   for a running instance, **Then** that process is not considered a target.

---

### Edge Cases

- The build or the install step fails: nothing is stopped, and the old instance
  keeps serving the previous build.
- The app crashed earlier and left an instance record behind: the record is
  validated against a live process before it is trusted, then cleared.
- The process id recorded earlier now belongs to an unrelated process: it is not
  signalled.
- The instance was started with relative paths: they are relaunched relative to
  the original working directory, not the installer's directory.
- The user passes `--restart` but the original launch arguments cannot be
  recovered: the installer states that it is starting bare rather than quietly
  dropping them.
- The install was a symlink install: the restarted instance uses the installed
  entry point, so a later rebuild is picked up the same way.
- Two installs are run concurrently: at most one may own the restart of the
  instance.
- The user declines and later quits the app themselves: the next launch uses the
  new build with no further action from the installer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The installer MUST determine whether an instance of the installed
  app is running only after the build and install have both succeeded.
- **FR-002**: The installer MUST NOT stop, signal, or restart any process when
  the build or install step fails.
- **FR-003**: When a running instance is found, the installer MUST ask whether to
  restart it, defaulting to yes, before taking any action against the process.
- **FR-004**: When the user declines, the installer MUST leave the instance
  untouched and report that a manual restart is required to use the new build.
- **FR-005**: When no interactive terminal is attached and no explicit choice was
  given, the installer MUST skip the prompt and print the manual restart
  guidance instead of blocking or assuming consent.
- **FR-006**: Users MUST be able to force or forbid the restart explicitly,
  independent of whether a terminal is attached.
- **FR-007**: On consent, the installer MUST first request a graceful shutdown
  and only escalate to a forceful stop after a bounded grace period.
- **FR-008**: The installer MUST confirm the old instance has exited before
  starting the new one, and MUST NOT start a new instance while the old one is
  still alive.
- **FR-009**: A restarted instance MUST be started from the installed entry point
  with the original launch arguments and original working directory.
- **FR-010**: When the original launch arguments cannot be recovered, the
  installer MUST NOT silently start a bare instance; it MUST report the loss and
  either skip or, when the restart was explicitly forced, start bare while
  saying so.
- **FR-011**: The app MUST expose a user-invocable way to request shutdown of a
  running instance that exits without opening a window when no instance is
  running.
- **FR-012**: The app MUST record enough information about its running instance
  for the installer to identify it, recover launch arguments and working
  directory, and verify that the recorded process is the expected executable.
- **FR-013**: The instance record MUST be removed on a clean exit, and stale or
  mismatched records MUST be rejected without signalling the referenced process.
- **FR-014**: The installer MUST distinguish a development instance from the
  installed build and MUST ask before replacing a development instance.
- **FR-015**: The installer MUST only consider processes owned by the current
  user as restart targets.
- **FR-016**: The instance record MUST be private to the current user and MUST
  contain no document content, only process and location metadata.
- **FR-017**: The restart capability MUST NOT modify watched documents, the watch
  configuration, or persisted preferences.
- **FR-018**: A shutdown control request MUST NOT be treated as a document or
  folder to open.
- **FR-019**: The installer MUST print an explicit, actionable message for every
  outcome: no instance found, restarted, declined, skipped non-interactively,
  or failed to stop.

### Key Entities

- **Running instance record**: identifies one live app process per user. Holds
  the process identifier, the executable it was started from, the original
  launch arguments, the working directory, and when it started. Valid only while
  its process is alive and matches the recorded executable.
- **Install target**: the entry point the installer wrote, plus whether it is a
  copy or a link to a build output. Used to decide whether a detected instance
  is the installed build, a development build, or unrelated.
- **Restart decision**: the resolved answer (restart, do not restart, or ask) and
  where it came from (prompt answer, explicit option, or non-interactive
  default).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a successful install where the user accepts the restart, an
  upgraded instance is running the new build with its original launch targets in
  under 10 seconds, with no manual quit or relaunch.
- **SC-002**: Following a successful install, there are zero cases where starting
  the installed app silently hands the request to a process running the previous
  build.
- **SC-003**: 100% of declines and non-interactive installs leave the running
  instance alive and print a manual-restart instruction.
- **SC-004**: 100% of failed or aborted stops leave exactly the original instance
  running, never two instances.
- **SC-005**: Restarting an instance does not change any watched document, the
  watch configuration, or persisted preferences.
- **SC-006**: Every install outcome produces one clear message stating what
  happened and what the user should do next.
- **SC-007**: The restart prompt appears only after the build completes, so an
  unattended build is never blocked on user input.

## Assumptions

- The shell installer is the supported upgrade path for this feature; packaged
  bundles and in-app updating are out of scope.
- One app instance per user session is the norm, guaranteed by the app's existing
  single-instance behavior.
- The installer and the app run as the same user, so the installer may signal the
  app's process.
- Persisted configuration, watches, and preferences survive a restart; documents
  opened from inside the app are session-scoped and are not restored (consistent
  with the current documented behavior).
- The restart flow may read and write one additional per-user runtime record;
  this is an accepted, documented widening of what docdeck writes.
- Development builds and installed builds are distinguishable by their
  executable location.
- An instance that ignores a graceful shutdown followed by one escalation is
  treated as not restartable rather than force-killed repeatedly.

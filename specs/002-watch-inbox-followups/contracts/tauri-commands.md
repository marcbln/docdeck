# Contract: Tauri Commands and Events

**Feature**: `002-watch-inbox-followups` | **Date**: 2026-11-01

The webview reaches the backend only through these typed commands and named
events. Every command validates its arguments; every error is a typed payload,
not a bare string.

## Existing commands (extended)

### `load_watches` → `WatchLoad`

Unchanged startup contract, extended with reload metadata:

```ts
interface WatchLoad {
  configPath: string;
  configFound: boolean;
  roots: string[];
  entries: InboxEntryPayload[];   // origin: "config"
  warnings: string[];
  error: string | null;           // set => no watches registered
  truncated: boolean;
  revision: string;               // hash of the bytes that produced this plan
  generation: number;
  at: number;                     // epoch ms
}
```

- Runs off the main thread and streams `scan-progress`.
- The first successful result seeds the acknowledgement baseline in the webview.

### `add_watch(paths: string[])` → `WatchAdded`

Unchanged shape; entries carry `origin: "session"`. Registers session roots that
survive later config reloads.

### `load_file(pathStr)` / `close_file(pathStr)`

Unchanged. `load_file` also seeds the backend file-identity cache for rename
tracking.

## New commands

### `read_watch_config` → `WatchConfigView`

```ts
interface WatchConfigView {
  path: string;
  found: boolean;
  revision: string;
  watch: string[];
  exclude: string[];
  error: string | null;   // parse/read error, if any
}
```

- Read-only.
- Returns `found: false` with empty arrays on first run.
- If the file exists but cannot be parsed, `error` carries the precise parse
  message and `watch`/`exclude` are empty. The surface then disables structural
  save and offers to open the file in the OS editor; it never overwrites an
  unparseable hand-written file without an explicit destructive confirmation.
- Does not modify anything.

### `save_watch_config` → `ReloadResult`

```ts
interface SaveWatchConfigArgs {
  watch: string[];
  exclude: string[];
  expectedRevision: string;   // revision returned by read/load/reload
  createFromExample?: boolean; // only when found=false was reported
}
```

Result union:

```ts
type SaveOutcome =
  | { status: "applied"; reload: ReloadResult }
  | { status: "conflict"; current: WatchConfigView }
  | { status: "invalid"; errors: FieldError[]; warnings: string[] }
  | { status: "ioError"; message: string; notWritable: boolean };
```

Rules:

- `expectedRevision` mismatch → `conflict`; nothing is written.
- Malformed TOML or an invalid selector → `invalid`; nothing is written.
- Writes only `config.toml`, atomically, preserving comments/formatting/unknown
  keys; then runs the same reconciliation as the file watcher.
- Duplicates are folded and reported; nonexistent selectors are warnings.
- On any failure the previous file and watches remain active.

### `reload_watch_config` → `ReloadResult`

Forces one read/expand/reconcile pass (used by the conflict banner's
"Reload from disk" action and by retry after a non-writable failure). If the
revision equals the currently applied revision, expansion is skipped and only
the status/last-reload metadata is refreshed.

## Events

### `paths-changed` (extended)

```ts
type PathChangeKind = "created" | "modified" | "deleted" | "renamed" | "movedOut";

interface PathChange {
  kind: PathChangeKind;
  path: string;
  fromPath?: string;          // present for "renamed"
  exists: boolean;
  modifiedTime?: number;
}
```

Batch semantics:

- `renamed` is one event: `path` is the new path, `fromPath` the old path.
- `movedOut` means the document left every watched location; remove its browse
  row and show the unavailable state in any open tab.
- `deleted` keeps the existing struck-through row behavior.
- `created` adds an unread row without opening a tab.
- The tray notification body uses `path` and ignores the new fields.

### `config-reloaded`

```ts
interface ReloadResult {
  generation: number;
  at: number;
  path: string;
  found: boolean;
  revision: string;
  watch: string[];
  exclude: string[];
  roots: string[];
  entries: InboxEntryPayload[]; // origin: "config" | "session"
  warnings: string[];
  error: string | null;
  truncated: boolean;
}
```

- Only the newest generation is applied.
- `error` non-null → keep the previous inventory, roots, and open documents;
  show the error and a recovery action.
- `found=false` → keep previous watches and show the setup hint with the
  platform path.
- Successful result → origin-aware reconciliation in the webview (see
  `data-model.md`).

### `scan-progress` (unchanged)

Still streamed during startup, session-folder scans, and reload scans.

## Error handling contract

- Commands return `Result<T, CommandError>` where
  `CommandError = { code: "invalid" | "conflict" | "io" | "notWritable" | "internal"; message: string; details?: unknown }`.
- The webview maps `conflict` to the conflict banner, `invalid` to per-field
  errors, `notWritable` to a retry message, and `internal` to a toast/console
  error.
- No command exposes raw filesystem handles, and no command writes a watched
  document.

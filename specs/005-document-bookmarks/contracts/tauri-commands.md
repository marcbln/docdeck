# Contract: Bookmark Notification Filter (Tauri command)

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

One new Tauri command connects the webview-owned bookmark set to the existing
Rust tray notification path. It carries metadata only and changes no file,
permission or watcher behavior. OS notification delivery, mode, focus and
throttling stay in Rust.

## Command

```text
set_bookmark_notification_filter
```

### Request

```ts
interface NotificationBookmarkFilter {
  enabled: boolean;
  paths: string[];
}

invoke("set_bookmark_notification_filter", {
  filter: { enabled, paths },
});
```

`paths` is the sorted, deduplicated union of:

- every document bookmark's path; and
- every section bookmark's path, including section-only bookmarks (FR-025).

Unavailable paths are included; they simply do not match a live change. Paths
are the canonical absolute strings used by tabs and the inventory.

### Success response

`null` / `()` — the in-memory filter was replaced atomically.

### Error response

`CommandError` (the existing typed shape):

```json
{ "code": "invalid", "message": "bookmark path must be absolute: …" }
```

| Code | Cause |
|------|-------|
| `invalid` | More than 10,000 paths; an empty value; a NUL byte; more than 4096 bytes; a non-absolute path |
| `internal` | The filter mutex is poisoned (previous filter unchanged) |

On error the previous filter is retained. The webview logs the failure and, when
the setting is enabled, shows an error toast. The next successful sync replaces
the filter.

## Validation (Rust re-validates the untrusted webview)

- `enabled` is a boolean by type.
- `paths.len() <= 10_000`.
- Per path:
  - non-empty;
  - byte length `<= 4096`;
  - no `\0`;
  - `Path::new(path).is_absolute()`.
- Duplicates are collapsed (a `HashSet` backs the filter).
- No canonicalization, filesystem access, content read or existence check occurs
  in this command.

## State

```rust
pub struct BookmarkFilterState {
    inner: Mutex<NotificationBookmarkFilter>,
}

pub struct NotificationBookmarkFilter {
    enabled: bool,
    paths: HashSet<String>,
}
```

- Default: `{ enabled: false, paths: {} }`.
- Registered with `app.manage(...)` in `lib.rs`; the command and `tray.rs` read
  the same state.
- **In memory only.** Rust does not persist it. The webview is the source of
  truth and re-sends it on every launch.

## Tray integration

`tray.rs` already receives each settled batch through the `paths-changed` event.
The only change is the candidate set before notifying:

```text
if !filter.enabled:
    candidates = changes
else:
    candidates = changes where
        filter.paths.contains(change.path)
        or (change.from_path is Some and filter.paths.contains(from_path))

update presence dot from the full `changes` batch   # unchanged, FR-026
if candidates is empty: return                       # no popup, no throttle use
if !should_notify(mode, focused, throttle, last, now): return  # unchanged
title/body = compose(candidates)                     # only qualifying changes
show notification; record last_notification on success
```

### Semantics

| Condition | Presence dot | Desktop popup |
|-----------|--------------|---------------|
| Filter disabled | All changes, unchanged | All changes, unchanged |
| Filter enabled, no matching changes | Updated from all changes | None |
| Filter enabled, matching changes | Updated from all changes | Matching changes only, under the existing mode/focus/throttle |
| Filter enabled, empty path set | Updated from all changes | None |
| Tray notify mode `off` | Updated | None |
| Window focused + `unfocused` mode | Updated | None |

- The title count and body list only candidates (`FR-026`).
- A notification batch that is filtered to empty must not consume the throttle
  window; otherwise a later bookmarked change could be delayed by an
  unbookmarked burst.
- Rename matching checks both `change.path` (new) and `change.from_path` (old),
  so a rename into or out of a bookmarked path still notifies.
- Deletions of bookmarked documents are candidates (the existing body renders
  `watched files were removed` when none exist).
- Duplicate candidates are not created; the input order is preserved.

## Webview sync timing

The webview sends the filter:

1. once at startup before the first inventory load;
2. after every bookmark add/remove/undo;
3. after a bookmark rename/re-key;
4. when `bookmarkNotificationsOnly` changes.

The sync call is fire-and-forget. A failure never blocks a bookmark action or
document render.

There is a short startup window between the Rust tray being created and the first
webview sync; until then the filter is disabled (existing unfiltered behavior).
This is documented rather than hidden.

## Non-goals and invariants

- No new Tauri capability or permission: custom commands do not require one.
- No reading, statting, writing or deleting any path.
- No bookmark collection, heading text, anchor or unread state reaches Rust.
- No persistence in Rust and no second source of truth.
- Watched documents remain read-only.
- The tray menu remains the owner of `off` / `unfocused` / `always`; the
  bookmark filter only narrows candidates.

## Tests

**Rust** (`src-tauri/src/bookmark_filter_test.rs`)
- Validation accepts absolute paths, dedupes, and rejects empty/NUL/oversized/
  relative paths and an over-limit count.
- Disabled filter passes the full batch unchanged.
- Enabled filter with an empty set yields no candidates.
- Mixed batch yields only bookmarked paths, in input order.
- Rename matches both source and target paths.
- Invalid input leaves the previous filter unchanged.
- The existing `should_notify`, `notification_body`, presence and title tests
  remain green.

**Webview**
- Controller sends `{ enabled, paths }` on startup, add/remove/undo, rename and
  preference change.
- Path set includes section-only documents and is sorted/deduplicated.
- A rejected sync is logged/toasted and does not break the bookmark action.

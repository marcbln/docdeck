//! Last-seen document snapshots for the change-summary agent.
//!
//! docdeck's inventory is metadata-only, so a write that happens before a
//! document was ever opened has no baseline. The store keeps the two most
//! recent versions of every document the watcher touched (and every document
//! `load_file` read), which is enough for a real diff in the common case and
//! falls back to current content otherwise.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::watcher::{PathChange, PathChangeKind};

/// Documents retained at once. Older entries are evicted first.
pub const MAX_DOCUMENTS: usize = 64;
/// Characters kept per document version (~512 KiB of UTF-8 for ASCII text).
pub const MAX_CONTENT_CHARS: usize = 262_144;
/// Files above this size are not read at all.
pub const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
/// Characters returned by one diff.
pub const MAX_DIFF_CHARS: usize = 16_000;
const TRUNCATED_MARKER: &str = "\n… [truncated]";

/// One document's last two observed versions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocSnapshot {
    pub previous: Option<String>,
    pub current: Option<String>,
    pub modified_time: Option<u64>,
}

impl DocSnapshot {
    fn empty(modified_time: Option<u64>) -> Self {
        Self {
            previous: None,
            current: None,
            modified_time,
        }
    }
}

#[derive(Default)]
struct Inner {
    documents: HashMap<PathBuf, DocSnapshot>,
    order: VecDeque<PathBuf>,
}

/// Session-scoped snapshot cache. Cheap to share behind an `Arc`.
#[derive(Default)]
pub struct SummaryStore {
    inner: Mutex<Inner>,
}

impl SummaryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records content docdeck just read, so a later write has a baseline.
    pub fn capture(&self, path: &Path, content: &str) {
        self.capture_with_mtime(path, content, crate::paths::modified_millis(path));
    }

    fn capture_with_mtime(&self, path: &Path, content: &str, modified_time: Option<u64>) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };

        let capped = cap_content(content);
        let entry = inner
            .documents
            .entry(path.to_path_buf())
            .or_insert_with(|| DocSnapshot::empty(modified_time));

        if entry.current.as_deref() != Some(capped.as_str()) {
            entry.previous = entry.current.take();
            entry.current = Some(capped);
        }
        entry.modified_time = modified_time;

        inner.order.retain(|candidate| candidate != path);
        inner.order.push_back(path.to_path_buf());
        while inner.order.len() > MAX_DOCUMENTS {
            if let Some(oldest) = inner.order.pop_front() {
                inner.documents.remove(&oldest);
            }
        }
    }

    /// Reads and records the current contents of one path.
    pub fn observe_path(&self, path: &Path) {
        if let Some(content) = read_capped(path) {
            self.capture(path, &content);
        }
    }

    /// Applies a settled watcher batch to the cache.
    pub fn observe_changes(&self, changes: &[PathChange]) {
        for change in changes {
            match change.kind {
                PathChangeKind::Created | PathChangeKind::Modified => {
                    self.observe_path(Path::new(&change.path));
                }
                PathChangeKind::Renamed => {
                    if let Some(from) = &change.from_path {
                        self.rename(Path::new(from), Path::new(&change.path));
                    }
                    self.observe_path(Path::new(&change.path));
                }
                PathChangeKind::Deleted | PathChangeKind::MovedOut => {}
            }
        }
    }

    /// Re-keys a snapshot after a rename or move.
    pub fn rename(&self, from: &Path, to: &Path) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        let Some(mut snapshot) = inner.documents.remove(from) else {
            return;
        };
        snapshot.modified_time = crate::paths::modified_millis(to);
        inner.documents.insert(to.to_path_buf(), snapshot);
        inner
            .order
            .retain(|candidate| candidate != from && candidate != to);
        inner.order.push_back(to.to_path_buf());
    }

    pub fn snapshot(&self, path: &Path) -> Option<DocSnapshot> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.documents.get(path).cloned())
    }

    /// True when the path was observed in this session and may be summarized.
    pub fn allows(&self, path: &Path) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.documents.contains_key(path))
            .unwrap_or(false)
    }

    /// Unified old→new diff, or `None` when the document has no baseline yet.
    pub fn diff(&self, path: &Path) -> Option<String> {
        let snapshot = self.snapshot(path)?;
        let previous = snapshot.previous?;
        let current = snapshot.current?;

        let diff = similar::TextDiff::from_lines(&previous, &current)
            .unified_diff()
            .context_radius(3)
            .header("before", "after")
            .to_string();
        if diff.trim().is_empty() {
            return Some("(no textual change)".to_string());
        }
        Some(cap_text(&diff, MAX_DIFF_CHARS))
    }

    /// Current content, read from disk when the cache has none.
    pub fn current(&self, path: &Path) -> Option<String> {
        match self.snapshot(path) {
            Some(DocSnapshot {
                current: Some(current),
                ..
            }) => Some(current),
            _ => read_capped(path),
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| inner.documents.len())
            .unwrap_or(0)
    }
}

/// Reads a text file, capped for the snapshot cache.
pub fn read_capped(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_READ_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(cap_content(&text))
}

fn cap_content(content: &str) -> String {
    cap_text(content, MAX_CONTENT_CHARS)
}

fn cap_text(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        return content.to_string();
    }
    let mut capped: String = content.chars().take(max_chars).collect();
    capped.push_str(TRUNCATED_MARKER);
    capped
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn change(kind: PathChangeKind, path: &Path) -> PathChange {
        PathChange {
            kind,
            path: path.to_string_lossy().into_owned(),
            from_path: None,
            exists: true,
            modified_time: None,
        }
    }

    fn write(path: &Path, text: &str) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn first_capture_has_no_baseline_and_second_has_a_diff() {
        let store = SummaryStore::new();
        let path = Path::new("/tmp/docdeck-store-imaginary.md");

        store.capture(path, "one\ntwo\n");
        assert_eq!(store.snapshot(path).unwrap().previous, None);
        assert_eq!(store.diff(path), None);

        store.capture(path, "one\nthree\n");
        let diff = store.diff(path).unwrap();
        assert!(diff.contains("-two"));
        assert!(diff.contains("+three"));
    }

    #[test]
    fn capture_never_moves_the_baseline_without_a_change() {
        let store = SummaryStore::new();
        let path = Path::new("/tmp/docdeck-same.md");
        store.capture(path, "same");
        store.capture(path, "same");
        assert_eq!(store.snapshot(path).unwrap().previous, None);
    }

    #[test]
    fn observes_disk_changes_and_renames() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.md");
        write(&path, "a\n");
        let store = SummaryStore::new();
        store.observe_path(&path);

        write(&path, "b\n");
        store.observe_changes(&[change(PathChangeKind::Modified, &path)]);
        assert!(store.diff(&path).unwrap().contains("+b"));
        assert!(store.allows(&path));

        let moved = dir.path().join("moved.md");
        fs::rename(&path, &moved).unwrap();
        let mut rename = change(PathChangeKind::Renamed, &moved);
        rename.from_path = Some(path.to_string_lossy().into_owned());
        store.observe_changes(&[rename]);

        assert!(!store.allows(&path));
        assert_eq!(store.current(&moved).as_deref(), Some("b\n"));
    }

    #[test]
    fn caps_large_content() {
        let store = SummaryStore::new();
        let path = Path::new("/tmp/docdeck-large.md");
        let huge = "x".repeat(MAX_CONTENT_CHARS + 10);
        store.capture(path, &huge);
        assert!(store
            .snapshot(path)
            .unwrap()
            .current
            .unwrap()
            .ends_with(TRUNCATED_MARKER));
    }

    #[test]
    fn evicts_the_oldest_document() {
        let store = SummaryStore::new();
        for index in 0..=MAX_DOCUMENTS {
            store.capture(Path::new(&format!("/tmp/docdeck-{index}.md")), "x");
        }
        assert_eq!(store.len(), MAX_DOCUMENTS);
        assert!(!store.allows(Path::new("/tmp/docdeck-0.md")));
    }
}

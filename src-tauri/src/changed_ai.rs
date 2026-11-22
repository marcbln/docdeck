//! Read-only report of uncommitted `_ai` Markdown documents.
//!
//! The module owns three concerns that must not leak into the webview:
//! resolving watched roots to git work trees, running one supervised
//! `git status` per work tree, and parsing its NUL-delimited porcelain output.
//! Every operation is read-only: only `git status` runs, with an argument
//! vector and `--no-optional-locks`, and files are inspected with `stat` only.
//!
//! [`build_report`] is pure apart from the injected [`GitClient`], so tests use
//! temporary repositories and a fake client instead of a real git binary. The
//! real client bounds each child at [`PER_REPOSITORY_TIMEOUT`], caps stdout at
//! [`OUTPUT_LIMIT`] and never invokes a shell.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::Manager;
use walkdir::WalkDir;

use crate::commands::{CommandError, CommandErrorCode};
use crate::paths::{
    has_ignored_component_below, is_ignored_name, is_markdown, is_noise_name, is_under,
    modified_millis, ExcludeSet,
};
use crate::watcher::WatcherState;

/// A hung repository must never block the rest of the list.
pub const PER_REPOSITORY_TIMEOUT: Duration = Duration::from_millis(1_500);

/// Overall budget for one report. Repositories that miss it are `timeout`.
pub const AGGREGATE_TIMEOUT: Duration = Duration::from_millis(1_800);

/// Captured stdout per repository before the run is treated as failed.
pub const OUTPUT_LIMIT: usize = 8 * 1024 * 1024;

/// Entries walked by the fallback `_ai` discovery before truncating.
pub const DISCOVERY_BUDGET: usize = 10_000;

/// Largest accepted scope payload, in bytes.
pub const SCOPE_MAX_BYTES: usize = 4_096;

/// One uncommitted Markdown document under an `_ai` segment.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedDocument {
    pub path: String,
    pub repository_root: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    /// Epoch milliseconds; `None` when the file vanished before the stat.
    pub modified_time: Option<u64>,
}

/// Why one repository could not be read. The webview branches on this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangedErrorCode {
    GitMissing,
    Timeout,
    OutputLimit,
    Unreadable,
    NotARepository,
}

impl ChangedErrorCode {
    fn message(self) -> &'static str {
        match self {
            Self::GitMissing => "git is not installed or could not be started",
            Self::Timeout => "git status did not finish in time",
            Self::OutputLimit => "git status output exceeded the 8 MiB limit",
            Self::Unreadable => "git status could not be read",
            Self::NotARepository => "not inside a git repository",
        }
    }
}

/// One git work tree queried for this snapshot.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedRepository {
    pub root: String,
    pub documents: Vec<ChangedDocument>,
    pub error: Option<String>,
    pub error_code: Option<ChangedErrorCode>,
}

/// A successful CLI scope: what was requested and what it resolved to.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedScope {
    pub requested: String,
    pub repository: String,
}

/// The complete answer to one refresh. It carries no UI state.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedAiReport {
    pub scope: Option<ChangedScope>,
    pub scope_error: Option<String>,
    pub watched_roots: usize,
    pub ai_folders: usize,
    pub repositories: Vec<ChangedRepository>,
    pub git_available: bool,
    pub discovery_truncated: bool,
}

/// A parsed porcelain v1 record before filesystem verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

/// Internal failure kinds. They become [`ChangedErrorCode`] rows, never command
/// errors, so one repository cannot hide the others.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitErrorKind {
    Missing,
    Timeout,
    OutputLimit,
    Unreadable,
}

impl GitErrorKind {
    fn code(self) -> ChangedErrorCode {
        match self {
            Self::Missing => ChangedErrorCode::GitMissing,
            Self::Timeout => ChangedErrorCode::Timeout,
            Self::OutputLimit => ChangedErrorCode::OutputLimit,
            Self::Unreadable => ChangedErrorCode::Unreadable,
        }
    }
}

/// The one OS boundary of this feature. Production runs a real subprocess;
/// tests inject a fake so no git binary or clock is required.
pub trait GitClient: Send + Sync {
    fn status(&self, repository: &Path) -> Result<Vec<u8>, GitErrorKind>;
}

/// Spawns the user's `git` with an argument vector and a bounded read.
pub struct ProcessGitClient;

impl GitClient for ProcessGitClient {
    fn status(&self, repository: &Path) -> Result<Vec<u8>, GitErrorKind> {
        let mut command = Command::new("git");
        command
            .arg("--no-optional-locks")
            .arg("-C")
            .arg(repository)
            .args([
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--no-renames",
                "--",
                ":(glob)**/_ai/**",
                "_ai/**",
            ])
            // An inherited shell must not point git at another repository.
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                GitErrorKind::Missing
            } else {
                GitErrorKind::Unreadable
            }
        })?;

        let stdout = child.stdout.take().ok_or(GitErrorKind::Unreadable)?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || read_capped(stdout, OUTPUT_LIMIT, tx));

        let deadline = Instant::now() + PER_REPOSITORY_TIMEOUT;
        let mut outcome: Option<Result<Vec<u8>, GitErrorKind>> = None;

        loop {
            if outcome.is_none() {
                if let Ok(result) = rx.try_recv() {
                    outcome = Some(result);
                }
            }
            if matches!(outcome, Some(Err(GitErrorKind::OutputLimit))) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitErrorKind::OutputLimit);
            }

            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {}
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(GitErrorKind::Unreadable);
                }
            }

            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitErrorKind::Timeout);
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        let _ = child.wait();
        match outcome {
            Some(result) => result,
            None => rx.recv().map_err(|_| GitErrorKind::Unreadable)?,
        }
    }
}

/// Reads at most `limit` bytes, reporting a cap breach instead of buffering.
fn read_capped<R: std::io::Read>(
    mut reader: R,
    limit: usize,
    tx: mpsc::Sender<Result<Vec<u8>, GitErrorKind>>,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => {
                let _ = tx.send(Ok(buffer));
                return;
            }
            Ok(read) => {
                if buffer.len() + read > limit {
                    let _ = tx.send(Err(GitErrorKind::OutputLimit));
                    return;
                }
                buffer.extend_from_slice(&chunk[..read]);
            }
            Err(_) => {
                let _ = tx.send(Err(GitErrorKind::Unreadable));
                return;
            }
        }
    }
}

/// Parses `git status --porcelain=v1 -z` records.
///
/// With `--no-renames` every record is `XY <path>` and NUL-terminated, so a
/// path may contain spaces, tabs or non-ASCII bytes without quoting. `??` is
/// untracked and carries neither badge; otherwise each column is independent.
pub fn parse_porcelain(output: &[u8]) -> Vec<StatusEntry> {
    output.split(|byte| *byte == 0).filter_map(parse_record).collect()
}

fn parse_record(record: &[u8]) -> Option<StatusEntry> {
    if record.len() < 4 || record[2] != b' ' {
        return None;
    }
    let x = record[0] as char;
    let y = record[1] as char;
    let path = String::from_utf8_lossy(&record[3..]).into_owned();
    if path.is_empty() {
        return None;
    }

    let untracked = x == '?' && y == '?';
    Some(StatusEntry {
        path,
        staged: !untracked && x != ' ' && x != '?',
        unstaged: !untracked && y != ' ' && y != '?',
        untracked,
    })
}

/// Resolves a path to the work tree that contains it.
///
/// `.git` may be a directory or a worktree/submodule pointer file. This is
/// cheaper than `git rev-parse --show-toplevel` and avoids a process per root.
pub fn find_repository_root(path: &Path) -> Option<PathBuf> {
    let start = if path.is_dir() {
        path
    } else {
        path.parent()?
    };

    for ancestor in start.ancestors() {
        let marker = ancestor.join(".git");
        if marker.is_dir() || marker.is_file() {
            return Some(
                ancestor
                    .canonicalize()
                    .unwrap_or_else(|_| ancestor.to_path_buf()),
            );
        }
    }
    None
}

/// Whether any component of `path` is exactly `_ai`.
pub fn has_ai_component(path: &Path) -> bool {
    path.components().any(
        |component| matches!(component, Component::Normal(name) if name.to_string_lossy() == "_ai"),
    )
}

/// Fallback discovery for a broad watched root that is not itself in a work
/// tree: find directories named `_ai`, pruning hidden, noise and excluded
/// subtrees, and stop at `budget` visited entries.
pub fn discover_ai_folders(
    root: &Path,
    excludes: &ExcludeSet,
    budget: usize,
) -> (Vec<PathBuf>, bool) {
    let mut found: Vec<PathBuf> = Vec::new();
    let mut visited = 0usize;
    let mut truncated = false;

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if is_ignored_name(&name) || is_noise_name(&name) {
                return false;
            }
            !excludes.is_excluded(entry.path())
        });

    for entry in walker {
        visited += 1;
        if visited > budget {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else {
            continue;
        };
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        if entry.file_name().to_string_lossy() == "_ai" {
            found.push(entry.path().to_path_buf());
        }
    }

    found.sort();
    found.dedup();
    (found, truncated)
}

/// Whether one status path is a live document this view may list.
fn includes_document(
    candidate: &Path,
    repository_root: &Path,
    watched_roots: &[PathBuf],
    excludes: &ExcludeSet,
    scoped: bool,
) -> bool {
    if !is_markdown(candidate) || !has_ai_component(candidate) {
        return false;
    }
    if !candidate.is_file() {
        return false;
    }
    if has_ignored_component_below(candidate, repository_root) {
        return false;
    }
    if scoped {
        return is_under(candidate, repository_root);
    }
    is_under_any(candidate, watched_roots) && !excludes.is_excluded(candidate)
}

fn is_under_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| is_under(path, root))
}

/// Case-insensitive identity on Windows, exact elsewhere.
fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

/// Collects the `_ai` anchors a watched root contributes, for `aiFolders`.
fn ai_anchors_for_root(root: &Path) -> Vec<PathBuf> {
    let parts: Vec<Component<'_>> = root.components().collect();
    if let Some(index) = parts.iter().position(|component| {
        matches!(component, Component::Normal(name) if name.to_string_lossy() == "_ai")
    }) {
        let mut anchor = PathBuf::new();
        for component in parts.iter().take(index + 1) {
            anchor.push(component.as_os_str());
        }
        return vec![anchor];
    }

    let nested = root.join("_ai");
    if nested.is_dir() {
        vec![nested]
    } else {
        Vec::new()
    }
}

/// Runs each repository once, in parallel, until the aggregate deadline.
///
/// A repository that misses the deadline is reported as `timeout`; completed
/// repositories, including failures, are kept. The worker threads are detached
/// so a hung client cannot hold the report open past the budget.
pub fn query_repositories(
    client: Arc<dyn GitClient>,
    roots: &[PathBuf],
    deadline_budget: Duration,
) -> Vec<(PathBuf, Result<Vec<u8>, GitErrorKind>)> {
    if roots.is_empty() {
        return Vec::new();
    }

    let (tx, rx) = mpsc::channel();
    for (index, root) in roots.iter().cloned().enumerate() {
        let tx = tx.clone();
        let client = Arc::clone(&client);
        std::thread::spawn(move || {
            let result = client.status(&root);
            let _ = tx.send((index, result));
        });
    }
    drop(tx);

    let deadline = Instant::now() + deadline_budget;
    let mut results: Vec<Option<Result<Vec<u8>, GitErrorKind>>> =
        (0..roots.len()).map(|_| None).collect();
    let mut received = 0usize;

    while received < roots.len() {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match rx.recv_timeout(deadline - now) {
            Ok((index, result)) => {
                results[index] = Some(result);
                received += 1;
            }
            Err(_) => break,
        }
    }

    roots
        .iter()
        .cloned()
        .zip(results)
        .map(|(root, result)| (root, result.unwrap_or(Err(GitErrorKind::Timeout))))
        .collect()
}

/// Builds one repository entry from raw porcelain output.
fn repository_entry(
    root: &Path,
    output: &[u8],
    watched_roots: &[PathBuf],
    excludes: &ExcludeSet,
    scoped: bool,
    seen: &mut HashSet<String>,
) -> ChangedRepository {
    let root_text = root.to_string_lossy().into_owned();
    let mut documents = Vec::new();

    for entry in parse_porcelain(output) {
        let raw = root.join(&entry.path);
        let Ok(canonical) = raw.canonicalize() else {
            continue;
        };
        if !includes_document(&canonical, root, watched_roots, excludes, scoped) {
            continue;
        }
        let key = path_key(&canonical);
        if !seen.insert(key) {
            continue;
        }
        documents.push(ChangedDocument {
            path: canonical.to_string_lossy().into_owned(),
            repository_root: root_text.clone(),
            staged: entry.staged,
            unstaged: entry.unstaged,
            untracked: entry.untracked,
            modified_time: modified_millis(&canonical),
        });
    }

    documents.sort_by(|left, right| left.path.cmp(&right.path));

    ChangedRepository {
        root: root_text,
        documents,
        error: None,
        error_code: None,
    }
}

fn failure_entry(root: &Path, kind: GitErrorKind) -> ChangedRepository {
    ChangedRepository {
        root: root.to_string_lossy().into_owned(),
        documents: Vec::new(),
        error: Some(kind.code().message().to_string()),
        error_code: Some(kind.code()),
    }
}

fn unresolved_entry(folder: &Path) -> ChangedRepository {
    let (code, message) = if folder.exists() {
        (
            ChangedErrorCode::NotARepository,
            ChangedErrorCode::NotARepository.message(),
        )
    } else {
        (
            ChangedErrorCode::Unreadable,
            "watched `_ai` folder could not be read",
        )
    };
    ChangedRepository {
        root: folder.to_string_lossy().into_owned(),
        documents: Vec::new(),
        error: Some(message.to_string()),
        error_code: Some(code),
    }
}

/// Assembles the watched-repository report.
fn watched_report(
    roots: &[PathBuf],
    excludes: &ExcludeSet,
    client: Arc<dyn GitClient>,
) -> ChangedAiReport {
    let mut repository_roots: Vec<PathBuf> = Vec::new();
    let mut failed: Vec<ChangedRepository> = Vec::new();
    let mut ai_anchors: HashSet<PathBuf> = HashSet::new();
    let mut truncated = false;

    for root in roots {
        match find_repository_root(root) {
            Some(repository) => {
                repository_roots.push(repository);
                for anchor in ai_anchors_for_root(root) {
                    ai_anchors.insert(anchor);
                }
            }
            None => {
                let (folders, did_truncate) = discover_ai_folders(root, excludes, DISCOVERY_BUDGET);
                truncated |= did_truncate;
                for folder in folders {
                    match find_repository_root(&folder) {
                        Some(repository) => {
                            repository_roots.push(repository);
                            ai_anchors.insert(folder);
                        }
                        None => {
                            ai_anchors.insert(folder.clone());
                            failed.push(unresolved_entry(&folder));
                        }
                    }
                }
            }
        }
    }

    let mut keyed: HashMap<String, PathBuf> = HashMap::new();
    for root in repository_roots {
        keyed.entry(path_key(&root)).or_insert(root);
    }
    let mut unique_roots: Vec<PathBuf> = keyed.into_values().collect();
    unique_roots.sort();

    let results = query_repositories(Arc::clone(&client), &unique_roots, AGGREGATE_TIMEOUT);

    let mut seen: HashSet<String> = HashSet::new();
    let mut repositories: Vec<ChangedRepository> = Vec::new();
    let mut git_available = true;

    for (root, result) in results {
        match result {
            Ok(output) => repositories.push(repository_entry(
                &root,
                &output,
                roots,
                excludes,
                false,
                &mut seen,
            )),
            Err(kind) => {
                if kind == GitErrorKind::Missing {
                    git_available = false;
                }
                repositories.push(failure_entry(&root, kind));
            }
        }
    }

    repositories.extend(failed);
    repositories.sort_by(|left, right| left.root.cmp(&right.root));

    ChangedAiReport {
        scope: None,
        scope_error: None,
        watched_roots: roots.len(),
        ai_folders: ai_anchors.len(),
        repositories,
        git_available,
        discovery_truncated: truncated,
    }
}

/// Assembles a report scoped to the repository containing `requested`.
fn scoped_report(requested: &str, client: Arc<dyn GitClient>) -> ChangedAiReport {
    let requested_path = PathBuf::from(requested);
    let search = if requested_path.is_dir() {
        requested_path.clone()
    } else {
        requested_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| requested_path.clone())
    };

    let Some(root) = find_repository_root(&search) else {
        return ChangedAiReport {
            scope: None,
            scope_error: Some(requested.to_string()),
            watched_roots: 0,
            ai_folders: 0,
            repositories: Vec::new(),
            git_available: true,
            discovery_truncated: false,
        };
    };

    let results = query_repositories(Arc::clone(&client), std::slice::from_ref(&root), AGGREGATE_TIMEOUT);
    let mut seen: HashSet<String> = HashSet::new();
    let mut repositories = Vec::new();
    let mut git_available = true;

    for (root, result) in results {
        match result {
            Ok(output) => repositories.push(repository_entry(
                &root,
                &output,
                std::slice::from_ref(&root),
                &ExcludeSet::default(),
                true,
                &mut seen,
            )),
            Err(kind) => {
                if kind == GitErrorKind::Missing {
                    git_available = false;
                }
                repositories.push(failure_entry(&root, kind));
            }
        }
    }

    repositories.sort_by(|left, right| left.root.cmp(&right.root));
    let ai_folders = usize::from(root.join("_ai").is_dir());

    ChangedAiReport {
        scope: Some(ChangedScope {
            requested: requested.to_string(),
            repository: root.to_string_lossy().into_owned(),
        }),
        scope_error: None,
        watched_roots: 0,
        ai_folders,
        repositories,
        git_available,
        discovery_truncated: false,
    }
}

/// Builds one complete report.
///
/// `scope` is an already-validated absolute path. `None` means the live watch
/// set; `Some` ignores the watch set and configured excludes on purpose,
/// because the requested repository need not be watched (FR-011).
pub fn build_report(
    roots: &[PathBuf],
    excludes: &ExcludeSet,
    scope: Option<&str>,
    client: Arc<dyn GitClient>,
) -> ChangedAiReport {
    match scope {
        Some(requested) => scoped_report(requested, client),
        None => watched_report(roots, excludes, client),
    }
}

/// Validates the untrusted webview scope before touching the filesystem.
pub fn validate_scope(scope: &Option<String>) -> Result<(), CommandError> {
    let Some(value) = scope else {
        return Ok(());
    };
    if value.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::Invalid,
            "changed scope must not be empty",
        ));
    }
    if value.len() > SCOPE_MAX_BYTES {
        return Err(CommandError::new(
            CommandErrorCode::Invalid,
            format!("changed scope exceeds {SCOPE_MAX_BYTES} bytes"),
        ));
    }
    if value.contains('\0') {
        return Err(CommandError::new(
            CommandErrorCode::Invalid,
            "changed scope contains a NUL byte",
        ));
    }
    if !Path::new(value).is_absolute() {
        return Err(CommandError::new(
            CommandErrorCode::Invalid,
            "changed scope must be an absolute path",
        ));
    }
    Ok(())
}

/// Snapshots the authoritative live watch set for one report.
///
/// A poisoned root lock is reported as an internal error so the webview can
/// retry a later refresh instead of silently treating the set as empty.
pub fn snapshot_watch_set(watcher: &WatcherState) -> Result<(Vec<PathBuf>, ExcludeSet), CommandError> {
    let roots = watcher
        .watched_roots
        .lock()
        .map_err(|_| {
            CommandError::new(
                CommandErrorCode::Internal,
                "the watch registry is unavailable; retry the refresh",
            )
        })?
        .iter()
        .cloned()
        .collect();
    Ok((roots, watcher.excludes()))
}

/// Command wrapper: validate, snapshot, run on a blocking worker.
#[tauri::command]
pub async fn list_changed_ai_documents(
    app: tauri::AppHandle,
    scope: Option<String>,
) -> Result<ChangedAiReport, CommandError> {
    validate_scope(&scope)?;
    let (roots, excludes) = snapshot_watch_set(&app.state::<WatcherState>())?;

    tauri::async_runtime::spawn_blocking(move || {
        build_report(
            &roots,
            &excludes,
            scope.as_deref(),
            Arc::new(ProcessGitClient),
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::Internal,
            format!("the changed `_ai` report could not run: {error}"),
        )
    })
}

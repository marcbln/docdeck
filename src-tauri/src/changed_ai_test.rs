#[cfg(test)]
mod tests {
    use crate::changed_ai::{
        build_report, discover_ai_folders, find_repository_root, parse_porcelain,
        query_repositories, snapshot_watch_set, validate_scope, ChangedErrorCode, GitClient,
        GitErrorKind, ProcessGitClient, StatusEntry, AGGREGATE_TIMEOUT, DISCOVERY_BUDGET,
        OUTPUT_LIMIT, PER_REPOSITORY_TIMEOUT, SCOPE_MAX_BYTES,
    };
    use crate::paths::ExcludeSet;
    use crate::watcher::WatcherState;
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tempfile::tempdir;

    /// A fake `git` whose answers are keyed by canonical repository root.
    #[derive(Default)]
    struct FakeGit {
        responses: HashMap<PathBuf, Result<Vec<u8>, GitErrorKind>>,
        calls: Arc<Mutex<Vec<PathBuf>>>,
    }

    impl FakeGit {
        fn new() -> Self {
            Self::default()
        }

        fn answer(mut self, root: &Path, output: Vec<u8>) -> Self {
            self.responses.insert(canonical(root), Ok(output));
            self
        }

        fn fail(mut self, root: &Path, kind: GitErrorKind) -> Self {
            self.responses.insert(canonical(root), Err(kind));
            self
        }
    }

    impl GitClient for FakeGit {
        fn status(&self, repository: &Path) -> Result<Vec<u8>, GitErrorKind> {
            self.calls.lock().unwrap().push(repository.to_path_buf());
            self.responses
                .get(repository)
                .cloned()
                .unwrap_or_else(|| Ok(Vec::new()))
        }
    }

    struct SlowGit;

    impl GitClient for SlowGit {
        fn status(&self, _repository: &Path) -> Result<Vec<u8>, GitErrorKind> {
            std::thread::sleep(Duration::from_millis(300));
            Ok(Vec::new())
        }
    }

    fn canonical(path: &Path) -> PathBuf {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    }

    fn porcelain(records: &[&str]) -> Vec<u8> {
        let mut output = Vec::new();
        for record in records {
            output.extend_from_slice(record.as_bytes());
            output.push(0);
        }
        output
    }

    fn make_repo(parent: &Path, name: &str) -> PathBuf {
        let repo = parent.join(name);
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("_ai/backlog")).unwrap();
        canonical(&repo)
    }

    fn write(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, "# document\n").unwrap();
    }

    #[test]
    fn porcelain_derives_each_change_state() {
        let entries = parse_porcelain(&porcelain(&[
            "?? _ai/new.md",
            "M  _ai/staged.md",
            "A  _ai/added.md",
            " M _ai/unstaged.md",
            "MM _ai/both.md",
            "UU _ai/conflict.md",
            "AA _ai/added-both.md",
            "D  _ai/deleted.md",
            "AD _ai/added-deleted.md",
            "DD _ai/deleted-both.md",
        ]));

        assert_eq!(entries.len(), 10);
        assert_eq!(
            entries[0],
            StatusEntry {
                path: "_ai/new.md".to_string(),
                staged: false,
                unstaged: false,
                untracked: true,
            }
        );
        assert_eq!(
            entries[1],
            StatusEntry {
                path: "_ai/staged.md".to_string(),
                staged: true,
                unstaged: false,
                untracked: false,
            }
        );
        assert!(entries[2].staged && !entries[2].unstaged);
        assert!(!entries[3].staged && entries[3].unstaged);
        assert!(entries[4].staged && entries[4].unstaged);
        assert!(entries[5].staged && entries[5].unstaged);
        assert!(entries[6].staged && entries[6].unstaged);

        // Deletion records still parse; existence filtering drops them later.
        assert!(entries[7].staged);
        assert!(entries[8].staged && entries[8].unstaged);
        assert!(entries[9].staged && entries[9].unstaged);
    }

    #[test]
    fn porcelain_keeps_paths_with_spaces_and_skips_malformed_records() {
        let entries = parse_porcelain(&porcelain(&[
            "?? _ai/backlog/a file with spaces.md",
            "bad",
            "",
        ]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "_ai/backlog/a file with spaces.md");
    }

    #[test]
    fn watched_inclusion_filters_extensions_segments_and_noise() {
        let dir = tempdir().unwrap();
        let repo = make_repo(dir.path(), "alpha");
        let root = repo.clone();

        write(&repo.join("_ai/backlog/plan.md"));
        write(&repo.join("_ai/backlog/notes.txt"));
        write(&repo.join("_ai/.hidden/secret.md"));
        write(&repo.join("_ai/node_modules/dep.md"));
        write(&repo.join("_ai/backlog/backup.md~"));
        write(&repo.join("_ai/archive/old.md"));
        write(&repo.join("pkg/sub/_ai/x/deep.md"));
        write(&repo.join("docs/readme.md"));

        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/archive/**".to_string()], dir.path());
        assert!(warnings.is_empty());

        let client = Arc::new(FakeGit::new().answer(
            &repo,
            porcelain(&[
                " M _ai/backlog/plan.md",
                "?? _ai/backlog/notes.txt",
                "?? _ai/.hidden/secret.md",
                "?? _ai/node_modules/dep.md",
                "?? _ai/backlog/backup.md~",
                "?? _ai/archive/old.md",
                "?? pkg/sub/_ai/x/deep.md",
                "?? docs/readme.md",
            ]),
        ));

        let report = build_report(&[root], &excludes, None, client);
        assert_eq!(report.repositories.len(), 1);
        let paths: Vec<String> = report.repositories[0]
            .documents
            .iter()
            .map(|document| document.path.clone())
            .collect();
        assert_eq!(
            paths,
            vec![
                canonical(&repo.join("_ai/backlog/plan.md"))
                    .to_string_lossy()
                    .into_owned(),
                canonical(&repo.join("pkg/sub/_ai/x/deep.md"))
                    .to_string_lossy()
                    .into_owned(),
            ]
        );
        assert_eq!(report.ai_folders, 1);
    }

    #[test]
    fn untracked_and_deleted_paths_follow_the_existence_rule() {
        let dir = tempdir().unwrap();
        let repo = make_repo(dir.path(), "alpha");
        write(&repo.join("_ai/backlog/new.md"));

        let client = Arc::new(FakeGit::new().answer(
            &repo,
            porcelain(&[
                "?? _ai/backlog/new.md",
                "D  _ai/backlog/deleted.md",
                "AD _ai/backlog/added-deleted.md",
                "DD _ai/backlog/deleted-both.md",
            ]),
        ));

        let report = build_report(
            std::slice::from_ref(&repo),
            &ExcludeSet::default(),
            None,
            client,
        );
        let documents = &report.repositories[0].documents;
        assert_eq!(documents.len(), 1);
        assert!(documents[0].untracked);
        assert!(!documents[0].staged && !documents[0].unstaged);
    }

    #[test]
    fn repository_root_walks_ancestors_for_directories_and_pointer_files() {
        let dir = tempdir().unwrap();

        let worktree = dir.path().join("worktree");
        fs::create_dir_all(worktree.join("nested/_ai/deep")).unwrap();
        fs::write(worktree.join(".git"), "gitdir: /tmp/elsewhere\n").unwrap();
        assert_eq!(
            find_repository_root(&worktree.join("nested/_ai/deep")).unwrap(),
            canonical(&worktree)
        );

        let plain = dir.path().join("plain");
        fs::create_dir_all(&plain).unwrap();
        assert!(find_repository_root(&plain).is_none());
    }

    #[test]
    fn fallback_discovery_finds_nested_repositories_and_prunes_noise() {
        let dir = tempdir().unwrap();
        let broad = dir.path().join("broad");
        fs::create_dir_all(&broad).unwrap();

        let project = broad.join("project");
        fs::create_dir_all(project.join(".git")).unwrap();
        write(&project.join("_ai/backlog/plan.md"));

        write(&broad.join("orphan/_ai/backlog/plan.md"));
        write(&broad.join("hidden/.secret/_ai/plan.md"));
        write(&broad.join("noise/node_modules/_ai/plan.md"));
        write(&broad.join("excluded/_ai/plan.md"));

        let (excludes, _) =
            ExcludeSet::build_lenient(&["**/excluded/**".to_string()], dir.path());

        let client = Arc::new(FakeGit::new().answer(
            &project,
            porcelain(&["?? _ai/backlog/plan.md"]),
        ));
        let report = build_report(&[canonical(&broad)], &excludes, None, client);

        let project_root = canonical(&project);
        assert!(report
            .repositories
            .iter()
            .any(|repository| repository.root == project_root.to_string_lossy()));

        let orphan = canonical(&broad.join("orphan/_ai"));
        let orphan_entry = report
            .repositories
            .iter()
            .find(|repository| repository.root == orphan.to_string_lossy())
            .expect("the unresolved _ai folder is still named");
        assert_eq!(orphan_entry.error_code, Some(ChangedErrorCode::NotARepository));
        assert!(orphan_entry.documents.is_empty());

        assert!(!report
            .repositories
            .iter()
            .any(|repository| repository.root.contains("node_modules")));
        assert!(!report
            .repositories
            .iter()
            .any(|repository| repository.root.contains("excluded")));
    }

    #[test]
    fn discovery_honours_its_entry_budget() {
        let dir = tempdir().unwrap();
        let broad = dir.path().join("broad");
        for index in 0..8 {
            fs::create_dir_all(broad.join(format!("dir-{index}"))).unwrap();
        }
        let (found, truncated) =
            discover_ai_folders(&broad, &ExcludeSet::default(), DISCOVERY_BUDGET);
        assert!(found.is_empty());
        assert!(!truncated);

        let (_, truncated) = discover_ai_folders(&broad, &ExcludeSet::default(), 2);
        assert!(truncated);
    }

    #[test]
    fn one_failing_repository_never_hides_another() {
        let dir = tempdir().unwrap();
        let alpha = make_repo(dir.path(), "alpha");
        let beta = make_repo(dir.path(), "beta");
        write(&alpha.join("_ai/backlog/a.md"));
        write(&beta.join("_ai/backlog/b.md"));

        let client = Arc::new(
            FakeGit::new()
                .answer(&alpha, porcelain(&[" M _ai/backlog/a.md"]))
                .fail(&beta, GitErrorKind::Timeout),
        );

        let report = build_report(
            &[alpha.clone(), beta.clone()],
            &ExcludeSet::default(),
            None,
            client,
        );

        assert_eq!(report.repositories.len(), 2);
        let alpha_entry = report
            .repositories
            .iter()
            .find(|repository| repository.root == canonical(&alpha).to_string_lossy())
            .unwrap();
        assert_eq!(alpha_entry.documents.len(), 1);

        let beta_entry = report
            .repositories
            .iter()
            .find(|repository| repository.root == canonical(&beta).to_string_lossy())
            .unwrap();
        assert_eq!(beta_entry.error_code, Some(ChangedErrorCode::Timeout));
        assert!(beta_entry.documents.is_empty());
        assert!(report.git_available);
    }

    #[test]
    fn failure_kinds_map_to_typed_repository_errors() {
        let dir = tempdir().unwrap();
        let repo = make_repo(dir.path(), "alpha");

        for (kind, expected, git_available) in [
            (GitErrorKind::Missing, ChangedErrorCode::GitMissing, false),
            (GitErrorKind::OutputLimit, ChangedErrorCode::OutputLimit, true),
            (GitErrorKind::Unreadable, ChangedErrorCode::Unreadable, true),
        ] {
            let client = Arc::new(FakeGit::new().fail(&repo, kind));
            let report = build_report(std::slice::from_ref(&repo), &ExcludeSet::default(), None, client);
            assert_eq!(report.repositories[0].error_code, Some(expected));
            assert!(report.repositories[0].error.is_some());
            assert_eq!(report.git_available, git_available);
        }
    }

    #[test]
    fn each_distinct_work_tree_is_queried_once() {
        let dir = tempdir().unwrap();
        let repo = make_repo(dir.path(), "alpha");
        let watch_a = repo.join("_ai");
        let watch_b = repo.join("pkg/sub/_ai");
        fs::create_dir_all(&watch_b).unwrap();

        let fake = FakeGit::new();
        let calls = Arc::clone(&fake.calls);
        let report = build_report(
            &[canonical(&watch_a), canonical(&watch_b)],
            &ExcludeSet::default(),
            None,
            Arc::new(fake),
        );

        assert_eq!(report.repositories.len(), 1);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], canonical(&repo));
    }

    #[test]
    fn aggregate_deadline_marks_unfinished_repositories_as_timeout() {
        let dir = tempdir().unwrap();
        let alpha = make_repo(dir.path(), "alpha");
        let beta = make_repo(dir.path(), "beta");

        let started = std::time::Instant::now();
        let results = query_repositories(
            Arc::new(SlowGit),
            &[alpha.clone(), beta.clone()],
            Duration::from_millis(60),
        );
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(results.len(), 2);
        for (_, result) in results {
            assert_eq!(result, Err(GitErrorKind::Timeout));
        }
    }

    #[test]
    fn documents_are_deduplicated_and_ordered_by_root_then_path() {
        let dir = tempdir().unwrap();
        let alpha = make_repo(dir.path(), "alpha");
        let beta = make_repo(dir.path(), "beta");
        write(&alpha.join("_ai/backlog/z.md"));
        write(&alpha.join("_ai/backlog/a.md"));
        write(&beta.join("_ai/backlog/m.md"));

        let client = Arc::new(
            FakeGit::new()
                .answer(
                    &alpha,
                    porcelain(&[" M _ai/backlog/z.md", "?? _ai/backlog/a.md"]),
                )
                .answer(&beta, porcelain(&["?? _ai/backlog/m.md"])),
        );

        let report = build_report(
            &[beta.clone(), alpha.clone()],
            &ExcludeSet::default(),
            None,
            client,
        );

        let roots: Vec<&str> = report
            .repositories
            .iter()
            .map(|repository| repository.root.as_str())
            .collect();
        let mut sorted = roots.clone();
        sorted.sort();
        assert_eq!(roots, sorted);

        let alpha_entry = report
            .repositories
            .iter()
            .find(|repository| repository.root == canonical(&alpha).to_string_lossy())
            .unwrap();
        let names: Vec<String> = alpha_entry
            .documents
            .iter()
            .map(|document| {
                Path::new(&document.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["a.md", "z.md"]);
    }

    #[test]
    fn duplicate_status_records_collapse_to_one_document() {
        let dir = tempdir().unwrap();
        let repo = make_repo(dir.path(), "alpha");
        write(&repo.join("_ai/backlog/plan.md"));

        let client = Arc::new(FakeGit::new().answer(
            &repo,
            porcelain(&["MM _ai/backlog/plan.md", " M _ai/backlog/plan.md"]),
        ));

        let report = build_report(&[repo], &ExcludeSet::default(), None, client);
        assert_eq!(report.repositories[0].documents.len(), 1);
        let document = &report.repositories[0].documents[0];
        assert!(document.staged && document.unstaged);
    }

    #[test]
    fn scoped_report_ignores_the_watch_set_and_names_a_missing_repository() {
        let dir = tempdir().unwrap();
        let repo = make_repo(dir.path(), "alpha");
        write(&repo.join("_ai/backlog/plan.md"));

        let client = Arc::new(FakeGit::new().answer(
            &repo,
            porcelain(&["?? _ai/backlog/plan.md"]),
        ));
        let requested = canonical(&repo).to_string_lossy().into_owned();
        let report = build_report(
            &[],
            &ExcludeSet::default(),
            Some(&requested),
            client,
        );

        assert!(report.scope.is_some());
        assert_eq!(report.repositories.len(), 1);
        assert_eq!(report.repositories[0].documents.len(), 1);

        let missing = dir.path().join("outside");
        fs::create_dir_all(&missing).unwrap();
        let requested = canonical(&missing).to_string_lossy().into_owned();
        let report = build_report(
            &[],
            &ExcludeSet::default(),
            Some(&requested),
            Arc::new(FakeGit::new()),
        );
        assert!(report.scope.is_none());
        assert_eq!(report.scope_error.as_deref(), Some(requested.as_str()));
        assert!(report.repositories.is_empty());
    }

    #[test]
    fn scope_validation_rejects_unsafe_input_before_touching_disk() {
        assert!(validate_scope(&None).is_ok());
        assert!(validate_scope(&Some("/tmp/project".to_string())).is_ok());

        for invalid in [
            String::new(),
            "relative/path".to_string(),
            "a\0b".to_string(),
            "x".repeat(SCOPE_MAX_BYTES + 1),
        ] {
            let error = validate_scope(&Some(invalid.clone())).unwrap_err();
            assert_eq!(error.code, crate::commands::CommandErrorCode::Invalid);
        }
    }

    #[test]
    fn poisoned_watch_registry_is_reported_as_an_internal_error() {
        let watcher = WatcherState::new();
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = watcher.watched_roots.lock().unwrap();
            panic!("poison the registry");
        }));
        std::panic::set_hook(previous);
        assert!(poisoned.is_err());

        let error = snapshot_watch_set(&watcher).unwrap_err();
        assert_eq!(error.code, crate::commands::CommandErrorCode::Internal);
    }

    #[test]
    fn limits_are_named_constants() {
        assert_eq!(PER_REPOSITORY_TIMEOUT, Duration::from_millis(1_500));
        assert_eq!(AGGREGATE_TIMEOUT, Duration::from_millis(1_800));
        assert_eq!(OUTPUT_LIMIT, 8 * 1024 * 1024);
        assert_eq!(DISCOVERY_BUDGET, 10_000);
        assert_eq!(SCOPE_MAX_BYTES, 4_096);
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn git(repo: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["-c", "user.name=test", "-c", "user.email=test@example.com"])
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn real_git_reports_changes_without_touching_the_index() {
        if !git_available() {
            eprintln!("skipping real-git smoke test: git is not on PATH");
            return;
        }

        let dir = tempdir().unwrap();
        let repo = dir.path().join("alpha");
        fs::create_dir_all(repo.join("_ai/backlog")).unwrap();
        git(&repo, &["init", "-q"]);
        fs::write(repo.join("_ai/backlog/plan.md"), "# base\n").unwrap();
        fs::write(repo.join("_ai/backlog/notes.md"), "# notes\n").unwrap();
        git(&repo, &["add", "_ai/backlog/plan.md", "_ai/backlog/notes.md"]);
        git(&repo, &["commit", "-qm", "init"]);

        fs::write(repo.join("_ai/backlog/plan.md"), "# base\nstaged\n").unwrap();
        git(&repo, &["add", "_ai/backlog/plan.md"]);
        fs::write(repo.join("_ai/backlog/notes.md"), "# notes\nunstaged\n").unwrap();
        fs::write(repo.join("_ai/backlog/new.md"), "# new\n").unwrap();
        fs::write(repo.join("_ai/backlog/ignored.txt"), "x\n").unwrap();
        fs::write(repo.join("README.md"), "# outside\n").unwrap();
        fs::create_dir_all(repo.join("pkg/sub/_ai/deep")).unwrap();
        fs::write(repo.join("pkg/sub/_ai/deep/nested.md"), "# nested\n").unwrap();

        let index_path = repo.join(".git/index");
        let before = fs::read(&index_path).unwrap();
        // Watch the repository root so both root-level and nested `_ai` trees
        // are in scope, as a broad watch configuration would be.
        let watch_root = canonical(&repo);

        let report = build_report(
            &[watch_root],
            &ExcludeSet::default(),
            None,
            Arc::new(ProcessGitClient),
        );

        let documents = &report.repositories[0].documents;
        // Root-level and nested `_ai` both match the pathspec; non-Markdown
        // and non-`_ai` siblings do not.
        assert_eq!(documents.len(), 4);
        assert!(documents.iter().any(|document| document.path.ends_with("plan.md")
            && document.staged
            && !document.unstaged));
        assert!(documents.iter().any(|document| document.path.ends_with("notes.md")
            && !document.staged
            && document.unstaged));
        assert!(documents
            .iter()
            .any(|document| document.path.ends_with("new.md") && document.untracked));
        assert!(documents.iter().any(|document| document
            .path
            .ends_with("pkg/sub/_ai/deep/nested.md")
            && document.untracked));

        let after = fs::read(&index_path).unwrap();
        assert_eq!(before, after, "git status must not refresh the index");

        // Scale: no document-count limit at five hundred rows.
        for index in 0..500 {
            fs::write(
                repo.join(format!("_ai/backlog/scale-{index:03}.md")),
                format!("# {index}\n"),
            )
            .unwrap();
        }
        let report = build_report(
            &[canonical(&repo.join("_ai"))],
            &ExcludeSet::default(),
            None,
            Arc::new(ProcessGitClient),
        );
        assert!(report.repositories[0].documents.len() >= 500);
    }
}

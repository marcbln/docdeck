#[cfg(test)]
mod tests {
    use crate::bookmark_filter::{
        filter_candidates, BookmarkFilterState, NotificationBookmarkFilter,
        NotificationBookmarkFilterInput, MAX_PATHS, MAX_PATH_BYTES,
    };
    use crate::commands::CommandErrorCode;
    use crate::watcher::{PathChange, PathChangeKind};

    fn change(path: &str) -> PathChange {
        PathChange {
            kind: PathChangeKind::Modified,
            path: path.to_string(),
            from_path: None,
            exists: true,
            modified_time: Some(1),
        }
    }

    fn renamed(from: &str, to: &str) -> PathChange {
        PathChange {
            kind: PathChangeKind::Renamed,
            path: to.to_string(),
            from_path: Some(from.to_string()),
            exists: true,
            modified_time: Some(1),
        }
    }

    fn deleted(path: &str) -> PathChange {
        PathChange {
            kind: PathChangeKind::Deleted,
            path: path.to_string(),
            from_path: None,
            exists: false,
            modified_time: None,
        }
    }

    fn input(enabled: bool, paths: &[&str]) -> NotificationBookmarkFilterInput {
        NotificationBookmarkFilterInput {
            enabled,
            paths: paths.iter().map(|path| path.to_string()).collect(),
        }
    }

    fn filter(enabled: bool, paths: &[&str]) -> NotificationBookmarkFilter {
        NotificationBookmarkFilter {
            enabled,
            paths: paths.iter().map(|path| path.to_string()).collect(),
        }
    }

    #[test]
    fn accepts_absolute_paths_and_collapses_duplicates() {
        let state = BookmarkFilterState::new();
        state
            .replace(input(true, &["/tmp/a.md", "/tmp/a.md", "/tmp/b.md"]))
            .expect("valid filter");

        let snapshot = state.snapshot();
        assert!(snapshot.enabled);
        assert_eq!(snapshot.paths.len(), 2);
        assert!(snapshot.paths.contains("/tmp/a.md"));
        assert!(snapshot.paths.contains("/tmp/b.md"));
    }

    #[test]
    fn rejects_an_empty_path() {
        let state = BookmarkFilterState::new();
        let error = state.replace(input(true, &[""])).expect_err("empty path");
        assert_eq!(error.code, CommandErrorCode::Invalid);
    }

    #[test]
    fn rejects_a_relative_path() {
        let state = BookmarkFilterState::new();
        let error = state
            .replace(input(true, &["relative/a.md"]))
            .expect_err("relative path");
        assert_eq!(error.code, CommandErrorCode::Invalid);
    }

    #[test]
    fn rejects_a_nul_byte() {
        let state = BookmarkFilterState::new();
        let error = state
            .replace(input(true, &["/tmp/a\0b.md"]))
            .expect_err("NUL path");
        assert_eq!(error.code, CommandErrorCode::Invalid);
    }

    #[test]
    fn rejects_an_oversized_path() {
        let state = BookmarkFilterState::new();
        let path = format!("/{}", "a".repeat(MAX_PATH_BYTES));
        let error = state
            .replace(input(true, &[&path]))
            .expect_err("oversized path");
        assert_eq!(error.code, CommandErrorCode::Invalid);
    }

    #[test]
    fn rejects_too_many_paths() {
        let state = BookmarkFilterState::new();
        let paths: Vec<String> = (0..=MAX_PATHS)
            .map(|index| format!("/tmp/{index}.md"))
            .collect();
        let error = state
            .replace(NotificationBookmarkFilterInput {
                enabled: true,
                paths,
            })
            .expect_err("too many paths");
        assert_eq!(error.code, CommandErrorCode::Invalid);
    }

    #[test]
    fn invalid_input_retains_the_previous_filter() {
        let state = BookmarkFilterState::new();
        state
            .replace(input(true, &["/tmp/keep.md"]))
            .expect("valid filter first");

        state
            .replace(input(false, &["relative.md"]))
            .expect_err("invalid replacement");

        let snapshot = state.snapshot();
        assert!(snapshot.enabled);
        assert_eq!(snapshot.paths.len(), 1);
        assert!(snapshot.paths.contains("/tmp/keep.md"));
    }

    #[test]
    fn disabled_filter_passes_the_full_batch_in_order() {
        let changes = vec![change("/tmp/a.md"), change("/tmp/b.md")];
        let candidates = filter_candidates(&filter(false, &["/tmp/a.md"]), &changes);
        assert_eq!(candidates, changes);
    }

    #[test]
    fn enabled_filter_with_no_paths_yields_no_candidates() {
        let changes = vec![change("/tmp/a.md")];
        assert!(filter_candidates(&filter(true, &[]), &changes).is_empty());
    }

    #[test]
    fn enabled_filter_keeps_only_bookmarked_paths_in_input_order() {
        let changes = vec![
            change("/tmp/a.md"),
            change("/tmp/b.md"),
            change("/tmp/c.md"),
        ];
        let candidates = filter_candidates(&filter(true, &["/tmp/c.md", "/tmp/a.md"]), &changes);
        assert_eq!(
            candidates
                .iter()
                .map(|change| change.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/tmp/a.md", "/tmp/c.md"]
        );
    }

    #[test]
    fn rename_matches_the_source_and_the_target() {
        let changes = vec![
            renamed("/tmp/old.md", "/tmp/new.md"),
            renamed("/tmp/other.md", "/tmp/third.md"),
        ];

        let from_source = filter_candidates(&filter(true, &["/tmp/old.md"]), &changes);
        assert_eq!(from_source.len(), 1);
        assert_eq!(from_source[0].path, "/tmp/new.md");

        let from_target = filter_candidates(&filter(true, &["/tmp/new.md"]), &changes);
        assert_eq!(from_target.len(), 1);

        let neither = filter_candidates(&filter(true, &["/tmp/absent.md"]), &changes);
        assert!(neither.is_empty());
    }

    #[test]
    fn bookmarked_deletions_remain_candidates() {
        let changes = vec![deleted("/tmp/gone.md")];
        let candidates = filter_candidates(&filter(true, &["/tmp/gone.md"]), &changes);
        assert_eq!(candidates.len(), 1);
        assert!(!candidates[0].exists);
    }

    #[test]
    fn filtering_never_duplicates_candidates() {
        let changes = vec![change("/tmp/a.md"), change("/tmp/a.md")];
        let candidates = filter_candidates(&filter(true, &["/tmp/a.md"]), &changes);
        assert_eq!(candidates.len(), 2);
    }
}

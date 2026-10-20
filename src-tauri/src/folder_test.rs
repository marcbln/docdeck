#[cfg(test)]
mod tests {
    use crate::folder::{scan_markdown_with_progress, MAX_SCAN_ENTRIES};
    use crate::paths::ExcludeSet;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use tempfile::tempdir;

    fn scan(root: &Path) -> (Vec<String>, bool) {
        let outcome = scan_markdown_with_progress(
            root,
            &ExcludeSet::default(),
            1000,
            MAX_SCAN_ENTRIES,
            &mut |_, _, _| {},
        )
        .unwrap();
        let mut names: Vec<String> = outcome
            .files
            .iter()
            .map(|path| {
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        (names, outcome.truncated)
    }

    #[test]
    fn scans_markdown_recursively_and_skips_noise() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("backlog/active")).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        fs::create_dir_all(dir.path().join("target")).unwrap();
        fs::create_dir_all(dir.path().join("vol/www/public/media/1a")).unwrap();
        fs::write(dir.path().join("README.md"), "# root").unwrap();
        fs::write(dir.path().join("backlog/active/plan.md"), "# plan").unwrap();
        fs::write(dir.path().join("backlog/report.MD"), "# report").unwrap();
        fs::write(dir.path().join("backlog/notes.txt"), "nope").unwrap();
        fs::write(dir.path().join(".git/HEAD.md"), "nope").unwrap();
        fs::write(dir.path().join("node_modules/dep.md"), "nope").unwrap();
        fs::write(dir.path().join("target/out.md"), "nope").unwrap();
        fs::write(dir.path().join("vol/www/public/media/1a/2b.md"), "nope").unwrap();
        fs::write(dir.path().join("backlog/plan.md~"), "nope").unwrap();

        let (names, truncated) = scan(dir.path());

        assert!(!truncated);
        assert_eq!(
            names,
            vec![
                "README.md".to_string(),
                "backlog/active/plan.md".to_string(),
                "backlog/report.MD".to_string(),
            ]
        );
    }

    #[test]
    fn rejects_a_non_directory() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();
        assert!(scan_markdown_with_progress(
            &file,
            &ExcludeSet::default(),
            1000,
            MAX_SCAN_ENTRIES,
            &mut |_, _, _| {}
        )
        .is_err());
    }

    #[test]
    fn honors_exclude_patterns() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("drafts")).unwrap();
        fs::write(dir.path().join("keep.md"), "# keep").unwrap();
        fs::write(dir.path().join("drafts/old.md"), "# old").unwrap();

        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/drafts/**".to_string()], dir.path());
        assert!(warnings.is_empty());

        let outcome = scan_markdown_with_progress(
            dir.path(),
            &excludes,
            1000,
            MAX_SCAN_ENTRIES,
            &mut |_, _, _| {},
        )
        .unwrap();
        assert_eq!(outcome.files.len(), 1);
        assert!(outcome.files[0].ends_with("keep.md"));
    }

    #[test]
    fn skips_symlinked_directories() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("real")).unwrap();
        fs::write(dir.path().join("real/plan.md"), "# plan").unwrap();
        symlink(dir.path().join("real"), dir.path().join("link")).unwrap();

        let (names, _) = scan(dir.path());
        assert_eq!(names, vec!["real/plan.md".to_string()]);
    }

    #[test]
    fn truncates_at_max_files() {
        let dir = tempdir().unwrap();
        for index in 0..5 {
            fs::write(dir.path().join(format!("doc_{index}.md")), "# doc").unwrap();
        }

        let outcome = scan_markdown_with_progress(
            dir.path(),
            &ExcludeSet::default(),
            3,
            MAX_SCAN_ENTRIES,
            &mut |_, _, _| {},
        )
        .unwrap();
        assert_eq!(outcome.files.len(), 3);
        assert!(outcome.truncated);
    }

    #[test]
    fn stops_walking_at_the_entry_limit() {
        let dir = tempdir().unwrap();
        for index in 0..5 {
            fs::create_dir_all(dir.path().join(format!("d{index}"))).unwrap();
            fs::write(dir.path().join(format!("d{index}/plan.md")), "# plan").unwrap();
        }

        let outcome = scan_markdown_with_progress(
            dir.path(),
            &ExcludeSet::default(),
            100,
            4,
            &mut |_, _, _| {},
        )
        .unwrap();

        assert!(outcome.entries_truncated);
        assert!(!outcome.truncated);
        assert!(outcome.files.len() < 5);
    }

    #[test]
    fn reports_directories_and_running_file_count() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("nested")).unwrap();
        fs::write(dir.path().join("root.md"), "# root").unwrap();
        fs::write(dir.path().join("nested/plan.md"), "# plan").unwrap();
        fs::write(dir.path().join("notes.txt"), "nope").unwrap();

        let mut seen_dirs: Vec<String> = Vec::new();
        let mut max_files = 0;
        let outcome = scan_markdown_with_progress(
            dir.path(),
            &ExcludeSet::default(),
            100,
            MAX_SCAN_ENTRIES,
            &mut |path, is_dir, files| {
                if is_dir {
                    seen_dirs.push(
                        path.strip_prefix(dir.path())
                            .unwrap()
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                max_files = max_files.max(files);
            },
        )
        .unwrap();

        assert_eq!(outcome.files.len(), 2);
        assert!(seen_dirs.contains(&"nested".to_string()));
        assert_eq!(max_files, 2);
    }
}

#[cfg(test)]
mod tests {
    use crate::folder::scan_markdown;
    use crate::paths::ExcludeSet;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use tempfile::tempdir;

    fn scan(root: &Path) -> (Vec<String>, bool) {
        let outcome = scan_markdown(root, &ExcludeSet::default(), 1000).unwrap();
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
        fs::write(dir.path().join("README.md"), "# root").unwrap();
        fs::write(dir.path().join("backlog/active/plan.md"), "# plan").unwrap();
        fs::write(dir.path().join("backlog/report.MD"), "# report").unwrap();
        fs::write(dir.path().join("backlog/notes.txt"), "nope").unwrap();
        fs::write(dir.path().join(".git/HEAD.md"), "nope").unwrap();
        fs::write(dir.path().join("node_modules/dep.md"), "nope").unwrap();
        fs::write(dir.path().join("target/out.md"), "nope").unwrap();
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
        assert!(scan_markdown(&file, &ExcludeSet::default(), 1000).is_err());
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

        let outcome = scan_markdown(dir.path(), &excludes, 1000).unwrap();
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

        let outcome = scan_markdown(dir.path(), &ExcludeSet::default(), 3).unwrap();
        assert_eq!(outcome.files.len(), 3);
        assert!(outcome.truncated);
    }
}

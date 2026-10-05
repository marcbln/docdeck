#[cfg(test)]
mod tests {
    use crate::folder::scan_markdown;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn scans_markdown_recursively_and_skips_noise() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("backlog/active")).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("README.md"), "# root").unwrap();
        fs::write(dir.path().join("backlog/active/plan.md"), "# plan").unwrap();
        fs::write(dir.path().join("backlog/report.MD"), "# report").unwrap();
        fs::write(dir.path().join("backlog/notes.txt"), "nope").unwrap();
        fs::write(dir.path().join(".git/HEAD.md"), "nope").unwrap();
        fs::write(dir.path().join("backlog/plan.md~"), "nope").unwrap();

        let files = scan_markdown(dir.path()).unwrap();
        let names: Vec<String> = files
            .iter()
            .map(|path| {
                path.strip_prefix(dir.path())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();

        assert_eq!(names.len(), 3);
        assert!(names.contains(&"README.md".to_string()));
        assert!(names.contains(&"backlog/active/plan.md".to_string()));
        assert!(names.contains(&"backlog/report.MD".to_string()));
    }

    #[test]
    fn rejects_a_non_directory() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();
        assert!(scan_markdown(&file).is_err());
    }
}

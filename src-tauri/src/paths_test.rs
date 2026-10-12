#[cfg(test)]
mod tests {
    use crate::paths::{classify_args, is_ignored_name, is_markdown, is_relevant, is_under};
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    #[test]
    fn markdown_extension_is_case_insensitive() {
        assert!(is_markdown(Path::new("plan.md")));
        assert!(is_markdown(Path::new("PLAN.MD")));
        assert!(!is_markdown(Path::new("plan.markdown")));
        assert!(!is_markdown(Path::new("plan.md~")));
        assert!(!is_markdown(Path::new("plan")));
    }

    #[test]
    fn under_compares_whole_components() {
        assert!(is_under(Path::new("/tmp/a/plan.md"), Path::new("/tmp/a")));
        assert!(is_under(Path::new("/tmp/a"), Path::new("/tmp/a")));
        assert!(!is_under(Path::new("/tmp/ab/plan.md"), Path::new("/tmp/a")));
    }

    #[test]
    fn hidden_and_backup_names_are_ignored() {
        assert!(is_ignored_name(".git"));
        assert!(is_ignored_name(".gitkeep"));
        assert!(is_ignored_name("plan.md~"));
        assert!(!is_ignored_name("plan.md"));
    }

    #[test]
    fn relevance_prefers_open_files_then_root_markdown() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        fs::create_dir_all(&root).unwrap();
        let doc = root.join("a.md");
        fs::write(&doc, "# doc").unwrap();
        let txt = root.join("a.txt");
        fs::write(&txt, "text").unwrap();

        let files: HashSet<PathBuf> = [txt.clone()].into();
        let roots: HashSet<PathBuf> = [root.clone()].into();

        // An explicitly opened file reloads whatever its extension.
        assert!(is_relevant(&txt, &files, &roots));
        // Fresh Markdown under a root is relevant.
        assert!(is_relevant(&doc, &files, &roots));
        // A deleted/never-existing path has nothing to mark.
        assert!(!is_relevant(&root.join("missing.md"), &files, &roots));
        // Markdown outside every root is not.
        assert!(!is_relevant(Path::new("/elsewhere/a.md"), &files, &roots));
    }

    #[test]
    fn classify_args_tags_files_and_dirs() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();

        let argv = vec![
            "docdeck".to_string(),
            "--accelerated".to_string(),
            dir.path().to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            "/does/not/exist.md".to_string(),
        ];

        let entries = classify_args(&argv);
        assert_eq!(entries.len(), 2);

        let dir_entry = entries.iter().find(|entry| entry.is_dir).unwrap();
        assert_eq!(
            dir_entry.path,
            dir.path()
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        );

        let file_entry = entries.iter().find(|entry| !entry.is_dir).unwrap();
        assert_eq!(
            file_entry.path,
            file.canonicalize().unwrap().to_string_lossy().into_owned()
        );
    }
}

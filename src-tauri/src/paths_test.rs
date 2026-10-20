#[cfg(test)]
mod tests {
    use crate::paths::{
        classify_args, expand_tilde, has_ignored_component_below, is_ignored_name, is_markdown,
        is_noise_name, is_relevant, is_under, modified_millis, ExcludeSet,
    };
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
    fn noise_names_are_recognized() {
        assert!(is_noise_name("node_modules"));
        assert!(is_noise_name("target"));
        assert!(is_noise_name(".venv"));
        assert!(is_noise_name("media"));
        assert!(is_noise_name("thumbnail"));
        assert!(is_noise_name("thumbnails"));
        assert!(is_noise_name("bundles"));
        assert!(is_noise_name("sitemap"));
        assert!(is_noise_name("uploads"));
        assert!(is_noise_name("vendor"));
        assert!(is_noise_name("__pycache__"));
        assert!(is_noise_name("htmlcov"));
        assert!(is_noise_name("docdeck.egg-info"));
        assert!(!is_noise_name("src"));
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
        let excludes = ExcludeSet::default();

        // An explicitly opened file reloads whatever its extension.
        assert!(is_relevant(&txt, &files, &roots, &excludes));
        // Fresh Markdown under a root is relevant.
        assert!(is_relevant(&doc, &files, &roots, &excludes));
        // A vanished Markdown row is relevant so the inbox can strike it
        // through even when it was never opened.
        assert!(is_relevant(
            &root.join("missing.md"),
            &files,
            &roots,
            &excludes
        ));
        // Markdown outside every root is not.
        assert!(!is_relevant(
            Path::new("/elsewhere/a.md"),
            &files,
            &roots,
            &excludes
        ));
    }

    #[test]
    fn relevance_rejects_noise_and_excluded_paths() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join("drafts")).unwrap();
        let noise = root.join("node_modules/dep.md");
        let draft = root.join("drafts/old.md");
        let keep = root.join("keep.md");
        fs::write(&noise, "# dep").unwrap();
        fs::write(&draft, "# old").unwrap();
        fs::write(&keep, "# keep").unwrap();

        let files: HashSet<PathBuf> = HashSet::new();
        let roots: HashSet<PathBuf> = [root.clone()].into();
        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/drafts/**".to_string()], dir.path());
        assert!(warnings.is_empty());

        assert!(!is_relevant(&noise, &files, &roots, &excludes));
        assert!(!is_relevant(&draft, &files, &roots, &excludes));
        assert!(is_relevant(&keep, &files, &roots, &excludes));
    }

    #[test]
    fn noise_check_ignores_components_above_the_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".notes");
        fs::create_dir_all(&root).unwrap();
        let doc = root.join("plan.md");
        fs::write(&doc, "# plan").unwrap();

        assert!(!has_ignored_component_below(&doc, &root));
        assert!(is_under(&doc, &root));
    }

    #[test]
    fn exclude_set_matches_directories_and_subtrees() {
        let dir = tempdir().unwrap();
        let (excludes, warnings) = ExcludeSet::build_lenient(
            &[dir.path().join("legacy").to_string_lossy().into_owned()],
            dir.path(),
        );
        assert!(warnings.is_empty());
        assert!(excludes.is_excluded(&dir.path().join("legacy")));
        assert!(excludes.is_excluded(&dir.path().join("legacy/deep/old.md")));
        assert!(!excludes.is_excluded(&dir.path().join("current/plan.md")));
    }

    #[test]
    fn empty_exclude_set_matches_nothing() {
        let excludes = ExcludeSet::default();
        assert!(excludes.is_empty());
        assert!(!excludes.is_excluded(Path::new("/tmp/anything.md")));
    }

    #[test]
    fn invalid_exclude_pattern_becomes_a_warning() {
        let (excludes, warnings) = ExcludeSet::build_lenient(&["[".to_string()], Path::new("/tmp"));
        assert!(excludes.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("exclude pattern"));
    }

    #[test]
    fn expand_tilde_handles_home_root_absolute_and_relative() {
        let home = Path::new("/home/tester");
        assert_eq!(expand_tilde("~", home), home);
        assert_eq!(expand_tilde("~/notes", home), home.join("notes"));
        assert_eq!(
            expand_tilde("/etc/notes", home),
            PathBuf::from("/etc/notes")
        );
        assert_eq!(expand_tilde("notes", home), home.join("notes"));
    }

    #[test]
    fn modified_millis_reads_a_real_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();
        assert!(modified_millis(&file).unwrap() > 0);
        assert!(modified_millis(&dir.path().join("missing.md")).is_none());
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

        let entries = classify_args(&argv, dir.path());
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

    #[test]
    fn classify_args_resolves_relative_paths_against_cwd() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();

        let argv = vec!["docdeck".to_string(), "plan.md".to_string()];

        // A forwarded command line resolves against the shell that sent it...
        let entries = classify_args(&argv, dir.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].path,
            file.canonicalize().unwrap().to_string_lossy().into_owned()
        );
        assert!(!entries[0].is_dir);

        // ...not against whatever directory the running app happens to have.
        let elsewhere = tempdir().unwrap();
        assert!(classify_args(&argv, elsewhere.path()).is_empty());
    }
}

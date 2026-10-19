#[cfg(test)]
mod tests {
    use crate::config::{expand_with_limits, load, Limits, WatchConfig};
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    fn config(watch: &[&str], exclude: &[&str]) -> WatchConfig {
        WatchConfig {
            watch: watch.iter().map(|value| value.to_string()).collect(),
            exclude: exclude.iter().map(|value| value.to_string()).collect(),
        }
    }

    fn names(paths: &[PathBuf]) -> Vec<String> {
        let mut names: Vec<String> = paths
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn expand(config: &WatchConfig, home: &Path) -> crate::config::WatchPlan {
        expand_with_limits(config, home, Limits::default())
    }

    // -- loading -------------------------------------------------------------

    #[test]
    fn missing_config_reports_not_found() {
        let dir = tempdir().unwrap();
        let loaded = load(&dir.path().join("config.toml")).unwrap();
        assert!(!loaded.found);
        assert!(loaded.config.watch.is_empty());
        assert!(loaded.config.exclude.is_empty());
    }

    #[test]
    fn parses_watch_and_exclude_arrays() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(
            &path,
            "watch = [\"~/notes\"]\nexclude = [\"**/drafts/**\"]\n",
        )
        .unwrap();

        let loaded = load(&path).unwrap();
        assert!(loaded.found);
        assert_eq!(loaded.config.watch, vec!["~/notes"]);
        assert_eq!(loaded.config.exclude, vec!["**/drafts/**"]);
    }

    #[test]
    fn empty_config_is_valid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "").unwrap();
        let loaded = load(&path).unwrap();
        assert!(loaded.found);
        assert!(loaded.config.watch.is_empty());
    }

    #[test]
    fn malformed_toml_is_an_error_naming_the_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = [\"unterminated\n").unwrap();

        let error = load(&path).unwrap_err();
        assert!(error.contains("config.toml"), "error was: {error}");
    }

    // -- expansion -----------------------------------------------------------

    #[test]
    fn literal_directory_becomes_a_root() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();

        let plan = expand(&config(&["~/notes"], &[]), home.path());

        assert_eq!(
            plan.roots,
            vec![home.path().join("notes").canonicalize().unwrap()]
        );
        assert!(plan.files.is_empty());
        assert!(plan.warnings.is_empty());
        assert!(!plan.truncated);
    }

    #[test]
    fn relative_selector_resolves_against_home() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();

        let plan = expand(&config(&["notes"], &[]), home.path());

        assert_eq!(names(&plan.roots), vec!["notes"]);
    }

    #[test]
    fn single_star_matches_one_segment_only() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("projects/alpha")).unwrap();
        fs::create_dir_all(home.path().join("projects/beta/nested")).unwrap();

        let plan = expand(&config(&["~/projects/*"], &[]), home.path());

        assert_eq!(names(&plan.roots), vec!["alpha", "beta"]);
        assert!(plan
            .roots
            .iter()
            .all(|root| root.file_name().unwrap() != "nested"));
    }

    #[test]
    fn deep_glob_matches_files_at_the_root_and_nested() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/sub")).unwrap();
        fs::write(home.path().join("notes/top.md"), "# top").unwrap();
        fs::write(home.path().join("notes/sub/deep.md"), "# deep").unwrap();
        fs::write(home.path().join("notes/sub/skip.txt"), "nope").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &[]), home.path());

        assert_eq!(names(&plan.files), vec!["deep.md", "top.md"]);
    }

    #[test]
    fn explicit_file_selector_accepts_any_extension() {
        let home = tempdir().unwrap();
        fs::write(home.path().join("todo.txt"), "task").unwrap();

        let plan = expand(&config(&["~/todo.txt"], &[]), home.path());

        assert_eq!(names(&plan.files), vec!["todo.txt"]);
        assert!(plan.roots.is_empty());
    }

    #[test]
    fn noise_directories_are_pruned() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/node_modules")).unwrap();
        fs::create_dir_all(home.path().join("notes/target")).unwrap();
        fs::create_dir_all(home.path().join("notes/sub")).unwrap();
        fs::write(home.path().join("notes/node_modules/dep.md"), "# dep").unwrap();
        fs::write(home.path().join("notes/target/out.md"), "# out").unwrap();
        fs::write(home.path().join("notes/keep.md"), "# keep").unwrap();
        fs::write(home.path().join("notes/sub/deep.md"), "# deep").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &[]), home.path());

        assert_eq!(names(&plan.files), vec!["deep.md", "keep.md"]);
    }

    #[test]
    fn symlinked_directories_are_skipped() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/real")).unwrap();
        symlink(
            home.path().join("notes/real"),
            home.path().join("notes/link"),
        )
        .unwrap();

        let plan = expand(&config(&["~/notes/*"], &[]), home.path());

        assert_eq!(names(&plan.roots), vec!["real"]);
    }

    // -- excludes ------------------------------------------------------------

    #[test]
    fn exclude_pattern_removes_files_and_subtrees() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/drafts")).unwrap();
        fs::write(home.path().join("notes/keep.md"), "# keep").unwrap();
        fs::write(home.path().join("notes/drafts/old.md"), "# old").unwrap();

        let plan = expand(
            &config(&["~/notes/**/*.md"], &["~/notes/drafts"]),
            home.path(),
        );

        assert_eq!(names(&plan.files), vec!["keep.md"]);
        assert!(plan
            .excludes
            .is_excluded(&home.path().join("notes/drafts/old.md")));
    }

    #[test]
    fn invalid_exclude_pattern_warns_but_keeps_the_rest() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();
        fs::write(home.path().join("notes/keep.md"), "# keep").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &["["]), home.path());

        assert_eq!(names(&plan.files), vec!["keep.md"]);
        assert_eq!(plan.warnings.len(), 1);
        assert!(plan.warnings[0].contains("exclude pattern"));
    }

    // -- caps and warnings ---------------------------------------------------

    #[test]
    fn unmatched_selector_warns() {
        let home = tempdir().unwrap();

        let plan = expand(&config(&["~/nowhere/**/*.md"], &[]), home.path());

        assert!(plan.roots.is_empty());
        assert!(plan.files.is_empty());
        assert_eq!(plan.warnings.len(), 1);
        assert!(plan.warnings[0].contains("matched nothing"));
    }

    #[test]
    fn duplicate_selectors_do_not_duplicate_roots() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();

        let plan = expand(
            &config(&["~/notes", "~/notes", "~/notes/"], &[]),
            home.path(),
        );

        assert_eq!(plan.roots.len(), 1);
    }

    #[test]
    fn root_cap_truncates_with_a_warning() {
        let home = tempdir().unwrap();
        for name in ["a", "b", "c"] {
            fs::create_dir_all(home.path().join("projects").join(name)).unwrap();
        }

        let plan = expand_with_limits(
            &config(&["~/projects/*"], &[]),
            home.path(),
            Limits {
                max_roots: 2,
                max_files: 10,
            },
        );

        assert_eq!(plan.roots.len(), 2);
        assert!(plan.truncated);
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("watch root limit")));
    }

    #[test]
    fn file_cap_truncates_with_a_warning() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();
        fs::write(home.path().join("notes/a.md"), "# a").unwrap();
        fs::write(home.path().join("notes/b.md"), "# b").unwrap();

        let plan = expand_with_limits(
            &config(&["~/notes/**/*.md"], &[]),
            home.path(),
            Limits {
                max_roots: 10,
                max_files: 1,
            },
        );

        assert_eq!(plan.files.len(), 1);
        assert!(plan.truncated);
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("file limit")));
    }
}

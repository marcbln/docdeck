#[cfg(test)]
mod tests {
    use crate::config_edit::{read_view, save, SaveFailure, SaveRequest};
    use std::fs;
    use tempfile::tempdir;

    fn request(watch: &[&str], exclude: &[&str], revision: &str) -> SaveRequest {
        SaveRequest {
            watch: watch.iter().map(|value| value.to_string()).collect(),
            exclude: exclude.iter().map(|value| value.to_string()).collect(),
            expected_revision: revision.to_string(),
            create_from_example: false,
        }
    }

    fn revision_of(path: &std::path::Path) -> String {
        crate::config::revision_of(&fs::read(path).unwrap())
    }

    #[test]
    fn read_view_reports_a_missing_file_without_creating_it() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let view = read_view(&path);

        assert!(!view.found);
        assert!(view.error.is_none());
        assert!(view.watch.is_empty());
        assert!(!path.exists());
    }

    #[test]
    fn read_view_reports_a_parse_error_and_empty_lists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = [").unwrap();

        let view = read_view(&path);

        assert!(view.found);
        assert!(view.error.is_some());
        assert!(view.watch.is_empty());
        assert!(!view.revision.is_empty());
    }

    #[test]
    fn save_preserves_comments_formatting_tray_and_unknown_keys() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(
            &path,
            r#"# top comment
watch = [
  "/old", # keep this one
]
exclude = []

[tray]
enabled = false
notify = "off"

[unknown]
answer = 42
"#,
        )
        .unwrap();

        let result = save(
            &path,
            &request(&["/old", "/new"], &["**/archive/**"], &revision_of(&path)),
        )
        .expect("save succeeds");

        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("# top comment"));
        assert!(written.contains("# keep this one"));
        assert!(written.contains("/old"));
        assert!(written.contains("/new"));
        assert!(written.contains("**/archive/**"));
        assert!(written.contains("[tray]"));
        assert!(written.contains("enable"));
        assert!(written.contains("[unknown]"));
        assert!(written.contains("answer = 42"));
        assert_eq!(result.revision, revision_of(&path));
    }

    #[test]
    fn save_folds_duplicates_and_reports_them() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = []\nexclude = []\n").unwrap();

        let result = save(
            &path,
            &request(
                &["/a", " /a ", "/b"],
                &["**/x/**", "**/x/**"],
                &revision_of(&path),
            ),
        )
        .expect("save succeeds");

        assert_eq!(result.warnings.len(), 2);
        let written = fs::read_to_string(&path).unwrap();
        assert_eq!(written.matches("/a").count(), 1);
        assert_eq!(written.matches("**/x/**").count(), 1);
    }

    #[test]
    fn save_rejects_an_invalid_selector_without_writing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = []\n").unwrap();
        let before = fs::read(&path).unwrap();

        let failure = save(
            &path,
            &request(&["[bad"], &[], &revision_of(&path)),
        )
        .expect_err("invalid selector is rejected");

        match failure {
            SaveFailure::Invalid { errors, .. } => {
                assert_eq!(errors[0].field, "watch");
            }
            other => panic!("unexpected failure: {other:?}"),
        }
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn save_rejects_an_empty_selector() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = []\n").unwrap();

        let failure = save(&path, &request(&["   "], &[], &revision_of(&path)))
            .expect_err("empty selector is rejected");

        assert!(matches!(failure, SaveFailure::Invalid { .. }));
    }

    #[test]
    fn a_stale_revision_is_a_conflict_and_writes_nothing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = [\"/disk\"]\n").unwrap();
        let before = fs::read(&path).unwrap();

        let failure = save(&path, &request(&["/draft"], &[], "not-the-revision"))
            .expect_err("stale revision conflicts");

        match failure {
            SaveFailure::Conflict(current) => {
                assert_eq!(current.watch, vec!["/disk"]);
            }
            other => panic!("unexpected failure: {other:?}"),
        }
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn save_creates_a_missing_file_from_the_example() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested/config.toml");

        let mut create = request(&["~/docs"], &["**/archive/**"], "");
        create.create_from_example = true;

        save(&path, &create).expect("create succeeds");

        let view = read_view(&path);
        assert!(view.found);
        assert_eq!(view.watch, vec!["~/docs"]);
        assert_eq!(view.exclude, vec!["**/archive/**"]);
    }

    #[test]
    fn save_is_atomic_and_leaves_no_temp_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = []\n").unwrap();

        save(&path, &request(&["/a"], &[], &revision_of(&path))).unwrap();

        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["config.toml".to_string()]);
        assert!(fs::read_to_string(&path).unwrap().contains("/a"));
    }

    #[test]
    fn save_does_not_replace_an_unparseable_hand_written_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = [").unwrap();
        let before = fs::read(&path).unwrap();

        let failure = save(
            &path,
            &request(&["/a"], &[], &revision_of(&path)),
        )
        .expect_err("unparseable file is protected");

        assert!(matches!(failure, SaveFailure::Invalid { .. }));
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}

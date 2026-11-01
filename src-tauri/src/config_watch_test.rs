#[cfg(test)]
mod tests {
    use crate::commands::Origin;
    use crate::config::{self, Limits, Platform};
    use crate::config_watch::{
        config_watch_target, reconcile_config, should_expand, ConfigWatchState, CONFIG_DEBOUNCE_MS,
    };
    use crate::watcher::WatcherState;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    fn reconcile(
        watcher: &WatcherState,
        config_path: &Path,
        home: &Path,
        revision: &str,
    ) -> crate::commands::ReloadResult {
        reconcile_config(
            watcher,
            config_path,
            home,
            Platform::Linux,
            Limits::default(),
            1,
            revision.to_string(),
            &mut |_, _, _| {},
        )
    }

    #[test]
    fn watches_the_config_parent_directory() {
        let path = Path::new("/home/reader/.config/docdeck/config.toml");
        assert_eq!(
            config_watch_target(path),
            Path::new("/home/reader/.config/docdeck")
        );
        assert_eq!(
            config_watch_target(Path::new("config.toml")),
            Path::new(".")
        );
    }

    #[test]
    fn debounce_window_matches_the_document_debounce() {
        assert_eq!(CONFIG_DEBOUNCE_MS, 300);
        assert_eq!(CONFIG_DEBOUNCE_MS, crate::watcher::DEBOUNCE_MS);
    }

    #[test]
    fn unchanged_revision_skips_expansion() {
        assert!(should_expand(None, "abc"));
        assert!(!should_expand(Some("abc"), "abc"));
        assert!(should_expand(Some("abc"), "def"));
    }

    #[test]
    fn generations_are_monotonic() {
        let first = config::next_generation();
        let second = config::next_generation();
        let third = config::next_generation();
        assert!(second > first);
        assert!(third > second);
    }

    #[test]
    fn state_tracks_the_last_applied_revision() {
        let state = ConfigWatchState::new();
        assert_eq!(state.last_applied_revision(), None);
        assert!(state.revision_changed("aaa"));

        state.record_applied("aaa");
        assert!(!state.revision_changed("aaa"));
        assert!(state.revision_changed("bbb"));
    }

    #[test]
    fn invalid_config_keeps_the_previous_watch_plan() {
        let dir = tempdir().unwrap();
        let docs = dir.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        fs::write(docs.join("plan.md"), "# plan").unwrap();

        let config_path = dir.path().join("config.toml");
        fs::write(
            &config_path,
            format!("watch = [\"{}\"]\n", docs.display()),
        )
        .unwrap();

        let watcher = WatcherState::new();
        let applied = reconcile(&watcher, &config_path, dir.path(), "rev-1");
        assert!(applied.error.is_none());
        assert!(!watcher.watched_roots.lock().unwrap().is_empty());

        let watched_before = watcher.watched_roots.lock().unwrap().clone();

        fs::write(&config_path, "watch = [").unwrap();
        let rejected = reconcile(&watcher, &config_path, dir.path(), "rev-2");
        assert!(rejected.error.is_some());
        assert_eq!(watcher.watched_roots.lock().unwrap().clone(), watched_before);
        // The last valid watch plan remains usable: its roots are still
        // reported so the webview does not narrow relevance to session roots.
        assert!(rejected
            .roots
            .iter()
            .any(|root| root == &docs.to_string_lossy()));
    }

    #[test]
    fn session_roots_survive_a_reload_and_are_rescanned() {
        let dir = tempdir().unwrap();
        let session = dir.path().join("session");
        let config_root = dir.path().join("configured");
        fs::create_dir_all(&session).unwrap();
        fs::create_dir_all(&config_root).unwrap();
        fs::write(session.join("session.md"), "# session").unwrap();
        fs::write(config_root.join("config.md"), "# config").unwrap();

        let config_path = dir.path().join("config.toml");
        fs::write(
            &config_path,
            format!("watch = [\"{}\"]\n", config_root.display()),
        )
        .unwrap();

        let watcher = WatcherState::new();
        watcher
            .watch_roots(std::slice::from_ref(&session))
            .unwrap();

        let result = reconcile(&watcher, &config_path, dir.path(), "rev-1");

        assert!(result.error.is_none());
        assert!(result.roots.iter().any(|root| root == &session.to_string_lossy()));
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.filename == "session.md" && entry.origin == Origin::Session));
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.filename == "config.md" && entry.origin == Origin::Config));
        assert!(watcher.watched_roots.lock().unwrap().contains(&session));
        assert!(!result.entries.is_empty());
    }

    #[test]
    fn reload_replaces_config_entries_and_keeps_them_typed() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("docs");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("plan.md"), "# plan").unwrap();

        let config_path = dir.path().join("config.toml");
        fs::write(&config_path, format!("watch = [\"{}\"]\n", root.display())).unwrap();

        let watcher = WatcherState::new();
        let first = reconcile(&watcher, &config_path, dir.path(), "rev-1");
        assert_eq!(first.entries.len(), 1);
        assert_eq!(first.entries[0].origin, Origin::Config);
        assert!(!first.revision.is_empty());

        let second = reconcile(&watcher, &config_path, dir.path(), "rev-2");
        assert_eq!(second.entries.len(), 1);
        assert!(second.generation >= first.generation);
    }

    #[test]
    fn missing_config_reports_not_found_without_error() {
        let dir = tempdir().unwrap();
        let watcher = WatcherState::new();
        let result = reconcile(
            &watcher,
            &dir.path().join("config.toml"),
            dir.path(),
            "",
        );
        assert!(!result.found);
        assert!(result.error.is_none());
        assert!(result.entries.is_empty());
    }

}

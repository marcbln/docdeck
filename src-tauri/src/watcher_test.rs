#[cfg(test)]
mod tests {
    use crate::paths::ExcludeSet;
    use crate::watcher::WatcherState;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    fn watched(state: &WatcherState) -> Vec<String> {
        let mut paths: Vec<String> = state
            .watched_paths
            .lock()
            .unwrap()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn watch_and_unwatch_lifecycle() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test_agent_doc.md");
        let mut file = File::create(&file_path).unwrap();
        writeln!(file, "# Test Plan").unwrap();

        let state = WatcherState::new();
        assert!(state.watched_paths.lock().unwrap().is_empty());

        state.watch_file(&file_path).unwrap();
        assert_eq!(state.watched_paths.lock().unwrap().len(), 1);
        assert!(state.watched_paths.lock().unwrap().contains(&file_path));

        state.unwatch_file(&file_path).unwrap();
        assert!(state.watched_paths.lock().unwrap().is_empty());
    }

    #[test]
    fn watch_is_idempotent() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("agent_plan.md");
        File::create(&file_path).unwrap();

        let state = WatcherState::new();
        state.watch_file(&file_path).unwrap();
        state.watch_file(&file_path).unwrap();

        assert_eq!(state.watched_paths.lock().unwrap().len(), 1);
    }

    #[test]
    fn unwatch_of_untracked_path_is_noop() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("never_opened.md");
        File::create(&file_path).unwrap();

        let state = WatcherState::new();
        state.unwatch_file(&file_path).unwrap();

        assert!(state.watched_paths.lock().unwrap().is_empty());
    }

    #[test]
    fn tracks_multiple_documents_independently() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        File::create(&a).unwrap();
        File::create(&b).unwrap();

        let state = WatcherState::new();
        state.watch_file(&a).unwrap();
        state.watch_file(&b).unwrap();
        assert_eq!(state.watched_paths.lock().unwrap().len(), 2);

        state.unwatch_file(&a).unwrap();
        assert_eq!(watched(&state), vec![b.to_string_lossy().to_string()]);
    }

    #[test]
    fn watch_roots_registers_directories_idempotently() {
        let dir = tempdir().unwrap();
        let state = WatcherState::new();

        state.watch_roots(&[dir.path().to_path_buf()]).unwrap();
        state.watch_roots(&[dir.path().to_path_buf()]).unwrap();

        assert_eq!(state.watched_roots.lock().unwrap().len(), 1);
        assert!(state.watched_roots.lock().unwrap().contains(dir.path()));
    }

    #[test]
    fn tracks_several_roots() {
        let first = tempdir().unwrap();
        let second = tempdir().unwrap();
        let state = WatcherState::new();

        state
            .watch_roots(&[first.path().to_path_buf(), second.path().to_path_buf()])
            .unwrap();

        assert_eq!(state.watched_roots.lock().unwrap().len(), 2);
    }

    #[test]
    fn file_and_root_registries_are_independent() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("plan.md");
        File::create(&file_path).unwrap();

        let state = WatcherState::new();
        state.watch_file(&file_path).unwrap();
        state.watch_roots(&[dir.path().to_path_buf()]).unwrap();

        assert_eq!(state.watched_paths.lock().unwrap().len(), 1);
        assert_eq!(state.watched_roots.lock().unwrap().len(), 1);
    }

    #[test]
    fn pinned_file_survives_tab_close() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("config_notes.md");
        File::create(&file_path).unwrap();

        let state = WatcherState::new();
        state.pin_file(&file_path).unwrap();
        state.unwatch_file(&file_path).unwrap();

        assert!(state.watched_paths.lock().unwrap().contains(&file_path));
    }

    #[test]
    fn excludes_are_stored_and_returned() {
        let state = WatcherState::new();
        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/archive/**".to_string()], std::path::Path::new("/tmp"));
        assert!(warnings.is_empty());

        state.set_excludes(excludes).unwrap();

        assert!(state
            .excludes()
            .is_excluded(std::path::Path::new("/tmp/archive/x.md")));
        assert!(!state
            .excludes()
            .is_excluded(std::path::Path::new("/tmp/current/x.md")));
    }

    #[test]
    fn replace_config_watches_swaps_only_config_owned_roots() {
        let config_root = tempdir().unwrap();
        let session_root = tempdir().unwrap();
        let state = WatcherState::new();

        state
            .watch_roots(std::slice::from_ref(&session_root.path().to_path_buf()))
            .unwrap();
        state
            .replace_config_watches(&[config_root.path().to_path_buf()], &[])
            .unwrap();

        assert!(state
            .watched_roots
            .lock()
            .unwrap()
            .contains(config_root.path()));
        assert!(state
            .watched_roots
            .lock()
            .unwrap()
            .contains(session_root.path()));

        state.replace_config_watches(&[], &[]).unwrap();

        assert!(!state
            .watched_roots
            .lock()
            .unwrap()
            .contains(config_root.path()));
        assert!(state
            .watched_roots
            .lock()
            .unwrap()
            .contains(session_root.path()));
    }

    #[test]
    fn replace_config_watches_keeps_session_roots_across_reloads() {
        let root = tempdir().unwrap();
        let state = WatcherState::new();
        state
            .watch_roots(std::slice::from_ref(&root.path().to_path_buf()))
            .unwrap();

        for _ in 0..3 {
            state.replace_config_watches(&[], &[]).unwrap();
        }

        assert!(state.watched_roots.lock().unwrap().contains(root.path()));
        assert_eq!(state.session_roots(), vec![root.path().to_path_buf()]);
    }

    #[test]
    fn config_file_removal_does_not_drop_an_open_tab() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("open.md");
        File::create(&file).unwrap();

        let state = WatcherState::new();
        state.watch_file(&file).unwrap();
        state
            .replace_config_watches(&[], std::slice::from_ref(&file))
            .unwrap();
        state.replace_config_watches(&[], &[]).unwrap();

        // The tab still owns the watch even though the config stopped pinning it.
        assert!(state.watched_paths.lock().unwrap().contains(&file));

        state.unwatch_file(&file).unwrap();
        assert!(!state.watched_paths.lock().unwrap().contains(&file));
    }

    #[test]
    fn config_pins_survive_a_tab_close() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("pinned.md");
        File::create(&file).unwrap();

        let state = WatcherState::new();
        state.watch_file(&file).unwrap();
        state
            .replace_config_watches(&[], std::slice::from_ref(&file))
            .unwrap();
        state.unwatch_file(&file).unwrap();

        assert!(state.watched_paths.lock().unwrap().contains(&file));

        state.replace_config_watches(&[], &[]).unwrap();
        assert!(!state.watched_paths.lock().unwrap().contains(&file));
    }
}

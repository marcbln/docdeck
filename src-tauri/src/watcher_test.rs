#[cfg(test)]
mod tests {
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
}

mod commands;
mod render;
mod watcher;

#[cfg(test)]
mod render_test;
#[cfg(test)]
mod watcher_test;

use std::env;
use std::io;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use watcher::WatcherState;

/// Collects file paths from a CLI argument vector, skipping the executable and
/// any flag-style argument. Paths are canonicalized so they match the keys the
/// frontend uses for tab state.
fn collect_paths(argv: Vec<String>) -> Vec<String> {
    argv.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            PathBuf::from(&arg)
                .canonicalize()
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        })
        .collect()
}

/// Returns the document paths this process was launched with.
///
/// The frontend pulls these once it has registered its event listeners. An
/// emitted event would race the webview's mount and be dropped on slow
/// machines; a command the frontend calls at the right moment cannot.
#[tauri::command]
fn startup_paths() -> Vec<String> {
    collect_paths(env::args().collect())
}

pub fn run() {
    let argv: Vec<String> = env::args().collect();

    // Must happen before any window exists: WebKitGTK reads these once, while
    // it initialises, so setting them later has no effect.
    render::configure(&argv);

    let watcher_state = WatcherState::new();

    let mut builder = tauri::Builder::default();

    // Must be registered first so the IPC socket exists before anything else.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        // Forward `docdeck path/to/doc.md` from a second shell into the running window.
        for path in collect_paths(argv) {
            let _ = app.emit("open-file-cli", path);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder
        .manage(watcher_state)
        .setup(|app| {
            app.state::<WatcherState>()
                .init(app.handle().clone())
                .map_err(io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file,
            commands::close_file,
            startup_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running docdeck application");
}

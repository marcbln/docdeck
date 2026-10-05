//! Application wiring: builder, single-instance IPC, plugin setup.

mod commands;
mod folder;
mod paths;
mod render;
mod watcher;

#[cfg(test)]
mod folder_test;
#[cfg(test)]
mod paths_test;
#[cfg(test)]
mod render_test;
#[cfg(test)]
mod watcher_test;

use std::env;
use std::io;
use tauri::{Emitter, Manager};

use paths::CliEntry;
use watcher::WatcherState;

/// Returns the document and folder paths this process was launched with.
///
/// The frontend pulls these once it has registered its event listeners. An
/// emitted event would race the webview's mount and be dropped on slow
/// machines; a command the frontend calls at the right moment cannot.
#[tauri::command]
fn startup_paths() -> Vec<CliEntry> {
    paths::classify_args(&env::args().collect::<Vec<_>>())
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
        // Forward `docdeck path/to/doc.md` or `docdeck ./_ai` from a second
        // shell into the running window.
        for entry in paths::classify_args(&argv) {
            let _ = app.emit("open-path-cli", entry);
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
            commands::scan_folder,
            commands::watch_folders,
            startup_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running docdeck application");
}

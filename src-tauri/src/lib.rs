//! Application wiring: builder, single-instance IPC, plugin setup.

mod commands;
mod config;
mod config_edit;
mod config_watch;
mod detach;
mod folder;
mod navigation;
mod paths;
mod rename;
mod render;
mod tray;
mod watcher;

#[cfg(test)]
mod commands_test;
#[cfg(test)]
mod config_test;
#[cfg(test)]
mod config_edit_test;
#[cfg(test)]
mod config_watch_test;
#[cfg(test)]
mod folder_test;
#[cfg(test)]
mod navigation_test;
#[cfg(test)]
mod paths_test;
#[cfg(test)]
mod rename_test;
#[cfg(test)]
mod render_test;
#[cfg(test)]
mod tray_test;
#[cfg(test)]
mod watcher_test;

use std::env;
use std::io;
use std::path::Path;
use tauri::{Emitter, Manager};

use config_watch::ConfigWatchState;
use paths::CliEntry;
use watcher::WatcherState;

/// Returns the document and folder paths this process was launched with.
///
/// The frontend pulls these once it has registered its event listeners. An
/// emitted event would race the webview's mount and be dropped on slow
/// machines; a command the frontend calls at the right moment cannot.
#[tauri::command]
fn startup_paths() -> Vec<CliEntry> {
    let cwd = env::current_dir().unwrap_or_default();
    paths::classify_args(&env::args().collect::<Vec<_>>(), &cwd)
}

/// Cancels every webview navigation that leaves docdeck's own origin.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let dev = tauri::is_dev();
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(move |_webview, url| navigation::allows_navigation(url, dev))
        .build()
}

pub fn run() {
    let argv: Vec<String> = env::args().collect();

    // Report bad path arguments while stderr still points at the caller's
    // terminal. `detach_from_terminal` redirects stdio to /dev/null, so doing
    // this afterwards would swallow the message along with the typo.
    let cwd = env::current_dir().unwrap_or_default();
    for warning in paths::classify_args_with_warnings(&argv, &cwd).1 {
        eprintln!("[docdeck] {warning}");
    }

    detach::detach_from_terminal();

    // Must happen before any window exists: WebKitGTK reads these once, while
    // it initialises, so setting them later has no effect.
    render::configure(&argv);

    let watcher_state = WatcherState::new();

    let mut builder = tauri::Builder::default();

    // Must be registered first so the IPC socket exists before anything else.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        // Forward `docdeck path/to/doc.md` or `docdeck ./_ai` from a second
        // shell into the running window. Relative arguments belong to *that*
        // shell's working directory, which is `cwd` here — not ours.
        for entry in paths::classify_args(&argv, Path::new(&cwd)) {
            let _ = app.emit("open-path-cli", entry);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder = builder.plugin(navigation_guard());

    builder = builder.plugin(tauri_plugin_notification::init());

    builder
        .manage(watcher_state)
        .manage(ConfigWatchState::new())
        .on_window_event(|window, event| {
            // Regaining focus means the user has seen the changes: retire the
            // unread dot. The tray may be disabled, so this is best-effort.
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                if let Some(manager) = window.try_state::<std::sync::Arc<tray::TrayManager>>() {
                    manager.set_presence(tray::Presence::Current);
                }
            }
        })
        .setup(|app| {
            app.state::<WatcherState>()
                .init(app.handle().clone())
                .map_err(io::Error::other)?;
            // Live reload: watch the config file's parent directory. A failure
            // here is non-fatal; the in-app surface can still save and reload.
            let config_path = config::config_path();
            if let Err(error) = app
                .state::<ConfigWatchState>()
                .start(app.handle().clone(), config_path)
            {
                eprintln!("[docdeck] config watcher unavailable: {error}");
            }
            // The tray re-reads the config file itself; a malformed config is
            // already surfaced by the sidebar panel, so the tray falls back to
            // its defaults rather than duplicating the error.
            let tray_config = config::load(&config::config_path())
                .map(|loaded| loaded.config.tray)
                .unwrap_or_default();
            if tray_config.enabled {
                if let Err(error) = tray::setup(app, tray_config) {
                    eprintln!("[docdeck] tray unavailable: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file,
            commands::close_file,
            commands::load_watches,
            commands::read_watch_config,
            commands::save_watch_config,
            commands::reload_watch_config,
            commands::add_watch,
            commands::open_external_url,
            commands::open_local_path,
            commands::resolve_document_link,
            startup_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running docdeck application");
}

//! Panel tray icon: a chat-style presence dot plus change notifications.
//!
//! The tray carries the app's whole "something happened" story: green while
//! the user is caught up, amber while changes arrived that the user has not
//! looked at (cleared when the window regains focus). Desktop notifications
//! are optional, mode-gated and throttled so a burst of agent writes raises at
//! most one popup per throttle window.

use image::RgbaImage;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Listener, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::config::{NotifyMode, TrayConfig};
use crate::watcher::PathChange;

/// Base tray icon, before any presence dot is painted on it.
const BASE_ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

/// Dot radius as a fraction of the icon size.
const DOT_RADIUS_FRACTION: f32 = 0.30;
/// Dark ring around the dot so it stays visible on any base icon.
const RING_PX: i64 = 2;
/// Files named in one notification; the rest are summarized as "+N more".
const MAX_NOTIFY_FILES: usize = 3;
/// Menu ids kept in one place so builder and handler cannot drift.
const MENU_SHOW: &str = "show";
const MENU_NOTIFY: &str = "notify";
const MENU_QUIT: &str = "quit";

/// Where the unread changes left the presence dot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    /// Nothing pending: the window is (or was last) focused.
    Current,
    /// Changes settled while the window was not focused.
    Unread,
}

impl Presence {
    pub(crate) fn rgb(self) -> [u8; 3] {
        match self {
            Self::Current => [38, 166, 91],
            Self::Unread => [235, 152, 44],
        }
    }
}

/// Paints the presence dot onto a copy of the base icon (bottom-right corner,
/// chat-style, with a dark contrast ring).
pub fn compose_presence_icon(base: &RgbaImage, presence: Presence) -> RgbaImage {
    let (width, height) = base.dimensions();
    let side = width.min(height) as f32;
    let radius = (side * DOT_RADIUS_FRACTION).round().max(3.0) as i64;
    let center_x = width as i64 - radius - RING_PX - 1;
    let center_y = height as i64 - radius - RING_PX - 1;
    let color = presence.rgb();
    let ring = [24u8, 26, 30];

    let mut img = base.clone();
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let dx = x as i64 - center_x;
        let dy = y as i64 - center_y;
        let distance_sq = dx * dx + dy * dy;
        if distance_sq <= radius * radius {
            *pixel = image::Rgba([color[0], color[1], color[2], 255]);
        } else if distance_sq <= (radius + RING_PX) * (radius + RING_PX) {
            *pixel = image::Rgba([ring[0], ring[1], ring[2], 255]);
        }
    }
    img
}

fn to_tauri_image(img: &RgbaImage) -> tauri::image::Image<'static> {
    tauri::image::Image::new_owned(img.clone().into_raw(), img.width(), img.height())
}

/// Whether this change batch may raise a notification, given mode, focus and
/// the throttle window. Split out so the decision is unit-testable without an
/// AppHandle or a real desktop.
pub fn should_notify(
    mode: NotifyMode,
    focused: bool,
    throttle: Duration,
    last: Option<Instant>,
    now: Instant,
) -> bool {
    match mode {
        NotifyMode::Off => false,
        NotifyMode::Unfocused if focused => false,
        NotifyMode::Unfocused | NotifyMode::Always => {
            last.is_none_or(|previous| now.saturating_duration_since(previous) >= throttle)
        }
    }
}

/// Body text naming the changed documents, capped so one agent burst does not
/// become a novel.
pub fn notification_body(changes: &[PathChange], max_files: usize) -> String {
    let present: Vec<&PathChange> = changes.iter().filter(|change| change.exists).collect();
    let listed: Vec<String> = present
        .iter()
        .take(max_files)
        .map(|change| {
            let path = std::path::Path::new(&change.path);
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| change.path.clone())
        })
        .collect();

    if listed.is_empty() {
        return "watched files were removed".to_string();
    }
    let mut body = listed.join(", ");
    let remaining = present.len() - listed.len();
    if remaining > 0 {
        body.push_str(&format!(" +{remaining} more"));
    }
    body.push_str(" changed");
    body
}

/// Mutable tray state guarded by one short-scope mutex.
struct TrayRuntime {
    presence: Presence,
    notify: NotifyMode,
    /// Mode the tray was configured with: the menu toggle switches between
    /// this and `Off`, it does not cycle through all modes.
    notify_default: NotifyMode,
    last_notification: Option<Instant>,
}

/// Shared tray owner; registered with `app.manage` in setup.
pub struct TrayManager {
    base: RgbaImage,
    throttle: Duration,
    icon: Mutex<Option<TrayIcon>>,
    runtime: Mutex<TrayRuntime>,
}

impl TrayManager {
    pub fn new(base: RgbaImage, config: &TrayConfig) -> Self {
        Self {
            base,
            throttle: Duration::from_secs(config.throttle_secs),
            icon: Mutex::new(None),
            runtime: Mutex::new(TrayRuntime {
                presence: Presence::Current,
                notify: config.notify,
                notify_default: config.notify,
                last_notification: None,
            }),
        }
    }

    fn set_icon(&self, presence: Presence) {
        if let Some(icon) = self.icon.lock().ok().and_then(|guard| guard.clone()) {
            let composed = to_tauri_image(&compose_presence_icon(&self.base, presence));
            let _ = icon.set_icon(Some(composed));
        }
    }

    /// Moves the dot to `presence` if that is a change worth painting.
    pub fn set_presence(&self, presence: Presence) {
        let changed = {
            let Ok(mut runtime) = self.runtime.lock() else {
                return;
            };
            if runtime.presence == presence {
                false
            } else {
                runtime.presence = presence;
                true
            }
        };
        if changed {
            self.set_icon(presence);
        }
    }

    /// One settled watcher batch: update the dot, then maybe notify.
    pub fn handle_changes(&self, app: &AppHandle, changes: &[PathChange], focused: bool) {
        if changes.is_empty() {
            return;
        }
        self.set_presence(if focused {
            Presence::Current
        } else {
            Presence::Unread
        });

        let now = Instant::now();
        let may = self.runtime.lock().is_ok_and(|runtime| {
            should_notify(
                runtime.notify,
                focused,
                self.throttle,
                runtime.last_notification,
                now,
            )
        });
        if !may {
            return;
        }

        let body = notification_body(changes, MAX_NOTIFY_FILES);
        let title = if changes.len() == 1 {
            "docdeck: 1 change".to_string()
        } else {
            format!("docdeck: {} changes", changes.len())
        };
        if app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .is_ok()
        {
            if let Ok(mut runtime) = self.runtime.lock() {
                runtime.last_notification = Some(now);
            }
        }
    }

    /// Menu toggle: switch between "off" and the configured mode.
    pub fn toggle_notify(&self, item: &CheckMenuItem<tauri::Wry>) {
        let enabled = {
            let Ok(mut runtime) = self.runtime.lock() else {
                return;
            };
            runtime.notify = if runtime.notify == NotifyMode::Off {
                runtime.notify_default
            } else {
                NotifyMode::Off
            };
            runtime.notify != NotifyMode::Off
        };
        let _ = item.set_checked(enabled);
    }

    fn show_main_window(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// Builds the tray, registers the manager and subscribes to watcher events.
/// A failure here is never fatal: docdeck still runs as a plain window and the
/// reason is printed to stderr.
pub fn setup(app: &mut tauri::App, config: TrayConfig) -> Result<(), Box<dyn std::error::Error>> {
    let base =
        image::load_from_memory_with_format(BASE_ICON_PNG, image::ImageFormat::Png)?.to_rgba8();

    let manager = std::sync::Arc::new(TrayManager::new(base, &config));
    app.manage(manager.clone());

    let notify_item = CheckMenuItemBuilder::new("Notify on changes")
        .id(MENU_NOTIFY)
        .checked(config.notify != NotifyMode::Off)
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .text(MENU_SHOW, "Show docdeck")
        .item(&notify_item)
        .separator()
        .text(MENU_QUIT, "Quit docdeck")
        .build()?;

    let app_handle = app.handle().clone();
    let click_manager = manager.clone();
    let menu_manager = manager.clone();
    let menu_app = app_handle.clone();
    let menu_notify = notify_item.clone();

    let tray = TrayIconBuilder::with_id("docdeck-tray")
        .tooltip("docdeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .icon(to_tauri_image(&compose_presence_icon(
            &manager.base,
            Presence::Current,
        )))
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                click_manager.set_presence(Presence::Current);
                TrayManager::show_main_window(&app_handle);
            }
        })
        .on_menu_event(move |_tray, event| match event.id().as_ref() {
            MENU_SHOW => TrayManager::show_main_window(&menu_app),
            MENU_NOTIFY => menu_manager.toggle_notify(&menu_notify),
            MENU_QUIT => menu_app.exit(0),
            _ => {}
        })
        .build(app)?;

    if let Ok(mut guard) = manager.icon.lock() {
        *guard = Some(tray);
    }

    // The watcher already emits `paths-changed`; the tray rides the same event
    // instead of adding a second hook into the debouncer callback.
    let listen_app = app.handle().clone();
    let listen_manager = manager;
    listen_app.clone().listen("paths-changed", move |event| {
        let Ok(changes) = serde_json::from_str::<Vec<PathChange>>(event.payload()) else {
            return;
        };
        let focused = listen_app
            .get_webview_window("main")
            .and_then(|window| window.is_focused().ok())
            .unwrap_or(false);
        listen_manager.handle_changes(&listen_app, &changes, focused);
    });

    Ok(())
}

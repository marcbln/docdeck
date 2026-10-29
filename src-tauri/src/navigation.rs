//! Navigation policy for the docdeck webview.
//!
//! Rendered documents may contain links that no frontend handler sees (Mermaid
//! SVGs, future renderers, injected content). The webview must therefore never
//! be allowed to leave the application origin.

/// Whether the webview may navigate to `url`.
///
/// Production uses the Tauri protocol on Linux/macOS and
/// `http(s)://tauri.localhost` on Windows. Development additionally allows the
/// fixed Vite server. Everything else is denied.
pub fn allows_navigation(url: &tauri::Url, dev: bool) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost" | "127.0.0.1")) if dev => url.port() == Some(1420),
        _ => false,
    }
}

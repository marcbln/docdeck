use crate::navigation::allows_navigation;
use tauri::Url;

fn parsed(raw: &str) -> Url {
    Url::parse(raw).unwrap()
}

#[test]
fn app_origins_are_allowed_in_production() {
    assert!(allows_navigation(
        &parsed("tauri://localhost/index.html"),
        false
    ));
    assert!(allows_navigation(
        &parsed("http://tauri.localhost/index.html"),
        false
    ));
}

#[test]
fn dev_server_is_allowed_only_in_dev() {
    assert!(allows_navigation(&parsed("http://localhost:1420/"), true));
    assert!(allows_navigation(&parsed("http://127.0.0.1:1420/"), true));
    assert!(!allows_navigation(&parsed("http://localhost:1420/"), false));
    assert!(!allows_navigation(&parsed("http://localhost:5173/"), true));
}

#[test]
fn external_and_hostile_urls_are_blocked() {
    for raw in [
        "https://example.com/",
        "http://localhost:8080/",
        "mailto:a@example.com",
        "javascript:alert(1)",
        "data:text/html,x",
    ] {
        assert!(!allows_navigation(&parsed(raw), false), "{raw}");
    }
}

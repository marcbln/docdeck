#[cfg(test)]
mod tests {
    use crate::config::NotifyMode;
    use crate::tray::{
        compose_presence_icon, notification_body, project_name, should_notify, Presence,
    };
    use crate::watcher::{PathChange, PathChangeKind};
    use image::RgbaImage;
    use std::time::{Duration, Instant};

    fn base_icon() -> RgbaImage {
        RgbaImage::from_pixel(32, 32, image::Rgba([255, 0, 255, 255]))
    }

    fn change(path: &str, exists: bool) -> PathChange {
        PathChange {
            kind: if exists {
                PathChangeKind::Modified
            } else {
                PathChangeKind::Deleted
            },
            path: path.to_string(),
            from_path: None,
            exists,
            modified_time: if exists { Some(0) } else { None },
        }
    }

    // -- dot compositing ------------------------------------------------------

    #[test]
    fn dot_is_painted_with_the_presence_color() {
        // Radius mirrors the production math: round(32 * 0.30) = 10, center at
        // (32 - 10 - 2 - 1) = (19, 19).
        let composed = compose_presence_icon(&base_icon(), Presence::Current);
        let [r, g, b] = Presence::Current.rgb();
        assert_eq!(composed.get_pixel(19, 19).0, [r, g, b, 255]);
    }

    #[test]
    fn unread_and_current_differ() {
        let current = compose_presence_icon(&base_icon(), Presence::Current);
        let unread = compose_presence_icon(&base_icon(), Presence::Unread);
        assert_ne!(current.get_pixel(19, 19).0, unread.get_pixel(19, 19).0);
    }

    #[test]
    fn ring_separates_dot_from_base_icon() {
        let composed = compose_presence_icon(&base_icon(), Presence::Current);
        // One pixel past the dot radius (10) but inside the ring (+2).
        assert_eq!(composed.get_pixel(19, 19 + 11).0, [24, 26, 30, 255]);
    }

    #[test]
    fn far_corner_is_untouched() {
        let composed = compose_presence_icon(&base_icon(), Presence::Unread);
        assert_eq!(composed.get_pixel(0, 0).0, [255, 0, 255, 255]);
    }

    #[test]
    fn compositing_keeps_the_base_untouched() {
        let base = base_icon();
        let _ = compose_presence_icon(&base, Presence::Unread);
        assert_eq!(base.get_pixel(19, 19).0, [255, 0, 255, 255]);
    }

    // -- notification decision --------------------------------------------------

    fn ten_secs() -> Duration {
        Duration::from_secs(10)
    }

    #[test]
    fn off_never_notifies() {
        let now = Instant::now();
        assert!(!should_notify(
            NotifyMode::Off,
            false,
            ten_secs(),
            None,
            now
        ));
        assert!(!should_notify(NotifyMode::Off, true, ten_secs(), None, now));
    }

    #[test]
    fn unfocused_mode_skips_a_focused_window() {
        let now = Instant::now();
        assert!(!should_notify(
            NotifyMode::Unfocused,
            true,
            ten_secs(),
            None,
            now
        ));
        assert!(should_notify(
            NotifyMode::Unfocused,
            false,
            ten_secs(),
            None,
            now
        ));
    }

    #[test]
    fn always_notifies_even_with_a_focused_window() {
        let now = Instant::now();
        assert!(should_notify(
            NotifyMode::Always,
            true,
            ten_secs(),
            None,
            now
        ));
    }

    #[test]
    fn throttle_blocks_bursts_until_the_window_elapses() {
        let last = Instant::now();
        let soon = last + Duration::from_millis(300);
        let much_later = last + Duration::from_secs(11);
        assert!(!should_notify(
            NotifyMode::Always,
            false,
            ten_secs(),
            Some(last),
            soon
        ));
        assert!(should_notify(
            NotifyMode::Always,
            false,
            ten_secs(),
            Some(last),
            much_later
        ));
    }

    // -- project chip ------------------------------------------------------------

    #[test]
    fn project_is_the_component_above_the_deepest_ai_segment() {
        assert_eq!(
            project_name("/home/u/devel/docdeck/_ai/backlog/plan.md"),
            Some("docdeck".to_string())
        );
        assert_eq!(
            project_name("/home/u/devel/x/_ai/notes/_ai/z.md"),
            Some("notes".to_string())
        );
    }

    #[test]
    fn no_project_without_an_ai_component() {
        assert_eq!(project_name("/home/u/notes/plan.md"), None);
        assert_eq!(project_name("_ai/plan.md"), None);
        assert_eq!(project_name("/home/u/weird\\name.md"), None);
    }

    #[test]
    fn windows_paths_find_the_project_too() {
        assert_eq!(
            project_name("C:\\devel\\docdeck\\_ai\\backlog\\plan.md"),
            Some("docdeck".to_string())
        );
    }

    // -- notification body -------------------------------------------------------

    #[test]
    fn single_change_names_the_file() {
        let body = notification_body(&[change("/x/plan.md", true)], 3);
        assert_eq!(body, "plan.md changed");
    }

    #[test]
    fn project_chip_prefixes_the_file_name() {
        let body = notification_body(
            &[change("/home/u/devel/skillman/_ai/backlog/plan.md", true)],
            3,
        );
        assert_eq!(body, "skillman: plan.md changed");
    }

    #[test]
    fn mixed_batches_keep_each_project_chip() {
        let body = notification_body(
            &[
                change("/home/u/devel/alpha/_ai/a.md", true),
                change("/home/u/devel/beta/_ai/b.md", true),
                change("/home/u/settings.md", true),
            ],
            3,
        );
        assert_eq!(body, "alpha: a.md, beta: b.md, settings.md changed");
    }

    #[test]
    fn several_changes_are_joined() {
        let body = notification_body(
            &[change("/x/plan.md", true), change("/y/tasks.md", true)],
            3,
        );
        assert_eq!(body, "plan.md, tasks.md changed");
    }

    #[test]
    fn long_batches_are_summarized() {
        let changes: Vec<PathChange> = (0..7)
            .map(|i| change(&format!("/x/doc{i}.md"), true))
            .collect();
        let body = notification_body(&changes, 3);
        assert_eq!(body, "doc0.md, doc1.md, doc2.md +4 more changed");
    }

    #[test]
    fn deletions_are_not_named() {
        let body = notification_body(&[change("/x/gone.md", false)], 3);
        assert_eq!(body, "watched files were removed");
    }

    #[test]
    fn deletions_still_count_towards_the_summary() {
        let body = notification_body(
            &[
                change("/x/a.md", true),
                change("/x/gone.md", false),
                change("/x/b.md", true),
                change("/x/c.md", true),
            ],
            2,
        );
        assert_eq!(body, "a.md, b.md +1 more changed");
    }

    #[test]
    fn rename_kinds_are_ignored_by_the_notification_body() {
        let renamed = PathChange {
            kind: PathChangeKind::Renamed,
            path: "/x/renamed.md".to_string(),
            from_path: Some("/x/old.md".to_string()),
            exists: true,
            modified_time: Some(1),
        };
        let moved_out = PathChange {
            kind: PathChangeKind::MovedOut,
            path: "/x/left.md".to_string(),
            from_path: None,
            exists: false,
            modified_time: None,
        };

        assert_eq!(
            notification_body(&[renamed, moved_out], 3),
            "renamed.md changed"
        );
    }
}

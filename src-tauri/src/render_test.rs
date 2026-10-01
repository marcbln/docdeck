#[cfg(test)]
mod tests {
    use crate::render::{should_disable_dmabuf, ACCELERATED_FLAG};

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn disabled_by_default() {
        assert!(should_disable_dmabuf(&argv(&["docdeck"]), false, false));
    }

    #[test]
    fn disabled_when_documents_are_passed() {
        let args = argv(&["docdeck", "/tmp/plan.md", "/tmp/report.md"]);
        assert!(should_disable_dmabuf(&args, false, false));
    }

    #[test]
    fn flag_opts_in_to_accelerated_rendering() {
        let args = argv(&["docdeck", ACCELERATED_FLAG, "/tmp/plan.md"]);
        assert!(!should_disable_dmabuf(&args, false, false));
    }

    #[test]
    fn env_var_opts_in_to_accelerated_rendering() {
        assert!(!should_disable_dmabuf(&argv(&["docdeck"]), false, true));
    }

    #[test]
    fn never_overrides_an_explicit_webkit_setting() {
        // The user already exported WEBKIT_DISABLE_DMABUF_RENDERER themselves.
        assert!(!should_disable_dmabuf(&argv(&["docdeck"]), true, false));
    }

    #[test]
    fn user_webkit_setting_wins_even_alongside_the_flag() {
        let args = argv(&["docdeck", ACCELERATED_FLAG]);
        assert!(!should_disable_dmabuf(&args, true, false));
    }

    #[test]
    fn flag_does_not_collide_with_other_flags() {
        let args = argv(&["docdeck", "--verbose", "--accelerated"]);
        assert!(!should_disable_dmabuf(&args, false, false));
    }

    #[test]
    fn similar_flag_does_not_opt_in() {
        let args = argv(&["docdeck", "--accelerated-please"]);
        assert!(should_disable_dmabuf(&args, false, false));
    }
}

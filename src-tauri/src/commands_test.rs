#[cfg(test)]
mod tests {
    use crate::commands::{
        CommandError, CommandErrorCode, FieldError, InboxEntry, Origin, ReloadResult, SaveOutcome,
        WatchConfigView, WatchLoad,
    };

    fn entry() -> InboxEntry {
        InboxEntry {
            path: "/docs/plan.md".to_string(),
            filename: "plan.md".to_string(),
            modified_time: 1_700_000_000_000,
            origin: Origin::Config,
        }
    }

    fn reload() -> ReloadResult {
        ReloadResult {
            generation: 3,
            at: 1_700_000_000_000,
            path: "/cfg/config.toml".to_string(),
            found: true,
            revision: "abc123".to_string(),
            watch: vec!["~/docs".to_string()],
            exclude: vec!["**/archive/**".to_string()],
            roots: vec!["/docs".to_string()],
            entries: vec![entry()],
            warnings: vec![],
            error: None,
            truncated: false,
        }
    }

    #[test]
    fn inbox_entry_serializes_origin_lowercase() {
        let json = serde_json::to_value(entry()).unwrap();
        assert_eq!(json["origin"], "config");
        assert_eq!(json["modifiedTime"], 1_700_000_000_000u64);
    }

    #[test]
    fn session_origin_serializes_lowercase() {
        let session = InboxEntry {
            origin: Origin::Session,
            ..entry()
        };
        assert_eq!(serde_json::to_value(session).unwrap()["origin"], "session");
    }

    #[test]
    fn watch_load_uses_camel_case_and_includes_reload_metadata() {
        let load = WatchLoad {
            config_path: "/cfg/config.toml".to_string(),
            config_found: true,
            roots: vec!["/docs".to_string()],
            entries: vec![entry()],
            warnings: vec![],
            error: None,
            truncated: false,
            revision: "abc123".to_string(),
            generation: 9,
            at: 42,
        };
        let json = serde_json::to_value(load).unwrap();

        assert_eq!(json["configPath"], "/cfg/config.toml");
        assert_eq!(json["configFound"], true);
        assert_eq!(json["revision"], "abc123");
        assert_eq!(json["generation"], 9);
        assert_eq!(json["at"], 42);
        assert!(json.get("error").is_some());
    }

    #[test]
    fn config_view_round_trips() {
        let view = WatchConfigView {
            path: "/cfg/config.toml".to_string(),
            found: true,
            revision: "abc".to_string(),
            watch: vec![],
            exclude: vec![],
            error: Some("bad toml".to_string()),
        };
        let json = serde_json::to_value(&view).unwrap();
        let back: WatchConfigView = serde_json::from_value(json).unwrap();
        assert_eq!(back.error.as_deref(), Some("bad toml"));
    }

    #[test]
    fn applied_save_outcome_is_tagged_applied() {
        let outcome = SaveOutcome::Applied { reload: reload() };
        let json = serde_json::to_value(outcome).unwrap();
        assert_eq!(json["status"], "applied");
        assert_eq!(json["reload"]["generation"], 3);
    }

    #[test]
    fn conflict_save_outcome_is_tagged_conflict() {
        let outcome = SaveOutcome::Conflict {
            current: WatchConfigView {
                path: "/cfg/config.toml".to_string(),
                found: true,
                revision: "newer".to_string(),
                watch: vec![],
                exclude: vec![],
                error: None,
            },
        };
        let json = serde_json::to_value(outcome).unwrap();
        assert_eq!(json["status"], "conflict");
        assert_eq!(json["current"]["revision"], "newer");
    }

    #[test]
    fn invalid_save_outcome_carries_field_errors() {
        let outcome = SaveOutcome::Invalid {
            errors: vec![FieldError {
                field: "watch".to_string(),
                message: "invalid glob".to_string(),
            }],
            warnings: vec!["selector matched nothing".to_string()],
        };
        let json = serde_json::to_value(outcome).unwrap();
        assert_eq!(json["status"], "invalid");
        assert_eq!(json["errors"][0]["field"], "watch");
        assert_eq!(json["warnings"][0], "selector matched nothing");
    }

    #[test]
    fn io_error_save_outcome_uses_camel_case_fields() {
        let outcome = SaveOutcome::IoError {
            message: "permission denied".to_string(),
            not_writable: true,
        };
        let json = serde_json::to_value(outcome).unwrap();
        assert_eq!(json["status"], "ioError");
        assert_eq!(json["notWritable"], true);
    }

    #[test]
    fn command_error_codes_use_the_documented_spelling() {
        for (code, expected) in [
            (CommandErrorCode::Invalid, "invalid"),
            (CommandErrorCode::Conflict, "conflict"),
            (CommandErrorCode::Io, "io"),
            (CommandErrorCode::NotWritable, "notWritable"),
            (CommandErrorCode::Internal, "internal"),
        ] {
            let json = serde_json::to_value(CommandError::new(code, "boom")).unwrap();
            assert_eq!(json["code"], expected);
            assert_eq!(json["message"], "boom");
        }
    }

    #[test]
    fn command_error_omits_absent_details() {
        let json = serde_json::to_value(CommandError::new(
            CommandErrorCode::Invalid,
            "bad selector",
        ))
        .unwrap();
        assert!(json.get("details").is_none());
    }
}

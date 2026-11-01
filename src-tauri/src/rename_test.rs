#[cfg(test)]
mod tests {
    use crate::paths::FileIdentity;
    use crate::rename::{RenameOutcome, RenamePairer, RENAME_HOLD};
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn identity(index: u64) -> Option<FileIdentity> {
        Some(FileIdentity { volume: 1, index })
    }

    fn path(name: &str) -> PathBuf {
        PathBuf::from(format!("/watched/{name}"))
    }

    #[test]
    fn from_and_to_with_the_same_identity_is_one_rename() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();

        pairer.on_from(path("old.md"), identity(7), now);
        let outcome = pairer.on_to(path("new.md"), identity(7), now + Duration::from_millis(80));

        assert_eq!(
            outcome,
            RenameOutcome::Renamed {
                from: path("old.md"),
                to: path("new.md")
            }
        );
        assert_eq!(pairer.pending_count(), 0);
    }

    #[test]
    fn a_from_without_a_to_settles_as_moved_out_after_the_hold() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();
        pairer.on_from(path("leaving.md"), identity(3), now);

        assert!(pairer.flush_due(now + Duration::from_millis(1_900)).is_empty());

        let settled = pairer.flush_due(now + RENAME_HOLD);
        assert_eq!(
            settled,
            vec![RenameOutcome::MovedOut {
                from: path("leaving.md")
            }]
        );
    }

    #[test]
    fn to_without_a_from_is_created() {
        let mut pairer = RenamePairer::new();
        let outcome = pairer.on_to(path("brand-new.md"), identity(9), Instant::now());

        assert_eq!(
            outcome,
            RenameOutcome::Created {
                path: path("brand-new.md")
            }
        );
    }

    #[test]
    fn unavailable_identity_falls_back_to_delete_plus_create() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();

        pairer.on_from(path("old.md"), None, now);
        let outcome = pairer.on_to(path("new.md"), None, now + Duration::from_millis(50));

        assert_eq!(
            outcome,
            RenameOutcome::Created {
                path: path("new.md")
            }
        );
    }

    #[test]
    fn rapid_renames_chain_onto_the_final_name() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();

        pairer.on_from(path("a.md"), identity(1), now);
        assert_eq!(
            pairer.on_to(path("b.md"), identity(1), now),
            RenameOutcome::Renamed {
                from: path("a.md"),
                to: path("b.md")
            }
        );

        pairer.on_from(path("b.md"), identity(1), now);
        assert_eq!(
            pairer.on_to(path("c.md"), identity(1), now),
            RenameOutcome::Renamed {
                from: path("b.md"),
                to: path("c.md")
            }
        );

        assert_eq!(pairer.pending_count(), 0);
    }

    #[test]
    fn case_only_rename_matches_by_identity() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();

        pairer.on_from(path("Plan.md"), identity(4), now);
        let outcome = pairer.on_to(path("plan.md"), identity(4), now);

        assert_eq!(
            outcome,
            RenameOutcome::Renamed {
                from: path("Plan.md"),
                to: path("plan.md")
            }
        );
    }

    #[test]
    fn oldest_matching_identity_wins() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();

        pairer.on_from(path("first.md"), identity(2), now);
        pairer.on_from(path("second.md"), identity(2), now + Duration::from_millis(10));

        assert_eq!(
            pairer.on_to(path("moved.md"), identity(2), now + Duration::from_millis(20)),
            RenameOutcome::Renamed {
                from: path("first.md"),
                to: path("moved.md")
            }
        );
    }

    #[test]
    fn an_explicit_rename_consumes_its_pending_from() {
        let mut pairer = RenamePairer::new();
        let now = Instant::now();

        pairer.on_from(path("old.md"), identity(5), now);
        pairer.forget(&path("old.md"));

        assert_eq!(pairer.pending_count(), 0);
        assert!(pairer.flush_due(now + RENAME_HOLD).is_empty());
    }
}

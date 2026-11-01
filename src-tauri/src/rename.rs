//! Pure rename pairing: one `From` plus one `To` of the same file identity is a
//! rename; a `From` that never receives a `To` within the hold window is a
//! move out of every watched location.
//!
//! Everything here takes an explicit `Instant`, so the two-second hold is
//! exercised deterministically in tests instead of with sleeps.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::paths::FileIdentity;

/// How long a rename `From` waits for its `To` before settling as a move-out.
pub const RENAME_HOLD: Duration = Duration::from_secs(2);

/// The classification of one observed appearance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenameOutcome {
    /// A `From` and a `To` matched by file identity.
    Renamed { from: PathBuf, to: PathBuf },
    /// A `From` waited out the hold with no matching `To`.
    MovedOut { from: PathBuf },
    /// An appearance with no matching `From`.
    Created { path: PathBuf },
}

#[derive(Debug, Clone)]
struct PendingFrom {
    path: PathBuf,
    identity: Option<FileIdentity>,
    at: Instant,
}

/// Holds rename `From` events until their `To` arrives or the hold expires.
#[derive(Debug, Default)]
pub struct RenamePairer {
    pending: Vec<PendingFrom>,
}

impl RenamePairer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Holds a deprecated path for pairing.
    pub fn on_from(&mut self, path: PathBuf, identity: Option<FileIdentity>, now: Instant) {
        if let Some(existing) = self.pending.iter_mut().find(|entry| entry.path == path) {
            existing.identity = identity;
            existing.at = now;
            return;
        }
        self.pending.push(PendingFrom {
            path,
            identity,
            at: now,
        });
    }

    /// Drops a pending `From` without emitting a move-out (an explicit rename
    /// event already consumed it).
    pub fn forget(&mut self, path: &PathBuf) {
        self.pending.retain(|entry| entry.path != *path);
    }

    /// Pairs `path` with the oldest pending `From` carrying the same identity.
    ///
    /// Without a usable identity the appearance is a creation: path-only
    /// pairing would invent renames for unrelated delete/create bursts.
    pub fn on_to(
        &mut self,
        path: PathBuf,
        identity: Option<FileIdentity>,
        _now: Instant,
    ) -> RenameOutcome {
        let matched = identity.and_then(|identity| {
            self.pending
                .iter()
                .position(|entry| entry.identity == Some(identity))
        });

        match matched {
            Some(index) => {
                let from = self.pending.remove(index);
                RenameOutcome::Renamed {
                    from: from.path,
                    to: path,
                }
            }
            None => RenameOutcome::Created { path },
        }
    }

    /// Settles every pending `From` older than the hold as a move-out.
    pub fn flush_due(&mut self, now: Instant) -> Vec<RenameOutcome> {
        let mut settled = Vec::new();
        let mut index = 0;
        while index < self.pending.len() {
            if now.saturating_duration_since(self.pending[index].at) >= RENAME_HOLD {
                let entry = self.pending.remove(index);
                settled.push(RenameOutcome::MovedOut { from: entry.path });
            } else {
                index += 1;
            }
        }
        settled
    }

    /// Number of `From` events still waiting. Test-only introspection.
    #[cfg(test)]
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
}

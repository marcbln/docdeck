//! "Summarize recent changes": Rig agent, TOC tools and snapshot storage.

pub mod agent;
pub mod store;
pub mod toc;

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

use crate::config;

pub use agent::{run_summary, SummaryResult};
pub use store::SummaryStore;

/// Whether the summary button can run, and why it cannot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryStatus {
    /// Provider/model/config/credential are all usable.
    pub ready: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    /// Actionable explanation shown as the button's tooltip.
    pub problem: Option<String>,
    pub config_path: String,
}

/// Reads the current `[summary]` configuration and checks readiness.
pub fn status() -> SummaryStatus {
    let path = config::config_path();
    let config_path = path.to_string_lossy().into_owned();

    let loaded = match config::load(&path) {
        Ok(loaded) => loaded,
        Err(error) => {
            return SummaryStatus {
                ready: false,
                provider: None,
                model: None,
                problem: Some(error),
                config_path,
            };
        }
    };

    let Some(summary) = loaded.config.summary else {
        return SummaryStatus {
            ready: false,
            provider: None,
            model: None,
            problem: Some(format!(
                "Add a [summary] section to {config_path} (provider and model) to enable summaries."
            )),
            config_path,
        };
    };

    let problem = summary.validate().err();
    SummaryStatus {
        ready: problem.is_none(),
        provider: Some(summary.provider),
        model: Some(summary.model),
        problem,
        config_path,
    }
}

/// Runs the agent over the caller's recently changed paths.
///
/// Only paths observed by this session's watcher are accepted; the webview is
/// not trusted to widen the agent's filesystem access.
pub async fn summarize(
    store: Arc<SummaryStore>,
    paths: Vec<String>,
) -> Result<SummaryResult, String> {
    let path = config::config_path();
    let loaded = config::load(&path)?;
    let summary = loaded
        .config
        .summary
        .ok_or_else(|| "No [summary] section in the docdeck configuration.".to_string())?;
    summary.validate()?;

    let mut requested = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if store.allows(&path) {
            requested.push(path);
        }
    }
    if requested.is_empty() {
        return Err(
            "None of the requested documents are in this session's change history.".to_string(),
        );
    }

    run_summary(&summary, store, requested).await
}

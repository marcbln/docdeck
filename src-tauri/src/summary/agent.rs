//! The Rig-backed change-summary agent: prompt, tools and provider wiring.

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rig_agent::tool::{Tool, ToolContext, ToolOutput};
use rig_agent::AgentBuilder;
use rig_core::driver::DynModel;
use rig_core::operation::Completion;
use rig_core::providers::{
    anthropic, deepseek, gemini, groq, mistral, ollama, openai, opencode, openrouter, xai, zai,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::config::SummaryConfig;

use super::store::{SummaryStore, MAX_DIFF_CHARS};
use super::toc;

const DEFAULT_MAX_CHARS: usize = 8_000;
const TIMEOUT: Duration = Duration::from_secs(180);
const PROMPT_DIFF_CHARS: usize = 1_500;
const PROMPT_MAX_CHARS: usize = 48_000;

const SYSTEM_PROMPT: &str = "\
You summarize recent changes to a writer's Markdown documents for docdeck.

OUTPUT:
1. An overview of 2-6 sentences covering the batch as a whole: what work
   happened, which projects or themes it belongs to, and anything that needs
   attention (blocked work, deletions, contradictions between documents).
2. One entry per document: a one-sentence summary, then 2-5 bullets about the
   INTENT and the APPROACH, not file mechanics.

WHAT CHANGED MATTERS:
The prompt lists paths and short diff excerpts. Use `get_change` to read the
full old-to-new diff before describing a document as changed. Use `get_toc` and
`get_sections` to read context without pulling a whole document. A document
with no earlier snapshot cannot be diffed; describe what it currently says and
say so rather than inventing a change.

Do not repeat a document's own abstract or restate unchanged sections. Prefer
concrete facts (decisions, numbers, paths) over adjectives. Mention deleted
documents explicitly. Never invent documents, paths or outcomes.

Answer only with the structured object the schema asks for.";

/// One document offered to the summary agent.
#[derive(Debug, Clone)]
pub struct SummaryDocMeta {
    pub path: String,
    pub filename: String,
    pub project: Option<String>,
    pub state: DocState,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocState {
    New,
    Updated,
    Deleted,
}

impl DocState {
    fn label(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Updated => "updated",
            Self::Deleted => "deleted",
        }
    }
}

/// Structured response the model is constrained to.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryOutput {
    pub overview: String,
    #[serde(default)]
    pub documents: Vec<SummaryDocumentOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDocumentOutput {
    pub path: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub bullets: Vec<String>,
}

/// One document in the final result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDocument {
    pub path: String,
    pub filename: String,
    pub project: Option<String>,
    pub state: DocState,
    pub summary: String,
    pub bullets: Vec<String>,
}

/// The command's payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    pub overview: String,
    pub documents: Vec<SummaryDocument>,
    pub provider: String,
    pub model: String,
    pub generated_at: u64,
    pub requested: usize,
    pub skipped: usize,
    pub tool_calls: usize,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Clone)]
struct ToolData {
    docs: Vec<SummaryDocMeta>,
    store: Arc<SummaryStore>,
    budget: Arc<AtomicUsize>,
    max_calls: usize,
}

impl ToolData {
    fn calls(&self) -> usize {
        self.budget.load(Ordering::Relaxed)
    }

    fn charge(&self) -> bool {
        if self.calls() >= self.max_calls {
            return false;
        }
        self.budget.fetch_add(1, Ordering::Relaxed) < self.max_calls
    }

    fn exhausted(&self) -> ToolOutput {
        ToolOutput::text(format!(
            "Error: tool-call budget exhausted ({}/{} used). Answer with what you have.",
            self.calls(),
            self.max_calls
        ))
    }

    fn resolve(&self, path: &str) -> Option<&SummaryDocMeta> {
        self.docs.iter().find(|doc| doc.path == path).or_else(|| {
            let mut matches = self.docs.iter().filter(|doc| doc.filename == path);
            let first = matches.next()?;
            matches.next().is_none().then_some(first)
        })
    }
}

#[derive(Debug, Deserialize)]
struct EmptyArgs {}

#[derive(Debug, Deserialize)]
struct PathArgs {
    path: String,
}

#[derive(Debug, Deserialize)]
struct SectionsArgs {
    path: String,
    refs: String,
    max_chars: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct SearchArgs {
    path: String,
    keyword: String,
    limit: Option<usize>,
}

struct ListDocumentsTool {
    data: ToolData,
}

impl Tool for ListDocumentsTool {
    const NAME: &'static str = "list_documents";
    type Args = EmptyArgs;
    type Output = ToolOutput;
    type Error = Infallible;

    fn description(&self) -> String {
        "List every document in this summary request with its path, project and change state."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({"type": "object", "properties": {}})
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        _args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        if !self.data.charge() {
            return Ok(self.data.exhausted());
        }
        let lines = self
            .data
            .docs
            .iter()
            .map(|doc| {
                format!(
                    "- {} [{}] project: {}",
                    doc.path,
                    doc.state.label(),
                    doc.project.as_deref().unwrap_or("(none)")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        Ok(ToolOutput::text(lines))
    }
}

struct GetTocTool {
    data: ToolData,
}

impl Tool for GetTocTool {
    const NAME: &'static str = "get_toc";
    type Args = PathArgs;
    type Output = ToolOutput;
    type Error = Infallible;

    fn description(&self) -> String {
        "Read a document's numbered table of contents and frontmatter.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Document path or filename"}},
            "required": ["path"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let Some(doc) = self.data.resolve(&args.path) else {
            return Ok(unknown_path(&args.path));
        };
        if !self.data.charge() {
            return Ok(self.data.exhausted());
        }
        let Some(text) = self.data.store.current(Path::new(&doc.path)) else {
            return Ok(ToolOutput::text(format!(
                "Error: '{}' is not readable (it may have been deleted).",
                doc.path
            )));
        };
        Ok(ToolOutput::text(format!(
            "frontmatter:\n{}\n\n{}",
            toc::frontmatter_block(&text),
            toc::toc_block(&text)
        )))
    }
}

struct GetSectionsTool {
    data: ToolData,
}

impl Tool for GetSectionsTool {
    const NAME: &'static str = "get_sections";
    type Args = SectionsArgs;
    type Output = ToolOutput;
    type Error = Infallible;

    fn description(&self) -> String {
        "Read sections by number, range or title: 7, 7-9, 2.1, 7, 10-12.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "refs": {"type": "string", "description": "Selection expression, e.g. 2.1, 7-9"},
                "max_chars": {"type": "integer", "description": "Result cap (default 8000)"}
            },
            "required": ["path", "refs"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let Some(doc) = self.data.resolve(&args.path) else {
            return Ok(unknown_path(&args.path));
        };
        if !self.data.charge() {
            return Ok(self.data.exhausted());
        }
        let Some(text) = self.data.store.current(Path::new(&doc.path)) else {
            return Ok(ToolOutput::text(format!(
                "Error: '{}' is not readable (it may have been deleted).",
                doc.path
            )));
        };
        match toc::resolve_ranges(&text, &args.refs) {
            Ok(sections) => {
                let lines: Vec<&str> = text.lines().collect();
                Ok(ToolOutput::text(toc::render(
                    &sections,
                    &lines,
                    args.max_chars.unwrap_or(DEFAULT_MAX_CHARS),
                    sections.len(),
                )))
            }
            Err(error) => {
                let mut sections = toc::extract_sections(&text, 6);
                toc::assign_numbers(&mut sections);
                let valid = sections
                    .iter()
                    .map(|section| section.number.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                Ok(ToolOutput::text(format!(
                    "Error: {error}; valid numbers: {valid}"
                )))
            }
        }
    }
}

struct SearchSectionsTool {
    data: ToolData,
}

impl Tool for SearchSectionsTool {
    const NAME: &'static str = "search_sections";
    type Args = SearchArgs;
    type Output = ToolOutput;
    type Error = Infallible;

    fn description(&self) -> String {
        "Find sections containing a keyword; returns pointers, not bodies.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "keyword": {"type": "string"},
                "limit": {"type": "integer", "description": "Maximum hits (default 20)"}
            },
            "required": ["path", "keyword"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let Some(doc) = self.data.resolve(&args.path) else {
            return Ok(unknown_path(&args.path));
        };
        if !self.data.charge() {
            return Ok(self.data.exhausted());
        }
        let Some(text) = self.data.store.current(Path::new(&doc.path)) else {
            return Ok(ToolOutput::text(format!(
                "Error: '{}' is not readable (it may have been deleted).",
                doc.path
            )));
        };

        let needle = args.keyword.trim().to_lowercase();
        let lines: Vec<&str> = text.lines().collect();
        let mut sections = toc::extract_sections(&text, 6);
        toc::assign_numbers(&mut sections);
        let limit = args.limit.unwrap_or(20).clamp(1, 50);
        let hits = sections
            .iter()
            .filter(|section| {
                let body = lines
                    .get(section.start.saturating_sub(1)..section.end)
                    .unwrap_or_default()
                    .join("\n")
                    .to_lowercase();
                section.text.to_lowercase().contains(&needle) || body.contains(&needle)
            })
            .take(limit)
            .map(|section| {
                format!(
                    "§{} — {} (lines {}-{})",
                    section.number, section.text, section.start, section.end
                )
            })
            .collect::<Vec<_>>();

        if hits.is_empty() {
            Ok(ToolOutput::text(format!(
                "No section contains {:?}.",
                args.keyword
            )))
        } else {
            Ok(ToolOutput::text(hits.join("\n")))
        }
    }
}

struct GetChangeTool {
    data: ToolData,
}

impl Tool for GetChangeTool {
    const NAME: &'static str = "get_change";
    type Args = PathArgs;
    type Output = ToolOutput;
    type Error = Infallible;

    fn description(&self) -> String {
        "The unified old-to-new diff for a document, or its current content when docdeck saw no earlier version."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let Some(doc) = self.data.resolve(&args.path) else {
            return Ok(unknown_path(&args.path));
        };
        if !self.data.charge() {
            return Ok(self.data.exhausted());
        }

        if let Some(diff) = self.data.store.diff(Path::new(&doc.path)) {
            return Ok(ToolOutput::text(diff));
        }
        match self.data.store.current(Path::new(&doc.path)) {
            Some(current) => Ok(ToolOutput::text(format!(
                "No earlier snapshot for '{}'. Current content:\n{}",
                doc.path,
                cap_chars(&current, MAX_DIFF_CHARS)
            ))),
            None => Ok(ToolOutput::text(format!(
                "Error: '{}' has no captured content (deleted or unreadable).",
                doc.path
            ))),
        }
    }
}

fn unknown_path(path: &str) -> ToolOutput {
    ToolOutput::text(format!(
        "Error: '{path}' is not part of this summary request. Use list_documents for valid paths."
    ))
}

/// Builds the summary prompt for the requested documents.
pub fn build_prompt(docs: &[SummaryDocMeta], store: &SummaryStore) -> String {
    let mut parts = vec![format!(
        "Summarize the recent changes in these {} document(s):",
        docs.len()
    )];
    let mut used = parts[0].chars().count();

    for doc in docs {
        let mut block = format!(
            "\n- path: {}\n  state: {}\n  project: {}\n  modified: {}\n",
            doc.path,
            doc.state.label(),
            doc.project.as_deref().unwrap_or("(none)"),
            doc.modified_at
        );

        match store.current(Path::new(&doc.path)) {
            Some(current) => {
                block.push_str(&format!(
                    "{}\n",
                    indent(&toc::frontmatter_block(&current), "  ")
                ));
                block.push_str(&format!("{}\n", indent(&toc::toc_block(&current), "  ")));
                if let Some(diff) = store.diff(Path::new(&doc.path)) {
                    block.push_str(&format!(
                        "  diff excerpt:\n{}\n",
                        indent(&cap_chars(&diff, PROMPT_DIFF_CHARS), "    ")
                    ));
                } else {
                    block.push_str(
                        "  (no earlier snapshot — use get_sections to read current content)\n",
                    );
                }
            }
            None => {
                block.push_str("  (no readable content — the document may have been deleted)\n")
            }
        }

        let size = block.chars().count();
        if used + size > PROMPT_MAX_CHARS {
            parts.push(format!(
                "\n- … {} more document(s) omitted at the prompt limit\n",
                docs.len() - parts.len() + 1
            ));
            break;
        }
        used += size;
        parts.push(block);
    }

    parts.push(
        "\nUse the tools when the excerpts are not enough. Return the overview and one entry per document."
            .to_string(),
    );
    parts.join("")
}

/// Runs the agent and normalizes its answer against the requested documents.
pub async fn run_summary(
    config: &SummaryConfig,
    store: Arc<SummaryStore>,
    paths: Vec<PathBuf>,
) -> Result<SummaryResult, String> {
    config.validate()?;
    let requested = paths.len();
    let mut docs = build_meta(&paths, &store);

    let skipped_by_cap = docs.len().saturating_sub(config.max_documents);
    docs.truncate(config.max_documents);
    if docs.is_empty() {
        return Err("No recently changed documents are available to summarize.".to_string());
    }

    let model = build_model(config)?;
    let budget = Arc::new(AtomicUsize::new(0));
    let data = ToolData {
        docs: docs.clone(),
        store: Arc::clone(&store),
        budget: Arc::clone(&budget),
        max_calls: config.max_tool_calls,
    };

    let agent = AgentBuilder::new(model)
        .name("docdeck-summary")
        .preamble(SYSTEM_PROMPT)
        .tool(ListDocumentsTool { data: data.clone() })
        .tool(GetTocTool { data: data.clone() })
        .tool(GetSectionsTool { data: data.clone() })
        .tool(SearchSectionsTool { data: data.clone() })
        .tool(GetChangeTool { data })
        .default_max_turns(config.max_tool_calls + 2)
        .temperature(0.2)
        .build();

    let prompt = build_prompt(&docs, &store);
    let response = tokio::time::timeout(
        TIMEOUT,
        agent
            .prompt_typed::<SummaryOutput>(prompt)
            .max_turns(config.max_tool_calls + 2),
    )
    .await
    .map_err(|_| {
        format!(
            "The summary agent did not finish within {} seconds.",
            TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("The summary agent failed: {error}"))?;

    let mut documents = Vec::new();
    for output in response.output.documents {
        let Some(doc) = resolve_output(&docs, &output.path) else {
            continue;
        };
        if documents
            .iter()
            .any(|existing: &SummaryDocument| existing.path == doc.path)
        {
            continue;
        }
        documents.push(SummaryDocument {
            path: doc.path.clone(),
            filename: doc.filename.clone(),
            project: doc.project.clone(),
            state: doc.state,
            summary: output.summary.trim().to_string(),
            bullets: output
                .bullets
                .into_iter()
                .map(|bullet| bullet.trim().to_string())
                .filter(|bullet| !bullet.is_empty())
                .collect(),
        });
    }

    let matched = documents.len();
    let skipped = requested.saturating_sub(matched) + skipped_by_cap;

    Ok(SummaryResult {
        overview: response.output.overview.trim().to_string(),
        documents,
        provider: config.provider.clone(),
        model: config.model.clone(),
        generated_at: crate::config::now_millis(),
        requested,
        skipped,
        tool_calls: budget.load(Ordering::Relaxed),
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
    })
}

fn build_meta(paths: &[PathBuf], store: &SummaryStore) -> Vec<SummaryDocMeta> {
    let mut seen = std::collections::HashSet::new();
    paths
        .iter()
        .filter(|path| seen.insert((*path).clone()))
        .map(|path| {
            let snapshot = store.snapshot(path);
            let exists = path.exists();
            let state = if !exists {
                DocState::Deleted
            } else if snapshot.as_ref().is_some_and(|s| s.previous.is_some()) {
                DocState::Updated
            } else {
                DocState::New
            };
            SummaryDocMeta {
                path: path.to_string_lossy().into_owned(),
                filename: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.to_string_lossy().into_owned()),
                project: project_name(path),
                state,
                modified_at: crate::paths::modified_millis(path).unwrap_or(0),
            }
        })
        .collect()
}

/// The `_ai` project a document belongs to (the component above the deepest
/// `_ai` segment), matching the sidebar chip.
pub fn project_name(path: &Path) -> Option<String> {
    let components: Vec<String> = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect();
    let deepest = components
        .iter()
        .enumerate()
        .take(components.len().saturating_sub(1))
        .filter(|(_, component)| component.as_str() == "_ai")
        .map(|(index, _)| index)
        .next_back()?;
    components.get(deepest.checked_sub(1)?).cloned()
}

fn resolve_output<'a>(docs: &'a [SummaryDocMeta], path: &str) -> Option<&'a SummaryDocMeta> {
    docs.iter().find(|doc| doc.path == path).or_else(|| {
        let mut matches = docs.iter().filter(|doc| doc.filename == path);
        let first = matches.next()?;
        matches.next().is_none().then_some(first)
    })
}

fn indent(text: &str, prefix: &str) -> String {
    text.lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn cap_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut capped: String = text.chars().take(max).collect();
    capped.push_str("\n… [truncated]");
    capped
}

fn build_model(config: &SummaryConfig) -> Result<DynModel<Completion>, String> {
    let model = config.model.as_str();
    match config.provider.as_str() {
        "openai" => {
            let mut provider = openai::OpenAIConfig::new(read_key(config)?);
            if let Some(base_url) = &config.base_url {
                provider = provider.with_base_url(base_url);
            }
            Ok(provider.client().completion(model).into())
        }
        "anthropic" => {
            let mut provider =
                anthropic::AnthropicConfig::with_key(&anthropic::ANTHROPIC, read_key(config)?);
            if let Some(base_url) = &config.base_url {
                provider = provider.with_base_url(base_url);
            }
            Ok(provider.client().completion(model).into())
        }
        "ollama" => {
            let mut provider =
                ollama::OllamaConfig::from_env().map_err(|error| error.to_string())?;
            if let Some(base_url) = &config.base_url {
                provider = provider.with_base_url(base_url);
            }
            if let Some(key) = read_optional_key(config) {
                provider = provider.with_api_key(key);
            }
            Ok(provider.client().completion(model).into())
        }
        "openrouter" => Ok(openrouter::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "deepseek" => Ok(deepseek::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "groq" => Ok(groq::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "mistral" => Ok(mistral::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "xai" => Ok(xai::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "gemini" => Ok(gemini::Gemini::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "opencode" => Ok(opencode::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        "zai" => Ok(zai::from_env()
            .map_err(|error| error.to_string())?
            .completion(model)
            .into()),
        other => Err(format!(
            "unknown summary provider '{other}' (supported: {})",
            SummaryConfig::PROVIDERS.join(", ")
        )),
    }
}

fn read_key(config: &SummaryConfig) -> Result<String, String> {
    let name = config
        .api_key_env_name()
        .ok_or_else(|| format!("summary provider '{}' needs an API key", config.provider))?;
    std::env::var(name).map_err(|_| format!("summary provider '{}' needs {name}", config.provider))
}

fn read_optional_key(config: &SummaryConfig) -> Option<String> {
    config
        .api_key_env_name()
        .and_then(|name| std::env::var(name).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::store::SummaryStore;

    fn doc(path: &str, state: DocState) -> SummaryDocMeta {
        SummaryDocMeta {
            path: path.to_string(),
            filename: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            project: project_name(Path::new(path)),
            state,
            modified_at: 0,
        }
    }

    fn data(docs: Vec<SummaryDocMeta>, max_calls: usize) -> ToolData {
        let store = Arc::new(SummaryStore::new());
        for doc in &docs {
            store.capture(Path::new(&doc.path), "# Title\nbody\n");
        }
        ToolData {
            docs,
            store,
            budget: Arc::new(AtomicUsize::new(0)),
            max_calls,
        }
    }

    #[test]
    fn derives_project_from_the_deepest_ai_segment() {
        assert_eq!(
            project_name(Path::new("/home/u/devel/docdeck/_ai/backlog/plan.md")),
            Some("docdeck".to_string())
        );
        assert_eq!(project_name(Path::new("/home/u/notes/plan.md")), None);
    }

    #[test]
    fn prompt_carries_toc_and_a_diff_excerpt() {
        let store = SummaryStore::new();
        let path = PathBuf::from("/tmp/docdeck-prompt.md");
        store.capture(&path, "# Plan\nold\n");
        store.capture(&path, "# Plan\nnew\n");
        let prompt = build_prompt(&[doc("/tmp/docdeck-prompt.md", DocState::Updated)], &store);
        assert!(prompt.contains("contents:"));
        assert!(prompt.contains("diff excerpt"));
        assert!(prompt.contains("+new"));
    }

    #[tokio::test]
    async fn enforces_the_tool_budget() {
        let data = data(vec![doc("/tmp/budget.md", DocState::New)], 1);
        let tool = ListDocumentsTool { data };
        let mut context = ToolContext::new();
        let first = tool
            .call(&mut context, EmptyArgs {})
            .await
            .unwrap()
            .as_text()
            .unwrap_or_default()
            .to_string();
        assert!(first.contains("/tmp/budget.md"));

        let second = tool
            .call(&mut context, EmptyArgs {})
            .await
            .unwrap()
            .as_text()
            .unwrap_or_default()
            .to_string();
        assert!(second.contains("budget exhausted"));
    }

    #[tokio::test]
    async fn resolves_sections_by_reference() {
        let docs = vec![doc("/tmp/sections.md", DocState::New)];
        let store = Arc::new(SummaryStore::new());
        store.capture(
            Path::new("/tmp/sections.md"),
            "# One\nfirst\n## Two\nsecond\n",
        );
        let data = ToolData {
            docs,
            store,
            budget: Arc::new(AtomicUsize::new(0)),
            max_calls: 8,
        };
        let tool = GetSectionsTool { data };
        let mut context = ToolContext::new();
        let output = tool
            .call(
                &mut context,
                SectionsArgs {
                    path: "/tmp/sections.md".to_string(),
                    refs: "1.1".to_string(),
                    max_chars: None,
                },
            )
            .await
            .unwrap()
            .as_text()
            .unwrap_or_default()
            .to_string();
        assert!(output.contains("Two"));
        assert!(output.contains("second"));
        assert!(!output.contains("first"));
    }
}

//! Markdown heading extraction and section selection.
//!
//! The summary agent is handed an outline, not whole documents, and asks for
//! sections by number, range or title. This mirrors the selection expression
//! used by `sb toc` so the two tools are easy to reason about together.

/// One Markdown heading and the inclusive line range of its body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub level: usize,
    pub text: String,
    /// Multi-level number (`1.2.3`), assigned by [`assign_numbers`].
    pub number: String,
    /// 1-based line of the heading itself.
    pub start: usize,
    /// 1-based line of the section's last body line.
    pub end: usize,
}

impl Section {
    fn new(level: usize, text: String, start: usize, end: usize) -> Self {
        Self {
            level,
            text,
            number: String::new(),
            start,
            end,
        }
    }
}

/// Why a selection expression could not be resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RangeError {
    NoHeadings,
    NoMatch(String),
}

impl std::fmt::Display for RangeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoHeadings => write!(formatter, "document has no headings"),
            Self::NoMatch(refs) => write!(formatter, "no section matched {refs:?}"),
        }
    }
}

impl std::error::Error for RangeError {}

/// Parses ATX headings, ignoring anything inside fenced code blocks.
pub fn extract_sections(markdown: &str, max_depth: usize) -> Vec<Section> {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut raw: Vec<(usize, usize, String)> = Vec::new();
    let mut fence: Option<(char, usize)> = None;

    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start_matches([' ', '\t']);
        if let Some((marker, width)) = fence_marker(trimmed) {
            if let Some((open, open_width)) = fence {
                if marker == open && width >= open_width {
                    fence = None;
                }
            } else {
                fence = Some((marker, width));
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }

        let Some((level, text)) = heading(trimmed) else {
            continue;
        };
        if level > max_depth {
            continue;
        }
        raw.push((index + 1, level, text));
    }

    let total = lines.len();
    raw.iter()
        .enumerate()
        .map(|(position, (line_no, level, text))| {
            let stop = raw[position + 1..]
                .iter()
                .find(|(_, next_level, _)| next_level <= level)
                .map(|(next_no, _, _)| next_no.saturating_sub(1))
                .unwrap_or(total);
            Section::new(*level, text.clone(), *line_no, stop.max(*line_no))
        })
        .collect()
}

/// Multi-level numbering following the heading hierarchy.
pub fn assign_numbers(sections: &mut [Section]) {
    let mut counters: Vec<usize> = Vec::new();
    for section in sections {
        if counters.len() < section.level {
            counters.resize(section.level, 0);
        }
        counters.truncate(section.level);
        counters[section.level - 1] += 1;
        section.number = counters
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join(".");
    }
}

/// Resolves a comma-separated selection expression to sections.
///
/// Accepted forms: `7` (section and subtree), `7-9` (range), `2.1, 7` (mixed)
/// and a substring of a heading title.
pub fn resolve_ranges(markdown: &str, refs: &str) -> Result<Vec<Section>, RangeError> {
    let mut sections = extract_sections(markdown, 6);
    if sections.is_empty() {
        return Err(RangeError::NoHeadings);
    }
    assign_numbers(&mut sections);

    let mut wanted = std::collections::BTreeSet::new();
    for reference in refs.split(',') {
        for index in match_one(reference, &sections) {
            wanted.insert(index);
        }
    }
    if wanted.is_empty() {
        return Err(RangeError::NoMatch(refs.to_string()));
    }

    Ok(sections
        .into_iter()
        .enumerate()
        .filter(|(index, _)| wanted.contains(index))
        .map(|(_, section)| section)
        .collect())
}

/// Renders sections from the source lines, truncating at `max_chars`.
pub fn render(sections: &[Section], lines: &[&str], max_chars: usize, requested: usize) -> String {
    let chunks: Vec<String> = sections
        .iter()
        .map(|section| {
            let body = lines
                .get(section.start.saturating_sub(1)..section.end)
                .unwrap_or_default()
                .join("\n");
            format!(
                "### {}. {}  (lines {}-{})\n{}",
                section.number, section.text, section.start, section.end, body
            )
        })
        .collect();
    let body = chunks.join("\n\n");

    if body.chars().count() <= max_chars {
        return body;
    }

    let mut truncated = body.chars().take(max_chars).collect::<String>();
    truncated.push_str(&format!(
        "\n\n… [truncated: {} of {} section(s) shown, raise max_chars or narrow the refs]",
        chunks.len(),
        requested
    ));
    truncated
}

/// Numbered outline for the prompt, or an explicit note when there are none.
pub fn toc_block(markdown: &str) -> String {
    let mut sections = extract_sections(markdown, 6);
    if sections.is_empty() {
        return "  (no headings — read the file directly if you need its body)".to_string();
    }
    assign_numbers(&mut sections);
    let lines = sections
        .iter()
        .map(|section| {
            format!(
                "  {}{}. {}",
                "  ".repeat(section.level.saturating_sub(1)),
                section.number,
                section.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("  contents:\n{lines}")
}

/// The leading YAML frontmatter block, verbatim, or an explicit note.
pub fn frontmatter_block(markdown: &str) -> String {
    if !markdown.trim_start().starts_with("---") {
        return "  (no frontmatter)".to_string();
    }
    match markdown.split_once("\n---") {
        Some((head, _)) => {
            let head = head.trim_end();
            if head.is_empty() {
                "  (no frontmatter)".to_string()
            } else {
                head.to_string()
            }
        }
        None => markdown.trim_end().to_string(),
    }
}

fn heading(line: &str) -> Option<(usize, String)> {
    let level = line
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = line[level..].strip_prefix([' ', '\t'])?;
    let text = rest.trim().trim_end_matches('#').trim();
    if text.is_empty() {
        return None;
    }
    Some((level, text.to_string()))
}

fn fence_marker(line: &str) -> Option<(char, usize)> {
    let mut characters = line.chars();
    let marker = characters.next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let width = line
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (width >= 3).then_some((marker, width))
}

fn match_one(reference: &str, sections: &[Section]) -> Vec<usize> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Vec::new();
    }

    if is_number(reference) {
        return sections
            .iter()
            .position(|section| section.number == reference)
            .map(|hit| subtree(sections, hit))
            .unwrap_or_default();
    }

    if let Some((low, high)) = parse_range(reference) {
        let low = sections.iter().position(|section| section.number == low);
        let high = sections.iter().position(|section| section.number == high);
        return match (low, high) {
            (Some(low), Some(high)) => {
                let (low, high) = if low <= high {
                    (low, high)
                } else {
                    (high, low)
                };
                (low..=high).collect()
            }
            _ => Vec::new(),
        };
    }

    let needle = reference.to_lowercase();
    sections
        .iter()
        .position(|section| section.text.to_lowercase().contains(&needle))
        .map(|hit| subtree(sections, hit))
        .unwrap_or_default()
}

fn subtree(sections: &[Section], hit: usize) -> Vec<usize> {
    let number = &sections[hit].number;
    sections
        .iter()
        .enumerate()
        .filter(|(_, section)| {
            &section.number == number || section.number.starts_with(&format!("{number}."))
        })
        .map(|(index, _)| index)
        .collect()
}

fn is_number(reference: &str) -> bool {
    !reference.is_empty()
        && reference
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn parse_range(reference: &str) -> Option<(String, String)> {
    let (low, high) = reference.split_once('-')?;
    let low = low.trim();
    let high = high.trim();
    if is_number(low) && is_number(high) {
        Some((low.to_string(), high.to_string()))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "# Plan\nintro\n\n## Problem\nproblem body\n\n### Detail\ndetail body\n\n## Phases\nphase body\n\n# Report\nreport body\n";

    #[test]
    fn extracts_heading_ranges_and_skips_fences() {
        let doc = "# A\nbody\n```\n# not a heading\n```\n## B\nb\n";
        let sections = extract_sections(doc, 6);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].text, "A");
        assert_eq!((sections[0].start, sections[0].end), (1, 7));
        assert_eq!(sections[1].text, "B");
    }

    #[test]
    fn numbers_nested_sections() {
        let mut sections = extract_sections(DOC, 6);
        assign_numbers(&mut sections);
        assert_eq!(
            sections
                .iter()
                .map(|section| section.number.as_str())
                .collect::<Vec<_>>(),
            ["1", "1.1", "1.1.1", "1.2", "2"]
        );
    }

    #[test]
    fn resolves_numbers_ranges_titles_and_subtrees() {
        let numbered = |refs| {
            resolve_ranges(DOC, refs)
                .unwrap()
                .into_iter()
                .map(|section| section.number)
                .collect::<Vec<_>>()
        };
        assert_eq!(numbered("1.1"), ["1.1", "1.1.1"]);
        assert_eq!(numbered("1.1-1.2"), ["1.1", "1.1.1", "1.2"]);
        assert_eq!(numbered("2"), ["2"]);
        assert_eq!(numbered("problem"), ["1.1", "1.1.1"]);
        assert_eq!(numbered("2, 1.1"), ["1.1", "1.1.1", "2"]);
    }

    #[test]
    fn reports_unmatched_references() {
        assert_eq!(
            resolve_ranges(DOC, "nope"),
            Err(RangeError::NoMatch("nope".to_string()))
        );
        assert_eq!(
            resolve_ranges("plain text", "1"),
            Err(RangeError::NoHeadings)
        );
    }

    #[test]
    fn renders_and_truncates_sections() {
        let sections = resolve_ranges(DOC, "1.1").unwrap();
        let lines: Vec<&str> = DOC.lines().collect();
        let rendered = render(&sections, &lines, 10_000, sections.len());
        assert!(rendered.contains("### 1.1. Problem"));
        assert!(rendered.contains("problem body"));

        let short = render(&sections, &lines, 5, sections.len());
        assert!(short.contains("truncated"));
    }

    #[test]
    fn renders_toc_and_frontmatter_blocks() {
        assert!(toc_block(DOC).contains("1.1. Problem"));
        assert_eq!(frontmatter_block("plain"), "  (no frontmatter)");
        assert!(frontmatter_block("---\ntitle: x\n---\nbody").contains("title: x"));
    }
}

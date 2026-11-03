/**
 * Types and pure helpers for the "Summarize recent changes" surface.
 *
 * The backend produces the structure; this module only decides how it is
 * labelled and grouped, so the panel and its tests share one vocabulary.
 */

export type SummaryDocState = "new" | "updated" | "deleted";

export interface SummaryDocument {
  path: string;
  filename: string;
  project: string | null;
  state: SummaryDocState;
  summary: string;
  bullets: string[];
}

export interface SummaryResult {
  overview: string;
  documents: SummaryDocument[];
  provider: string;
  model: string;
  generatedAt: number;
  requested: number;
  skipped: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface SummaryStatus {
  ready: boolean;
  provider: string | null;
  model: string | null;
  problem: string | null;
  configPath: string;
}

export interface SummaryGroup {
  project: string | null;
  documents: SummaryDocument[];
}

/** Documents grouped by `_ai` project, in first-seen order. */
export function groupByProject(
  documents: readonly SummaryDocument[],
): SummaryGroup[] {
  const groups: SummaryGroup[] = [];
  const index = new Map<string | null, SummaryGroup>();

  for (const document of documents) {
    let group = index.get(document.project);
    if (group === undefined) {
      group = { project: document.project, documents: [] };
      index.set(document.project, group);
      groups.push(group);
    }
    group.documents.push(document);
  }

  return groups;
}

/** Header line under the modal title. */
export function summaryMeta(result: SummaryResult): string {
  const shown = `${result.documents.length} of ${
    result.requested
  } document${result.requested === 1 ? "" : "s"}`;
  const parts = [shown, `${result.provider}/${result.model}`];
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  return parts.join(" · ");
}

/** Footer line with the cheap run statistics. */
export function summaryFooter(result: SummaryResult): string {
  const parts = [
    `${result.toolCalls} tool call${result.toolCalls === 1 ? "" : "s"}`,
  ];
  const input = result.inputTokens ?? 0;
  const output = result.outputTokens ?? 0;
  if (input + output > 0) {
    parts.push(`${input + output} tokens`);
  }
  return parts.join(" · ");
}

/** Human label for a document's change state. */
export function stateLabel(state: SummaryDocState): string {
  switch (state) {
    case "new":
      return "new";
    case "updated":
      return "updated";
    case "deleted":
      return "deleted";
  }
}

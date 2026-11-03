import { describe, expect, it } from "vitest";

import {
  groupByProject,
  stateLabel,
  summaryFooter,
  summaryMeta,
  type SummaryDocument,
  type SummaryResult,
} from "./summary-model";

function document(
  project: string | null,
  filename: string,
): SummaryDocument {
  return {
    path: `/p/${filename}`,
    filename,
    project,
    state: "updated",
    summary: "s",
    bullets: [],
  };
}

function result(overrides: Partial<SummaryResult> = {}): SummaryResult {
  return {
    overview: "overview",
    documents: [],
    provider: "openai",
    model: "gpt-test",
    generatedAt: 1,
    requested: 0,
    skipped: 0,
    toolCalls: 0,
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

describe("summary model", () => {
  it("groups documents by project in first-seen order", () => {
    const groups = groupByProject([
      document("docdeck", "a.md"),
      document(null, "b.md"),
      document("docdeck", "c.md"),
    ]);

    expect(groups.map((group) => group.project)).toEqual(["docdeck", null]);
    expect(groups[0].documents.map((doc) => doc.filename)).toEqual([
      "a.md",
      "c.md",
    ]);
  });

  it("summarizes the run header and footer", () => {
    expect(
      summaryMeta(
        result({
          requested: 3,
          documents: [document("x", "a.md")],
          skipped: 2,
        }),
      ),
    ).toBe("1 of 3 documents · openai/gpt-test · 2 skipped");

    expect(
      summaryFooter(
        result({
          inputTokens: 100,
          outputTokens: 20,
          toolCalls: 2,
        }),
      ),
    ).toBe("2 tool calls · 120 tokens");
  });

  it("labels every change state", () => {
    expect(stateLabel("new")).toBe("new");
    expect(stateLabel("updated")).toBe("updated");
    expect(stateLabel("deleted")).toBe("deleted");
  });
});

import { describe, expect, it } from "vitest";

import {
  ConfigEditorModel,
  EXAMPLE_EXCLUDE,
  EXAMPLE_WATCH,
  sanitizeSelectors,
  type WatchConfigView,
} from "./config-editor-model";
import type { ReloadResult } from "./inbox-model";

function view(overrides: Partial<WatchConfigView> = {}): WatchConfigView {
  return {
    path: "/home/u/.config/docdeck/config.toml",
    found: true,
    revision: "rev-1",
    watch: ["~/docs"],
    exclude: [],
    error: null,
    ...overrides,
  };
}

function applied(revision?: string): ReloadResult {
  return {
    generation: 2,
    at: 42,
    path: "/home/u/.config/docdeck/config.toml",
    found: true,
    revision: revision ?? "rev-2",
    watch: ["~/docs", "~/notes"],
    exclude: [],
    roots: ["/home/u/docs", "/home/u/notes"],
    entries: [],
    warnings: [],
    error: null,
    truncated: false,
  };
}

describe("ConfigEditorModel", () => {
  it("tracks dirty when a selector is added or removed", () => {
    const model = ConfigEditorModel.fromView(view());
    expect(model.dirty).toBe(false);

    expect(model.addSelector("watch", "~/reports")).toBe(true);
    expect(model.dirty).toBe(true);

    model.removeSelector("watch", 1);
    expect(model.dirty).toBe(false);
  });

  it("folds exact duplicate selectors", () => {
    const model = ConfigEditorModel.fromView(view());
    expect(model.addSelector("watch", "  ~/docs  ")).toBe(false);
    expect(model.state.watch).toEqual(["~/docs"]);
  });

  it("reports duplicate selectors that reach the draft another way", () => {
    const model = ConfigEditorModel.fromView(view({ watch: ["~/docs", "~/docs"] }));
    const errors = model.validate();
    expect(errors).toEqual([{ field: "watch", message: "Duplicate selector: ~/docs" }]);
  });

  it("validates empty and malformed selectors per field", () => {
    const model = ConfigEditorModel.fromView(view({ watch: ["   "], exclude: ["[bad"] }));

    const errors = model.validate();

    expect(errors).toContainEqual({ field: "watch", message: "Selector cannot be empty." });
    expect(errors).toContainEqual({
      field: "exclude",
      message: "Invalid glob pattern: [bad",
    });
  });

  it("creates a working draft from the example and blocks save on invalid file", () => {
    const missing = ConfigEditorModel.createFromExample("/cfg/config.toml");
    expect(missing.state.createFromExample).toBe(true);
    expect(missing.state.watch).toEqual(EXAMPLE_WATCH);
    expect(missing.state.exclude).toEqual(EXAMPLE_EXCLUDE);

    const broken = ConfigEditorModel.fromView(
      view({ found: true, watch: [], exclude: [], error: "expected value at line 1" }),
    );
    expect(broken.state.invalidFile).toBe(true);
    expect(broken.canSave).toBe(false);
    expect(broken.beginSave()).toBeNull();
  });

  it("builds a sanitized save request and disables duplicate submits", () => {
    const model = ConfigEditorModel.fromView(view());
    model.addSelector("watch", "  ~/docs  ");
    model.addSelector("watch", "~/notes");

    const args = model.beginSave();

    expect(args).toEqual({
      watch: ["~/docs", "~/notes"],
      exclude: [],
      expectedRevision: "rev-1",
      createFromExample: false,
    });
    expect(model.state.saving).toBe(true);
    expect(model.beginSave()).toBeNull();
  });

  it("does not clear the draft when a save is rejected", () => {
    const model = ConfigEditorModel.fromView(view());
    model.addSelector("watch", "~/new");
    model.beginSave();

    model.applySaveResult({
      status: "invalid",
      errors: [{ field: "watch", message: "Invalid glob pattern: ~/new" }],
      warnings: ["selector matched nothing"],
    });

    expect(model.state.watch).toContain("~/new");
    expect(model.state.errors).toHaveLength(1);
    expect(model.state.saving).toBe(false);
  });

  it("adopts the applied result and becomes clean", () => {
    const model = ConfigEditorModel.fromView(view());
    model.addSelector("watch", "~/notes");
    model.beginSave();

    model.applySaveResult({ status: "applied", reload: applied() });

    expect(model.state.revision).toBe("rev-2");
    expect(model.state.watch).toEqual(["~/docs", "~/notes"]);
    expect(model.dirty).toBe(false);
    expect(model.state.lastReload).toMatchObject({ ok: true, at: 42 });
  });

  it("surfaces a conflict and can overwrite after reloading or accepting", () => {
    const model = ConfigEditorModel.fromView(view());
    model.addSelector("watch", "~/notes");
    model.beginSave();

    model.applySaveResult({
      status: "conflict",
      current: view({ revision: "rev-external", watch: ["~/external"] }),
    });

    expect(model.state.conflict?.currentRevision).toBe("rev-external");
    expect(model.state.watch).toContain("~/notes");

    model.overwrite();

    expect(model.state.conflict).toBeNull();
    expect(model.state.revision).toBe("rev-external");
    expect(model.dirty).toBe(true);
  });

  it("reloads the file from disk and drops the draft", () => {
    const model = ConfigEditorModel.fromView(view());
    model.addSelector("watch", "~/notes");

    model.reloadFromDisk(view({ revision: "rev-disk", watch: ["~/disk"] }));

    expect(model.state.revision).toBe("rev-disk");
    expect(model.state.watch).toEqual(["~/disk"]);
    expect(model.dirty).toBe(false);
  });

  it("asks before closing when the draft is dirty", () => {
    const model = ConfigEditorModel.fromView(view());
    expect(model.closeNeedsConfirmation()).toBe(false);
    model.addSelector("exclude", "**/drafts/**");
    expect(model.closeNeedsConfirmation()).toBe(true);
  });
});

describe("sanitizeSelectors", () => {
  it("trims, drops blanks and folds duplicates in order", () => {
    expect(sanitizeSelectors([" ~/a ", "", "~/b", "~/a", "   "])).toEqual(["~/a", "~/b"]);
  });
});

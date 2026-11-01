import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigPanel } from "./config-panel";
import type { WatchConfigView } from "./config-editor-model";
import type { ReloadResult } from "./inbox-model";

const NOW = 1_800_000_000_000;

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

function reload(overrides: Partial<ReloadResult> = {}): ReloadResult {
  return {
    generation: 2,
    at: NOW,
    path: "/home/u/.config/docdeck/config.toml",
    found: true,
    revision: "rev-2",
    watch: ["~/docs", "~/notes"],
    exclude: [],
    roots: ["/home/u/docs", "/home/u/notes"],
    entries: [],
    warnings: [],
    error: null,
    truncated: false,
    ...overrides,
  };
}

function mount(options: Partial<ConstructorParameters<typeof ConfigPanel>[0]> = {}) {
  const container = document.createElement("button");
  container.textContent = "opener";
  document.body.append(container);
  container.focus();

  const onApplied = vi.fn();
  const openFile = vi.fn();
  const panel = new ConfigPanel({
    readConfig: vi.fn(async () => view()),
    saveConfig: vi.fn(async () => ({ status: "applied" as const, reload: reload() })),
    reloadConfig: vi.fn(async () => reload()),
    openFile,
    onApplied,
    now: () => NOW,
    confirmDiscard: () => true,
    ...options,
  });

  return { panel, onApplied, openFile, container };
}

function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".config-overlay");
  if (!element) throw new Error("panel is not open");
  return element;
}

function action(name: string): HTMLButtonElement {
  const button = overlay().querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  if (!button) throw new Error(`missing action: ${name}`);
  return button;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ConfigPanel", () => {
  it("shows the path, validity and last reload", () => {
    const { panel } = mount();
    panel.open(view(), { at: NOW - 5_000, ok: true, error: null, warnings: [], truncated: false });

    expect(overlay().querySelector(".config-path")?.textContent).toContain("config.toml");
    expect(overlay().querySelector(".config-validity")?.textContent).toContain("valid");
    expect(overlay().querySelector(".config-last-reload")?.textContent).toContain("Last reload");
  });

  it("offers to create from the example when no file exists", () => {
    const { panel } = mount();
    panel.open(view({ found: false, revision: "", watch: [], exclude: [] }), null);

    expect(overlay().textContent).toContain("No configuration file yet");
    action("create-example").click();

    expect(
      overlay().querySelector<HTMLInputElement>('.config-selector-row[data-field="watch"] input')
        ?.value,
    ).toBe("~/devel/*/_ai");
  });

  it("adds and removes selectors", () => {
    const { panel } = mount();
    panel.open(view(), null);

    const input = overlay().querySelector<HTMLInputElement>(
      '.config-add-input[data-field="watch"]',
    )!;
    input.value = "~/notes";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(panel.draft?.state.watch).toEqual(["~/docs", "~/notes"]);

    overlay()
      .querySelector<HTMLButtonElement>(
        '.config-selector-row[data-field="watch"][data-index="0"] .config-selector-remove',
      )!
      .click();

    expect(panel.draft?.state.watch).toEqual(["~/notes"]);
  });

  it("shows a precise error and does not call save for invalid input", async () => {
    const saveConfig = vi.fn(async () => ({ status: "applied" as const, reload: reload() }));
    const { panel } = mount({ saveConfig });
    panel.open(view({ watch: ["[bad"] }), null);

    action("save").click();
    await Promise.resolve();

    expect(saveConfig).not.toHaveBeenCalled();
    expect(overlay().querySelector('.config-errors [data-field="watch"]')?.textContent).toContain(
      "Invalid glob pattern",
    );
    expect(panel.draft?.state.watch).toEqual(["[bad"]);
  });

  it("disables structural save for an unparseable file and opens the file", () => {
    const { panel, openFile } = mount();
    panel.open(
      view({ error: "expected value at line 1", watch: [], exclude: [] }),
      null,
    );

    expect(action("save").disabled).toBe(true);
    expect(overlay().textContent).toContain("Invalid configuration");

    action("open-file").click();
    expect(openFile).toHaveBeenCalledWith("/home/u/.config/docdeck/config.toml");
  });

  it("surfaces a conflict and can overwrite with a fresh revision", async () => {
    const saveConfig = vi
      .fn()
      .mockResolvedValueOnce({
        status: "conflict" as const,
        current: view({ revision: "rev-external", watch: ["~/external"] }),
      })
      .mockResolvedValueOnce({ status: "applied" as const, reload: reload() });
    const { panel } = mount({ saveConfig });
    panel.open(view(), null);

    action("save").click();
    await vi.waitFor(() => expect(overlay().querySelector(".config-conflict")).not.toBeNull());

    action("overwrite").click();
    await vi.waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(2));
    expect(saveConfig.mock.calls[1][0].expectedRevision).toBe("rev-external");
  });

  it("reloads from disk and applies the result", async () => {
    const reloadConfig = vi.fn(async () => reload({ revision: "rev-disk" }));
    const readConfig = vi.fn(async () => view({ revision: "rev-disk", watch: ["~/disk"] }));
    const { panel, onApplied } = mount({ reloadConfig, readConfig });
    panel.open(view(), null);

    action("reload").click();

    await vi.waitFor(() => expect(panel.draft?.state.revision).toBe("rev-disk"));
    expect(onApplied).toHaveBeenCalledWith(reload({ revision: "rev-disk" }));
    expect(panel.draft?.state.watch).toEqual(["~/disk"]);
  });

  it("applies a successful save and keeps the dialog open", async () => {
    const { panel, onApplied } = mount();
    panel.open(view(), null);

    action("save").click();

    await vi.waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(panel.isOpen).toBe(true);
    expect(panel.draft?.state.revision).toBe("rev-2");
  });

  it("confirms before discarding unsaved changes and returns focus", () => {
    const confirmDiscard = vi.fn(() => false);
    const { panel, container } = mount({ confirmDiscard });
    panel.open(view(), null);
    const input = overlay().querySelector<HTMLInputElement>(
      '.config-add-input[data-field="watch"]',
    )!;
    input.value = "~/new";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(confirmDiscard).toHaveBeenCalled();
    expect(panel.isOpen).toBe(true);

    confirmDiscard.mockReturnValue(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.isOpen).toBe(false);
    expect(document.activeElement).toBe(container);
  });

  it("closes cleanly with Escape without confirmation", () => {
    const confirmDiscard = vi.fn(() => false);
    const { panel } = mount({ confirmDiscard });
    panel.open(view(), null);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(panel.isOpen).toBe(false);
  });
});

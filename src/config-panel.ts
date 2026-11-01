/**
 * Modal configuration surface.
 *
 * The panel owns only DOM and wiring; every rule lives in
 * `ConfigEditorModel`. It never reads or writes files itself — it calls the
 * typed commands provided by `main.ts`.
 */

import {
  ConfigEditorModel,
  type SaveOutcome,
  type SaveWatchConfigArgs,
  type SelectorField,
  type WatchConfigView,
} from "./config-editor-model";
import type { ReloadResult, ReloadSummary } from "./inbox-model";
import { formatRelativeTime } from "./relative-time";

export interface ConfigPanelOptions {
  readConfig(): Promise<WatchConfigView>;
  saveConfig(args: SaveWatchConfigArgs): Promise<SaveOutcome>;
  reloadConfig(): Promise<ReloadResult>;
  openFile(path: string): void;
  /** Applies an already-reconciled backend reload to the whole app. */
  onApplied(reload: ReloadResult): void;
  onClosed?(): void;
  confirmDiscard?(message: string): boolean;
  now?: () => number;
}

const FIELD_LABELS: Record<SelectorField, string> = {
  watch: "Watch selectors",
  exclude: "Exclude patterns",
};

export class ConfigPanel {
  private overlay: HTMLDivElement | null = null;
  private model: ConfigEditorModel | null = null;
  private opener: HTMLElement | null = null;
  private feedback = "";
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  constructor(private readonly options: ConfigPanelOptions) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  get draft(): ConfigEditorModel | null {
    return this.model;
  }

  open(view: WatchConfigView, lastReload: ReloadSummary | null): void {
    this.opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.model = ConfigEditorModel.fromView(view, lastReload);
    this.feedback = "";
    this.mount();
    this.render();
    this.focusFirst();
  }

  close(force = false): void {
    if (this.overlay === null) return;
    if (this.model && this.model.closeNeedsConfirmation()) {
      const confirm =
        this.options.confirmDiscard ??
        ((message: string) => window.confirm(message));
      if (!force && !confirm("Discard unsaved configuration changes?")) return;
    }

    document.removeEventListener("keydown", this.onKeyDown, true);
    this.overlay.remove();
    this.overlay = null;
    this.model = null;
    this.opener?.focus();
    this.opener = null;
    this.options.onClosed?.();
  }

  destroy(): void {
    this.close(true);
  }

  /** Refreshes the last-reload line without disturbing the draft. */
  updateLastReload(lastReload: ReloadSummary | null): void {
    if (!this.model) return;
    this.model.setLastReload(lastReload);
    this.render();
  }

  private mount(): void {
    const overlay = document.createElement("div");
    overlay.className = "config-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Watch configuration");

    const modal = document.createElement("div");
    modal.className = "config-modal";
    overlay.append(modal);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close();
    });
    document.addEventListener("keydown", this.onKeyDown, true);
    document.body.append(overlay);
    this.overlay = overlay;
  }

  private render(): void {
    if (!this.overlay || !this.model) return;
    const modal = this.overlay.querySelector<HTMLElement>(".config-modal");
    if (!modal) return;
    const state = this.model.state;

    const header = document.createElement("div");
    header.className = "config-header";
    const title = document.createElement("h2");
    title.className = "config-title";
    title.textContent = "Watch configuration";
    const close = this.button("×", "Close configuration", "cancel");
    close.classList.add("config-close");
    close.addEventListener("click", () => this.close());
    header.append(title, close);

    const status = document.createElement("div");
    status.className = "config-status";
    const path = document.createElement("code");
    path.className = "config-path";
    path.textContent = state.path;
    path.title = state.path;
    status.append(path);

    const validity = document.createElement("p");
    validity.className = "config-validity";
    if (state.invalidFile) {
      validity.classList.add("inbox-error");
      validity.textContent = `Invalid configuration: ${
        state.invalidFileError ?? "could not be parsed"
      }`;
    } else if (!state.found) {
      validity.textContent = "No configuration file yet — create one from the example.";
    } else {
      validity.textContent = "Configuration is valid.";
    }
    status.append(validity);

    const reload = document.createElement("p");
    reload.className = "config-last-reload";
    if (state.lastReload) {
      reload.textContent = state.lastReload.ok
        ? `Last reload ${formatRelativeTime(
            state.lastReload.at,
            this.options.now?.() ?? Date.now(),
          )}.`
        : `Last reload failed: ${state.lastReload.error ?? "unknown error"}`;
      if (!state.lastReload.ok) reload.classList.add("inbox-error");
    } else {
      reload.textContent = "No reload has run yet.";
    }
    status.append(reload);

    const body = document.createElement("div");
    body.className = "config-body";

    if (state.createFromExample && !state.invalidFile) {
      const example = this.button(
        "Create from example",
        "Create a working configuration from an example",
        "create-example",
      );
      example.classList.add("sidebar-action");
      example.addEventListener("click", () => {
        const replacement = ConfigEditorModel.createFromExample(
          state.path,
          state.lastReload,
        );
        this.model = replacement;
        this.feedback = "Example configuration loaded. Review it and save.";
        this.render();
      });
      body.append(example);
    }

    if (state.conflict) {
      const banner = document.createElement("div");
      banner.className = "config-conflict";
      const message = document.createElement("p");
      message.textContent =
        "The configuration changed on disk after this dialog opened. Reload it, or overwrite it with your draft.";
      const actions = document.createElement("div");
      actions.className = "config-conflict-actions";
      const reloadDisk = this.button(
        "Reload from disk",
        "Discard the draft and reload the file",
        "reload-disk",
      );
      reloadDisk.addEventListener("click", () => void this.reloadFromDisk());
      const overwrite = this.button(
        "Overwrite",
        "Keep the draft and overwrite the file",
        "overwrite",
      );
      overwrite.addEventListener("click", () => void this.overwrite());
      actions.append(reloadDisk, overwrite);
      banner.append(message, actions);
      body.append(banner);
    }

    body.append(this.selectorList("watch"), this.selectorList("exclude"));

    const errors = document.createElement("div");
    errors.className = "config-errors";
    for (const error of state.errors) {
      const line = document.createElement("p");
      line.className = "inbox-error";
      line.dataset.field = error.field;
      line.textContent = error.message;
      errors.append(line);
    }
    if (this.feedback) {
      const line = document.createElement("p");
      line.className = "config-feedback";
      line.textContent = this.feedback;
      errors.append(line);
    }
    body.append(errors);

    const footer = document.createElement("div");
    footer.className = "config-footer";

    const openFile = this.button("Open config file", "Open in the OS editor", "open-file");
    openFile.addEventListener("click", () => this.options.openFile(state.path));

    const reloadBtn = this.button("Reload", "Reload the file from disk", "reload");
    reloadBtn.addEventListener("click", () => void this.reloadFromDisk());

    const cancel = this.button("Cancel", "Close without saving", "cancel");
    cancel.addEventListener("click", () => this.close());

    const save = this.button("Save", "Validate and apply the configuration", "save");
    save.disabled = !this.model.canSave;
    save.addEventListener("click", () => void this.save());

    footer.append(openFile, reloadBtn, cancel, save);
    modal.replaceChildren(header, status, body, footer);
  }

  private selectorList(field: SelectorField): HTMLElement {
    const state = this.model!.state;
    const section = document.createElement("section");
    section.className = `config-section config-section--${field}`;
    section.dataset.field = field;

    const heading = document.createElement("h3");
    heading.className = "config-section-title";
    heading.textContent = FIELD_LABELS[field];
    section.append(heading);

    const list = document.createElement("ul");
    list.className = "config-selector-list";
    state[field].forEach((value, index) => {
      const row = document.createElement("li");
      row.className = "config-selector-row";
      row.dataset.field = field;
      row.dataset.index = String(index);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "config-selector-input";
      input.value = value;
      input.setAttribute("aria-label", `${FIELD_LABELS[field]} ${index + 1}`);
      input.addEventListener("input", () => {
        if (this.model) this.model.state[field][index] = input.value;
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "config-selector-remove";
      remove.textContent = "×";
      remove.setAttribute(
        "aria-label",
        `Remove ${field} selector ${index + 1}`,
      );
      remove.addEventListener("click", () => {
        if (!this.model) return;
        this.model.removeSelector(field, index);
        this.render();
      });

      row.append(input, remove);
      list.append(row);
    });
    section.append(list);

    const addRow = document.createElement("div");
    addRow.className = "config-add-row";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "config-add-input";
    addInput.placeholder = `Add ${field === "watch" ? "a watch selector" : "an exclude pattern"}`;
    addInput.setAttribute("aria-label", addInput.placeholder);
    const addButton = this.button("Add", `Add the ${field} selector`, `add-${field}`);
    const submit = (): void => {
      if (!this.model || addInput.value.length === 0) return;
      const added = this.model.addSelector(field, addInput.value);
      addInput.value = "";
      this.feedback = added ? "" : "That selector is already in the list.";
      this.render();
      this.overlay
        ?.querySelector<HTMLInputElement>(`.config-add-input[data-field="${field}"]`)
        ?.focus();
    };
    addInput.dataset.field = field;
    addInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
    addButton.addEventListener("click", submit);
    addRow.append(addInput, addButton);
    section.append(addRow);

    return section;
  }

  private async save(): Promise<void> {
    const model = this.model;
    if (!model) return;
    const args = model.beginSave();
    if (!args) {
      this.feedback = "";
      this.render();
      return;
    }
    this.render();

    let outcome: SaveOutcome;
    try {
      outcome = await this.options.saveConfig(args);
    } catch (error) {
      outcome = {
        status: "ioError",
        message: error instanceof Error ? error.message : String(error),
        notWritable: false,
      };
    }

    model.applySaveResult(outcome);
    this.feedback =
      outcome.status === "applied"
        ? "Configuration saved and applied."
        : outcome.status === "conflict"
          ? "Conflicting outside edit detected."
          : "";

    if (outcome.status === "applied") this.options.onApplied(outcome.reload);
    this.render();
    this.announce(outcome);
  }

  private async reloadFromDisk(): Promise<void> {
    try {
      const reload = await this.options.reloadConfig();
      this.options.onApplied(reload);
      const view = await this.options.readConfig();
      this.model?.reloadFromDisk(view);
      this.feedback = "Reloaded from disk.";
    } catch (error) {
      this.feedback = `Reload failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
    this.render();
  }

  private async overwrite(): Promise<void> {
    this.model?.overwrite();
    await this.save();
  }

  /** Focuses the first interactive control or the first invalid field. */
  private focusFirst(): void {
    const firstError = this.model?.state.errors[0];
    if (firstError && firstError.field !== "form") {
      const input = this.overlay?.querySelector<HTMLInputElement>(
        `.config-selector-input`,
      );
      input?.focus();
      return;
    }
    this.overlay?.querySelector<HTMLElement>(".config-add-input")?.focus();
  }

  private announce(outcome: SaveOutcome): void {
    if (outcome.status !== "invalid") return;
    const first = this.overlay?.querySelector<HTMLElement>(".config-errors .inbox-error");
    first?.scrollIntoView?.({ block: "nearest" });
  }

  private button(label: string, title: string, action: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "config-action";
    button.dataset.action = action;
    button.textContent = label;
    button.title = title;
    return button;
  }
}

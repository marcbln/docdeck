/**
 * Pure draft/validation/conflict state for the in-app configuration surface.
 *
 * No DOM and no `invoke`: the panel renders this model, `main.ts` performs the
 * save, and the tests exercise every transition without a window.
 */

import type { ReloadResult, ReloadSummary } from "./inbox-model";

export type SelectorField = "watch" | "exclude";

export interface ConfigFieldError {
  field: SelectorField | "form";
  message: string;
}

export interface WatchConfigView {
  path: string;
  found: boolean;
  revision: string;
  watch: string[];
  exclude: string[];
  error: string | null;
}

export interface SaveWatchConfigArgs {
  watch: string[];
  exclude: string[];
  expectedRevision: string;
  createFromExample: boolean;
}

export type SaveOutcome =
  | { status: "applied"; reload: ReloadResult }
  | { status: "conflict"; current: WatchConfigView }
  | { status: "invalid"; errors: ConfigFieldError[]; warnings: string[] }
  | { status: "ioError"; message: string; notWritable: boolean };

export interface ConflictState {
  currentRevision: string;
  currentWatch: string[];
  currentExclude: string[];
  current: WatchConfigView;
}

export interface ConfigEditorState {
  path: string;
  found: boolean;
  revision: string;
  watch: string[];
  exclude: string[];
  originalWatch: string[];
  originalExclude: string[];
  createFromExample: boolean;
  invalidFile: boolean;
  invalidFileError: string | null;
  errors: ConfigFieldError[];
  conflict: ConflictState | null;
  lastReload: ReloadSummary | null;
  saving: boolean;
}

/** A working starter config offered when no file exists yet. */
export const EXAMPLE_WATCH = ["~/devel/*/_ai"];
export const EXAMPLE_EXCLUDE = ["**/archive/**"];

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Trims, drops blanks and folds exact duplicates, preserving order. */
export function sanitizeSelectors(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** A selector with an unterminated character class cannot compile. */
function isInvalidGlob(value: string): boolean {
  let open = 0;
  for (const character of value) {
    if (character === "[") open += 1;
    if (character === "]") open -= 1;
    if (open < 0) return true;
  }
  return open !== 0;
}

export class ConfigEditorModel {
  state: ConfigEditorState;

  constructor(state: ConfigEditorState) {
    this.state = state;
  }

  static fromView(
    view: WatchConfigView,
    lastReload: ReloadSummary | null = null,
  ): ConfigEditorModel {
    return new ConfigEditorModel({
      path: view.path,
      found: view.found,
      revision: view.revision,
      watch: [...view.watch],
      exclude: [...view.exclude],
      originalWatch: [...view.watch],
      originalExclude: [...view.exclude],
      createFromExample: !view.found && view.error === null,
      invalidFile: view.error !== null,
      invalidFileError: view.error,
      errors: [],
      conflict: null,
      lastReload,
      saving: false,
    });
  }

  /** Starts a draft from the working example when no file exists. */
  static createFromExample(
    path: string,
    lastReload: ReloadSummary | null = null,
  ): ConfigEditorModel {
    return new ConfigEditorModel({
      path,
      found: false,
      revision: "",
      watch: [...EXAMPLE_WATCH],
      exclude: [...EXAMPLE_EXCLUDE],
      originalWatch: [],
      originalExclude: [],
      createFromExample: true,
      invalidFile: false,
      invalidFileError: null,
      errors: [],
      conflict: null,
      lastReload,
      saving: false,
    });
  }

  get dirty(): boolean {
    return (
      !sameList(this.state.watch, this.state.originalWatch) ||
      !sameList(this.state.exclude, this.state.originalExclude)
    );
  }

  get canSave(): boolean {
    return !this.state.invalidFile && !this.state.saving;
  }

  /** Adds a selector, folding exact duplicates. Returns false when folded. */
  addSelector(field: SelectorField, value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length > 0 && this.state[field].some((item) => item.trim() === trimmed)) {
      return false;
    }
    this.state[field].push(value);
    return true;
  }

  removeSelector(field: SelectorField, index: number): void {
    if (index < 0 || index >= this.state[field].length) return;
    this.state[field].splice(index, 1);
  }

  setLastReload(lastReload: ReloadSummary | null): void {
    this.state.lastReload = lastReload;
  }

  /** Validates the draft and records precise field errors. */
  validate(): ConfigFieldError[] {
    const errors: ConfigFieldError[] = [];

    if (this.state.invalidFile) {
      errors.push({
        field: "form",
        message:
          "The existing configuration could not be parsed. Open the file, fix it, then reload.",
      });
    }

    for (const field of ["watch", "exclude"] as const) {
      const seen = new Set<string>();
      for (const raw of this.state[field]) {
        const value = raw.trim();
        if (value.length === 0) {
          errors.push({ field, message: "Selector cannot be empty." });
          continue;
        }
        if (seen.has(value)) {
          errors.push({ field, message: `Duplicate selector: ${value}` });
        }
        seen.add(value);
        if (isInvalidGlob(value)) {
          errors.push({ field, message: `Invalid glob pattern: ${value}` });
        }
      }
    }

    this.state.errors = errors;
    return errors;
  }

  /**
   * Prepares a save request, or `null` when the draft cannot be saved.
   * Saving is disabled while a previous submit is in flight.
   */
  beginSave(): SaveWatchConfigArgs | null {
    if (!this.canSave) return null;
    if (this.validate().length > 0) return null;

    this.state.saving = true;
    return {
      watch: sanitizeSelectors(this.state.watch),
      exclude: sanitizeSelectors(this.state.exclude),
      expectedRevision: this.state.revision,
      createFromExample: this.state.createFromExample,
    };
  }

  /** Folds a failed save while preserving the draft. */
  applySaveResult(outcome: SaveOutcome): void {
    this.state.saving = false;

    switch (outcome.status) {
      case "applied": {
        this.state.revision = outcome.reload.revision;
        this.state.found = true;
        this.state.createFromExample = false;
        this.state.invalidFile = false;
        this.state.invalidFileError = null;
        this.state.watch = [...outcome.reload.watch];
        this.state.exclude = [...outcome.reload.exclude];
        this.state.originalWatch = [...outcome.reload.watch];
        this.state.originalExclude = [...outcome.reload.exclude];
        this.state.errors = [];
        this.state.conflict = null;
        this.state.lastReload = {
          at: outcome.reload.at,
          ok: outcome.reload.error === null,
          error: outcome.reload.error,
          warnings: [...outcome.reload.warnings],
          truncated: outcome.reload.truncated,
        };
        return;
      }
      case "conflict": {
        this.state.conflict = {
          currentRevision: outcome.current.revision,
          currentWatch: [...outcome.current.watch],
          currentExclude: [...outcome.current.exclude],
          current: outcome.current,
        };
        return;
      }
      case "invalid": {
        this.state.errors = [...outcome.errors];
        return;
      }
      case "ioError": {
        this.state.errors = [{ field: "form", message: outcome.message }];
        return;
      }
    }
  }

  /** Replaces the draft with the file as it is now on disk. */
  reloadFromDisk(view: WatchConfigView): void {
    const reload = this.state.lastReload;
    this.state = ConfigEditorModel.fromView(view, reload).state;
  }

  /** Accepts the outside edit and keeps the draft, so a retry can overwrite. */
  overwrite(): void {
    if (this.state.conflict === null) return;
    this.state.revision = this.state.conflict.currentRevision;
    this.state.conflict = null;
  }

  /** Closing with unsaved changes needs an explicit discard confirmation. */
  closeNeedsConfirmation(): boolean {
    return this.dirty;
  }
}

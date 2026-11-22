/**
 * Pure view model for the transient **Changed `_ai`** browse view.
 *
 * DOM-free by design: the report shape, row composition, ordering and the
 * explicit state matrix are unit tested without a filesystem, a DOM or Tauri.
 * Rust owns repository discovery and git; this module owns presentation.
 */

import { fileName, projectName } from "./project";

export type ChangedErrorCode =
  | "git-missing"
  | "timeout"
  | "output-limit"
  | "unreadable"
  | "not-a-repository";

export interface ChangedDocument {
  path: string;
  repositoryRoot: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  modifiedTime: number | null;
}

export interface ChangedRepository {
  root: string;
  documents: ChangedDocument[];
  error: string | null;
  errorCode: ChangedErrorCode | null;
}

export interface ChangedScope {
  requested: string;
  repository: string;
}

export interface ChangedAiReport {
  scope: ChangedScope | null;
  scopeError: string | null;
  watchedRoots: number;
  aiFolders: number;
  repositories: ChangedRepository[];
  gitAvailable: boolean;
  discoveryTruncated: boolean;
}

/** One flat row the changed list renders. */
export interface ChangedRow {
  path: string;
  filename: string;
  /** Never null: `projectName` falls back to the repository basename. */
  project: string;
  /** Path relative to the deepest `_ai` component; never empty. */
  context: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  modifiedTime: number | null;
  repositoryRoot: string;
}

export type ChangedStatus =
  | "idle"
  | "loading"
  | "refreshing"
  | "ready"
  | "empty"
  | "no-repository"
  | "partial"
  | "error"
  | "scope-error";

/** Everything the sidebar needs to paint one changed snapshot. */
export interface ChangedViewState {
  status: ChangedStatus;
  rows: ChangedRow[];
  repositories: ChangedRepository[];
  scope: ChangedScope | null;
  scopeError: string | null;
  gitAvailable: boolean;
  discoveryTruncated: boolean;
  watchedRoots: number;
  aiFolders: number;
  loadedAt: number | null;
}

/** The idle snapshot painted before the first activation. */
export function emptyChangedViewState(): ChangedViewState {
  return {
    status: "idle",
    rows: [],
    repositories: [],
    scope: null,
    scopeError: null,
    gitAvailable: true,
    discoveryTruncated: false,
    watchedRoots: 0,
    aiFolders: 0,
    loadedAt: null,
  };
}

interface SplitPath {
  parts: string[];
  separator: string;
}

/**
 * Splits a path the same way `project.ts` does: a Windows-shaped path accepts
 * both separators, a Unix-shaped one treats a backslash as a filename character.
 */
function splitPath(path: string): SplitPath {
  const windows =
    /^[A-Za-z]:[\\/]/.test(path) ||
    (path.includes("\\") && !path.includes("/")) ||
    path.startsWith("\\\\");
  if (windows) {
    return {
      parts: path.split("\\").join("/").split("/").filter(Boolean),
      separator: "\\",
    };
  }
  return { parts: path.split("/").filter(Boolean), separator: "/" };
}

/**
 * The part of a path below the deepest `_ai` component.
 *
 * `~/devel/docdeck/_ai/backlog/plan.md` → `backlog/plan.md`. Falls back to the
 * tail of the path so a valid row never renders empty context.
 */
export function changedContext(path: string): string {
  const { parts, separator } = splitPath(path);
  let deepest = -1;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "_ai") deepest = index;
  }
  const tail = deepest >= 0 ? parts.slice(deepest + 1) : parts.slice(-2);
  return tail.length > 0 ? tail.join(separator) : fileName(path);
}

function repositoryBase(path: string): string {
  return fileName(path) || path;
}

function comparablePath(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) ? path.toLowerCase() : path;
}

/**
 * Flattens every repository into one row list.
 *
 * One row per canonical path (merged defensively across repositories), newest
 * modification first, `path.localeCompare` as the tiebreaker, and rows without
 * a modification time last (research D12).
 */
export function deriveChangedRows(report: ChangedAiReport): ChangedRow[] {
  const merged = new Map<string, ChangedRow>();

  for (const repository of report.repositories) {
    for (const document of repository.documents) {
      const key = comparablePath(document.path);
      const existing = merged.get(key);
      if (existing !== undefined) {
        existing.staged ||= document.staged;
        existing.unstaged ||= document.unstaged;
        existing.untracked ||= document.untracked;
        if (
          document.modifiedTime !== null &&
          (existing.modifiedTime === null ||
            document.modifiedTime > existing.modifiedTime)
        ) {
          existing.modifiedTime = document.modifiedTime;
        }
        continue;
      }

      merged.set(key, {
        path: document.path,
        filename: fileName(document.path),
        project:
          projectName(document.path) ?? repositoryBase(repository.root),
        context: changedContext(document.path),
        staged: document.staged,
        unstaged: document.unstaged,
        untracked: document.untracked,
        modifiedTime: document.modifiedTime,
        repositoryRoot: document.repositoryRoot,
      });
    }
  }

  return [...merged.values()].sort((left, right) => {
    if (left.modifiedTime === null && right.modifiedTime === null) {
      return left.path.localeCompare(right.path);
    }
    if (left.modifiedTime === null) return 1;
    if (right.modifiedTime === null) return -1;
    return (
      right.modifiedTime - left.modifiedTime ||
      left.path.localeCompare(right.path)
    );
  });
}

/**
 * Selects one explicit state from a report.
 *
 * Order matters: scope-error and git-missing win before row counting, and a
 * repository error is never hidden behind an "empty" claim.
 */
export function selectChangedState(
  report: ChangedAiReport,
  loadedAt: number | null,
): ChangedViewState {
  const rows = deriveChangedRows(report);
  const hasError = report.repositories.some(
    (repository) => repository.error !== null,
  );

  let status: ChangedStatus;
  if (report.scopeError !== null) {
    status = "scope-error";
  } else if (!report.gitAvailable) {
    status = "error";
  } else if (rows.length > 0) {
    status = hasError ? "partial" : "ready";
  } else if (hasError) {
    status = "partial";
  } else if (report.aiFolders === 0) {
    status = "no-repository";
  } else if (report.repositories.length === 0) {
    status = "no-repository";
  } else {
    status = "empty";
  }

  return {
    status,
    rows: status === "scope-error" || status === "error" ? [] : rows,
    repositories: report.repositories,
    scope: report.scopeError === null ? report.scope : null,
    scopeError: report.scopeError,
    gitAvailable: report.gitAvailable,
    discoveryTruncated: report.discoveryTruncated,
    watchedRoots: report.watchedRoots,
    aiFolders: report.aiFolders,
    loadedAt,
  };
}

/** Badge text in display order; never colour alone. */
export function changedBadgeLabels(
  row: Pick<ChangedRow, "staged" | "unstaged" | "untracked">,
): string[] {
  const labels: string[] = [];
  if (row.staged) labels.push("Staged");
  if (row.unstaged) labels.push("Unstaged");
  if (row.untracked) labels.push("New");
  return labels;
}

/** How many repositories the loading copy should name. */
function repositoryCount(state: ChangedViewState): number {
  return state.repositories.length > 0
    ? state.repositories.length
    : state.watchedRoots;
}

function documentCount(count: number): string {
  return `${count} changed \`_ai\` document${count === 1 ? "" : "s"}`;
}

/** The exact copy for one state (research D11). */
export function changedStateMessage(state: ChangedViewState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "loading": {
      const count = repositoryCount(state);
      return `Reading git status in ${count} repositor${
        count === 1 ? "y" : "ies"
      }…`;
    }
    case "refreshing":
      return "Refreshing…";
    case "ready":
      return documentCount(state.rows.length);
    case "partial":
      return state.rows.length > 0
        ? documentCount(state.rows.length)
        : "Some repositories could not be read.";
    case "empty":
      return `No uncommitted \`_ai\` documents in ${
        state.repositories.length
      } repositor${state.repositories.length === 1 ? "y" : "ies"}.`;
    case "no-repository":
      return "No watched `_ai` folder is inside a git repository.";
    case "scope-error":
      return `No git repository contains \`${
        state.scopeError ?? "the requested path"
      }\`.`;
    case "error":
      return "git is not installed or could not be started.";
  }
}

/** The warning appended when the fallback discovery hit its budget. */
export const DISCOVERY_TRUNCATED_WARNING =
  "Repository discovery stopped at its entry limit; some `_ai` folders may be missing.";

/** One line per failing repository, naming it and its reason. */
export function changedRepositoryErrors(
  repositories: readonly ChangedRepository[],
): string[] {
  return repositories
    .filter((repository) => repository.error !== null)
    .map((repository) => `${repository.root}: ${repository.error ?? "unknown error"}`);
}

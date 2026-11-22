/**
 * Session state machine for the transient **Changed `_ai`** view.
 *
 * The controller owns the scope, the in-flight generation and the one-shot
 * scan-settled refresh. It never touches tabs, documents, scroll, unread,
 * bookmark or acknowledgement state: row activation is a document action and
 * deliberately not a transition here.
 */

import {
  emptyChangedViewState,
  selectChangedState,
  type ChangedAiReport,
  type ChangedStatus,
  type ChangedViewState,
} from "./changed-ai-model";

/** Whether the view covers every watched repository or one of them. */
export type ChangedScopeState =
  | { kind: "all" }
  | {
      kind: "repository";
      /** As supplied by `--changed [path]`; retained for the error state. */
      requestedPath: string;
      /** Resolved work tree, or null until the report confirms it. */
      root: string | null;
    };

export interface ChangedAiControllerState {
  active: boolean;
  scope: ChangedScopeState;
  status: ChangedStatus;
  report: ChangedAiReport | null;
  snapshot: ChangedViewState;
  loadedAt: number | null;
  generation: number;
  inFlight: boolean;
  refreshOnSettle: boolean;
}

export interface ChangedAiControllerOptions {
  /** Injected Tauri seam; tests supply a deferred promise. */
  load(scope: string | null): Promise<ChangedAiReport>;
  /** Injectable clock so `loadedAt` is deterministic in tests. */
  now?: () => number;
  onChange?: (state: ChangedAiControllerState) => void;
}

export class ChangedAiController {
  private state: ChangedAiControllerState = {
    active: false,
    scope: { kind: "all" },
    status: "idle",
    report: null,
    snapshot: emptyChangedViewState(),
    loadedAt: null,
    generation: 0,
    inFlight: false,
    refreshOnSettle: false,
  };
  private pending: Promise<void> | null = null;
  /** Set when settle arrives mid-flight: one follow-up request after it. */
  private refreshQueued = false;

  constructor(private readonly options: ChangedAiControllerOptions) {}

  get current(): ChangedAiControllerState {
    return this.state;
  }

  get snapshot(): ChangedViewState {
    return this.state.snapshot;
  }

  /**
   * Shows the view and issues one request.
   *
   * Without a `scope` the previous scope is kept; the first activation is
   * therefore `{ kind: "all" }`. A supplied scope always supersedes an
   * in-flight request, because rescoping must replace the previous scope
   * atomically. `watchesPending` arms the one-shot settle refresh.
   */
  activate(scope?: ChangedScopeState, watchesPending = false): Promise<void> {
    const rescope = scope !== undefined;
    if (rescope) this.state.scope = scope;
    this.state.active = true;
    this.state.refreshOnSettle = watchesPending;

    if (this.state.inFlight && !rescope) {
      return this.pending ?? Promise.resolve();
    }
    return this.startRequest();
  }

  /** Re-reads git without discarding the painted snapshot. */
  refresh(): Promise<void> {
    this.state.active = true;
    if (this.state.inFlight) return this.pending ?? Promise.resolve();
    return this.startRequest();
  }

  /** Leaves the view while keeping the last snapshot for the session. */
  deactivate(): void {
    this.state.active = false;
    this.state.status = "idle";
    this.emit();
  }

  /** One action: replace a narrowed scope with the full watched list. */
  showAllRepositories(): Promise<void> {
    this.state.active = true;
    this.state.scope = { kind: "all" };
    return this.startRequest();
  }

  /**
   * The single automatic follow-up: refresh once when startup scans settle,
   * and only when the view activated while one was in flight.
   */
  notifyWatchesSettled(): Promise<void> {
    if (!this.state.refreshOnSettle) return Promise.resolve();
    this.state.refreshOnSettle = false;
    if (this.state.inFlight) {
      // The initial request may have snapshotted an empty watch set. Queue one
      // follow-up so the settle still causes exactly one refresh.
      this.refreshQueued = true;
      return this.pending ?? Promise.resolve();
    }
    return this.refresh();
  }

  /** Row activation is a document action: it never changes the view state. */
  activateRow(path: string, open: (path: string) => void): void {
    open(path);
  }

  private startRequest(): Promise<void> {
    const generation = ++this.state.generation;
    this.state.inFlight = true;

    if (this.state.loadedAt === null) {
      this.state.status = "loading";
      this.state.snapshot = {
        ...emptyChangedViewState(),
        status: "loading",
      };
    } else {
      // Keep the previous rows painted while the new report is in flight.
      this.state.status = "refreshing";
      this.state.snapshot = {
        ...this.state.snapshot,
        status: "refreshing",
      };
    }
    this.emit();

    const scope =
      this.state.scope.kind === "repository"
        ? this.state.scope.requestedPath
        : null;
    const clock = this.options.now ?? Date.now;

    const request = this.options
      .load(scope)
      .then((report) => {
        if (generation !== this.state.generation) return;
        const loadedAt = clock();
        const snapshot = selectChangedState(report, loadedAt);
        this.state.report = report;
        this.state.loadedAt = loadedAt;
        this.state.snapshot = snapshot;
        this.state.status = snapshot.status;

        if (report.scope !== null) {
          this.state.scope = {
            kind: "repository",
            requestedPath: report.scope.requested,
            root: report.scope.repository,
          };
        } else if (report.scopeError !== null) {
          // Remember what was asked for so the error can name it.
          if (this.state.scope.kind === "repository") {
            this.state.scope = { ...this.state.scope, root: null };
          }
        }
      })
      .catch(() => {
        if (generation !== this.state.generation) return;
        this.state.status = "error";
        this.state.snapshot = {
          ...emptyChangedViewState(),
          status: "error",
          repositories: this.state.report?.repositories ?? [],
          scope: this.state.snapshot.scope,
          loadedAt: this.state.loadedAt,
        };
      })
      .finally(() => {
        if (generation !== this.state.generation) return;
        this.state.inFlight = false;
        this.pending = null;
        this.emit();
        if (this.refreshQueued) {
          this.refreshQueued = false;
          void this.startRequest();
        }
      });

    this.pending = request;
    return request;
  }

  private emit(): void {
    this.options.onChange?.({ ...this.state });
  }
}

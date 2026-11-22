import { describe, expect, it, vi } from "vitest";

import { ChangedAiController } from "./changed-ai-controller";
import type { ChangedAiReport } from "./changed-ai-model";

function report(overrides: Partial<ChangedAiReport> = {}): ChangedAiReport {
  return {
    scope: null,
    scopeError: null,
    watchedRoots: 1,
    aiFolders: 1,
    repositories: [
      {
        root: "/devel/docdeck",
        documents: [
          {
            path: "/devel/docdeck/_ai/backlog/plan.md",
            repositoryRoot: "/devel/docdeck",
            staged: false,
            unstaged: true,
            untracked: false,
            modifiedTime: 100,
          },
        ],
        error: null,
        errorCode: null,
      },
    ],
    gitAvailable: true,
    discoveryTruncated: false,
    ...overrides,
  };
}

interface Pending {
  resolve(value: ChangedAiReport): void;
  reject(error: unknown): void;
}

function deferredLoader() {
  const calls: Array<string | null> = [];
  const pending: Pending[] = [];
  const load = vi.fn(
    (scope: string | null) =>
      new Promise<ChangedAiReport>((resolve, reject) => {
        calls.push(scope);
        pending.push({ resolve, reject });
      }),
  );
  return { load, calls, pending };
}

function controller(loader: ReturnType<typeof deferredLoader>) {
  return new ChangedAiController({
    load: loader.load,
    now: () => 5_000,
  });
}

describe("ChangedAiController", () => {
  it("activates all watched repositories first and paints loading at once", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const request = subject.activate();

    expect(loader.calls).toEqual([null]);
    expect(subject.current.active).toBe(true);
    expect(subject.current.status).toBe("loading");
    expect(subject.current.snapshot.rows).toEqual([]);

    loader.pending[0].resolve(report());
    await request;

    expect(subject.current.status).toBe("ready");
    expect(subject.current.loadedAt).toBe(5_000);
    expect(subject.current.snapshot.rows).toHaveLength(1);
  });

  it("keeps exactly one request in flight for repeated activation", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const first = subject.activate();
    const second = subject.activate();

    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    loader.pending[0].resolve(report());
    await first;
  });

  it("drops a superseded generation when a rescope arrives", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const first = subject.activate();
    const second = subject.activate({
      kind: "repository",
      requestedPath: "/devel/other",
      root: null,
    });

    expect(loader.calls).toEqual([null, "/devel/other"]);

    loader.pending[0].resolve(
      report({
        repositories: [
          {
            root: "/devel/docdeck",
            documents: [
              {
                path: "/devel/docdeck/_ai/old.md",
                repositoryRoot: "/devel/docdeck",
                staged: false,
                unstaged: false,
                untracked: true,
                modifiedTime: 1,
              },
            ],
            error: null,
            errorCode: null,
          },
        ],
      }),
    );
    await first;

    // The superseded report never paints.
    expect(subject.current.status).not.toBe("ready");
    expect(subject.current.snapshot.rows).toEqual([]);

    loader.pending[1].resolve(
      report({
        scope: {
          requested: "/devel/other",
          repository: "/devel/other",
        },
        repositories: [
          {
            root: "/devel/other",
            documents: [
              {
                path: "/devel/other/_ai/new.md",
                repositoryRoot: "/devel/other",
                staged: false,
                unstaged: false,
                untracked: true,
                modifiedTime: 2,
              },
            ],
            error: null,
            errorCode: null,
          },
        ],
      }),
    );
    await second;

    expect(subject.current.status).toBe("ready");
    expect(subject.current.snapshot.rows[0].path).toBe(
      "/devel/other/_ai/new.md",
    );
    expect(subject.current.scope).toEqual({
      kind: "repository",
      requestedPath: "/devel/other",
      root: "/devel/other",
    });
  });

  it("treats row activation as a document action, not a state transition", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);
    const request = subject.activate();
    loader.pending[0].resolve(report());
    await request;

    const before = JSON.parse(JSON.stringify(subject.current));
    const open = vi.fn();
    subject.activateRow("/devel/docdeck/_ai/backlog/plan.md", open);

    expect(open).toHaveBeenCalledWith(
      "/devel/docdeck/_ai/backlog/plan.md",
    );
    expect(JSON.parse(JSON.stringify(subject.current))).toEqual(before);
  });

  it("rescopes atomically and returns to all repositories in one action", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const request = subject.activate({
      kind: "repository",
      requestedPath: "/devel/other",
      root: null,
    });
    expect(subject.current.scope).toEqual({
      kind: "repository",
      requestedPath: "/devel/other",
      root: null,
    });

    loader.pending[0].resolve(
      report({ scopeError: "/devel/other", repositories: [] }),
    );
    await request;

    expect(subject.current.status).toBe("scope-error");
    expect(subject.current.scope).toEqual({
      kind: "repository",
      requestedPath: "/devel/other",
      root: null,
    });

    const all = subject.showAllRepositories();
    expect(subject.current.scope).toEqual({ kind: "all" });
    expect(loader.calls).toEqual(["/devel/other", null]);

    loader.pending[1].resolve(
      report({
        repositories: [],
        aiFolders: 0,
      }),
    );
    await all;
    expect(subject.current.status).toBe("no-repository");
  });

  it("keeps the previous snapshot painted while refreshing", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const first = subject.activate();
    loader.pending[0].resolve(report());
    await first;
    const previous = subject.snapshot;

    const refresh = subject.refresh();
    expect(subject.current.status).toBe("refreshing");
    expect(subject.snapshot.rows).toEqual(previous.rows);
    expect(loader.calls).toEqual([null, null]);

    loader.pending[1].resolve(
      report({
        repositories: [],
        aiFolders: 0,
      }),
    );
    await refresh;
    expect(subject.current.status).toBe("no-repository");
    expect(subject.snapshot.rows).toEqual([]);
  });

  it("performs one scan-settled refresh and only when it was armed", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const first = subject.activate(undefined, true);
    loader.pending[0].resolve(report());
    await first;
    expect(loader.load).toHaveBeenCalledTimes(1);

    const settled = subject.notifyWatchesSettled();
    expect(loader.load).toHaveBeenCalledTimes(2);

    loader.pending[1].resolve(report());
    await settled;

    await subject.notifyWatchesSettled();
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it("queues the settle refresh when it arrives mid-flight", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    subject.activate(undefined, true);
    const settle = subject.notifyWatchesSettled();
    expect(loader.load).toHaveBeenCalledTimes(1);

    loader.pending[0].resolve(report());
    await settle;
    // The initial request was still in flight, so exactly one follow-up starts.
    expect(loader.load).toHaveBeenCalledTimes(2);

    loader.pending[1].resolve(report());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(subject.current.inFlight).toBe(false);
  });

  it("does not refresh after settle when activation did not arm it", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const first = subject.activate();
    loader.pending[0].resolve(report());
    await first;

    await subject.notifyWatchesSettled();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it("maps a rejected request to the error state without timers", async () => {
    const loader = deferredLoader();
    const subject = controller(loader);

    const request = subject.activate();
    loader.pending[0].reject(new Error("backend unavailable"));
    await request;

    expect(subject.current.status).toBe("error");
    expect(subject.snapshot.rows).toEqual([]);
    expect(subject.current.inFlight).toBe(false);
  });
});

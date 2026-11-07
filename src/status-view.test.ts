import { describe, expect, it } from "vitest";

import type { StatusEvent } from "./event-log";
import { deriveStatusBar } from "./status-view";

const NOW = 1_800_000_000_000;

function event(overrides: Partial<StatusEvent> = {}): StatusEvent {
  return {
    id: 1,
    at: NOW,
    kind: "reload",
    severity: "info",
    message: "Configuration reloaded",
    ...overrides,
  };
}

describe("deriveStatusBar", () => {
  it("shows live progress while scanning", () => {
    const view = deriveStatusBar({
      scanning: true,
      progress: { path: "/work/_ai/plans", directories: 3, files: 12 },
      entries: [],
      watchCount: 2,
    });

    expect(view.phase).toBe("scanning");
    expect(view.location).toBe("/work/_ai/plans");
    expect(view.directories).toBe(3);
    expect(view.files).toBe(12);
    expect(view.text).toBe("Scanning /work/_ai/plans (3 folders · 12 files)");
    expect(view.severity).toBe("info");
  });

  it("uses the fallback line before any progress arrives", () => {
    const view = deriveStatusBar({
      scanning: true,
      progress: null,
      entries: [],
      watchCount: 0,
    });

    expect(view.phase).toBe("scanning");
    expect(view.location).toBeNull();
    expect(view.text).toBe("Scanning watched paths…");
  });

  it("uses singular folder and file labels", () => {
    const view = deriveStatusBar({
      scanning: true,
      progress: { path: "/a", directories: 1, files: 1 },
      entries: [],
      watchCount: 0,
    });

    expect(view.text).toBe("Scanning /a (1 folder · 1 file)");
  });

  it("renders the newest event once scanning has finished", () => {
    const view = deriveStatusBar({
      scanning: false,
      progress: null,
      entries: [
        event({ id: 1, message: "Scan complete", severity: "info" }),
        event({ id: 2, message: "3 warnings", severity: "warning" }),
      ],
      watchCount: 1,
    });

    expect(view.phase).toBe("idle");
    expect(view.event?.message).toBe("3 warnings");
    expect(view.severity).toBe("warning");
    expect(view.text).toBe("3 warnings");
  });

  it("counts warning entries and yields no chip at zero", () => {
    const none = deriveStatusBar({
      scanning: false,
      progress: null,
      entries: [event({ severity: "info" })],
      watchCount: 0,
    });
    expect(none.warningCount).toBe(0);

    const some = deriveStatusBar({
      scanning: false,
      progress: null,
      entries: [
        event({ id: 1, severity: "warning" }),
        event({ id: 2, severity: "info" }),
        event({ id: 3, severity: "warning" }),
      ],
      watchCount: 0,
    });
    expect(some.warningCount).toBe(2);
  });

  it("shows a quiet idle line when nothing has happened", () => {
    expect(
      deriveStatusBar({
        scanning: false,
        progress: null,
        entries: [],
        watchCount: 0,
      }).text,
    ).toBe("Ready");

    expect(
      deriveStatusBar({
        scanning: false,
        progress: null,
        entries: [],
        watchCount: 3,
      }).text,
    ).toBe("Watching 3 folders");

    expect(
      deriveStatusBar({
        scanning: false,
        progress: null,
        entries: [],
        watchCount: 1,
      }).text,
    ).toBe("Watching 1 folder");
  });

  it("shortens a long location before hiding the counts", () => {
    const path = `/very/long/${"a".repeat(80)}/file.md`;
    const view = deriveStatusBar({
      scanning: true,
      progress: { path, directories: 4, files: 9 },
      entries: [],
      watchCount: 0,
    });

    expect(view.location).not.toBe(path);
    expect(view.location?.startsWith("…")).toBe(true);
    expect(view.text).toContain("4 folders · 9 files");
  });

  it("keeps event text on a single line", () => {
    const view = deriveStatusBar({
      scanning: false,
      progress: null,
      entries: [event({ message: "first line\n\tsecond   line" })],
      watchCount: 0,
    });

    expect(view.text).toBe("first line second line");
    expect(view.text).not.toContain("\n");
  });
});

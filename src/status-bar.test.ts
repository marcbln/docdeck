import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusBarView } from "./status-view";
import { StatusBar } from "./status-bar";

function view(overrides: Partial<StatusBarView> = {}): StatusBarView {
  return {
    phase: "idle",
    location: null,
    directories: 0,
    files: 0,
    event: null,
    warningCount: 0,
    severity: "info",
    text: "Configuration reloaded",
    ...overrides,
  };
}

function mount(): {
  root: HTMLElement;
  bar: StatusBar;
  onToggleLog: ReturnType<typeof vi.fn>;
  onShowWarnings: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = '<footer id="status-bar"></footer>';
  const root = document.getElementById("status-bar") as HTMLElement;
  const onToggleLog = vi.fn();
  const onShowWarnings = vi.fn();
  const bar = new StatusBar(root, { onToggleLog, onShowWarnings });
  return { root, bar, onToggleLog, onShowWarnings };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StatusBar", () => {
  it("renders the derived text and severity", () => {
    const { root, bar } = mount();
    bar.render(
      view({ text: "Some paths were skipped", severity: "warning" }),
    );

    expect(root.querySelector(".status-bar-location")?.textContent).toBe(
      "Some paths were skipped",
    );
    expect(root.dataset.severity).toBe("warning");
  });

  it("renders scan counts in their own non-shrinking segment", () => {
    const { root, bar } = mount();
    bar.render(
      view({
        phase: "scanning",
        location: "/work/_ai",
        directories: 2,
        files: 7,
        text: "Scanning /work/_ai (2 folders · 7 files)",
      }),
    );

    expect(root.querySelector(".status-bar-location")?.textContent).toBe(
      "Scanning /work/_ai",
    );
    expect(root.querySelector(".status-bar-counts")?.textContent).toBe(
      "(2 folders · 7 files)",
    );
    expect(
      (root.querySelector(".status-bar-counts") as HTMLElement).hidden,
    ).toBe(false);
  });

  it("hides the warning chip at zero and shows it above zero", () => {
    const { root, bar } = mount();

    bar.render(view({ warningCount: 0 }));
    expect((root.querySelector(".status-bar-chip") as HTMLElement).hidden).toBe(
      true,
    );

    bar.render(view({ warningCount: 3 }));
    const chip = root.querySelector(".status-bar-chip") as HTMLElement;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toContain("3 warnings");
  });

  it("opens the warnings filter from the chip without toggling the log", () => {
    const { root, bar, onShowWarnings, onToggleLog } = mount();
    bar.render(view({ warningCount: 1 }));

    (root.querySelector(".status-bar-chip") as HTMLElement).click();

    expect(onShowWarnings).toHaveBeenCalledTimes(1);
    expect(onToggleLog).not.toHaveBeenCalled();
  });

  it("toggles the log from the rest of the bar", () => {
    const { root, bar, onToggleLog, onShowWarnings } = mount();
    bar.render(view());

    (root.querySelector(".status-bar-location") as HTMLElement).click();

    expect(onToggleLog).toHaveBeenCalledTimes(1);
    expect(onShowWarnings).not.toHaveBeenCalled();
  });

  it("never takes focus on its own", () => {
    const { root, bar } = mount();
    bar.render(view());

    expect(root.tabIndex).toBe(-1);
    root.click();
    expect(document.activeElement).not.toBe(root);
  });

  it("does not intercept scrolling", () => {
    const { root, bar } = mount();
    bar.render(view());

    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    root.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { EventLog, type EventLogInput } from "./event-log";
import { EventLogPanel } from "./event-log-panel";

const NOW = 1_800_000_000_000;

function input(overrides: Partial<EventLogInput> = {}): EventLogInput {
  return {
    kind: "reload",
    severity: "info",
    message: "Configuration reloaded",
    ...overrides,
  };
}

function mount(entries: EventLogInput[] = []): {
  root: HTMLElement;
  log: EventLog;
  panel: EventLogPanel;
  opener: HTMLButtonElement;
  onClear: ReturnType<typeof vi.fn>;
  onVisibilityChange: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML =
    '<div id="event-log"></div><button id="opener">open</button>';
  const root = document.getElementById("event-log") as HTMLElement;
  const opener = document.getElementById("opener") as HTMLButtonElement;
  const log = new EventLog(() => NOW);
  for (const entry of entries) log.record(entry);
  const onClear = vi.fn();
  const onVisibilityChange = vi.fn();
  const panel = new EventLogPanel(root, {
    log,
    formatTime: () => "12:00:00",
    onClear,
    onVisibilityChange,
  });
  return { root, log, panel, opener, onClear, onVisibilityChange };
}

function scrollElement(root: HTMLElement): HTMLElement {
  return root.querySelector(".event-log-scroll") as HTMLElement;
}

function setViewport(
  host: HTMLElement,
  values: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(host, "scrollHeight", {
    value: values.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(host, "clientHeight", {
    value: values.clientHeight,
    configurable: true,
  });
  host.scrollTop = values.scrollTop;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("EventLogPanel", () => {
  it("shows an explicit empty state", () => {
    const { root, panel, opener } = mount();
    panel.open(opener);

    expect(root.hidden).toBe(false);
    expect(root.querySelector(".event-log-empty")?.textContent).toBe(
      "No events in this session",
    );
    expect(root.querySelectorAll(".event-log-row").length).toBe(0);
  });

  it("filters between all entries and warnings", () => {
    const { root, panel, opener } = mount([
      input({ severity: "info", message: "one" }),
      input({ severity: "warning", message: "two" }),
      input({ severity: "error", message: "three" }),
    ]);
    panel.open(opener);

    expect(root.querySelectorAll(".event-log-row").length).toBe(3);

    (root.querySelector("[data-filter='warnings']") as HTMLButtonElement).click();
    expect(root.querySelectorAll(".event-log-row").length).toBe(1);
    expect(root.querySelector(".event-log-message")?.textContent).toBe("two");

    (root.querySelector("[data-filter='all']") as HTMLButtonElement).click();
    expect(root.querySelectorAll(".event-log-row").length).toBe(3);
  });

  it("shows the warning empty state when no warnings exist", () => {
    const { root, panel, opener } = mount([input({ severity: "info" })]);
    panel.open(opener, "warnings");

    expect(root.querySelector(".event-log-empty")?.textContent).toBe(
      "No warnings in this session",
    );
  });

  it("renders timestamp, severity, message and full detail", () => {
    const { root, panel, opener } = mount([
      input({
        severity: "warning",
        message: "skipped",
        detail: "line one\nline two",
      }),
    ]);
    panel.open(opener);

    const row = root.querySelector(".event-log-row") as HTMLElement;
    expect(row.querySelector(".event-log-time")?.textContent).toBe("12:00:00");
    expect(row.querySelector(".event-log-severity")?.textContent).toBe(
      "warning",
    );
    expect(row.querySelector(".event-log-message")?.textContent).toBe("skipped");
    expect(row.querySelector(".event-log-detail")?.textContent).toBe(
      "line one\nline two",
    );
  });

  it("clears entries and keeps the panel open", () => {
    const { root, log, panel, opener, onClear } = mount([
      input({ severity: "warning" }),
    ]);
    panel.open(opener);

    (root.querySelector(".event-log-clear") as HTMLButtonElement).click();

    expect(log.size).toBe(0);
    expect(panel.isOpen).toBe(true);
    expect(root.querySelectorAll(".event-log-row").length).toBe(0);
    expect(root.querySelector(".event-log-empty")?.textContent).toBe(
      "No events in this session",
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("follows new entries at the bottom without jumping", () => {
    const { root, log, panel, opener } = mount([input({ message: "one" })]);
    panel.open(opener);
    const host = scrollElement(root);
    setViewport(host, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 600 });

    log.record(input({ message: "two" }));
    panel.sync();

    expect(root.querySelectorAll(".event-log-row").length).toBe(2);
    expect(panel.following).toBe(true);
    expect(host.scrollTop).toBe(1_000);
    expect(
      (root.querySelector(".event-log-new") as HTMLElement).hidden,
    ).toBe(true);
  });

  it("pauses following when scrolled up and counts new events", () => {
    const { root, log, panel, opener } = mount([input({ message: "one" })]);
    panel.open(opener);
    const host = scrollElement(root);
    setViewport(host, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 100 });
    host.dispatchEvent(new Event("scroll"));

    expect(panel.following).toBe(false);

    log.record(input({ message: "two" }));
    panel.sync();
    log.record(input({ message: "three" }));
    panel.sync();

    expect(host.scrollTop).toBe(100);
    const pill = root.querySelector(".event-log-new") as HTMLElement;
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toContain("2 new events");
  });

  it("resumes following and clears the counter at the bottom", () => {
    const { root, log, panel, opener } = mount([input({ message: "one" })]);
    panel.open(opener);
    const host = scrollElement(root);
    setViewport(host, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 100 });
    host.dispatchEvent(new Event("scroll"));

    log.record(input({ message: "two" }));
    panel.sync();

    host.scrollTop = 600;
    host.dispatchEvent(new Event("scroll"));

    expect(panel.following).toBe(true);
    const pill = root.querySelector(".event-log-new") as HTMLElement;
    expect(pill.hidden).toBe(true);
  });

  it("closes only the panel on Escape", () => {
    const { root, panel, opener } = mount();
    panel.open(opener);

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(panel.isOpen).toBe(false);
    expect(root.hidden).toBe(true);
  });

  it("returns focus to the opener when closed", () => {
    const { panel, opener } = mount();
    opener.focus();
    panel.open(opener);

    panel.close();

    expect(document.activeElement).toBe(opener);
  });
});

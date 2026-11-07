import { describe, expect, it } from "vitest";

import { EventLog, type EventLogInput } from "./event-log";

const NOW = 1_800_000_000_000;

function input(overrides: Partial<EventLogInput> = {}): EventLogInput {
  return {
    kind: "reload",
    severity: "info",
    message: "Configuration reloaded",
    ...overrides,
  };
}

describe("EventLog", () => {
  it("stamps entries with an injected clock and monotonic ids", () => {
    let now = NOW;
    const log = new EventLog(() => now);

    const first = log.record(input({ message: "one" }));
    now += 1_000;
    const second = log.record(input({ message: "two" }));

    expect(first.at).toBe(NOW);
    expect(second.at).toBe(NOW + 1_000);
    expect(second.id).toBe(first.id + 1);
  });

  it("keeps oldest-first ordering with the newest last", () => {
    const log = new EventLog(() => NOW);
    log.record(input({ message: "one" }));
    log.record(input({ message: "two" }));
    log.record(input({ message: "three" }));

    expect(log.entries().map((entry) => entry.message)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("trims the message and never stores blank text", () => {
    const log = new EventLog(() => NOW);
    const trimmed = log.record(input({ message: "  spaced  " }));
    const blank = log.record(input({ message: "   " }));

    expect(trimmed.message).toBe("spaced");
    expect(blank.message.length).toBeGreaterThan(0);
  });

  it("filters warning entries", () => {
    const log = new EventLog(() => NOW);
    log.record(input({ severity: "info" }));
    log.record(input({ severity: "warning", message: "bad" }));
    log.record(input({ severity: "warning", message: "worse" }));
    log.record(input({ severity: "error", message: "failed" }));

    expect(log.warnings().map((entry) => entry.message)).toEqual([
      "bad",
      "worse",
    ]);
  });

  it("evicts the oldest entry beyond its 500-entry capacity", () => {
    const log = new EventLog(() => NOW);
    for (let index = 0; index < 501; index += 1) {
      log.record(input({ message: `event ${index}` }));
    }

    expect(log.capacity).toBe(500);
    expect(log.size).toBe(500);
    expect(log.entries()[0].message).toBe("event 1");
    expect(log.entries()[499].message).toBe("event 500");
  });

  it("clear empties entries but keeps the id counter and capacity", () => {
    const log = new EventLog(() => NOW);
    const before = log.record(input({ message: "one" }));
    log.record(input({ message: "two" }));

    log.clear();

    expect(log.entries()).toEqual([]);
    expect(log.size).toBe(0);
    expect(log.capacity).toBe(500);

    const after = log.record(input({ message: "three" }));
    expect(after.id).toBeGreaterThan(before.id);
  });

  it("never reuses ids after clear", () => {
    const log = new EventLog(() => NOW);
    log.record(input());
    log.record(input());
    log.clear();
    const next = log.record(input());

    expect(next.id).toBe(3);
  });

  it("keeps the size within 0 … 500 at all times", () => {
    const log = new EventLog(() => NOW);
    expect(log.size).toBe(0);

    for (let index = 0; index < 620; index += 1) log.record(input());
    expect(log.size).toBe(500);
  });

  it("never writes to localStorage", () => {
    const log = new EventLog(() => NOW);
    log.record(input());
    log.clear();
    expect(window.localStorage.length).toBe(0);
  });
});

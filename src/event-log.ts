/**
 * Session-only store for watch and scan lifecycle events.
 *
 * DOM-free and never persisted: constructing the app always starts empty, and
 * `clear()` is irreversible for the rest of the session. The capacity is fixed
 * so a long agent session cannot grow memory without bound.
 */

export type EventSeverity = "info" | "warning" | "error";

export type EventKind =
  | "scan-start"
  | "scan-complete"
  | "reload"
  | "watch-added"
  | "watch-removed"
  | "warning"
  | "truncated"
  | "error";

export interface StatusEvent {
  /** Monotonic within a session; never reused, even after `clear()`. */
  id: number;
  /** Epoch ms from the injected clock. */
  at: number;
  kind: EventKind;
  severity: EventSeverity;
  /** One plain-text line, used by the status bar. */
  message: string;
  /** Full warning/error text shown in the log row. */
  detail?: string;
}

export interface EventLogInput {
  kind: EventKind;
  severity: EventSeverity;
  message: string;
  detail?: string;
}

export class EventLog {
  /** FR-016: retain at least the 500 most recent entries. */
  public readonly capacity = 500;

  private readonly items: StatusEvent[] = [];
  private nextId = 1;

  constructor(private readonly now: () => number = Date.now) {}

  /** Appends one event, evicting the oldest entry when the log is full. */
  public record(input: EventLogInput): StatusEvent {
    const message = input.message.trim() || "Event";
    const event: StatusEvent = {
      id: this.nextId,
      at: this.now(),
      kind: input.kind,
      severity: input.severity,
      message,
    };
    this.nextId += 1;

    const detail = input.detail?.trim();
    if (detail) event.detail = detail;

    this.items.push(event);
    if (this.items.length > this.capacity) this.items.shift();
    return event;
  }

  /** Oldest first; the newest entry is last. */
  public entries(): readonly StatusEvent[] {
    return this.items;
  }

  /** Warning-severity entries, in insertion order. */
  public warnings(): readonly StatusEvent[] {
    return this.items.filter((entry) => entry.severity === "warning");
  }

  /** Empties the entries but keeps the id counter and capacity. */
  public clear(): void {
    this.items.length = 0;
  }

  public get size(): number {
    return this.items.length;
  }
}

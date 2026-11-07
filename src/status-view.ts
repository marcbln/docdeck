/**
 * Pure view model for the one-line status bar.
 *
 * Precedence: live scan progress > the newest logged event > a quiet idle
 * line. The bar never disappears and never grows beyond one line.
 */

import type { EventSeverity, StatusEvent } from "./event-log";
import type { ScanProgress } from "./inbox-model";
import { compactPath } from "./project";

export type StatusPhase = "scanning" | "idle";

export interface StatusBarView {
  phase: StatusPhase;
  location: string | null;
  directories: number;
  files: number;
  event: StatusEvent | null;
  warningCount: number;
  severity: EventSeverity;
  text: string;
}

export interface StatusInput {
  /** A config or folder scan is in flight. */
  scanning: boolean;
  /** The most recent progress tick, if one has arrived. */
  progress: ScanProgress | null;
  /** The current event log, oldest first. */
  entries: readonly StatusEvent[];
  /** Number of registered watch roots, used by the idle line. */
  watchCount: number;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function deriveStatusBar(input: StatusInput): StatusBarView {
  const warningCount = input.entries.reduce(
    (total, entry) => total + (entry.severity === "warning" ? 1 : 0),
    0,
  );

  if (input.scanning) {
    if (input.progress === null) {
      return {
        phase: "scanning",
        location: null,
        directories: 0,
        files: 0,
        event: null,
        warningCount,
        severity: "info",
        text: "Scanning watched paths…",
      };
    }

    const location = compactPath(input.progress.path);
    const folders = plural(input.progress.directories, "folder");
    const files = plural(input.progress.files, "file");
    return {
      phase: "scanning",
      location,
      directories: input.progress.directories,
      files: input.progress.files,
      event: null,
      warningCount,
      severity: "info",
      text: `Scanning ${location} (${folders} · ${files})`,
    };
  }

  if (input.entries.length > 0) {
    const event = input.entries[input.entries.length - 1];
    return {
      phase: "idle",
      location: null,
      directories: 0,
      files: 0,
      event,
      warningCount,
      severity: event.severity,
      text: oneLine(event.message),
    };
  }

  return {
    phase: "idle",
    location: null,
    directories: 0,
    files: 0,
    event: null,
    warningCount,
    severity: "info",
    text:
      input.watchCount > 0
        ? `Watching ${plural(input.watchCount, "folder")}`
        : "Ready",
  };
}

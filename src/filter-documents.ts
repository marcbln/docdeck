/**
 * Session-only document filtering.
 *
 * Pure and DOM-free: the caller keeps the term, and the returned array keeps the
 * input order so the virtual list and Recently Changed ordering are untouched.
 */

import type { InboxEntry } from "./inbox-model";
import { projectName } from "./project";

/**
 * Narrows `entries` to a case-insensitive literal substring of the filename,
 * full path, or project name.
 *
 * The term is trimmed and lower-cased once. An empty or whitespace-only term
 * returns a copy of the whole list. Entries are never mutated and relative order
 * is preserved.
 */
export function filterEntries<T extends Pick<InboxEntry, "path" | "filename">>(
  entries: readonly T[],
  term: string,
): T[] {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return [...entries];

  return entries.filter((entry) => {
    if (entry.filename.toLowerCase().includes(needle)) return true;
    if (entry.path.toLowerCase().includes(needle)) return true;
    const project = projectName(entry.path);
    return project !== null && project.toLowerCase().includes(needle);
  });
}

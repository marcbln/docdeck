import { formatExactTime, formatRelativeTime } from "./relative-time";
import { compactPath, parentPath, projectName } from "./project";
import type { InboxEntry } from "./inbox-model";

/**
 * Row anatomy shared by the browse list and the pop-out inventory.
 *
 * The row is two lines: a project chip plus filename, then the compacted parent
 * path and relative modification time.
 */
export function createInboxRow(): HTMLElement {
  const row = document.createElement("li");
  row.className = "inbox-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const top = document.createElement("div");
  top.className = "inbox-row-top";
  const chip = document.createElement("span");
  chip.className = "inbox-project";
  const name = document.createElement("span");
  name.className = "inbox-filename";
  const dot = document.createElement("span");
  dot.className = "inbox-dot";
  top.append(chip, name, dot);

  const bottom = document.createElement("div");
  bottom.className = "inbox-row-bottom";
  const parent = document.createElement("span");
  parent.className = "inbox-parent";
  const time = document.createElement("time");
  time.className = "inbox-time";
  bottom.append(parent, time);

  row.append(top, bottom);
  return row;
}

/** Fills a row's content and state; positioning belongs to the list owner. */
export function bindInboxRow(
  row: HTMLElement,
  entry: InboxEntry,
  openPaths: ReadonlySet<string>,
  activePath: string | null,
  now: number,
): void {
  row.dataset.path = entry.path;
  row.className = "inbox-row";
  if (entry.unread) row.classList.add("unread");
  if (entry.deleted) row.classList.add("deleted");
  if (openPaths.has(entry.path)) row.classList.add("open");
  if (entry.path === activePath) row.classList.add("active");

  const project = projectName(entry.path);
  const chip = row.querySelector<HTMLElement>(".inbox-project")!;
  chip.hidden = project === null;
  chip.textContent = project ?? "";

  const name = row.querySelector<HTMLElement>(".inbox-filename")!;
  name.textContent = entry.filename;
  name.title = entry.deleted ? `${entry.path} (deleted on disk)` : entry.path;

  const parentPathText = parentPath(entry.path);
  const parent = row.querySelector<HTMLElement>(".inbox-parent")!;
  parent.textContent = compactPath(parentPathText);
  parent.title = parentPathText;

  const time = row.querySelector<HTMLTimeElement>(".inbox-time")!;
  time.dateTime = new Date(entry.modifiedTime).toISOString();
  time.textContent = formatRelativeTime(entry.modifiedTime, now);
  time.title = formatExactTime(entry.modifiedTime);
}

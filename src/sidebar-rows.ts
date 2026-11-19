import { formatExactTime, formatRelativeTime } from "./relative-time";
import { compactPath, parentPath, projectName } from "./project";
import type { InboxEntry } from "./inbox-model";

/**
 * Row anatomy shared by the browse list, the bookmarks view and the pop-out
 * inventory.
 *
 * The row is two lines inside a real activation button; the bookmark star is a
 * sibling button so no interactive control is nested inside another. Clicking
 * the star never activates the row.
 */
export function createInboxRow(): HTMLElement {
  const row = document.createElement("li");
  row.className = "inbox-row";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "inbox-row-main";

  const top = document.createElement("span");
  top.className = "inbox-row-top";
  const chip = document.createElement("span");
  chip.className = "inbox-project";
  const name = document.createElement("span");
  name.className = "inbox-filename";
  const dot = document.createElement("span");
  dot.className = "inbox-dot";
  top.append(chip, name, dot);

  const bottom = document.createElement("span");
  bottom.className = "inbox-row-bottom";
  const parent = document.createElement("span");
  parent.className = "inbox-parent";
  const time = document.createElement("time");
  time.className = "inbox-time";
  bottom.append(parent, time);

  main.append(top, bottom);

  const bookmark = document.createElement("button");
  bookmark.type = "button";
  bookmark.className = "inbox-bookmark";
  bookmark.setAttribute("aria-pressed", "false");
  bookmark.textContent = "☆";

  row.append(main, bookmark);
  return row;
}

/** Fills a row's content and state; positioning belongs to the list owner. */
export function bindInboxRow(
  row: HTMLElement,
  entry: InboxEntry,
  openPaths: ReadonlySet<string>,
  activePath: string | null,
  now: number,
  bookmarked = false,
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

  const main = row.querySelector<HTMLButtonElement>(".inbox-row-main")!;
  main.setAttribute("aria-label", `${entry.filename}${project ? ` in ${project}` : ""}`);

  const star = row.querySelector<HTMLButtonElement>(".inbox-bookmark")!;
  star.setAttribute("aria-pressed", String(bookmarked));
  star.setAttribute("aria-label", bookmarked
    ? `Remove bookmark for ${entry.filename}`
    : `Bookmark ${entry.filename}`);
  star.title = bookmarked ? "Remove bookmark" : "Bookmark document";
  star.textContent = bookmarked ? "★" : "☆";
}

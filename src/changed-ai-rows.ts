/**
 * DOM builders for the transient **Changed `_ai`** view.
 *
 * One focusable native button per row, with no close, star, unread or dismiss
 * control. Badges are real text, never colour alone. The builders are thin on
 * purpose: ordering, state selection and copy live in `changed-ai-model.ts`.
 */

import {
  DISCOVERY_TRUNCATED_WARNING,
  changedBadgeLabels,
  changedRepositoryErrors,
  changedStateMessage,
  type ChangedRepository,
  type ChangedRow,
  type ChangedScope,
  type ChangedViewState,
} from "./changed-ai-model";
import { fileName } from "./project";
import { formatExactTime, formatRelativeTime } from "./relative-time";

/** One recycled `<li>` whose only interactive element is the row button. */
export function createChangedRow(): HTMLElement {
  const row = document.createElement("li");
  row.className = "changed-row";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "changed-row-main";

  const title = document.createElement("span");
  title.className = "changed-row-title";
  const chip = document.createElement("span");
  chip.className = "project-chip";
  const filename = document.createElement("span");
  filename.className = "changed-row-filename";
  title.append(chip, filename);

  const context = document.createElement("span");
  context.className = "changed-row-context";

  const meta = document.createElement("span");
  meta.className = "changed-row-meta";
  const badges = document.createElement("span");
  badges.className = "changed-row-badges";
  const time = document.createElement("time");
  time.className = "changed-row-time";
  meta.append(badges, time);

  main.append(title, context, meta);
  row.append(main);
  return row;
}

/**
 * Fills one row and binds its single activation handler.
 *
 * Enter and Space are handled explicitly with `preventDefault`, which also
 * suppresses the browser's synthesized click, so one keypress activates once.
 * Middle click is not handled at all: the row has no dismissal action.
 */
export function bindChangedRow(
  row: HTMLElement,
  item: ChangedRow,
  now: number,
  onActivate?: (item: ChangedRow) => void,
): void {
  row.dataset.path = item.path;
  row.className = "changed-row";

  const main = row.querySelector<HTMLButtonElement>(".changed-row-main")!;
  const chip = row.querySelector<HTMLElement>(".project-chip")!;
  const filename = row.querySelector<HTMLElement>(".changed-row-filename")!;
  const context = row.querySelector<HTMLElement>(".changed-row-context")!;
  const badges = row.querySelector<HTMLElement>(".changed-row-badges")!;
  const time = row.querySelector<HTMLTimeElement>(".changed-row-time")!;

  chip.textContent = item.project;
  filename.textContent = item.filename;
  filename.title = item.path;
  context.textContent = item.context;
  context.title = item.path;

  const labels = changedBadgeLabels(item);
  badges.replaceChildren();
  const classes: Record<string, string> = {
    Staged: "staged",
    Unstaged: "unstaged",
    New: "untracked",
  };
  for (const label of labels) {
    const badge = document.createElement("span");
    badge.className = `change-badge change-badge--${classes[label] ?? "staged"}`;
    badge.textContent = label;
    badges.append(badge);
  }
  badges.hidden = labels.length === 0;

  let timeText: string;
  if (item.modifiedTime === null) {
    time.removeAttribute("datetime");
    time.textContent = "unknown time";
    time.title = "Modification time unavailable";
    timeText = "unknown time";
  } else {
    time.dateTime = new Date(item.modifiedTime).toISOString();
    timeText = formatRelativeTime(item.modifiedTime, now);
    time.textContent = timeText;
    time.title = formatExactTime(item.modifiedTime);
  }

  main.title = item.path;
  main.setAttribute(
    "aria-label",
    [item.filename, item.project, ...labels, timeText].join(", "),
  );

  const activate = (): void => onActivate?.(item);
  main.onclick = activate;
  main.onkeydown = (event): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
}

/**
 * The scope banner: names the repository and the full root, with exactly one
 * action that returns to every watched repository.
 */
export function createScopeBanner(
  scope: ChangedScope,
  onShowAll: () => void,
): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "changed-scope-banner";
  banner.setAttribute("role", "note");

  const label = document.createElement("span");
  label.className = "changed-scope-label";
  label.textContent = `Showing changes in ${fileName(scope.repository) || scope.repository} — ${scope.repository}`;
  banner.append(label);

  const showAll = document.createElement("button");
  showAll.type = "button";
  showAll.className = "sidebar-inline-action changed-scope-show-all";
  showAll.textContent = "Show all watched repositories";
  showAll.setAttribute("aria-label", "Show all watched repositories");
  showAll.addEventListener("click", onShowAll);
  banner.append(showAll);

  return banner;
}

/** One line per failing repository, naming it and its reason. */
export function createRepositoryErrorBanner(
  repositories: readonly ChangedRepository[],
): HTMLElement {
  const host = document.createElement("div");
  host.className = "changed-repo-errors";
  host.setAttribute("role", "note");

  const lines = changedRepositoryErrors(repositories);
  host.hidden = lines.length === 0;
  for (const line of lines) {
    const row = document.createElement("p");
    row.className = "changed-repo-error";
    row.textContent = `⚠ ${line}`;
    host.append(row);
  }
  return host;
}

export interface ChangedStatePanelOptions {
  /** Rendered only for the scope-error state, which has no scope banner. */
  onShowAll?: () => void;
}

/**
 * The live region for loading, empty, partial and error states.
 *
 * Loading/refreshing set `aria-busy`, so a screen reader announces the quiet
 * refresh instead of reading the old rows as fresh.
 */
export function createStatePanel(
  state: ChangedViewState,
  options: ChangedStatePanelOptions = {},
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "changed-state-panel";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  const busy = state.status === "loading" || state.status === "refreshing";
  panel.setAttribute("aria-busy", String(busy));

  const message = document.createElement("p");
  message.className = "changed-state-message";
  message.textContent = changedStateMessage(state);
  panel.append(message);

  if (state.discoveryTruncated) {
    const warning = document.createElement("p");
    warning.className = "changed-state-warning";
    warning.textContent = DISCOVERY_TRUNCATED_WARNING;
    panel.append(warning);
  }

  if (state.status === "scope-error" && options.onShowAll !== undefined) {
    const showAll = document.createElement("button");
    showAll.type = "button";
    showAll.className = "sidebar-inline-action changed-scope-show-all";
    showAll.textContent = "Show all watched repositories";
    showAll.setAttribute("aria-label", "Show all watched repositories");
    showAll.addEventListener("click", options.onShowAll);
    panel.append(showAll);
  }

  return panel;
}

/**
 * Path helpers shared by the inbox panel and the watcher integration.
 *
 * The backend canonicalizes paths, so these compare plain absolute strings;
 * component-awareness (not `startsWith`) keeps `/ab` from being treated as
 * under `/a`.
 */

export function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : "";
  return path.slice(0, index);
}

export function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix);
}

export function isUnderAny(path: string, roots: Iterable<string>): boolean {
  for (const root of roots) {
    if (isUnder(path, root)) return true;
  }
  return false;
}

/**
 * The project a path belongs to: the component directly above the deepest
 * `_ai` segment, or null when no `_ai` exists.
 *
 * `~/devel/docdeck/_ai/backlog/plan.md` → `docdeck`. The fallback of using a
 * watch-root basename is deliberately absent: labels such as `devel` or
 * `reports` would be misleading.
 */
export function projectName(path: string): string | null {
  const parts = path.split("/");
  let deepest = -1;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "_ai") deepest = index;
  }
  if (deepest <= 0) return null;
  return parts[deepest - 1] || null;
}

/** Shortens a path for display, keeping the tail segments. */
export function compactPath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path;

  const parts = path.split("/");
  const tail: string[] = [];
  let length = 0;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    const addition = tail.length === 0 ? part.length : part.length + 1;
    if (length + addition > maxLength - 2) break;
    tail.unshift(part);
    length += addition;
  }

  if (tail.length === 0 || tail.length === parts.length) return path;
  return `…/${tail.join("/")}`;
}

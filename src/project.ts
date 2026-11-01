/**
 * Path helpers shared by the inbox panel and the watcher integration.
 *
 * The backend canonicalizes paths, so these compare plain absolute strings;
 * component-awareness (not `startsWith`) keeps `/ab` from being treated as
 * under `/a`.
 *
 * Separators: a Windows-shaped path (drive prefix, or backslashes and no
 * forward slashes) uses both `\` and `/` as separators. On a Unix-shaped path a
 * backslash is an ordinary filename character and is never split.
 */

interface PathShape {
  components: string[];
  /** Separator used when rejoining. */
  separator: string;
  /** Windows paths compare case-insensitively. */
  windows: boolean;
  /** Prefix preserved by `parentPath` (`/` or `C:`); empty for relative paths. */
  root: string;
}

function shape(path: string): PathShape {
  const windows =
    /^[A-Za-z]:[\\/]/.test(path) ||
    (path.includes("\\") && !path.includes("/")) ||
    path.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const normalized = windows ? path.split("\\").join("/") : path;

  let root = "";
  let rest = normalized;
  if (windows) {
    const match = /^([A-Za-z]:)(?:\/|$)/.exec(normalized);
    if (match) {
      root = match[1];
      rest = normalized.slice(match[0].length);
    } else if (normalized.startsWith("//")) {
      root = "//";
      rest = normalized.slice(2);
    }
  } else if (normalized.startsWith("/")) {
    root = "/";
    rest = normalized.slice(1);
  }

  const components = rest.split("/").filter((part) => part.length > 0);
  return { components, separator, windows, root };
}

function join(parts: PathShape, components: string[]): string {
  const body = components.join(parts.separator);
  if (parts.windows) {
    if (parts.root === "//") return `//${body}`;
    if (parts.root) return `${parts.root}${parts.separator}${body}`;
    return body;
  }
  if (parts.root === "/") return `/${body}`;
  return body;
}

export function fileName(path: string): string {
  const parts = shape(path);
  return parts.components[parts.components.length - 1] ?? path;
}

export function parentPath(path: string): string {
  const parts = shape(path);
  if (parts.components.length <= 1) {
    return parts.root || (parts.windows ? "" : "");
  }
  return join(parts, parts.components.slice(0, -1));
}

function comparable(parts: PathShape): string[] {
  return parts.windows
    ? parts.components.map((part) => part.toLowerCase())
    : parts.components;
}

export function isUnder(path: string, root: string): boolean {
  const pathParts = shape(path);
  const rootParts = shape(root);
  const sameRoot =
    pathParts.windows && rootParts.windows
      ? pathParts.root.toLowerCase() === rootParts.root.toLowerCase()
      : pathParts.root === rootParts.root;
  if (!sameRoot) return false;

  const parent = comparable(pathParts);
  const child = comparable(rootParts);
  if (child.length > parent.length) return false;
  return child.every((part, index) => parent[index] === part);
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
  const parts = shape(path).components;
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

  const parts = shape(path);
  const separator = parts.separator;
  const tail: string[] = [];
  let length = 0;
  for (let index = parts.components.length - 1; index >= 0; index -= 1) {
    const part = parts.components[index];
    const addition = tail.length === 0 ? part.length : part.length + 1;
    if (length + addition > maxLength - 2) break;
    tail.unshift(part);
    length += addition;
  }

  if (tail.length === 0 || tail.length === parts.components.length) return path;
  return `…${separator}${tail.join(separator)}`;
}

/**
 * Classification of one href found in rendered Markdown.
 *
 * Filesystem resolution is deliberately not done here: it needs platform-aware
 * path handling and is owned by the Rust `resolve_document_link` command.
 */
export type LinkTarget =
  | { kind: "empty" }
  | { kind: "fragment"; fragment: string }
  | { kind: "external"; url: string }
  | { kind: "mailto"; url: string }
  | { kind: "local"; path: string; fragment: string | null }
  | { kind: "blocked"; reason: string };

/** A local target after the Rust resolver has canonicalized it. */
export interface ResolvedLink {
  path: string;
  isDir: boolean;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

/** Decodes an href component, falling back to the raw text on malformed input. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits a raw relative href into a decoded path and fragment. */
function classifyLocalPath(raw: string): LinkTarget {
  const hashIndex = raw.indexOf("#");
  const fragment =
    hashIndex >= 0 ? decode(raw.slice(hashIndex + 1)) || null : null;
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;

  const queryIndex = withoutFragment.indexOf("?");
  const rawPath =
    queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const path = decode(rawPath);

  return path === ""
    ? { kind: "blocked", reason: "empty path" }
    : { kind: "local", path, fragment };
}

/** Converts a `file:` URL into the local path the resolver expects. */
function classifyFileUrl(raw: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "blocked", reason: "malformed file URL" };
  }

  let path = decode(url.pathname);
  // URL pathnames serialize Windows drives as `/C:/...`.
  if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
  // Preserve UNC hosts for the OS handler.
  if (url.hostname !== "" && url.hostname !== "localhost") {
    path = `//${url.hostname}${path}`;
  }

  const fragment = url.hash === "" ? null : decode(url.hash.slice(1)) || null;
  return { kind: "local", path, fragment };
}

/**
 * Classifies one rendered href.
 *
 * Same-document fragments scroll, http(s)/mailto go to the OS handler, local
 * paths are resolved later against the active document, and everything else is
 * blocked with a reason suitable for a toast.
 */
export function classifyLink(rawHref: string): LinkTarget {
  const href = rawHref.trim();
  if (href === "" || href === "#") return { kind: "empty" };

  if (href.startsWith("#")) {
    return { kind: "fragment", fragment: decode(href.slice(1)) };
  }

  // Protocol-relative links inherit the page scheme in a browser; docdeck
  // always chooses https for a desktop viewer.
  if (href.startsWith("//")) {
    return { kind: "external", url: `https:${href}` };
  }

  const match = SCHEME.exec(href);
  if (match !== null && !WINDOWS_DRIVE.test(href)) {
    const scheme = match[1].toLowerCase();
    if (scheme === "http" || scheme === "https") {
      return { kind: "external", url: href };
    }
    if (scheme === "mailto") return { kind: "mailto", url: href };
    if (scheme === "file") return classifyFileUrl(href);
    return { kind: "blocked", reason: `unsupported scheme "${scheme}:"` };
  }

  return classifyLocalPath(href);
}

/** Whether a resolved path should open as a docdeck document tab. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
